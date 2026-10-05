import path from "node:path";
import picomatch from "picomatch";
import type { ContextFile, Diagnostic, Rule, Severity } from "../core/types.js";

export function diag(rule: Pick<Rule, "id" | "defaultSeverity">, file: string, message: string, extra: { line?: number; hint?: string; severity?: Severity } = {}): Diagnostic {
  return { ruleId: rule.id, severity: extra.severity ?? rule.defaultSeverity, message, file, line: extra.line, hint: extra.hint };
}

/** Lines of the body only (frontmatter excluded), with 1-based numbers. */
export function bodyLines(f: ContextFile): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let inFence = false;
  for (let i = f.bodyStart - 1; i < f.lines.length; i++) {
    const text = f.lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push({ text, line: i + 1 });
  }
  return out;
}

/** Lines of the body with fenced code and HTML comments (single or multi-line) removed. */
export function proseLines(f: ContextFile): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let inComment = false;
  for (const l of bodyLines(f)) {
    let t = l.text;
    if (inComment) {
      const end = t.indexOf("-->");
      if (end === -1) continue;
      inComment = false;
      t = t.slice(end + 3);
    }
    for (;;) {
      const start = t.indexOf("<!--");
      if (start === -1) break;
      const end = t.indexOf("-->", start + 4);
      if (end === -1) {
        t = t.slice(0, start);
        inComment = true;
        break;
      }
      t = t.slice(0, start) + t.slice(end + 3);
    }
    out.push({ text: t, line: l.line });
  }
  return out;
}

/** Text that says a referenced thing may legitimately be absent, optional, generated or yet to be created. */
export const HEDGED = /\b(?:if (?:it )?(?:exists?|is present|present|available|any)|when present|where present|optional(?:ly)?|may not exist|if needed|generated|auto-generated|gitignored|git-ignored|build output|output (?:goes|is written)|created (?:by|on|at)|will be created|scratch|put (?:any )?files)\b/i;

/** Simple .gitignore matcher (no negation support beyond skipping `!` lines). */
export function gitignoreCovers(lines: string[], rel: string): boolean {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const pattern = line.replace(/^\//, "").replace(/\/$/, "");
    const anchored = line.startsWith("/") || pattern.includes("/");
    const glob = anchored ? pattern : `**/${pattern}`;
    const m = picomatch(glob, { dot: true });
    if (m(rel) || m(rel.replace(/\/$/, ""))) return true;
    // a directory pattern also covers everything below it
    const parts = rel.replace(/\/$/, "").split("/");
    for (let i = 1; i < parts.length; i++) if (m(parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

/** Paths of git submodules from .gitmodules; their content is not part of a plain clone. */
export function submodulePaths(text: string | null): string[] {
  if (!text) return [];
  return [...text.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((m) => (m[1] ?? "").replace(/\/$/, ""));
}

export function resolveFrom(fileDir: string, target: string): string {
  return path.posix.normalize(path.posix.join(fileDir, target));
}
