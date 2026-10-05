import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { lint } from "./core/runner.js";
import { loadConfig } from "./core/config.js";
import { createWorkspace, discover, discoverAll } from "./core/discover.js";
import { diskFs } from "./core/fs.js";
import { createBaseline, loadBaseline } from "./core/baseline.js";
import { formatResolved, resolveContext } from "./core/resolve.js";
import { changedPaths } from "./core/git.js";
import { computeBudget, formatBudget } from "./core/budget.js";
import { badgeSvg, shieldsJson } from "./core/badge.js";
import { planInit } from "./core/init.js";
import { entryFrom, formatHistory, readHistory, recordHistory } from "./core/history.js";
import { formatScan, scan } from "./core/scan.js";
import { ObelosError, EXIT, exitCodeFor } from "./core/errors.js";
import { todayIso } from "./core/parse.js";
import { RULES } from "./rules/index.js";
import { RULE_DOCS } from "./rules/docs.js";
import { getReporter, reporterNames } from "./report/index.js";
import { VERSION, SCORE_VERSION } from "./version.js";
import type { LintResult, Severity } from "./core/types.js";

let debug = false;

function render(format: string, result: LintResult): string {
  const reporter = getReporter(format);
  if (!reporter) throw new ObelosError("USAGE", `Unknown format "${format}". Use one of: ${reporterNames().join(", ")}`);
  return reporter(result, { color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR });
}

function fail(e: unknown): void {
  const msg = (e as Error).message ?? String(e);
  console.error(`obelos: ${msg}`);
  if (debug && e instanceof Error && e.stack) console.error(e.stack);
  process.exitCode = exitCodeFor(e);
}

function verboseReport(result: LintResult): void {
  const s = result.stats;
  console.error(`[obelos] version ${VERSION}, score formula v${SCORE_VERSION}`);
  console.error(`[obelos] config: ${s.configSources.length ? s.configSources.join(", ") : "(defaults)"}`);
  console.error(`[obelos] ${s.filesDiscovered} instruction files in ${s.totalMs} ms`);
  for (const f of result.files) console.error(`[obelos]   ${f.path} (${f.kind})`);
  for (const k of s.skipped) console.error(`[obelos]   skipped: ${k}`);
  for (const r of s.rules) if (r.findings > 0 || r.ms >= 5) console.error(`[obelos]   ${r.id} ${r.ms} ms, ${r.findings} findings`);
}

function exitFor(result: LintResult, failOn: string, maxWarnings?: number): number {
  const order: Severity[] = ["error", "warn", "info"];
  const threshold = failOn === "never" ? -1 : order.indexOf(failOn as Severity);
  if (failOn !== "never" && threshold < 0) throw new ObelosError("USAGE", `Invalid --fail-on value "${failOn}". Use error, warn, info or never.`);
  if (threshold >= 0 && result.diagnostics.some((d) => d.ruleId !== "OBL000" && order.indexOf(d.severity) <= threshold)) return EXIT.FINDINGS;
  if (maxWarnings !== undefined && result.diagnostics.filter((d) => d.severity === "warn").length > maxWarnings) return EXIT.FINDINGS;
  return EXIT.OK;
}

interface LintCliOptions {
  format: string;
  failOn: string;
  maxWarnings?: number;
  baseline?: string;
  output?: string;
  config?: string;
  changedOnly?: boolean;
  since?: string;
  verbose?: boolean;
  debug?: boolean;
  cascade?: boolean;
  today?: string;
  watch?: boolean;
}

function runLint(p: string, opts: LintCliOptions): LintResult {
  const changed = opts.changedOnly || opts.since !== undefined ? changedPaths(p, opts.since) : undefined;
  return lint(p, {
    configPath: opts.config,
    baseline: opts.baseline ? loadBaseline(opts.baseline) : undefined,
    changed,
    since: opts.since,
    cascade: opts.cascade,
    today: opts.today,
  });
}

function watchLint(p: string, opts: LintCliOptions): void {
  const root = path.resolve(p);
  let timer: NodeJS.Timeout | null = null;
  const rerun = () => {
    try {
      const result = runLint(p, opts);
      console.clear();
      console.log(render(opts.format, result));
      console.log(`\nWatching ${root} (Ctrl-C to stop)`);
    } catch (e) {
      console.error(`obelos: ${(e as Error).message}`);
    }
  };
  rerun();
  const relevant = /(^|\/)(CLAUDE(\.local)?\.md|AGENTS\.md|GEMINI\.md|\.cursorrules|package\.json|\.gitignore|obelos\.config\.json|\.obelosrc\.json|copilot-instructions\.md)$|\.claude\/|\.cursor\/rules\/|\.github\/instructions\//;
  fs.watch(root, { recursive: true }, (_event, file) => {
    if (!file || !relevant.test(String(file).replace(/\\/g, "/")) || /node_modules|\.git\//.test(String(file))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(rerun, 200);
  });
}

const program = new Command();
program.name("obelos").description("CI for agent context: lint, score and test your instruction files.").version(VERSION);
program.option("--debug", "print stack traces on errors");
program.hook("preAction", () => {
  debug = Boolean(program.opts().debug);
});

program
  .command("lint")
  .argument("[path]", "repository root", ".")
  .option("-f, --format <format>", `output format: ${reporterNames().join(", ")}`, "text")
  .option("--fail-on <level>", "error, warn, info or never", "error")
  .option("--max-warnings <n>", "fail if more than n warnings", (v) => parseInt(v, 10))
  .option("--baseline <file>", "hide findings recorded in a baseline file")
  .option("-o, --output <file>", "write the report to a file instead of stdout")
  .option("-c, --config <file>", "config file path")
  .option("--changed-only", "only report findings in instruction files affected by uncommitted or unpushed changes (needs git)")
  .option("--since <ref>", "only report findings affected by changes since a git ref (implies --changed-only)")
  .option("--no-cascade", "ignore nested obelos.config.json files in subdirectories")
  .option("--today <date>", "treat this YYYY-MM-DD as today for suppression expiry (reproducible CI)")
  .option("--verbose", "print timings, config sources and skipped files to stderr")
  .option("--watch", "re-run when instruction files change (experimental)")
  .description("Check instruction files for broken references, size, conflicts and secrets.")
  .action((p: string, opts: LintCliOptions) => {
    try {
      if (opts.today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) throw new ObelosError("USAGE", "--today must look like 2026-12-31.");
      if (opts.watch) return watchLint(p, opts);
      const result = runLint(p, opts);
      if (opts.verbose) verboseReport(result);
      const text = render(opts.format, result);
      if (opts.output) fs.writeFileSync(opts.output, text + "\n");
      else if (text) console.log(text);
      process.exitCode = exitFor(result, opts.failOn, opts.maxWarnings);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("baseline")
  .argument("[path]", "repository root", ".")
  .option("-o, --output <file>", "baseline file to write", "obelos.baseline.json")
  .option("-c, --config <file>", "config file path")
  .description("Record current findings so that only new ones are reported (adopt without fixing everything first).")
  .action((p: string, opts: { output: string; config?: string }) => {
    try {
      const result = lint(p, { configPath: opts.config });
      const baseline = createBaseline(result.diagnostics.filter((d) => d.ruleId !== "OBL000"));
      fs.writeFileSync(opts.output, JSON.stringify(baseline, null, 2) + "\n");
      console.log(`Recorded ${baseline.entries.length} findings in ${opts.output}. Use: obelos lint --baseline ${opts.output}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("resolve")
  .argument("<target>", "a file path in the repository, e.g. src/api/users.ts")
  .option("--root <path>", "repository root", ".")
  .option("-f, --format <format>", "text or json", "text")
  .description("Show which instruction files apply when an agent works on a given file, per tool.")
  .action((target: string, opts: { root: string; format: string }) => {
    try {
      const root = path.resolve(opts.root);
      const files = discover(root, loadConfig(root));
      const r = resolveContext(files, target);
      console.log(opts.format === "json" ? JSON.stringify(r, null, 2) : formatResolved(r));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("explain")
  .argument("<rule>", "rule ID, e.g. OBL006")
  .description("Explain a rule: why it exists, how to fix it, examples and sources.")
  .action((id: string) => {
    const key = id.toUpperCase();
    const rule = RULES.find((r) => r.id === key);
    const docs = RULE_DOCS[key];
    if (!rule && !docs) return fail(new ObelosError("USAGE", `Unknown rule ${id}. Run \`obelos rules\` for the list.`));
    console.log(`${key}${rule ? `  ${rule.name}  (default: ${rule.defaultSeverity})` : ""}`);
    if (rule) console.log(`\n${rule.description}`);
    if (docs) {
      console.log(`\nWhy: ${docs.why}\nFix: ${docs.fix}`);
      if (docs.bad) console.log(`\nBad:\n${docs.bad}`);
      if (docs.good) console.log(`\nGood:\n${docs.good}`);
      if (docs.sources?.length) console.log(`\nSources (verified 2026-10-04):\n${docs.sources.map((s) => `  ${s}`).join("\n")}`);
    }
    console.log(`\nSilence: <!-- obelos-disable-next-line ${key} --> , <!-- obelos-disable-file ${key} --> , or "rules": {"${key}": "off"} in obelos.config.json`);
  });

program
  .command("inspect")
  .argument("[path]", "repository root", ".")
  .description("List the instruction files found and their size.")
  .action((p: string) => {
    try {
      const root = path.resolve(p);
      const files = discover(root, loadConfig(root));
      if (files.length === 0) console.log("No agent instruction files found.");
      for (const f of files) console.log(`${f.tool.padEnd(8)} ${f.kind.padEnd(13)} ${String(f.lines.length).padStart(5)} lines  ~${String(f.tokens).padStart(6)} tokens  ${f.path}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("budget")
  .argument("<target>", "a file path in the repository, e.g. src/api/users.ts")
  .option("--root <path>", "repository root", ".")
  .option("-f, --format <format>", "text or json", "text")
  .option("--chars-per-token <n>", "characters per token for the estimate", (v) => parseFloat(v), 4)
  .option("--max-tokens <n>", "exit 1 if any tool's always-loaded context exceeds n estimated tokens", (v) => parseInt(v, 10))
  .description("Estimate how much instruction context an agent carries when working on a file, per tool (follows @imports).")
  .action((target: string, opts: { root: string; format: string; charsPerToken: number; maxTokens?: number }) => {
    try {
      if (!(opts.charsPerToken > 0)) throw new ObelosError("USAGE", "--chars-per-token must be a positive number.");
      const root = path.resolve(opts.root);
      const config = loadConfig(root);
      const fsys = diskFs(root);
      const { files } = discoverAll(fsys, config);
      const ws = createWorkspace(fsys, config, todayIso(), root);
      const r = computeBudget(files, ws, target, opts.charsPerToken);
      console.log(opts.format === "json" ? JSON.stringify(r, null, 2) : formatBudget(r));
      if (opts.maxTokens !== undefined && r.tools.some((t) => t.baselineTokens > opts.maxTokens!)) process.exitCode = EXIT.FINDINGS;
    } catch (e) {
      fail(e);
    }
  });

program
  .command("badge")
  .argument("[path]", "repository root", ".")
  .option("-o, --output <file>", "write to a file instead of stdout")
  .option("--shields", "emit shields.io endpoint JSON instead of SVG")
  .option("-c, --config <file>", "config file path")
  .description("Generate a score badge (SVG, or shields.io endpoint JSON) for your README.")
  .action((p: string, opts: { output?: string; shields?: boolean; config?: string }) => {
    try {
      const result = lint(p, { configPath: opts.config });
      const body = opts.shields ? shieldsJson(result) : badgeSvg(result);
      if (opts.output) fs.writeFileSync(opts.output, body.endsWith("\n") ? body : body + "\n");
      else process.stdout.write(body.endsWith("\n") ? body : body + "\n");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("init")
  .argument("[path]", "repository root", ".")
  .option("--stack <stack>", "force a stack: node, python, rust or go")
  .option("--write", "write the files (default is a dry run)")
  .description("Create a minimal AGENTS.md with real commands detected from the repository, plus a CLAUDE.md that imports it. Never overwrites.")
  .action((p: string, opts: { stack?: string; write?: boolean }) => {
    try {
      if (opts.stack && !["node", "python", "rust", "go"].includes(opts.stack)) throw new ObelosError("USAGE", "--stack must be node, python, rust or go.");
      const root = path.resolve(p);
      const plan = planInit(diskFs(root), root, opts.stack);
      console.log(`Detected: ${plan.stack.stacks.join(", ") || "no known stack"}`);
      for (const n of plan.stack.notes) console.log(`Note: ${n}`);
      for (const item of plan.items) {
        if (item.action === "skip") {
          console.log(`skip    ${item.path} (${item.reason})`);
          continue;
        }
        if (opts.write) {
          fs.writeFileSync(path.join(root, item.path), item.content, { flag: "wx" });
          console.log(`created ${item.path}`);
        } else {
          console.log(`would create ${item.path}:\n${item.content.split("\n").map((l) => `  | ${l}`).join("\n")}`);
        }
      }
      if (!opts.write) console.log("\nDry run. Re-run with --write to create the files.");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("history")
  .argument("[path]", "repository root", ".")
  .option("--record", "append the current score to .obelos/history.jsonl")
  .option("--label <text>", "label for the recorded entry, e.g. a commit hash")
  .option("-f, --format <format>", "text or json", "text")
  .option("--today <date>", "date to record (YYYY-MM-DD)")
  .description("Record the score over time and show the trend (local file, no network).")
  .action((p: string, opts: { record?: boolean; label?: string; format: string; today?: string }) => {
    try {
      const root = path.resolve(p);
      if (opts.record) {
        const result = lint(root, { today: opts.today });
        recordHistory(root, entryFrom(result, opts.today ?? todayIso(), SCORE_VERSION, opts.label));
      }
      const entries = readHistory(root);
      console.log(opts.format === "json" ? JSON.stringify(entries, null, 2) : formatHistory(entries));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("scan")
  .argument("<parent>", "a directory whose subdirectories are repositories")
  .option("-f, --format <format>", "text or json", "text")
  .description("Lint many repositories at once and summarise (portfolio view; also the corpus-study runner).")
  .action((parent: string, opts: { format: string }) => {
    try {
      const r = scan(parent);
      console.log(opts.format === "json" ? JSON.stringify(r, null, 2) : formatScan(r));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("suppressions")
  .argument("[path]", "repository root", ".")
  .option("-f, --format <format>", "text or json", "text")
  .option("--today <date>", "treat this YYYY-MM-DD as today")
  .description("List every obelos-disable comment, with expiry and reason; expired ones are marked.")
  .action((p: string, opts: { format: string; today?: string }) => {
    try {
      const root = path.resolve(p);
      const { files } = discoverAll(diskFs(root), loadConfig(root), opts.today);
      const rows = files.flatMap((f) =>
        f.disables.entries.map((s) => ({ file: f.path, line: s.line, scope: s.scope, rules: s.rules === "all" ? "all" : [...s.rules].join(","), until: s.until ?? null, reason: s.reason ?? null, expired: f.disables.expired.includes(s) })),
      );
      if (opts.format === "json") console.log(JSON.stringify(rows, null, 2));
      else if (rows.length === 0) console.log("No suppression comments.");
      else for (const r of rows) console.log(`${r.file}:${r.line}  ${r.scope.padEnd(9)} ${r.rules.padEnd(14)} ${r.until ? `until ${r.until}` : "no expiry"}${r.expired ? "  EXPIRED" : ""}${r.reason ? `  - ${r.reason}` : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("config")
  .argument("[path]", "repository root", ".")
  .option("-c, --config <file>", "config file path")
  .description("Print the effective configuration after presets and extends are applied, and where each layer came from.")
  .action((p: string, opts: { config?: string }) => {
    try {
      console.log(JSON.stringify(loadConfig(path.resolve(p), opts.config), null, 2));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("rules")
  .option("--json", "machine-readable output")
  .description("List the lint rules.")
  .action((opts: { json?: boolean }) => {
    if (opts.json) {
      console.log(JSON.stringify(RULES.map((r) => ({ id: r.id, name: r.name, description: r.description, defaultSeverity: r.defaultSeverity, fixable: Boolean(r.fixable), docs: RULE_DOCS[r.id] ?? null })), null, 2));
      return;
    }
    for (const r of RULES) console.log(`${r.id}  ${r.defaultSeverity.padEnd(5)}  ${r.name.padEnd(28)} ${r.description}`);
  });

program.parseAsync(process.argv).catch(fail);
