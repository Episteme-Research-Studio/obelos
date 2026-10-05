# Rule catalogue

Verification status uses these labels: **doc** (stated in vendor documentation, fetched 2026-10-04), **secondary** (stated by a non-vendor source), **heuristic** (our judgement; may false-positive). Vendor behaviour is volatile; re-verify monthly (backlog CO-110).

| ID | Name | Default | What it detects | Basis | False-positive risk |
|---|---|---|---|---|---|
| OBL001 | size-budget | warn | File over the line budget for its tool (Claude 200, Cursor 500, AGENTS.md/other 500) | doc: Claude "target under 200 lines"; Cursor "under 500 lines". AGENTS.md figure is a secondary range (200 to 500) | Low; budgets configurable |
| OBL002 | aggregate-budget | warn | Combined AGENTS.md chain (file plus ancestors) over 32 KiB, reported once at the file that crosses the limit | doc: Codex stops adding AGENTS.md files once the combined size reaches `project_doc_max_bytes`, 32 KiB by default (checked 2026-10-05). Not applied to CLAUDE.md, which has no documented byte limit | Low; the limit is configurable in Codex |
| OBL003 | broken-import | error | `@import` target missing; import chain deeper than four hops | doc: Claude imports, relative to containing file, max four hops | Low; bare `@word` is not treated as an import |
| OBL004 | missing-path-reference | warn | Backticked or linked repository path that does not exist anywhere in the repo, not even as a trailing sub-path | heuristic (Claude docs recommend referencing real paths and warn about outdated instructions) | Medium: placeholders, identifiers and module names that look like paths. Skipped: generated or output folders (`dist`, `vendor`, `.build`, ...), lines marked optional or generated ("if exists"), scheme-less URLs, `.js` for `.ts` sources. Mitigate with `ignorePathRefs` |
| OBL005 | missing-script-reference | warn | `npm/pnpm/yarn/bun run NAME` where NAME is not a package.json script in scope | heuristic | Low to medium: scripts defined in workspaces further down the tree, or in other manifests |
| OBL006 | claude-ignores-agents-md | warn | CLAUDE.md and AGENTS.md in the same directory with no import or symlink | doc: with both present Claude Code reads CLAUDE.md only (v2.1.277+ reads AGENTS.md when no CLAUDE.md) | Low; version-dependent message |
| OBL007 | cursor-md-ignored | warn | `.md` file in `.cursor/rules` | doc: Cursor requires `.mdc`; `.md` ignored | Low; confirm for current Cursor releases |
| OBL008 | cursor-frontmatter | info | `.mdc` rule without frontmatter, or without description, globs or alwaysApply | doc: rule types depend on those fields | Low; manual-only rules are sometimes intended |
| OBL009 | copilot-applyto-missing | info | Path-specific Copilot file with neither `applyTo` nor `description` | doc: VS Code custom instructions list `applyTo` and `description` as optional; without both the file is only used when attached by hand (checked 2026-10-05) | Low |
| OBL010 | scoped-glob-matches-nothing | warn | `paths` (Claude), `globs` (Cursor) or `applyTo` (Copilot) pattern matching no file; patterns without a slash match by file name in any directory; empty or `null` globs are ignored; brace groups are not split at commas | heuristic derived from doc semantics (Cursor docs, checked 2026-10-05) | Low to medium |
| OBL011 | duplicate-instruction | info | Same instruction line (40+ characters) repeated in a file or in a parent/child pair of files; an exact copy of another file is reported once | heuristic; supports the "single source of truth" claim. Ignores comments, headings, tables, symlinks and unrelated sibling directories | Medium: intentional copies |
| OBL012 | vague-instruction | info | Generic phrases ("write clean code") | heuristic; Claude docs recommend specific, verifiable instructions | Low at `info` |
| OBL013 | secret-detected | error | Credential patterns (cloud keys, GitHub tokens, private keys, Slack tokens, `sk-` keys, generic key=value) | heuristic; standard patterns | Medium for the generic rule; placeholders are skipped |
| OBL014 | empty-or-placeholder | info | Nearly empty file (under three lines and about 80 characters; import-only files such as `@AGENTS.md` are fine); TODO/TBD/placeholder text | heuristic | Low |
| OBL015 | contradictory-instruction | warn | "always use X" versus "never use X" with identical normalised phrase; mixed package managers across files | doc: Claude says contradictions may be followed arbitrarily; detection itself is heuristic | Medium to high: scoped rules, alternatives lists. Keep warn or lower |
| OBL016 | frontmatter-invalid | error/warn | Unclosed or unreadable frontmatter (error). Frontmatter that is not strict YAML but whose keys can be read, such as an unquoted `globs: *.ts`, is accepted for Cursor and a warning elsewhere | doc: frontmatter drives scoping in Claude, Cursor and Copilot; Cursor documents unquoted globs | Low |
| OBL017 | local-file-not-gitignored | warn | `CLAUDE.local.md` not covered by `.gitignore` | doc: Claude Code memory page says to add `CLAUDE.local.md` to `.gitignore` | Low; only root `.gitignore` is read (nested ignore files and global ignores are not) |
| OBL018 | expired-suppression | warn | A `obelos-disable` comment whose `until` date has passed | our own feature (suppression expiry); date comparison is deterministic and `--today` makes runs reproducible | Low |
| OBL019 | no-build-or-test-command | info | Root instruction files never mention a build, test or lint command | heuristic (agents verify work best with exact commands; this is our judgement, not a vendor requirement) | Medium: commands in linked docs or unusual tooling; evaluated on root files only |
| OBL026 | wall-of-text | info | Line over 600 characters or paragraph over 1,200 (list items, headings, tables and comments each start a new block) | heuristic; options `maxLineChars`, `maxParagraphChars` | Medium: tables, long URLs |
| OBL027 | emphasis-overuse | info | More than 8 ALL-CAPS absolute words (ALWAYS, NEVER, MUST, IMPORTANT, CRITICAL, ...) | heuristic; option `max` | Medium: style guides that legitimately use RFC 2119 keywords |
| OBL900 | policy-engine | per policy | Runs configured `policies` (require, forbid, requireHeading); findings carry `POL-<ID>` | user-defined (docs/POLICY.md) | Depends on the policy |

OBL013 (secret-detected) now also covers GitHub fine-grained tokens, Slack webhooks, Stripe live keys, Google API keys, npm tokens, SendGrid keys, JSON Web Tokens, Azure storage keys and URLs with embedded credentials; generic `key = value` matches must have Shannon entropy of at least 3.0 bits per character (option `minEntropy`) and not look like placeholders; `allow` (regex strings) skips known-safe lines. Patterns are standard public formats; none has been tested against a real-world corpus yet (CO-012).

## Sources (fetched 2026-10-04)

- Claude Code memory and rules: https://code.claude.com/docs/en/memory
- Cursor rules: https://cursor.com/docs/context/rules
- GitHub Copilot repository instructions: https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- AGENTS.md: https://agents.md
- Measurement study (secondary): https://aaif.io/blog/measuring-agents-md-what-five-runs-show-that-one-doesn-t

## Planned rules

| ID (provisional) | Idea | Phase | Notes |
|---|---|---|---|
| OBL040 | `.cursorrules` legacy file present | 1 | Verify current Cursor deprecation status first (was provisionally OBL018; that ID now belongs to expired-suppression) |
| OBL020+ | Drift family: documented command not found in package.json, Makefile, justfile or CI; undocumented build and test commands | 2 | OBL019 shipped a first, root-files-only version |
| OBL021 | Major top-level directory never mentioned | 2 | Optional, `info` |
| OBL022 | Skill `SKILL.md` frontmatter problems | 2 | Verify required fields and limits in current Claude Code skills docs first |
| OBL023 | Rule scopes overlap and conflict | 2 | Needs scope intersection logic |
| OBL024 | Real-tokenizer budget | 2 | Optional dependency |
| OBL025 | Instruction mentions a tool or framework not in dependencies | 2 | Heuristic, `info` |

## Rule quality checklist

1. Which vendor document or evidence supports it? Add the URL and date.
2. What would a false positive look like? Add a test for it.
3. Does the message tell the developer exactly what to change?
4. Is the severity honest? Heuristics are never `error`.
5. Run the rule on the corpus and record the hit rate and a hand-checked sample of 20.
