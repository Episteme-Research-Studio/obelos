import type { Diagnostic, Severity } from "./types.js";

const WEIGHT: Record<Severity, number> = { error: 12, warn: 4, info: 1 };
const CAP_PER_RULE = 5;

function grade(value: number): string {
  return value >= 90 ? "A" : value >= 80 ? "B" : value >= 65 ? "C" : value >= 50 ? "D" : "F";
}

/**
 * Context health score, v2 heuristic: each instruction file is scored on its own (start at 100, subtract a
 * weight per finding, at most five findings per rule), and the repository score is the average over all files.
 * Averaging keeps a large monorepo with many files from collapsing to zero. Without a file list (older callers)
 * all findings are scored as one group, as in v1. Documented in docs/SPEC.md; expect this to change before 1.0.
 */
export function score(diagnostics: Diagnostic[], filePaths?: string[]): { score: number; grade: string } {
  if (filePaths && filePaths.length > 0) {
    const byFile = new Map<string, Diagnostic[]>();
    for (const d of diagnostics) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
    const total = filePaths.reduce((sum, p) => sum + groupScore(byFile.get(p) ?? []), 0);
    const value = Math.round(total / filePaths.length);
    return { score: value, grade: grade(value) };
  }
  const value = groupScore(diagnostics);
  return { score: value, grade: grade(value) };
}

function groupScore(diagnostics: Diagnostic[]): number {
  const counts = new Map<string, { n: number; sev: Severity }>();
  for (const d of diagnostics) {
    const k = `${d.ruleId}:${d.severity}`;
    const c = counts.get(k) ?? { n: 0, sev: d.severity };
    c.n += 1;
    counts.set(k, c);
  }
  let penalty = 0;
  for (const { n, sev } of counts.values()) penalty += Math.min(n, CAP_PER_RULE) * WEIGHT[sev];
  return Math.max(0, 100 - penalty);
}
