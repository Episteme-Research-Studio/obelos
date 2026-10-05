import picomatch from "picomatch";
import path from "node:path";
import type { ContextFile, Tool } from "./types.js";

export type Certainty = "always" | "matched" | "agent-decides" | "manual-only" | "nearest-wins";

export interface ResolvedEntry {
  file: string;
  certainty: Certainty;
  reason: string;
}

export interface ResolvedContext {
  target: string;
  tools: { tool: Tool | "claude" | "cursor" | "copilot" | "codex-and-others"; entries: ResolvedEntry[]; notes: string[] }[];
}

function isAncestorDir(dir: string, targetDir: string): boolean {
  return dir === "" || targetDir === dir || targetDir.startsWith(dir + "/");
}

/** Directory a CLAUDE.md "belongs to": `.claude/CLAUDE.md` belongs to the parent of `.claude`. */
function ownerDir(f: ContextFile): string {
  return f.dir.endsWith("/.claude") ? f.dir.slice(0, -"/.claude".length) : f.dir === ".claude" ? "" : f.dir;
}

function globList(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  return (Array.isArray(raw) ? raw : String(raw).split(",")).map((x) => String(x).trim()).filter(Boolean);
}

const matches = (patterns: string[], target: string) => patterns.some((p) => picomatch(p, { dot: true })(target));

/**
 * Which instruction files plausibly apply when an agent works on `target`.
 * Models documented behaviour (verified 2026-10-04) and is a best-effort explanation, not a guarantee:
 * vendors change loading rules and some depend on the agent's own decisions.
 */
export function resolveContext(files: ContextFile[], targetInput: string): ResolvedContext {
  const target = path.posix.normalize(targetInput.replace(/\\/g, "/")).replace(/^\.\//, "");
  const targetDir = path.posix.dirname(target) === "." ? "" : path.posix.dirname(target);
  const chain = (kind: ContextFile["kind"]) =>
    files.filter((f) => f.kind === kind && isAncestorDir(ownerDir(f), targetDir)).sort((a, b) => ownerDir(a).length - ownerDir(b).length);

  // Claude Code
  const claudeEntries: ResolvedEntry[] = [];
  const claudeNotes: string[] = [];
  const claudeMd = [...chain("claude-md"), ...chain("claude-local")];
  const agents = chain("agents-md");
  for (const f of claudeMd) claudeEntries.push({ file: f.path, certainty: "always", reason: "CLAUDE.md in the directory chain (loaded at launch or when files in that directory are read)" });
  if (claudeMd.length === 0) {
    for (const f of agents) claudeEntries.push({ file: f.path, certainty: "always", reason: "no CLAUDE.md in the chain, so Claude Code reads AGENTS.md (v2.1.277+)" });
  } else if (agents.length) {
    const imported = new Set(claudeMd.flatMap((c) => c.imports.map((i) => path.posix.normalize(path.posix.join(c.dir, i.value)))));
    for (const a of agents) {
      if (imported.has(a.path) || claudeMd.some((c) => c.realPath === a.realPath)) claudeEntries.push({ file: a.path, certainty: "always", reason: "imported or linked from CLAUDE.md" });
      else claudeNotes.push(`${a.path} exists but is NOT read: CLAUDE.md files are present and do not import it.`);
    }
  }
  for (const f of files.filter((x) => x.kind === "claude-rule")) {
    const paths = globList(f.frontmatter?.paths);
    if (paths.length === 0) claudeEntries.push({ file: f.path, certainty: "always", reason: "rule without a paths field loads unconditionally" });
    else if (matches(paths, target)) claudeEntries.push({ file: f.path, certainty: "matched", reason: `paths pattern matches ${target}` });
  }

  // Cursor
  const cursorEntries: ResolvedEntry[] = [];
  const cursorNotes: string[] = [];
  for (const f of files.filter((x) => x.kind === "cursor-rule")) {
    if (f.path.endsWith(".md")) {
      cursorNotes.push(`${f.path} is ignored (Cursor needs .mdc).`);
      continue;
    }
    const fm = f.frontmatter ?? {};
    const globs = globList(fm.globs);
    if (fm.alwaysApply === true) cursorEntries.push({ file: f.path, certainty: "always", reason: "alwaysApply: true" });
    else if (globs.length && matches(globs, target)) cursorEntries.push({ file: f.path, certainty: "matched", reason: `globs match ${target}` });
    else if (fm.description !== undefined && globs.length === 0) cursorEntries.push({ file: f.path, certainty: "agent-decides", reason: "has a description; the agent decides whether it is relevant" });
    else if (globs.length === 0) cursorEntries.push({ file: f.path, certainty: "manual-only", reason: "no description, globs or alwaysApply; only applies when mentioned with @rule-name" });
  }
  for (const f of agents) cursorEntries.push({ file: f.path, certainty: "always", reason: "AGENTS.md in the directory chain (more specific files apply as you go deeper)" });

  // Copilot
  const copilotEntries: ResolvedEntry[] = [];
  for (const f of files.filter((x) => x.kind === "copilot-repo")) copilotEntries.push({ file: f.path, certainty: "always", reason: "repository-wide instructions" });
  for (const f of files.filter((x) => x.kind === "copilot-path")) {
    const apply = globList(f.frontmatter?.applyTo);
    if (apply.length && matches(apply, target)) copilotEntries.push({ file: f.path, certainty: "matched", reason: `applyTo matches ${target}` });
  }
  const nearestAgents = [...agents].sort((a, b) => b.dir.length - a.dir.length)[0];
  if (nearestAgents) copilotEntries.push({ file: nearestAgents.path, certainty: "nearest-wins", reason: "agent instructions file: nearest in the tree takes precedence" });

  // Others reading AGENTS.md (Codex, Gemini CLI via config, etc.)
  const otherEntries: ResolvedEntry[] = nearestAgents ? [{ file: nearestAgents.path, certainty: "nearest-wins", reason: "nearest AGENTS.md takes precedence (agents.md convention)" }] : [];
  const gemini = chain("gemini-md");
  const geminiEntries: ResolvedEntry[] = gemini.map((f) => ({ file: f.path, certainty: "always", reason: "GEMINI.md in the directory chain" }));

  return {
    target,
    tools: [
      { tool: "claude", entries: claudeEntries, notes: claudeNotes },
      { tool: "cursor", entries: cursorEntries, notes: cursorNotes },
      { tool: "copilot", entries: copilotEntries, notes: [] },
      { tool: "codex-and-others", entries: otherEntries, notes: [] },
      { tool: "gemini", entries: geminiEntries, notes: [] },
    ],
  };
}

export function formatResolved(r: ResolvedContext): string {
  const out = [`Instruction files that apply when an agent works on ${r.target}:`, ""];
  for (const t of r.tools) {
    out.push(`${t.tool}`);
    if (t.entries.length === 0) out.push("  (none)");
    for (const e of t.entries) out.push(`  ${e.certainty.padEnd(14)} ${e.file}  - ${e.reason}`);
    for (const n of t.notes) out.push(`  NOTE ${n}`);
    out.push("");
  }
  out.push("Best-effort model of documented behaviour; vendors change loading rules and some choices are the agent's own.");
  return out.join("\n");
}
