import type { LintResult } from "./types.js";

const COLORS: Record<string, string> = { A: "#2ea44f", B: "#7cb342", C: "#dfb317", D: "#fe7d37", F: "#e05d44" };
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);

/** shields.io endpoint JSON: https://shields.io/badges/endpoint-badge */
export function shieldsJson(r: Pick<LintResult, "score" | "grade">): string {
  const color = { A: "brightgreen", B: "green", C: "yellow", D: "orange", F: "red" }[r.grade] ?? "lightgrey";
  return JSON.stringify({ schemaVersion: 1, label: "agent context", message: `${r.score}/100 ${r.grade}`, color }, null, 2);
}

/** Self-contained flat SVG badge; width estimated from character count (no font metrics needed). */
export function badgeSvg(r: Pick<LintResult, "score" | "grade">): string {
  const label = "agent context";
  const msg = `${r.score}/100 ${r.grade}`;
  const lw = Math.round(label.length * 6.2 + 12);
  const mw = Math.round(msg.length * 6.8 + 12);
  const w = lw + mw;
  const color = COLORS[r.grade] ?? "#9f9f9f";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(msg)}"><title>${esc(label)}: ${esc(msg)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="14">${esc(msg)}</text></g></svg>\n`;
}
