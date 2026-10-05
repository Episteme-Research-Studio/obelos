import picomatch from "picomatch";
import type { Diagnostic, Policy, Rule } from "../core/types.js";

const MAX_LINE = 5000;
const MAX_HITS = 20;

function compile(p: Policy, pattern: string): RegExp {
  return new RegExp(pattern, (p.flags ?? "i").replace(/[gy]/g, ""));
}

function mk(p: Policy, file: string, message: string, line?: number): Diagnostic {
  return { ruleId: `POL-${p.id.toUpperCase()}`, severity: p.severity, message: p.message ?? message, file, line, hint: p.description };
}

/**
 * Policy as code (free tier): declarative `require` / `forbid` / `requireHeading` rules from config.
 * Each policy reports under its own rule ID, `POL-<ID>`, so it can be re-levelled, suppressed and baselined like any rule.
 * Regular expressions are length-capped and applied per line to bound cost; there is no timeout, so keep patterns simple.
 */
export const policyEngine: Rule = {
  id: "OBL900",
  name: "policy-engine",
  description: "Runs the organisation-defined policies from the config file (require, forbid, requireHeading).",
  defaultSeverity: "warn",
  run(files, ws) {
    const out: Diagnostic[] = [];
    for (const p of ws.config.policies) {
      const match = picomatch(p.files, { dot: true });
      const req = p.require ? compile(p, p.require) : null;
      const forb = p.forbid ? compile(p, p.forbid) : null;
      const heading = p.requireHeading?.trim().toLowerCase();
      for (const f of files) {
        if (!match(f.path) || (p.tools && !p.tools.includes(f.tool))) continue;
        if (req && !req.test(f.raw)) out.push(mk(p, f.path, `Policy ${p.id}: file must match /${p.require}/.`));
        if (heading) {
          const has = f.lines.some((l) => {
            const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
            return m !== null && (m[1] ?? "").trim().toLowerCase() === heading;
          });
          if (!has) out.push(mk(p, f.path, `Policy ${p.id}: file must contain a heading "${p.requireHeading}".`));
        }
        if (forb) {
          let hits = 0;
          for (let i = 0; i < f.lines.length && hits < MAX_HITS; i++) {
            const text = f.lines[i] ?? "";
            if (text.length <= MAX_LINE && forb.test(text)) {
              out.push(mk(p, f.path, `Policy ${p.id}: line matches forbidden pattern /${p.forbid}/.`, i + 1));
              hits++;
            }
          }
        }
      }
    }
    return out;
  },
};
