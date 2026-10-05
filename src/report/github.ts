import type { LintResult } from "../core/types.js";

const escapeData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProp = (s: string) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** GitHub Actions workflow commands: annotations appear on the pull request without extra setup. */
export function formatGithub(result: LintResult): string {
  return result.diagnostics
    .filter((d) => d.ruleId !== "OBL000")
    .map((d) => {
      const cmd = d.severity === "error" ? "error" : d.severity === "warn" ? "warning" : "notice";
      const line = d.line ? `,line=${d.line}` : "";
      return `::${cmd} file=${escapeProp(d.file)}${line},title=${escapeProp(d.ruleId)}::${escapeData(d.message)}`;
    })
    .join("\n");
}
