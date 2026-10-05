import type { ContextFile, Diagnostic, Rule } from "../core/types.js";
import { diag } from "./util.js";

function budgetFor(f: ContextFile, b: { claudeLines: number; cursorLines: number; agentsLines: number; otherLines: number }): number {
  switch (f.tool) {
    case "claude":
      return b.claudeLines;
    case "cursor":
      return b.cursorLines;
    case "agents":
      return b.agentsLines;
    default:
      return b.otherLines;
  }
}

export const sizeBudget: Rule = {
  id: "OBL001",
  name: "size-budget",
  description: "A single instruction file exceeds the recommended line budget for its tool.",
  defaultSeverity: "warn",
  run(files, ws) {
    const out: Diagnostic[] = [];
    for (const f of files) {
      const lines = f.lines.length;
      const limit = budgetFor(f, ws.config.budgets);
      if (lines > limit) {
        out.push(
          diag(this, f.path, `${lines} lines exceeds the ${limit}-line budget for ${f.tool} files (about ${f.tokens} tokens).`, {
            hint: "Move area-specific guidance into path-scoped rules or subdirectory files; keep the always-loaded file short.",
          }),
        );
      }
    }
    return out;
  },
};

export const aggregateBudget: Rule = {
  id: "OBL002",
  name: "aggregate-budget",
  description: "Combined size of an AGENTS.md chain (file plus its ancestors) exceeds the aggregate byte budget; Codex stops loading files once 32 KiB is reached.",
  defaultSeverity: "warn",
  run(files, ws) {
    const out: Diagnostic[] = [];
    const limit = ws.config.budgets.aggregateBytes;
    const chainKinds = new Set(["agents-md"]);
    for (const f of files) {
      if (!chainKinds.has(f.kind)) continue;
      const chain = files.filter(
        (g) => g.kind === f.kind && (g.dir === "" || f.dir === g.dir || f.dir.startsWith(g.dir + "/")),
      );
      const total = chain.reduce((n, g) => n + g.bytes, 0);
      // Report only at the file whose addition pushes the chain over the limit, not at every file below it.
      if (total > limit && total - f.bytes <= limit) {
        out.push(
          diag(this, f.path, `Combined ${f.kind} chain is ${total} bytes (limit ${limit}); some tools truncate or drop the excess.`, {
            hint: "Trim the root file or split guidance into nested files that only load when relevant.",
          }),
        );
      }
    }
    return out;
  },
};
