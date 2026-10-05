import type { Diagnostic, Rule } from "../core/types.js";
import { bodyLines, diag } from "./util.js";

function normalise(s: string): string {
  return s
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const duplicateInstruction: Rule = {
  id: "OBL011",
  name: "duplicate-instruction",
  description: "The same instruction line appears more than once, in one file or across files.",
  defaultSeverity: "warn",
  run(files) {
    const out: Diagnostic[] = [];
    const firstSeen = new Map<string, { file: string; line: number }>();
    for (const f of files) {
      for (const { text, line } of bodyLines(f)) {
        if (/^\s*#/.test(text)) continue;
        const n = normalise(text);
        if (n.length < 40) continue;
        const prev = firstSeen.get(n);
        if (!prev) {
          firstSeen.set(n, { file: f.path, line });
          continue;
        }
        if (prev.file === f.path) {
          out.push(diag(this, f.path, `Line repeats line ${prev.line} of the same file.`, { line, severity: "info" }));
        } else {
          out.push(diag(this, f.path, `Same instruction already appears in ${prev.file}:${prev.line}.`, { line, hint: "Keep one source of truth and import or reference it." }));
        }
      }
    }
    return out;
  },
};

const VAGUE: { re: RegExp; label: string }[] = [
  { re: /\bwrite (clean|good|high[- ]quality|quality) code\b/i, label: "write clean code" },
  { re: /\bfollow (the )?best practices\b/i, label: "follow best practices" },
  { re: /\b(be|stay) (careful|thoughtful|mindful)\b/i, label: "be careful" },
  { re: /\bmake sure (it|everything|that it) works?\b/i, label: "make sure it works" },
  { re: /\buse (good|meaningful|descriptive) (naming|names)\b/i, label: "use good names" },
  { re: /\bkeep (the )?code (clean|simple|tidy)\b/i, label: "keep code clean" },
];

export const vagueInstruction: Rule = {
  id: "OBL012",
  name: "vague-instruction",
  description: "An instruction is too generic to change agent behaviour.",
  defaultSeverity: "info",
  run(files) {
    const out: Diagnostic[] = [];
    for (const f of files) {
      for (const { text, line } of bodyLines(f)) {
        for (const v of VAGUE) {
          if (v.re.test(text)) out.push(diag(this, f.path, `"${v.label}" is too vague to change behaviour.`, { line, hint: "Replace with a concrete, checkable rule (a command, a path, a named convention)." }));
        }
      }
    }
    return out;
  },
};

const SECRETS: { re: RegExp; label: string }[] = [
  { re: /AKIA[0-9A-Z]{16}/, label: "AWS access key id" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, label: "GitHub token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/, label: "GitHub fine-grained token" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/, label: "private key block" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: "Slack token" },
  { re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/, label: "Slack webhook URL" },
  { re: /\bsk-[A-Za-z0-9_-]{32,}\b/, label: "API secret key" },
  { re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/, label: "Stripe live key" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: "Google API key" },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/, label: "npm token" },
  { re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/, label: "SendGrid key" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, label: "JSON Web Token" },
  { re: /\bAccountKey=[A-Za-z0-9+/=]{40,}/, label: "Azure storage account key" },
];
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s/@]{3,})@[^\s/]+/i;
const GENERIC = /\b(?:api[_-]?key|secret|token|password|passwd|auth)\b\s*[:=]\s*['"]?([A-Za-z0-9_\-/+=]{16,})/i;
const PLACEHOLDER = /(your|xxx|example|changeme|placeholder|dummy|sample|test|fake|<|\$\{|\$[A-Z_]+|\*{3,}|\.{3})/i;

/** Shannon entropy in bits per character. Real random secrets score about 3.5 or more; words and repeats score low. */
export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function compileAllow(opts: unknown): RegExp[] {
  if (!Array.isArray(opts)) return [];
  const out: RegExp[] = [];
  for (const a of opts) {
    try {
      if (typeof a === "string" && a.length <= 200) out.push(new RegExp(a));
    } catch {
      /* ignore invalid allow patterns */
    }
  }
  return out;
}

export const secretDetected: Rule = {
  id: "OBL013",
  name: "secret-detected",
  description: "The file appears to contain a credential. Instruction files are committed and sent to model providers.",
  defaultSeverity: "error",
  run(files, ws) {
    const out: Diagnostic[] = [];
    const allow = compileAllow(ws.config.ruleOptions.OBL013?.allow);
    const minEntropy = Number(ws.config.ruleOptions.OBL013?.minEntropy ?? 3.0);
    for (const f of files) {
      f.lines.forEach((text, i) => {
        if (text.length > 4000 || allow.some((re) => re.test(text))) return;
        for (const s of SECRETS) {
          if (s.re.test(text)) out.push(diag(this, f.path, `Possible ${s.label} (value not shown).`, { line: i + 1, hint: "Remove it, rotate the credential, and read secrets from the environment instead." }));
        }
        const u = URL_CREDENTIALS.exec(text);
        if (u && !PLACEHOLDER.test(u[0])) out.push(diag(this, f.path, "URL with embedded credentials (value not shown).", { line: i + 1, hint: "Remove the credentials from the URL and rotate them." }));
        const g = GENERIC.exec(text);
        if (g && !PLACEHOLDER.test(g[0]) && entropy(g[1] ?? "") >= minEntropy) {
          out.push(diag(this, f.path, "Possible hard-coded credential (value not shown).", { line: i + 1, hint: "Remove it and rotate if it is real. To allow a known-safe pattern, set ruleOptions OBL013.allow in the config." }));
        }
      });
    }
    return out;
  },
};

export const emptyOrPlaceholder: Rule = {
  id: "OBL014",
  name: "empty-or-placeholder",
  description: "The file is nearly empty or still contains template placeholders.",
  defaultSeverity: "info",
  run(files) {
    const out: Diagnostic[] = [];
    for (const f of files) {
      const content = bodyLines(f).filter((l) => l.text.trim() && !/^\s*#/.test(l.text));
      if (content.length < 3) {
        out.push(diag(this, f.path, "File has fewer than three lines of content.", { severity: "warn", hint: "Add concrete build, test and convention instructions, or delete the file." }));
      }
      for (const { text, line } of bodyLines(f)) {
        if (/\b(TODO|TBD|FIXME)\b|<fill (this )?in>|\[placeholder\]/i.test(text)) out.push(diag(this, f.path, "Placeholder text left in file.", { line }));
      }
    }
    return out;
  },
};

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

function phraseKey(s: string): string {
  return s
    .replace(/\b(the|a|an|our|this|that|these|those)\b/gi, " ")
    .replace(/[`*_"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const contradictoryInstruction: Rule = {
  id: "OBL015",
  name: "contradictory-instruction",
  description: "Heuristic: two instructions directly oppose each other (always X vs never X) or several package managers are prescribed.",
  defaultSeverity: "warn",
  run(files) {
    const out: Diagnostic[] = [];
    const positives = new Map<string, { file: string; line: number; text: string }>();
    const negatives = new Map<string, { file: string; line: number; text: string }>();
    const managerUse = new Map<string, { file: string; line: number }>();
    const POS = /\b(?:always|must|should)\s+(?:use|prefer|run|write|add)\s+([^.,;:\n]{2,60})/i;
    const NEG = /\b(?:never|do not|don't|must not|should not|avoid)\s+(?:use|prefer|run|write|add)?\s*([^.,;:\n]{2,60})/i;
    for (const f of files) {
      const lines = bodyLines(f);
      const inFile = new Set<string>();
      for (const { text, line } of lines) {
        const p = POS.exec(text);
        if (p?.[1]) positives.set(phraseKey(p[1]), { file: f.path, line, text: text.trim() });
        const n = NEG.exec(text);
        if (n?.[1]) negatives.set(phraseKey(n[1]), { file: f.path, line, text: text.trim() });
      }
      for (let i = f.bodyStart - 1; i < f.lines.length; i++) {
        const text = f.lines[i] ?? "";
        for (const m of MANAGERS) {
          if (new RegExp(`\\b${m}\\s+(install|ci|add|run|test|i)\\b`).test(text) && !inFile.has(m)) {
            inFile.add(m);
            if (!managerUse.has(m)) managerUse.set(m, { file: f.path, line: i + 1 });
          }
        }
      }
    }
    for (const [key, pos] of positives) {
      const neg = negatives.get(key);
      if (neg && key.length > 2) {
        out.push(diag(this, neg.file, `Conflicts with ${pos.file}:${pos.line} ("${pos.text.slice(0, 70)}") about "${key}".`, { line: neg.line, hint: "Decide which applies and delete the other." }));
      }
    }
    if (managerUse.size > 1) {
      const names = [...managerUse.keys()];
      const first = [...managerUse.values()][1]!;
      out.push(diag(this, first.file, `Multiple package managers are prescribed (${names.join(", ")}).`, { line: first.line, hint: "Pick one; agents will otherwise mix lockfiles." }));
    }
    return out;
  },
};
