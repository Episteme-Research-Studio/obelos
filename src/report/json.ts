import type { LintResult } from "../core/types.js";
import { SCORE_VERSION, VERSION } from "../version.js";

export function formatJson(result: LintResult): string {
  return JSON.stringify(
    {
      version: 1,
      toolVersion: VERSION,
      scoreVersion: SCORE_VERSION,
      root: result.root,
      score: result.score,
      grade: result.grade,
      baselined: result.baselined,
      suppressed: result.suppressed,
      ...(result.scope ? { scope: result.scope } : {}),
      files: result.files.map((f) => ({ path: f.path, tool: f.tool, kind: f.kind, lines: f.lines.length, bytes: f.bytes, tokensEstimate: f.tokens })),
      diagnostics: result.diagnostics,
    },
    null,
    2,
  );
}
