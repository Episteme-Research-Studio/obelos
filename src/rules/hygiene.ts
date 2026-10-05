import type { Diagnostic, Rule } from "../core/types.js";
import { bodyLines, diag, proseLines } from "./util.js";

const MAIN_KINDS = new Set(["claude-md", "agents-md", "copilot-repo", "gemini-md"]);
const COMMAND_RE = /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test|build|lint|typecheck|check)\b|\bpytest\b|\bcargo\s+(?:test|build|check)\b|\bgo\s+(?:test|build|vet)\b|\bmake\s+[\w-]+|\b(?:mvn|gradle|gradlew)\b|\bdotnet\s+(?:test|build)\b|\b(?:tox|nox)\b|\bjust\s+[\w-]+|\b(?:test|build|lint)\s+command\b/i;

export const expiredSuppression: Rule = {
  id: "OBL018",
  name: "expired-suppression",
  description: "A obelos-disable comment has an `until` date that has passed, so it no longer suppresses anything.",
  defaultSeverity: "warn",
  run(files) {
    const out: Diagnostic[] = [];
    for (const f of files) {
      for (const s of f.disables.expired) {
        const ids = s.rules === "all" ? "all rules" : [...s.rules].join(", ");
        out.push(diag(this, f.path, `Suppression of ${ids} expired on ${s.until}${s.reason ? ` (reason: ${s.reason})` : ""} and no longer applies.`, { line: s.line, hint: "Fix the underlying finding, or extend the until date with a reason." }));
      }
    }
    return out;
  },
};

export const noBuildOrTestCommand: Rule = {
  id: "OBL019",
  name: "no-build-or-test-command",
  description: "The root instruction files never tell the agent how to build, test or lint the project.",
  defaultSeverity: "info",
  run(files) {
    const roots = files.filter((f) => f.dir === "" && MAIN_KINDS.has(f.kind));
    if (roots.length === 0) return [];
    if (roots.some((f) => COMMAND_RE.test(f.raw))) return [];
    const first = roots[0]!;
    return [diag(this, first.path, "No build, test or lint command found in the root instruction files.", { hint: "Agents verify their own work best when you give them the exact command, e.g. `npm test`. Add a Commands section." })];
  },
};

export const wallOfText: Rule = {
  id: "OBL026",
  name: "wall-of-text",
  description: "A very long line or paragraph that agents are likely to skim or follow only partly.",
  defaultSeverity: "info",
  run(files, ws) {
    const maxLine = Number(ws.config.ruleOptions.OBL026?.maxLineChars ?? 600);
    const maxPara = Number(ws.config.ruleOptions.OBL026?.maxParagraphChars ?? 1200);
    const out: Diagnostic[] = [];
    for (const f of files) {
      let count = 0;
      let paraStart = 0;
      let paraLen = 0;
      const flushPara = () => {
        if (paraLen > maxPara && count < 5) {
          out.push(diag(this, f.path, `Paragraph is ${paraLen} characters long.`, { line: paraStart, hint: "Split it into short, single-purpose bullets." }));
          count++;
        }
        paraLen = 0;
        paraStart = 0;
      };
      for (const { text, line } of proseLines(f)) {
        if (text.trim() === "") {
          flushPara();
          continue;
        }
        // Headings, table rows and each list item start a new block; they are not one paragraph.
        if (/^\s*(#|\||[-*+]\s|\d+[.)]\s)/.test(text)) {
          flushPara();
          if (/^\s*(#|\|)/.test(text)) continue;
        }
        if (text.length > maxLine && count < 5) {
          out.push(diag(this, f.path, `Line is ${text.length} characters long.`, { line, hint: "Break it into shorter instructions." }));
          count++;
        }
        if (paraStart === 0) paraStart = line;
        paraLen += text.length;
      }
      flushPara();
    }
    return out;
  },
};

const SHOUT = /\b(?:ALWAYS|NEVER|MUST|IMPORTANT|CRITICAL|MANDATORY|ABSOLUTELY|EXTREMELY)\b/g;

export const emphasisOveruse: Rule = {
  id: "OBL027",
  name: "emphasis-overuse",
  description: "Many ALL-CAPS absolute words dilute each other; when everything is critical, nothing is.",
  defaultSeverity: "info",
  run(files, ws) {
    const max = Number(ws.config.ruleOptions.OBL027?.max ?? 8);
    const out: Diagnostic[] = [];
    for (const f of files) {
      let n = 0;
      for (const { text } of bodyLines(f)) n += text.match(SHOUT)?.length ?? 0;
      if (n > max) out.push(diag(this, f.path, `${n} ALL-CAPS emphasis words (limit ${max}).`, { hint: "Keep emphasis for the one or two rules that truly must not be broken; state the rest plainly." }));
    }
    return out;
  },
};
