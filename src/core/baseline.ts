import crypto from "node:crypto";
import fs from "node:fs";
import { ObelosError } from "./errors.js";
import type { Diagnostic } from "./types.js";

export interface Baseline {
  version: 1;
  entries: { fingerprint: string; ruleId: string; file: string }[];
}

/** Line-independent fingerprint so findings survive unrelated edits above them. */
export function fingerprint(d: Diagnostic): string {
  return crypto.createHash("sha1").update(`${d.ruleId}|${d.file}|${d.message}`).digest("hex").slice(0, 16);
}

export function createBaseline(diagnostics: Diagnostic[]): Baseline {
  const seen = new Set<string>();
  const entries: Baseline["entries"] = [];
  for (const d of diagnostics) {
    const fp = fingerprint(d);
    if (seen.has(fp)) continue;
    seen.add(fp);
    entries.push({ fingerprint: fp, ruleId: d.ruleId, file: d.file });
  }
  return { version: 1, entries };
}

export function loadBaseline(file: string): Baseline {
  let parsed: Baseline;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Baseline;
  } catch (e) {
    throw new ObelosError("BASELINE_INVALID", `Cannot read baseline ${file}: ${(e as Error).message}`);
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new ObelosError("BASELINE_INVALID", `Unsupported baseline file: ${file}`);
  return parsed;
}

export function applyBaseline(diagnostics: Diagnostic[], baseline: Baseline): { kept: Diagnostic[]; baselined: number } {
  const known = new Set(baseline.entries.map((e) => e.fingerprint));
  const kept = diagnostics.filter((d) => !known.has(fingerprint(d)));
  return { kept, baselined: diagnostics.length - kept.length };
}
