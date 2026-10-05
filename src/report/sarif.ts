import { fingerprint } from "../core/baseline.js";
import type { LintResult, Severity } from "../core/types.js";
import { RULES } from "../rules/index.js";
import { VERSION } from "../version.js";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = { error: "error", warn: "warning", info: "note" };

export function formatSarif(result: LintResult): string {
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "obelos",
            version: VERSION,
            informationUri: "https://github.com/Episteme-Research-Studio/obelos",
            rules: RULES.map((r) => ({
              id: r.id,
              name: r.name,
              shortDescription: { text: r.description },
              defaultConfiguration: { level: LEVEL[r.defaultSeverity] },
            })),
          },
        },
        results: result.diagnostics
          .filter((d) => d.ruleId !== "OBL000")
          .map((d) => ({
            ruleId: d.ruleId,
            level: LEVEL[d.severity],
            message: { text: d.hint ? `${d.message} ${d.hint}` : d.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: d.file },
                  region: { startLine: d.line ?? 1, ...(d.column ? { startColumn: d.column } : {}), ...(d.endLine ? { endLine: d.endLine } : {}), ...(d.endColumn ? { endColumn: d.endColumn } : {}) },
                },
              },
            ],
            partialFingerprints: { "obelos/v1": fingerprint(d) },
          })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}
