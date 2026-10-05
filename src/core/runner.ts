import path from "node:path";
import picomatch from "picomatch";
import { CONFIG_NAMES, loadConfig, parseConfigText } from "./config.js";
import { ALWAYS_IGNORE, createWorkspace, discoverAll } from "./discover.js";
import { diskFs, type FileSystem } from "./fs.js";
import { score } from "./score.js";
import { todayIso } from "./parse.js";
import { applyBaseline, type Baseline } from "./baseline.js";
import { RULES } from "../rules/index.js";
import type { Config, ContextFile, Diagnostic, LintResult, RuleSet, RunStats, Severity } from "./types.js";

export interface LintOptions {
  config?: Config;
  configPath?: string;
  baseline?: Baseline;
  /** Custom file system (in-memory, git tree, ...). Defaults to the disk under `root`. */
  fs?: FileSystem;
  /** Override "today" (YYYY-MM-DD) for reproducible expiry checks. */
  today?: string;
  /** Restrict findings to instruction files affected by these changed paths (see core/git.ts). */
  changed?: Set<string>;
  /** Label for the git ref the changed set was computed against. */
  since?: string;
  /** Honour nested obelos.config.json files in subdirectories. Default true. */
  cascade?: boolean;
}

const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

function covers(set: RuleSet | null | undefined, id: string): boolean {
  return set === "all" || (set instanceof Set && set.has(id));
}

function isSuppressed(d: Diagnostic, byPath: Map<string, ContextFile>): boolean {
  const f = byPath.get(d.file);
  if (!f) return false;
  if (covers(f.disables.file, d.ruleId)) return true;
  return d.line !== undefined && covers(f.disables.lines.get(d.line), d.ruleId);
}

interface Nested {
  dir: string;
  config: Config;
  ignore: (rel: string) => boolean;
}

function loadNested(fsys: FileSystem, today: string): Nested[] {
  const names = CONFIG_NAMES.flatMap((n) => [`**/${n}`]);
  const found = fsys.glob(names, ALWAYS_IGNORE, 20).filter((p) => p.includes("/")).sort();
  const seenDirs = new Set<string>();
  const out: Nested[] = [];
  const prefix = fsys.abs("").replace(/\/$/, "") + "/";
  const read = (abs: string): string | null => {
    if (abs.startsWith(prefix)) {
      const buf = fsys.readBytes(abs.slice(prefix.length));
      return buf ? buf.toString("utf8") : null;
    }
    return null;
  };
  for (const rel of found) {
    const dir = path.posix.dirname(rel);
    if (seenDirs.has(dir)) continue; // first config name wins per directory, like the root
    seenDirs.add(dir);
    const buf = fsys.readBytes(rel);
    if (!buf) continue;
    const config = parseConfigText(buf.toString("utf8"), fsys.abs(rel), { read });
    const local = config.ignore.length ? picomatch(config.ignore, { dot: true }) : () => false;
    out.push({ dir, config, ignore: (r) => local(r.slice(dir.length + 1)) });
  }
  void today;
  return out;
}

/** Keep findings in changed instruction files, or in files whose references point at changed paths. */
function scopeToChanged(diagnostics: Diagnostic[], files: ContextFile[], changed: Set<string>): Diagnostic[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const hits = (p: string) => {
    for (const c of changed) if (c === p || c.startsWith(p.replace(/\/$/, "") + "/")) return true;
    return false;
  };
  const affected = new Set<string>();
  for (const f of files) {
    if (changed.has(f.path)) {
      affected.add(f.path);
      continue;
    }
    const refs = [...f.imports, ...f.pathRefs].map((r) => r.value.replace(/^\.\//, ""));
    const resolved = refs.flatMap((r) => [r, path.posix.normalize(path.posix.join(f.dir, r))]);
    if (resolved.some(hits)) affected.add(f.path);
    else if (f.scriptRefs.length && [...changed].some((c) => c === "package.json" || c.endsWith("/package.json"))) affected.add(f.path);
    else if (f.kind === "claude-local" && [...changed].some((c) => c.endsWith(".gitignore"))) affected.add(f.path);
  }
  return diagnostics.filter((d) => affected.has(d.file) || (!byPath.has(d.file) && changed.has(d.file)));
}

export function lint(rootInput: string, options: LintOptions = {}): LintResult {
  const t0 = performance.now();
  const root = options.fs ? rootInput : path.resolve(rootInput);
  const fsys = options.fs ?? diskFs(root);
  const today = options.today ?? todayIso();
  const config = options.config ?? (options.fs ? loadDefault() : loadConfig(root, options.configPath));
  const { files, notices } = discoverAll(fsys, config, today);
  const ws = createWorkspace(fsys, config, today, root);
  const nested = options.cascade === false ? [] : loadNested(fsys, today);

  const diagnostics: Diagnostic[] = [...notices];
  const ruleStats: RunStats["rules"] = [];
  const policyIds = new Set(config.policies.map((p) => `POL-${p.id.toUpperCase()}`));
  for (const id of Object.keys(config.rules)) {
    if (!RULES.some((r) => r.id === id) && !policyIds.has(id)) diagnostics.push({ ruleId: "OBL000", severity: "info", file: "(config)", message: `Config sets unknown rule ${id}; check the spelling (run \`obelos rules\`).` });
  }
  for (const rule of RULES) {
    if (config.rules[rule.id] === "off") continue;
    if (performance.now() - t0 > config.limits.timeoutMs) {
      diagnostics.push({ ruleId: "OBL000", severity: "info", file: "(internal)", message: `Time limit of ${config.limits.timeoutMs} ms reached; rule ${rule.id} and later rules were skipped.` });
      break;
    }
    const r0 = performance.now();
    let count = 0;
    try {
      for (const d of rule.run(files, ws)) {
        const override = config.rules[d.ruleId] ?? config.rules[rule.id];
        if (override === "off") continue;
        diagnostics.push(override ? { ...d, severity: override } : d);
        count++;
      }
    } catch (e) {
      // Isolate rule failures: one bad rule or file must never hide other findings.
      diagnostics.push({ ruleId: "OBL000", severity: "info", file: "(internal)", message: `Rule ${rule.id} failed: ${(e as Error).message}` });
    }
    ruleStats.push({ id: rule.id, ms: Math.round((performance.now() - r0) * 100) / 100, findings: count });
  }

  const ignoreFile = config.ignore.length ? picomatch(config.ignore, { dot: true }) : () => false;
  const byPath = new Map(files.map((f) => [f.path, f]));
  let kept: Diagnostic[] = [];
  for (const d of diagnostics) {
    if (ignoreFile(d.file)) continue;
    let sev: Severity | "off" = d.severity;
    let dropped = false;
    for (const n of nested) {
      if (!d.file.startsWith(n.dir + "/")) continue;
      if (n.ignore(d.file)) {
        dropped = true;
        break;
      }
      const o = n.config.rules[d.ruleId];
      if (o) sev = o;
    }
    if (dropped || sev === "off") continue;
    kept.push(sev === d.severity ? d : { ...d, severity: sev });
  }
  const before = kept.length;
  kept = kept.filter((d) => !isSuppressed(d, byPath));
  const suppressed = before - kept.length;
  let baselined = 0;
  if (options.baseline) {
    const r = applyBaseline(kept, options.baseline);
    kept = r.kept;
    baselined = r.baselined;
  }
  let scope: LintResult["scope"];
  if (options.changed) {
    kept = scopeToChanged(kept, files, options.changed);
    scope = { mode: "changed", since: options.since, changedFiles: options.changed.size };
  }
  kept.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || ORDER[a.severity] - ORDER[b.severity]);
  const stats: RunStats = {
    totalMs: Math.round((performance.now() - t0) * 100) / 100,
    filesDiscovered: files.length,
    rules: ruleStats,
    configSources: [...config.sources, ...nested.map((n) => `${n.dir}/(nested)`)],
    skipped: notices.map((n) => n.file),
  };
  return { root, files, diagnostics: kept, ...score(kept.filter((d) => d.ruleId !== "OBL000"), files.map((f) => f.path)), baselined, suppressed, scope, stats };
}

function loadDefault(): Config {
  return loadConfig("/nonexistent-obelos-root");
}
