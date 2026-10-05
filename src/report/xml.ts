import type { Diagnostic, LintResult } from "../core/types.js";
import { VERSION } from "../version.js";

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] as string).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function real(result: LintResult): Diagnostic[] {
  return result.diagnostics.filter((d) => d.ruleId !== "OBL000");
}

/** JUnit XML: one suite per instruction file; errors and warnings are failures, notes are passing cases with output. */
export function formatJunit(result: LintResult): string {
  const ds = real(result);
  const failures = ds.filter((d) => d.severity !== "info").length;
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites name="obelos" tests="${Math.max(ds.length, result.files.length)}" failures="${failures}">`];
  for (const f of result.files) {
    const mine = ds.filter((d) => d.file === f.path);
    out.push(`  <testsuite name="${esc(f.path)}" tests="${Math.max(mine.length, 1)}" failures="${mine.filter((d) => d.severity !== "info").length}">`);
    if (mine.length === 0) out.push(`    <testcase classname="${esc(f.path)}" name="no findings"/>`);
    for (const d of mine) {
      const name = `${d.ruleId}${d.line ? `:${d.line}` : ""} ${d.message}`;
      if (d.severity === "info") out.push(`    <testcase classname="${esc(f.path)}" name="${esc(name)}"><system-out>${esc(d.hint ?? d.message)}</system-out></testcase>`);
      else out.push(`    <testcase classname="${esc(f.path)}" name="${esc(name)}"><failure type="${d.severity === "error" ? "error" : "warning"}" message="${esc(d.message)}">${esc(d.hint ?? "")}</failure></testcase>`);
    }
    out.push("  </testsuite>");
  }
  out.push("</testsuites>");
  return out.join("\n");
}

const CS_SEV = { error: "error", warn: "warning", info: "info" } as const;

/** Checkstyle XML, understood by many CI systems and editors. */
export function formatCheckstyle(result: LintResult): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', `<checkstyle version="4.3" generator="obelos ${esc(VERSION)}">`];
  const byFile = new Map<string, Diagnostic[]>();
  for (const d of real(result)) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
  for (const f of result.files) {
    out.push(`  <file name="${esc(f.path)}">`);
    for (const d of byFile.get(f.path) ?? []) {
      out.push(`    <error line="${d.line ?? 1}"${d.column ? ` column="${d.column}"` : ""} severity="${CS_SEV[d.severity]}" message="${esc(d.message)}" source="obelos.${esc(d.ruleId)}"/>`);
    }
    out.push("  </file>");
  }
  out.push("</checkstyle>");
  return out.join("\n");
}
