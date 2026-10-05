import fs from "node:fs";
import path from "node:path";
import { ObelosError } from "./errors.js";
import type { LintResult } from "./types.js";

export interface HistoryEntry {
  date: string;
  score: number;
  grade: string;
  scoreVersion: number;
  errors: number;
  warnings: number;
  notes: number;
  files: number;
  tokens: number;
  /** Optional label, e.g. a commit hash passed with --label. */
  label?: string;
}

export const HISTORY_FILE = ".obelos/history.jsonl";

export function entryFrom(result: LintResult, date: string, scoreVersion: number, label?: string): HistoryEntry {
  const n = (s: string) => result.diagnostics.filter((d) => d.severity === s && d.ruleId !== "OBL000").length;
  return { date, score: result.score, grade: result.grade, scoreVersion, errors: n("error"), warnings: n("warn"), notes: n("info"), files: result.files.length, tokens: result.files.reduce((a, f) => a + f.tokens, 0), label };
}

/** Append one JSON line. Local file, no network. */
export function recordHistory(root: string, entry: HistoryEntry, file = HISTORY_FILE): string {
  const abs = path.resolve(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, JSON.stringify(entry) + "\n");
  return abs;
}

export function readHistory(root: string, file = HISTORY_FILE): HistoryEntry[] {
  const abs = path.resolve(root, file);
  if (!fs.existsSync(abs)) return [];
  const out: HistoryEntry[] = [];
  for (const line of fs.readFileSync(abs, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as HistoryEntry);
    } catch {
      throw new ObelosError("USAGE", `History file ${abs} contains a line that is not valid JSON.`);
    }
  }
  return out;
}

const BARS = "▁▂▃▄▅▆▇█";

export function formatHistory(entries: HistoryEntry[]): string {
  if (entries.length === 0) return "No history yet. Run `obelos history --record` (for example in CI) to start one.";
  const spark = entries.map((e) => BARS[Math.min(7, Math.floor((e.score / 100) * 8))]).join("");
  const out = [`Score trend: ${spark}  (${entries[0]!.score} -> ${entries[entries.length - 1]!.score})`, ""];
  for (const e of entries.slice(-20)) out.push(`${e.date}  ${String(e.score).padStart(3)} ${e.grade}  ${e.errors}E ${e.warnings}W ${e.notes}N  ~${e.tokens} tokens${e.label ? `  ${e.label}` : ""}`);
  const mixed = new Set(entries.map((e) => e.scoreVersion));
  if (mixed.size > 1) out.push("", "Note: the score formula changed during this history; compare across versions with care.");
  return out.join("\n");
}
