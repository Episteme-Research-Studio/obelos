import fs from "node:fs";
import path from "node:path";
import { lint } from "./runner.js";
import { ObelosError } from "./errors.js";

export interface ScanRow {
  repo: string;
  score: number | null;
  grade: string | null;
  files: number;
  errors: number;
  warnings: number;
  notes: number;
  tokens: number;
  error?: string;
}

export interface ScanReport {
  parent: string;
  repos: number;
  withInstructionFiles: number;
  rows: ScanRow[];
  /** Findings per rule across all repos, for corpus studies. */
  byRule: Record<string, number>;
}

/** Lint every direct subdirectory of `parent` (one repository each). Never follows symlinked directories out of the parent. */
export function scan(parentInput: string, options: { today?: string; limit?: number } = {}): ScanReport {
  const parent = path.resolve(parentInput);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new ObelosError("PATH_NOT_FOUND", `Not a directory: ${parent}`);
  const dirs = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
    .map((d) => d.name)
    .sort()
    .slice(0, options.limit ?? 1000);
  const rows: ScanRow[] = [];
  const byRule: Record<string, number> = {};
  for (const name of dirs) {
    try {
      const r = lint(path.join(parent, name), { today: options.today });
      const real = r.diagnostics.filter((d) => d.ruleId !== "OBL000");
      for (const d of real) byRule[d.ruleId] = (byRule[d.ruleId] ?? 0) + 1;
      rows.push({
        repo: name,
        score: r.files.length ? r.score : null,
        grade: r.files.length ? r.grade : null,
        files: r.files.length,
        errors: real.filter((d) => d.severity === "error").length,
        warnings: real.filter((d) => d.severity === "warn").length,
        notes: real.filter((d) => d.severity === "info").length,
        tokens: r.files.reduce((a, f) => a + f.tokens, 0),
      });
    } catch (e) {
      rows.push({ repo: name, score: null, grade: null, files: 0, errors: 0, warnings: 0, notes: 0, tokens: 0, error: (e as Error).message });
    }
  }
  return { parent, repos: rows.length, withInstructionFiles: rows.filter((r) => r.files > 0).length, rows, byRule };
}

export function formatScan(r: ScanReport): string {
  const out = [`${r.repos} repositories under ${r.parent}; ${r.withInstructionFiles} have agent instruction files.`, ""];
  for (const row of r.rows) {
    if (row.error) out.push(`${row.repo.padEnd(32)} ERROR ${row.error}`);
    else if (row.files === 0) out.push(`${row.repo.padEnd(32)} no instruction files`);
    else out.push(`${row.repo.padEnd(32)} ${String(row.score).padStart(3)} ${row.grade}  ${row.errors}E ${row.warnings}W ${row.notes}N  ${row.files} files  ~${row.tokens} tokens`);
  }
  const rules = Object.entries(r.byRule).sort((a, b) => b[1] - a[1]);
  if (rules.length) out.push("", "Findings by rule: " + rules.map(([k, v]) => `${k}=${v}`).join(" "));
  return out.join("\n");
}
