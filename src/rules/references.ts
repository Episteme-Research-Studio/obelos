import path from "node:path";
import picomatch from "picomatch";
import type { ContextFile, Diagnostic, Rule, Workspace } from "../core/types.js";
import { extractRefs } from "../core/parse.js";
import { HEDGED, diag, gitignoreCovers, resolveFrom, submodulePaths } from "./util.js";

const MAX_IMPORT_DEPTH = 4; // Claude Code docs: imports resolve recursively to a maximum depth of four hops

function resolveImport(f: ContextFile, target: string): string | null {
  if (target.startsWith("~") || path.isAbsolute(target)) return null; // cannot verify outside the workspace
  return resolveFrom(f.dir, target);
}

function importsOf(ws: Workspace, rel: string): string[] {
  const raw = ws.read(rel);
  if (raw === null) return [];
  const dir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
  return extractRefs(raw.split(/\r?\n/), 1).imports.map((i) => resolveFrom(dir, i.value));
}

function depthOf(ws: Workspace, rel: string, seen: Set<string>): number {
  if (seen.has(rel)) return 0;
  seen.add(rel);
  let max = 0;
  for (const t of importsOf(ws, rel)) {
    if (!ws.exists(t)) continue;
    max = Math.max(max, 1 + depthOf(ws, t, new Set(seen)));
  }
  return max;
}

export const brokenImport: Rule = {
  id: "OBL003",
  name: "broken-import",
  description: "An @import points to a file that does not exist, or the import chain is deeper than four hops.",
  defaultSeverity: "error",
  run(files, ws) {
    const out: Diagnostic[] = [];
    for (const f of files) {
      for (const imp of f.imports) {
        const target = resolveImport(f, imp.value);
        if (target === null) continue;
        // `@scope/package` in prose is an npm package name, not a file import.
        if (!/\.[A-Za-z0-9]+$/.test(imp.value) && /^[a-z0-9][\w.-]*\/[\w.-]+$/.test(imp.value) && !ws.exists(target)) continue;
        // Cursor `@file` references may be relative to the repository root.
        if (f.kind === "cursor-rule" && ws.exists(imp.value)) continue;
        // Content of a git submodule is absent from a plain clone.
        if (submodulePaths(ws.read(".gitmodules")).some((p) => target === p || target.startsWith(`${p}/`))) continue;
        if (!ws.exists(target)) {
          out.push(diag(this, f.path, `@${imp.value} does not exist (resolved to ${target}).`, { line: imp.line, hint: "Imports resolve relative to the file that contains them." }));
        }
      }
      const depth = depthOf(ws, f.path, new Set());
      if (depth > MAX_IMPORT_DEPTH) {
        out.push(diag(this, f.path, `Import chain is ${depth} hops deep; Claude Code follows at most ${MAX_IMPORT_DEPTH}.`, { hint: "Flatten the import chain." }));
      }
    }
    return out;
  },
};

const GENERATED_DIR = /(^|\/)(?:node_modules|dist|build|\.build|out|target|vendor|coverage|\.next|\.nuxt|\.venv|venv|__pycache__|\.cache|tmp|generated|gen|[\w.-]+-gen)(\/|$)/;

interface PathIndex {
  files: Set<string>;
  suffixes: Set<string>;
}
const indexCache = new WeakMap<Workspace, PathIndex>();

/** Every file path, and every trailing sub-path of files and directories, so `models/` matches `src/airflow/models/`. */
function pathIndex(ws: Workspace): PathIndex {
  const hit = indexCache.get(ws);
  if (hit) return hit;
  const files = new Set<string>();
  const suffixes = new Set<string>();
  const dirs = new Set<string>();
  for (const file of ws.allFiles()) {
    files.add(file);
    const parts = file.split("/");
    for (let j = 0; j < parts.length; j++) suffixes.add(parts.slice(j).join("/"));
    for (let k = 1; k < parts.length; k++) dirs.add(parts.slice(0, k).join("/"));
  }
  for (const d of dirs) {
    const parts = d.split("/");
    for (let j = 0; j < parts.length; j++) suffixes.add(parts.slice(j).join("/"));
  }
  const idx = { files, suffixes };
  indexCache.set(ws, idx);
  return idx;
}

function existsAnywhere(ws: Workspace, rel: string): boolean {
  const clean = rel.replace(/\/$/, "");
  const { suffixes } = pathIndex(ws);
  if (suffixes.has(clean)) return true;
  // TypeScript sources are imported with a .js extension.
  const ts = clean.replace(/\.jsx?$/, (m) => (m === ".js" ? ".ts" : ".tsx"));
  return ts !== clean && suffixes.has(ts);
}

export const missingPathReference: Rule = {
  id: "OBL004",
  name: "missing-path-reference",
  description: "The file mentions a repository path in code formatting that does not exist.",
  defaultSeverity: "warn",
  run(files, ws) {
    const out: Diagnostic[] = [];
    const ignored = picomatch(ws.config.ignorePathRefs, { dot: true });
    const gi = (ws.read(".gitignore") ?? "").split(/\r?\n/);
    const subs = submodulePaths(ws.read(".gitmodules"));
    const repoName = path.basename(path.resolve(ws.root));
    for (const f of files) {
      const seen = new Set<string>();
      for (const ref of f.pathRefs) {
        const clean = ref.value.replace(/^\.\//, "");
        if (ignored(clean) || seen.has(clean)) continue;
        seen.add(clean);
        const fromRoot = ws.exists(clean);
        const fromFile = ws.exists(resolveFrom(f.dir, ref.value));
        if (fromRoot || fromFile) continue;
        if (GENERATED_DIR.test(clean) || HEDGED.test(f.lines[ref.line - 1] ?? "")) continue;
        // Tool aliases (`@app/...`), paths ignored by git (generated or local), submodules, and `<repo-name>/...` prefixes.
        if (clean.startsWith("@") || gitignoreCovers(gi, clean) || subs.some((p) => clean === p || clean.startsWith(`${p}/`))) continue;
        if (clean.startsWith(`${repoName}/`) && ws.exists(clean.slice(repoName.length + 1))) continue;
        // Paths are often written relative to a sub-package or source root: accept any matching trailing path.
        if (!existsAnywhere(ws, clean)) {
          out.push(diag(this, f.path, `\`${ref.value}\` is referenced but does not exist in the repository.`, { line: ref.line, hint: "Update the path, remove the line, or add the path to ignorePathRefs if it is generated." }));
        }
      }
    }
    return out;
  },
};

/** Monorepo and sub-folder case: the script is defined in some other package.json in the repository. */
function definedElsewhere(ws: Workspace, name: string): boolean {
  let n = 0;
  for (const file of ws.allFiles()) {
    if (file !== "package.json" && !file.endsWith("/package.json")) continue;
    if (++n > 300) break;
    const dir = file === "package.json" ? "" : file.slice(0, -"/package.json".length);
    if (ws.scriptsFor(dir).has(name)) return true;
  }
  return false;
}

export const missingScriptReference: Rule = {
  id: "OBL005",
  name: "missing-script-reference",
  description: "The file tells the agent to run a package script that is not defined in package.json.",
  defaultSeverity: "warn",
  run(files, ws) {
    const out: Diagnostic[] = [];
    for (const f of files) {
      const scripts = ws.scriptsFor(f.dir);
      if (scripts.size === 0) continue; // no package.json in scope: nothing to compare against
      const seen = new Set<string>();
      for (const ref of f.scriptRefs) {
        if (scripts.has(ref.value) || seen.has(ref.value)) continue;
        if (HEDGED.test(f.lines[ref.line - 1] ?? "") || definedElsewhere(ws, ref.value)) continue;
        seen.add(ref.value);
        out.push(diag(this, f.path, `Script "${ref.value}" is not defined in any package.json in scope.`, { line: ref.line, hint: "The agent will run this command and fail; fix the name or add the script." }));
      }
    }
    return out;
  },
};

/** Split a comma-separated glob list without breaking brace groups such as `*.{ts,css}`. */
export function splitPatterns(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}" && depth > 0) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export const scopedGlobMatchesNothing: Rule = {
  id: "OBL010",
  name: "scoped-glob-matches-nothing",
  description: "A path-scoped rule (Claude paths, Cursor globs, Copilot applyTo) matches no files in the repository.",
  defaultSeverity: "warn",
  run(files, ws) {
    const out: Diagnostic[] = [];
    for (const f of files) {
      const fm = f.frontmatter;
      if (!fm) continue;
      let key: string | null = null;
      if (f.kind === "claude-rule") key = "paths";
      else if (f.kind === "cursor-rule") key = "globs";
      else if (f.kind === "copilot-path") key = "applyTo";
      if (!key || fm[key] === undefined) continue;
      const raw = fm[key];
      if (raw === null || raw === false || raw === true) continue; // `globs:` left empty, `null`, or a boolean
      const patterns = (Array.isArray(raw) ? raw : splitPatterns(String(raw))).map((p) => String(p).trim().replace(/^["']|["']$/g, "")).filter((p) => p && p !== "null" && p !== "~");
      const all = ws.allFiles();
      for (const p of patterns) {
        // A pattern without a slash (`*.cs`, `build.gradle`) matches by file name in any directory.
        const m = picomatch(p, { dot: true, basename: !p.includes("/") });
        if (!all.some((file) => m(file))) {
          out.push(diag(this, f.path, `${key} pattern "${p}" matches no files in the repository.`, { hint: "The rule will never load; fix the glob or delete the rule." }));
        }
      }
    }
    return out;
  },
};
