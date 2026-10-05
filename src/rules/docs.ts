import type { RuleDocs } from "../core/types.js";

const CLAUDE = "https://code.claude.com/docs/en/memory";
const CURSOR = "https://cursor.com/docs/context/rules";
const COPILOT = "https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions";

/** Long-form help shown by `obelos explain OBLnnn`. Sources fetched 2026-10-04; vendor behaviour is volatile. */
export const RULE_DOCS: Record<string, RuleDocs> = {
  OBL000: { why: "A rule crashed on unexpected input. Obelos isolates rule failures so one bad file never hides other findings.", fix: "Please report this with the file that triggered it." },
  OBL001: { why: "Long always-loaded files consume context and reduce adherence; Claude Code recommends under 200 lines per CLAUDE.md and Cursor under 500 lines per rule.", fix: "Move area-specific guidance into path-scoped rules or nested files; delete what the agent already knows.", sources: [CLAUDE, CURSOR] },
  OBL002: { why: "Some tools cap the combined size of instruction files and drop the rest (reported for Codex at 32 KiB; secondary source).", fix: "Trim the root file and split guidance into nested files that load only when relevant." },
  OBL003: { why: "An @import to a missing file silently loads nothing; chains deeper than four hops are not followed by Claude Code.", fix: "Fix the path (relative to the importing file) or flatten the chain.", bad: "See @docs/missing.md", good: "See @docs/architecture.md", sources: [CLAUDE] },
  OBL004: { why: "Stale paths send the agent to files that no longer exist and erode trust in the rest of the file.", fix: "Update or remove the reference; add generated paths to ignorePathRefs.", bad: "API handlers live in `src/handlers/`", good: "API handlers live in `src/api/handlers/`" },
  OBL005: { why: "The agent will run the documented command and fail or improvise.", fix: "Correct the script name or add the script to package.json.", bad: "Run `npm run test:unit`", good: "Run `npm test`" },
  OBL006: { why: "When both files exist, Claude Code reads only CLAUDE.md unless it imports AGENTS.md, so rules in AGENTS.md that Cursor, Copilot and Codex follow are invisible to Claude.", fix: "Put `@AGENTS.md` in CLAUDE.md, or symlink one file to the other.", good: "@AGENTS.md\n\n# Claude-specific notes", sources: [CLAUDE] },
  OBL007: { why: "Cursor requires the .mdc extension for project rules; .md files in .cursor/rules are ignored.", fix: "Rename to .mdc and add frontmatter.", sources: [CURSOR] },
  OBL008: { why: "A rule with no description, globs or alwaysApply only applies when mentioned manually.", fix: "Add `description` (agent decides), `globs` (file match) or `alwaysApply: true`.", sources: [CURSOR] },
  OBL009: { why: "Copilot path-specific instruction files need an applyTo glob to be used.", fix: "Add applyTo frontmatter.", good: '---\napplyTo: "**/*.ts"\n---', sources: [COPILOT] },
  OBL010: { why: "A scoped rule whose glob matches nothing never loads.", fix: "Fix the glob or delete the rule.", sources: [CLAUDE, CURSOR, COPILOT] },
  OBL011: { why: "Duplicated instructions drift apart and double the context cost.", fix: "Keep one source of truth and import or reference it; silence intentional copies with a disable comment." },
  OBL012: { why: "Generic advice does not change agent behaviour but costs tokens.", fix: "Replace with a concrete, checkable rule.", bad: "Write clean code.", good: "Functions stay under 40 lines; extract helpers into `src/utils/`." },
  OBL013: { why: "Instruction files are committed and sent to model providers; credentials in them leak.", fix: "Remove the value, rotate the credential, read secrets from the environment." },
  OBL014: { why: "Empty or placeholder files give a false sense of coverage.", fix: "Add concrete build, test and convention instructions, or delete the file." },
  OBL015: { why: "Claude Code notes that contradictory instructions may be followed arbitrarily.", fix: "Decide which applies and delete the other.", sources: [CLAUDE] },
  OBL016: { why: "Unparseable frontmatter breaks scoping in Claude, Cursor and Copilot rules.", fix: "Close the frontmatter with --- and fix the YAML." },
  OBL017: { why: "CLAUDE.local.md holds personal preferences and should not be committed.", fix: "Add CLAUDE.local.md to .gitignore.", good: "CLAUDE.local.md", sources: [CLAUDE] },
  OBL018: { why: "A suppression with an expiry date is a promise to fix something later; once the date passes it silently stops working and the finding returns.", fix: "Fix the underlying finding, or extend the until date and say why.", bad: "<!-- obelos-disable-next-line OBL012 until=2026-01-01 -->", good: "<!-- obelos-disable-next-line OBL012 until=2027-01-01 reason=\"rewrite after v2 launch\" -->" },
  OBL019: { why: "Agents check their own work best when the exact build, test and lint commands are in front of them. This is a heuristic, not a vendor requirement.", fix: "Add a short Commands section with the exact commands.", good: "## Commands\n- Test: `npm test`\n- Lint: `npm run lint`" },
  OBL026: { why: "Very long lines and paragraphs are skimmed or followed only partly, and cost tokens on every request.", fix: "Split into short single-purpose bullets. Tune with ruleOptions OBL026.maxLineChars and maxParagraphChars." },
  OBL027: { why: "When many rules are marked ALWAYS, NEVER or CRITICAL they compete, and none stands out.", fix: "Keep emphasis for the one or two rules that must not be broken. Tune with ruleOptions OBL027.max." },
  OBL900: { why: "Organisation policies from the config file (require, forbid, requireHeading). Each policy reports as POL-<ID>.", fix: "Fix the instruction file, or adjust the policy.", good: "{ \"policies\": [{ \"id\": \"no-todos\", \"forbid\": \"\\\\bTODO\\\\b\", \"severity\": \"warn\" }] }" },
};
