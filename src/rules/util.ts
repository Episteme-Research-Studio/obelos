import path from "node:path";
import type { ContextFile, Diagnostic, Rule, Severity } from "../core/types.js";

export function diag(rule: Pick<Rule, "id" | "defaultSeverity">, file: string, message: string, extra: { line?: number; hint?: string; severity?: Severity } = {}): Diagnostic {
  return { ruleId: rule.id, severity: extra.severity ?? rule.defaultSeverity, message, file, line: extra.line, hint: extra.hint };
}

/** Lines of the body only (frontmatter excluded), with 1-based numbers. */
export function bodyLines(f: ContextFile): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let inFence = false;
  for (let i = f.bodyStart - 1; i < f.lines.length; i++) {
    const text = f.lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push({ text, line: i + 1 });
  }
  return out;
}

export function resolveFrom(fileDir: string, target: string): string {
  return path.posix.normalize(path.posix.join(fileDir, target));
}
