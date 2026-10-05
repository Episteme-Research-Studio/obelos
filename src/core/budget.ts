import path from "node:path";
import { extractRefs } from "./parse.js";
import { resolveContext, type Certainty } from "./resolve.js";
import type { ContextFile, Workspace } from "./types.js";

export interface BudgetItem {
  file: string;
  certainty: Certainty | "imported";
  bytes: number;
  /** Estimate: bytes / charsPerToken. Not a tokenizer. */
  tokens: number;
  via?: string;
}

export interface ToolBudget {
  tool: string;
  /** Loaded without any decision by the agent: always, matched, nearest-wins, plus imports of those. */
  baselineTokens: number;
  /** The agent may pull these in (Cursor "agent decides"). */
  optionalTokens: number;
  items: BudgetItem[];
}

export interface BudgetReport {
  target: string;
  charsPerToken: number;
  tools: ToolBudget[];
  note: string;
}

const MAX_HOPS = 4;
const BASELINE: Certainty[] = ["always", "matched", "nearest-wins"];

/**
 * Estimated instruction context an agent carries when working on `target`, per tool.
 * Builds on `resolveContext` and follows @imports (Claude Code loads imported files too).
 * Token figures are character-count estimates; pass a different `charsPerToken` to model another tokenizer.
 */
export function computeBudget(files: ContextFile[], ws: Workspace, target: string, charsPerToken = 4): BudgetReport {
  const resolved = resolveContext(files, target);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const tok = (bytes: number) => Math.ceil(bytes / charsPerToken);
  const tools: ToolBudget[] = [];
  for (const t of resolved.tools) {
    const items: BudgetItem[] = [];
    const seen = new Set<string>();
    const add = (item: BudgetItem) => {
      if (seen.has(item.file)) return;
      seen.add(item.file);
      items.push(item);
    };
    const follow = (rel: string, via: string, hop: number) => {
      if (hop > MAX_HOPS) return;
      const text = ws.read(rel);
      if (text === null) return;
      const dir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
      for (const imp of extractRefs(text.split(/\r?\n/), 1).imports) {
        if (imp.value.startsWith("~") || path.isAbsolute(imp.value)) continue;
        const target2 = path.posix.normalize(path.posix.join(dir, imp.value));
        if (seen.has(target2)) continue;
        const body = ws.read(target2);
        if (body === null) continue;
        const bytes = Buffer.byteLength(body, "utf8");
        add({ file: target2, certainty: "imported", bytes, tokens: tok(bytes), via });
        follow(target2, via, hop + 1);
      }
    };
    for (const e of t.entries) {
      if (e.certainty === "manual-only") continue;
      const f = byPath.get(e.file);
      const bytes = f?.bytes ?? 0;
      add({ file: e.file, certainty: e.certainty, bytes, tokens: tok(bytes) });
    }
    if (t.tool === "claude") {
      for (const e of t.entries.filter((x) => BASELINE.includes(x.certainty))) follow(e.file, e.file, 1);
    }
    const baselineTokens = items.filter((i) => i.certainty === "imported" || BASELINE.includes(i.certainty as Certainty)).reduce((n, i) => n + i.tokens, 0);
    const optionalTokens = items.filter((i) => i.certainty === "agent-decides").reduce((n, i) => n + i.tokens, 0);
    tools.push({ tool: t.tool, baselineTokens, optionalTokens, items });
  }
  return {
    target: resolved.target,
    charsPerToken,
    tools,
    note: "Estimates only (characters divided by " + charsPerToken + "). Real tokenizers differ by model and content; use for comparison and trend, not billing.",
  };
}

export function formatBudget(r: BudgetReport): string {
  const out = [`Instruction context when an agent works on ${r.target} (estimated tokens):`, ""];
  for (const t of r.tools) {
    out.push(`${t.tool}: ~${t.baselineTokens} always loaded${t.optionalTokens ? `, +~${t.optionalTokens} if the agent opts in` : ""}`);
    for (const i of t.items) out.push(`  ~${String(i.tokens).padStart(6)}  ${i.certainty.padEnd(13)} ${i.file}${i.via ? `  (imported via ${i.via})` : ""}`);
    if (t.items.length === 0) out.push("  (none)");
    out.push("");
  }
  out.push(r.note);
  return out.join("\n");
}
