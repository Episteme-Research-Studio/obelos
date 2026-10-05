import picomatch from "picomatch";
import type { Diagnostic, Rule } from "../core/types.js";
import { diag, gitignoreCovers, resolveFrom } from "./util.js";

export const claudeIgnoresAgentsMd: Rule = {
  id: "OBL006",
  name: "claude-ignores-agents-md",
  description: "CLAUDE.md and AGENTS.md both exist in a directory but CLAUDE.md does not import AGENTS.md, so Claude Code ignores AGENTS.md.",
  defaultSeverity: "warn",
  run(files) {
    const out: Diagnostic[] = [];
    for (const a of files.filter((f) => f.kind === "agents-md")) {
      const claudes = files.filter((f) => f.kind === "claude-md" && (f.dir === a.dir || f.dir === (a.dir ? a.dir + "/.claude" : ".claude")));
      if (claudes.length === 0) continue;
      const linked = claudes.some((c) => {
        if (c.realPath === a.realPath) return true; // symlink
        if (c.raw === a.raw) return true; // identical copy: nothing is hidden (OBL011 reports the duplication)
        return c.imports.some((i) => resolveFrom(c.dir, i.value) === a.path);
      });
      if (linked) continue;
      const c = claudes[0]!;
      out.push(
        diag(this, c.path, `${a.path} exists next to this file but is not imported; Claude Code reads only CLAUDE.md when both are present.`, {
          hint: "Add `@AGENTS.md` to CLAUDE.md (then keep shared rules in AGENTS.md), or symlink one to the other.",
        }),
      );
    }
    return out;
  },
};

export const cursorMdIgnored: Rule = {
  id: "OBL007",
  name: "cursor-md-ignored",
  description: "A .md file inside .cursor/rules is ignored by Cursor, which requires the .mdc extension.",
  defaultSeverity: "warn",
  run(files) {
    return files
      .filter((f) => f.kind === "cursor-rule" && f.path.endsWith(".md") && !/(^|\/)README\.md$/i.test(f.path))
      .map((f) => diag(this, f.path, "Cursor project rules must use the .mdc extension; this file is ignored.", { hint: "Rename to .mdc and add frontmatter (description, globs, alwaysApply)." }));
  },
};

export const cursorFrontmatter: Rule = {
  id: "OBL008",
  name: "cursor-frontmatter",
  description: "A Cursor .mdc rule has no frontmatter or none of description, globs or alwaysApply, so it only applies when mentioned manually.",
  defaultSeverity: "info",
  run(files) {
    const out: Diagnostic[] = [];
    for (const f of files.filter((x) => x.kind === "cursor-rule" && x.path.endsWith(".mdc") && !x.frontmatterError)) {
      const fm = f.frontmatter;
      if (!fm) {
        out.push(diag(this, f.path, "Rule has no frontmatter, so Cursor treats it as manual-only.", { hint: "Add description, globs or alwaysApply." }));
        continue;
      }
      if (fm.description === undefined && fm.globs === undefined && fm.alwaysApply !== true) {
        out.push(diag(this, f.path, "Rule has no description, globs or alwaysApply: true, so it only applies when mentioned with @rule-name.", { hint: "Add a description (agent decides), globs (file match) or alwaysApply: true." }));
      }
    }
    return out;
  },
};

export const copilotApplyToMissing: Rule = {
  id: "OBL009",
  name: "copilot-applyto-missing",
  description: "A Copilot path-specific instructions file has neither applyTo nor description, so nothing selects it automatically.",
  defaultSeverity: "info",
  run(files) {
    return files
      .filter((f) => f.kind === "copilot-path" && (!f.frontmatter || (f.frontmatter.applyTo === undefined && f.frontmatter.description === undefined)))
      .map((f) => diag(this, f.path, "No `applyTo` glob and no `description`: this file is only used when attached by hand.", { hint: 'Add `applyTo: "**/*.ts"` (automatic by file) or a `description` (chosen by task).' }));
  },
};

export const frontmatterInvalid: Rule = {
  id: "OBL016",
  name: "frontmatter-invalid",
  description: "The YAML frontmatter cannot be parsed.",
  defaultSeverity: "error",
  run(files) {
    const out: Diagnostic[] = [];
    for (const f of files) {
      if (f.frontmatterError) out.push(diag(this, f.path, `Invalid frontmatter: ${f.frontmatterError}`, { line: 1 }));
      else if (f.strictYamlError) out.push(diag(this, f.path, `Frontmatter is not strict YAML (${f.strictYamlError}) but its keys were read; tools with strict parsers may ignore it.`, { line: 1, severity: "warn", hint: "Quote values that contain special characters, for example globs: \"*.ts\"." }));
    }
    return out;
  },
};

export const localFileNotGitignored: Rule = {
  id: "OBL017",
  name: "local-file-not-gitignored",
  description: "CLAUDE.local.md holds personal preferences and should be listed in .gitignore.",
  defaultSeverity: "warn",
  fixable: true,
  run(files, ws) {
    const out: Diagnostic[] = [];
    const gi = (ws.read(".gitignore") ?? "").split(/\r?\n/);
    for (const f of files.filter((x) => x.kind === "claude-local")) {
      if (!gitignoreCovers(gi, f.path)) {
        out.push(diag(this, f.path, "CLAUDE.local.md is not covered by .gitignore and may be committed.", { hint: "Add `CLAUDE.local.md` to .gitignore." }));
      }
    }
    return out;
  },
};
