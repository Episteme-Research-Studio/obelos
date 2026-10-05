import type { LintResult, Severity } from "../core/types.js";

const COLOR: Record<Severity, string> = { error: "\x1b[31m", warn: "\x1b[33m", info: "\x1b[36m" };
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

export function formatText(result: LintResult, color: boolean): string {
  const c = (code: string, s: string) => (color ? `${code}${s}${RESET}` : s);
  const out: string[] = [];
  if (result.files.length === 0) {
    out.push("No agent instruction files found (CLAUDE.md, AGENTS.md, .cursor/rules, .github/copilot-instructions.md, GEMINI.md).");
    for (const d of result.diagnostics.filter((x) => x.ruleId === "OBL000")) out.push(`  note  ${d.file.startsWith("(") ? "" : `${d.file}: `}${d.message}`);
    return out.join("\n");
  }
  const byFile = new Map<string, typeof result.diagnostics>();
  for (const d of result.diagnostics) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
  for (const f of result.files) {
    const ds = byFile.get(f.path) ?? [];
    out.push(`${f.path} ${c(DIM, `(${f.lines.length} lines, ~${f.tokens} tokens)`)}`);
    if (ds.length === 0) out.push(`  ${c(DIM, "no findings")}`);
    for (const d of ds) {
      const loc = d.line ? `:${d.line}` : "";
      out.push(`  ${c(COLOR[d.severity], d.severity.padEnd(5))} ${d.ruleId}${loc}  ${d.message}`);
      if (d.hint) out.push(`        ${c(DIM, d.hint)}`);
    }
    out.push("");
  }
  const notices = result.diagnostics.filter((d) => d.ruleId === "OBL000");
  if (notices.length) {
    out.push("Notices (not counted in the score):");
    for (const d of notices) out.push(`  ${c(DIM, "note")}  ${d.file === "(internal)" || d.file === "(config)" ? "" : `${d.file}: `}${d.message}`);
    out.push("");
  }
  const n = (s: Severity) => result.diagnostics.filter((d) => d.severity === s && d.ruleId !== "OBL000").length;
  out.push(`${result.files.length} files, ${n("error")} errors, ${n("warn")} warnings, ${n("info")} notes. Context health: ${result.score}/100 (${result.grade})`);
  return out.join("\n");
}
