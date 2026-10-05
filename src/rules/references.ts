import path from "node:path";
import picomatch from "picomatch";
import type { ContextFile, Diagnostic, Rule, Workspace } from "../core/types.js";
import { extractRefs } from "../core/parse.js";
import { diag, resolveFrom } from "./util.js";

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

export const missingPathReference: Rule = {
  id: "OBL004",
  name: "missing-path-reference",
  description: "The file mentions a repository path in code formatting that does not exist.",
  defaultSeverity: "warn",
  run(files, ws) {
    const out: Diagnostic[] = [];
    const ignored = picomatch(ws.config.ignorePathRefs, { dot: true });
    for (const f of files) {
      const seen = new Set<string>();
      for (const ref of f.pathRefs) {
        const clean = ref.value.replace(/^\.\//, "");
        if (ignored(clean) || seen.has(clean)) continue;
        seen.add(clean);
        const fromRoot = ws.exists(clean);
        const fromFile = ws.exists(resolveFrom(f.dir, ref.value));
        if (!fromRoot && !fromFile) {
          out.push(diag(this, f.path, `\`${ref.value}\` is referenced but does not exist in the repository.`, { line: ref.line, hint: "Update the path, remove the line, or add the path to ignorePathRefs if it is generated." }));
        }
      }
    }
    return out;
  },
};

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
        seen.add(ref.value);
        out.push(diag(this, f.path, `Script "${ref.value}" is not defined in any package.json in scope.`, { line: ref.line, hint: "The agent will run this command and fail; fix the name or add the script." }));
      }
    }
    return out;
  },
};

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
      const patterns = (Array.isArray(raw) ? raw : String(raw).split(",")).map((p) => String(p).trim()).filter(Boolean);
      const all = ws.allFiles();
      for (const p of patterns) {
        const m = picomatch(p, { dot: true });
        if (!all.some((file) => m(file))) {
          out.push(diag(this, f.path, `${key} pattern "${p}" matches no files in the repository.`, { hint: "The rule will never load; fix the glob or delete the rule." }));
        }
      }
    }
    return out;
  },
};
