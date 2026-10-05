import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ContextFile, Disables, FileKind, Ref, RuleSet, Suppression, Tool } from "./types.js";

const FENCE = /^\s*(```|~~~)/;
const CODE_SPAN = /`([^`\n]+)`/g;
const SCRIPT_RE = /\b(?:npm|pnpm|yarn|bun)\s+run\s+((?:(?!\b(?:npm|pnpm|yarn|bun)\s+run\b)[^\n`])*)/g;
const VALUE_FLAGS = new Set(["--filter", "-F", "--workspace", "-w", "--prefix", "-C", "--cwd", "--dir"]);
const CJK_PUNCT = /[\u3000-\u303f\uff00-\uffef]/;

/** First non-flag word after `run`, skipping flags such as `-r` or `--filter web`. */
function scriptName(rest: string): string | null {
  const tokens = rest.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? "";
    if (t.startsWith("-")) {
      if (VALUE_FLAGS.has(t)) i++;
      continue;
    }
    const name = t.replace(/[`'",;)]+$/, "");
    return /^[\w:.\-]+$/.test(name) ? name : null;
  }
  return null;
}
// An @import must start a token (start of line or whitespace before it).
const IMPORT_RE = /(^|\s)@((?:\\ |[^\s`])+)/g;

export function classify(rel: string): { tool: Tool; kind: FileKind } | null {
  const base = path.posix.basename(rel);
  if (base === "CLAUDE.local.md") return { tool: "claude", kind: "claude-local" };
  if (base === "CLAUDE.md") return { tool: "claude", kind: "claude-md" };
  if (/(^|\/)\.claude\/rules\/.+\.md$/.test(rel)) return { tool: "claude", kind: "claude-rule" };
  if (base === "AGENTS.md") return { tool: "agents", kind: "agents-md" };
  if (/(^|\/)\.cursor\/rules\/.+\.(mdc|md)$/.test(rel)) return { tool: "cursor", kind: "cursor-rule" };
  if (rel === ".cursorrules") return { tool: "cursor", kind: "cursor-legacy" };
  if (rel === ".github/copilot-instructions.md") return { tool: "copilot", kind: "copilot-repo" };
  if (/^\.github\/instructions\/.+\.instructions\.md$/.test(rel)) return { tool: "copilot", kind: "copilot-path" };
  if (base === "GEMINI.md") return { tool: "gemini", kind: "gemini-md" };
  return null;
}

export function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown> | null;
  error?: string;
  bodyStart: number;
  yamlText?: string;
} {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { frontmatter: null, bodyStart: 1 };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { frontmatter: null, error: "Frontmatter opened with --- but never closed.", bodyStart: 1 };
  const yamlText = lines.slice(1, end).join("\n");
  try {
    const parsed = YAML.parse(yamlText);
    const fm = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return { frontmatter: fm, bodyStart: end + 2 };
  } catch (e) {
    return { frontmatter: null, error: (e as Error).message.split("\n")[0] ?? "Invalid YAML", bodyStart: end + 2, yamlText };
  }
}

/** Line-by-line `key: value` reader for frontmatter that is not strict YAML (for example an unquoted `globs: *.ts`). */
export function lenientFrontmatter(yamlText: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const line of yamlText.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v: unknown = (m[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
    if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (v === "" || v === "null" || v === "~") v = null;
    out[m[1]!] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function looksLikePath(s: string): boolean {
  if (/\s/.test(s) || s.includes("://")) return false;
  if (!/^[\w@.\-/]+$/.test(s)) return false;
  if (s.startsWith("/") || s.startsWith("~") || s.startsWith("$")) return false;
  if (!s.includes("/")) return false;
  if (/[*?{}[\]]/.test(s)) return false;
  if (/(?:YYYY|MM_DD|<|>)/.test(s)) return false; // template placeholder
  if (!s.startsWith(".") && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ai|app|gov|edu)\//i.test(s)) return false; // a URL without a scheme
  const ext = /\.([A-Za-z0-9]+)$/.exec(s)?.[1];
  return (ext !== undefined && ext.length <= 6) || s.endsWith("/");
}

function stripSpans(line: string): string {
  return line.replace(CODE_SPAN, (m) => " ".repeat(m.length));
}

export function extractRefs(lines: string[], from: number): { imports: Ref[]; pathRefs: Ref[]; scriptRefs: Ref[] } {
  const imports: Ref[] = [];
  const pathRefs: Ref[] = [];
  const scriptRefs: Ref[] = [];
  let inFence = false;
  for (let i = from - 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    // Script references are meaningful inside fences and spans alike.
    for (const m of line.matchAll(SCRIPT_RE)) {
      const name = scriptName(m[1] ?? "");
      if (name) scriptRefs.push({ value: name, line: lineNo });
    }
    if (inFence) continue;
    for (const m of line.matchAll(CODE_SPAN)) {
      const v = m[1]?.trim();
      if (v && looksLikePath(v)) pathRefs.push({ value: v, line: lineNo });
    }
    for (const m of line.matchAll(/\]\(([^)\s#]+)\)/g)) {
      const v = m[1];
      if (v && !v.includes("://") && !v.startsWith("mailto:") && looksLikePath(v)) pathRefs.push({ value: v, line: lineNo });
    }
    const bare = stripSpans(line);
    for (const m of bare.matchAll(IMPORT_RE)) {
      let t = m[2] ?? "";
      t = (t.split(CJK_PUNCT)[0] ?? "").replace(/[.,;:!?)\]]+$/, "");
      if (t && (t.includes("/") || /\.[A-Za-z0-9]+$/.test(t))) imports.push({ value: t.replace(/\\ /g, " "), line: lineNo });
    }
  }
  return { imports, pathRefs, scriptRefs };
}

const DISABLE_RE = /<!--\s*obelos-disable(-file|-next-line)?((?:\s[^\n]*?)?)\s*-->/g;
const UNTIL_RE = /\buntil=(\d{4}-\d{2}-\d{2})\b/;
const REASON_RE = /\breason=(?:"([^"]*)"|(\S+))/;

function toRuleSet(list: string): RuleSet {
  const ids = list.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  return ids.length === 0 ? "all" : new Set(ids);
}

function merge(a: RuleSet | null | undefined, b: RuleSet): RuleSet {
  if (a === "all" || b === "all") return "all";
  return new Set([...(a ?? []), ...b]);
}

export function todayIso(): string {
  return process.env.OBELOS_TODAY && /^\d{4}-\d{2}-\d{2}$/.test(process.env.OBELOS_TODAY) ? process.env.OBELOS_TODAY : new Date().toISOString().slice(0, 10);
}

/**
 * Parse suppression comments. A comment may carry `until=YYYY-MM-DD` (inclusive) and `reason="..."`;
 * once the date has passed the suppression stops applying and is listed in `expired`.
 */
export function extractDisables(lines: string[], today: string = todayIso()): Disables {
  const out: Disables = { file: null, lines: new Map(), entries: [], expired: [] };
  lines.forEach((text, i) => {
    for (const m of text.matchAll(DISABLE_RE)) {
      const scopeRaw = m[1];
      let body = m[2] ?? "";
      const until = UNTIL_RE.exec(body)?.[1];
      const reasonM = REASON_RE.exec(body);
      body = body.replace(UNTIL_RE, " ").replace(REASON_RE, " ");
      const rules = toRuleSet(body);
      const scope: Suppression["scope"] = scopeRaw === "-file" ? "file" : scopeRaw === "-next-line" ? "next-line" : "line";
      const entry: Suppression = { scope, rules, line: i + 1, until, reason: reasonM ? (reasonM[1] ?? reasonM[2]) : undefined };
      out.entries.push(entry);
      if (until && until < today) {
        out.expired.push(entry);
        continue;
      }
      if (scope === "file") out.file = merge(out.file, rules);
      else {
        const target = scope === "next-line" ? i + 2 : i + 1;
        out.lines.set(target, merge(out.lines.get(target), rules));
      }
    }
  });
  return out;
}

export interface ParseMeta {
  abs?: string;
  realPath?: string;
  today?: string;
}

/** Pure parser: text in, ContextFile out. No file system access. */
export function parseContent(rel: string, raw: string, meta: ParseMeta = {}): ContextFile | null {
  const cls = classify(rel);
  if (!cls) return null;
  const lines = raw.split(/\r?\n/);
  const fm = splitFrontmatter(raw);
  // Cursor reads frontmatter leniently (unquoted globs are common); recover the values instead of reporting an error.
  let frontmatter = fm.frontmatter;
  let frontmatterError = fm.error;
  let strictYamlError: string | undefined;
  if (fm.error && !frontmatter && fm.yamlText !== undefined) {
    const lenient = lenientFrontmatter(fm.yamlText);
    if (lenient) {
      frontmatter = lenient;
      if (cls.tool === "cursor") frontmatterError = undefined;
      else {
        strictYamlError = fm.error;
        frontmatterError = undefined;
      }
    }
  }
  const refs = extractRefs(lines, fm.bodyStart);
  const bytes = Buffer.byteLength(raw, "utf8");
  return {
    path: rel,
    abs: meta.abs ?? rel,
    realPath: meta.realPath ?? meta.abs ?? rel,
    tool: cls.tool,
    kind: cls.kind,
    dir: path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel),
    raw,
    lines,
    bytes,
    tokens: Math.ceil(bytes / 4),
    frontmatter,
    frontmatterError,
    strictYamlError,
    bodyStart: fm.bodyStart,
    ...refs,
    disables: extractDisables(lines, meta.today),
  };
}

/** Convenience wrapper that reads from disk. */
export function parseFile(root: string, rel: string, today?: string): ContextFile | null {
  const abs = path.join(root, rel);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  let realPath = abs;
  try {
    realPath = fs.realpathSync(abs);
  } catch {
    /* keep abs */
  }
  return parseContent(rel, raw, { abs, realPath, today });
}
