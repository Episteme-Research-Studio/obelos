import type { Diagnostic, Severity } from "./types.js";

const WEIGHT: Record<Severity, number> = { error: 12, warn: 4, info: 1 };
const CAP_PER_RULE = 5;

/**
 * Context health score, v0 heuristic: start at 100, subtract a weight per finding,
 * counting at most five findings per rule so one noisy rule cannot zero the score.
 * Documented in docs/SPEC.md; expect this to change before 1.0.
 */
export function score(diagnostics: Diagnostic[]): { score: number; grade: string } {
  const counts = new Map<string, { n: number; sev: Severity }>();
  for (const d of diagnostics) {
    const k = `${d.ruleId}:${d.severity}`;
    const c = counts.get(k) ?? { n: 0, sev: d.severity };
    c.n += 1;
    counts.set(k, c);
  }
  let penalty = 0;
  for (const { n, sev } of counts.values()) penalty += Math.min(n, CAP_PER_RULE) * WEIGHT[sev];
  const value = Math.max(0, 100 - penalty);
  const grade = value >= 90 ? "A" : value >= 80 ? "B" : value >= 65 ? "C" : value >= 50 ? "D" : "F";
  return { score: value, grade };
}
