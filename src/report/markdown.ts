import type { LintResult } from "../core/types.js";

export function formatMarkdown(result: LintResult, top = 5): string {
  const n = (s: string) => result.diagnostics.filter((d) => d.severity === s).length;
  const out: string[] = [];
  out.push(`### Obelos: ${result.score}/100 (${result.grade})`);
  out.push("");
  out.push(`${result.files.length} instruction files, ${n("error")} errors, ${n("warn")} warnings, ${n("info")} notes.`);
  if (result.baselined || result.suppressed) out.push(`Hidden: ${result.baselined} by baseline, ${result.suppressed} by inline comments.`);
  if (result.diagnostics.length) {
    out.push("");
    out.push("| Severity | Rule | Location | Finding |");
    out.push("|---|---|---|---|");
    const rank = { error: 0, warn: 1, info: 2 } as const;
    const sorted = [...result.diagnostics].sort((a, b) => rank[a.severity] - rank[b.severity]);
    for (const d of sorted.slice(0, top)) {
      const loc = d.line ? `${d.file}:${d.line}` : d.file;
      out.push(`| ${d.severity} | ${d.ruleId} | \`${loc}\` | ${d.message.replace(/\|/g, "\\|")} |`);
    }
    if (sorted.length > top) out.push("", `...and ${sorted.length - top} more. Run \`npx obelos lint\` for the full list.`);
  } else {
    out.push("", "No findings.");
  }
  return out.join("\n");
}
