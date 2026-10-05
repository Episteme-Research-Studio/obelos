# Obelos product specification (v0.1 alpha)

Describes behaviour that exists or is committed for v0.1; later items are marked **planned**.

## 1. Files discovered

Discovery is by path pattern from the repository root, ignoring `node_modules`, `.git`, `dist`, `.next`, `coverage`. Vendor behaviour was verified on 2026-10-04; see docs/RULES.md for sources.

| Tool | Kind | Path pattern |
|---|---|---|
| Claude Code | claude-md | `CLAUDE.md`, `.claude/CLAUDE.md` (any directory) |
| Claude Code | claude-local | `CLAUDE.local.md` |
| Claude Code | claude-rule | `.claude/rules/**/*.md` (frontmatter `paths`) |
| AGENTS.md ecosystem | agents-md | `AGENTS.md`, `.claude/AGENTS.md` (any directory; nearest wins) |
| Cursor | cursor-rule | `.cursor/rules/**/*.mdc` and `*.md` (the latter is ignored by Cursor) |
| Cursor | cursor-legacy | `.cursorrules` (root) |
| GitHub Copilot | copilot-repo | `.github/copilot-instructions.md` |
| GitHub Copilot | copilot-path | `.github/instructions/**/*.instructions.md` (frontmatter `applyTo`) |
| Gemini CLI | gemini-md | `GEMINI.md` |

Planned: `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, `.windsurf/rules`, `.aider.conf.yml` conventions, Codex `AGENTS.override.md` handling (note: Claude Code does not read `AGENTS.override.md` or `AGENTS.local.md`).

## 2. Commands

Full option lists: `obelos <command> --help`.

### `obelos lint [path]`
Runs all enabled rules. Options: `-f, --format text|json|sarif|markdown|github|junit|checkstyle`; `--fail-on error|warn|info|never` (default `error`); `--max-warnings N`; `--baseline <file>`; `-o, --output <file>`; `-c, --config <file>`; `--changed-only` and `--since <ref>` (only findings in instruction files affected by changes, including files whose referenced paths changed or were deleted; needs git); `--no-cascade`; `--today <YYYY-MM-DD>`; `--verbose` (timings, config sources and skipped files on stderr); `--watch` (experimental).

### Exit codes (stable contract)

| Code | Meaning |
|---|---|
| `0` | No findings at or above the fail threshold |
| `1` | Findings at or above the threshold, or more warnings than `--max-warnings`, or `budget --max-tokens` exceeded |
| `2` | Usage error or invalid input: bad flag value, invalid or missing config, invalid baseline, not a git repository for `--changed-only`, path not found |
| `3` | Internal error or a hard limit made the run impossible |

OBL000 notices (a rule crashed, a file was skipped, a limit was reached) never change the exit code. Changing a code's meaning is a breaking change. Programmatic callers get `ObelosError` with a `code` (`CONFIG_INVALID`, `CONFIG_NOT_FOUND`, `BASELINE_INVALID`, `NOT_A_GIT_REPO`, `GIT_FAILED`, `PATH_NOT_FOUND`, `LIMIT_EXCEEDED`, `USAGE`, `INTERNAL`) and `exitCode`.

### `obelos baseline [path]`
Writes `obelos.baseline.json` (or `-o`) with line-independent fingerprints of current findings; `lint --baseline` then reports only new ones.

### `obelos resolve <file>`
Prints which instruction files apply when an agent works on `<file>`, per tool, with a certainty label (always, matched, agent-decides, manual-only, nearest-wins) and notes such as "AGENTS.md exists but is NOT read". Best-effort model of documented behaviour. `--format json` for machines.

### `obelos budget <file>`
Builds on `resolve`: estimated tokens per tool that are always loaded (including files pulled in through `@imports`, up to four hops, for Claude Code) and tokens the agent may opt into (Cursor "agent decides"). Manual-only rules are excluded. `--chars-per-token` (default 4) models another tokenizer; `--max-tokens N` exits `1` when any tool's always-loaded context exceeds N, for use as a CI gate. Estimates, not billing figures.

### `obelos explain <rule>`
Long-form help for a rule: why, fix, good and bad examples, sources.

### `obelos inspect [path]`
Lists discovered files with tool, kind, lines and estimated tokens.

### `obelos rules`
Lists rule IDs, default severities and descriptions (`--json` includes the long-form docs).

### `obelos init [path]`
Detects the stack from `package.json` (scripts and lockfile), `pyproject.toml`, `Cargo.toml`, `go.mod` and Makefile targets, and creates `AGENTS.md` with the commands that actually exist plus a `CLAUDE.md` that imports it (Claude Code reads CLAUDE.md, not AGENTS.md, when both exist). Dry run by default; `--write` creates files and never overwrites an existing one. Commands that cannot be found are left out, not guessed.

### `obelos badge [path]`
SVG badge, or shields.io endpoint JSON with `--shields`.

### `obelos history [path]`
`--record` appends `{date, score, grade, scoreVersion, counts, tokens}` to `.obelos/history.jsonl`; without it, prints the trend. Local file, no network.

### `obelos scan <parent>`
Lints each direct subdirectory as a repository; prints a per-repository table and findings per rule, or JSON.

### `obelos suppressions [path]`
Lists every suppression comment with scope, rules, expiry, reason, and whether it has expired.

### `obelos config [path]`
Prints the effective configuration after presets and `extends`, including the layers that contributed.

### Suppression comments
`<!-- obelos-disable-next-line OBL012 -->`, `<!-- obelos-disable-file OBL011,OBL012 -->`, `<!-- obelos-disable OBL012 -->` (same line). No IDs means all rules. Optional attributes: `until=YYYY-MM-DD` (inclusive; afterwards the suppression no longer applies and OBL018 reports it) and `reason="..."`. Policy rules are suppressed by their `POL-<ID>`.

### Planned
`obelos fix` (safe, idempotent autofixes using the optional `fix` edits); `obelos sync` (AGENTS.md rules to Cursor `.mdc` and Copilot path files); `obelos drift`; `obelos eval` (section 7); `obelos lsp`.

## 3. Configuration

File: `obelos.config.json` or `.obelosrc.json` in the repository root, or `--config`. JSON Schema: `schema/config.v1.json`.

```json
{
  "extends": ["obelos:strict", "./.obelos/org-policy.json"],
  "rules": { "OBL012": "off", "OBL001": "error", "OBL027": ["warn", { "max": 5 }] },
  "ignore": ["vendor/**", "legacy/AGENTS.md"],
  "ignorePathRefs": ["generated/**"],
  "budgets": { "claudeLines": 200, "cursorLines": 500, "agentsLines": 500, "otherLines": 500, "aggregateBytes": 32768 },
  "limits": { "maxFileBytes": 1048576, "maxInstructionFiles": 500, "maxDepth": 20, "timeoutMs": 30000 },
  "policies": [{ "id": "no-todo", "forbid": "\\bTODO\\b", "severity": "warn" }]
}
```

- `extends`: presets `obelos:recommended` (the defaults), `obelos:strict` (raises documented, non-heuristic findings to `error` or `warn`; heuristics never become `error`) and `obelos:minimal` (switches the advisory and heuristic rules off), or relative paths to shared config files. Layers apply in order; later layers win; `ignore`, `ignorePathRefs` and policies accumulate (a policy with the same `id` replaces the earlier one). Circular and deeper than five levels is an error.
- `rules`: map of rule ID (including `POL-<ID>`) to `error`, `warn`, `info`, `off`, or `[severity, options]`. Options in use: `OBL013.allow` (array of regex strings; a line matching one is skipped), `OBL013.minEntropy`, `OBL026.maxLineChars`, `OBL026.maxParagraphChars`, `OBL027.max`. Unknown rule IDs produce a OBL000 notice.
- `ignore`: globs of instruction files (not discovered; findings dropped).
- `ignorePathRefs`: extra globs for path references that should not be checked (built outputs are ignored by default: `dist`, `build`, `out`, `.next`, `coverage`, `node_modules`, `target`, `tmp`).
- `budgets`: line and byte budgets.
- `limits`: hard limits (section 8).
- `policies`: see docs/POLICY.md.

Unknown top-level keys, invalid severities, invalid regular expressions and bad numbers are configuration errors (exit code 2).

**Monorepo cascade.** A `obelos.config.json` (or `.obelosrc.json`) in a subdirectory applies to findings in that subtree: it can change severities (`rules`), turn rules off, and `ignore` files relative to its own directory. Budgets, limits, policies and rule options remain root-level. Nested configs may use `extends`. `--no-cascade` disables this.

## 4. JSON output (version 1)

```json
{
  "version": 1,
  "toolVersion": "0.1.0-alpha.0",
  "scoreVersion": 1,
  "root": "/abs/path",
  "baselined": 0,
  "suppressed": 0,
  "scope": { "mode": "changed", "since": "origin/main", "changedFiles": 3 },
  "score": 87,
  "grade": "B",
  "files": [{ "path": "AGENTS.md", "tool": "agents", "kind": "agents-md", "lines": 42, "bytes": 1810, "tokensEstimate": 453 }],
  "diagnostics": [{ "ruleId": "OBL004", "severity": "warn", "message": "...", "file": "AGENTS.md", "line": 12, "hint": "..." }]
}
```

`scope` appears only for `--changed-only` and `--since`. Diagnostics may also carry optional `column`, `endLine`, `endColumn` and `fix` (a list of `{line, column, endLine, endColumn, newText}` edits, 1-based, end exclusive); no rule fills them yet. Rule IDs are `OBLnnn` or `POL-<ID>`. The schema is stable within `version: 1`; additions are allowed, removals are not. Schemas: `schema/output.v1.json` and `schema/config.v1.json`.

## 5. Score (v0 heuristic)

Start at 100. For each rule and severity, subtract weight times min(count, 5): error 12, warn 4, info 1. Floor at 0. Grades: A 90 or more, B 80 to 89, C 65 to 79, D 50 to 64, F below 50. The score is for trend and communication, not a quality guarantee. It will change before 1.0; every change is recorded in the changelog and version-stamped in JSON output (`scoreVersion` in JSON output).

## 6. Severity semantics

- **error**: the agent will almost certainly misbehave or something unsafe is committed (broken import, secret, missing `applyTo`, invalid frontmatter).
- **warn**: likely harmful or wasteful (oversize file, missing path or script, ignored AGENTS.md, duplicate or contradictory instruction).
- **info**: advisory or heuristic (vague wording, manual-only Cursor rule, placeholder text).

## 7. Eval harness (planned, Phase 3)

Purpose: measure whether instruction files change agent behaviour, with repeated runs because single runs mislead.

Task file (`evals/*.yaml`):

```yaml
name: add-health-endpoint
agent: claude-code            # adapters: claude-code, codex, copilot-cli, command
prompt: "Add a GET /health endpoint that returns 200 and {ok:true}."
runs: 5
variants:
  - name: with-context
  - name: without-context
    remove: [AGENTS.md, CLAUDE.md, .cursor/rules]
checks:
  - { type: command, run: "npm test", expect: pass }
  - { type: file-exists, path: src/health.ts }
  - { type: diff-max-lines, value: 80 }
timeout_minutes: 10
```

Each run happens in a fresh temporary git worktree. Metrics per run: checks passed, wall time, diff size, token or cost figures where the agent exposes them. Report: per-variant median, min and max, and the difference, with an explicit note when variance is high. No numbers are claimed without at least three runs.

## 8. Hard limits and encoding

Configurable under `limits`: instruction files over `maxFileBytes` (1 MiB) are skipped; discovery stops after `maxInstructionFiles` (500); search depth is `maxDepth` (20); after `timeoutMs` (30 s) the remaining rules are skipped. Each skip is reported as a OBL000 notice, never silently. Symlinked directories are not traversed. Files are decoded as UTF-8 (BOM stripped) or UTF-16 (with BOM); files with NUL bytes are skipped as binary.

## 9. Privacy and security

Runs locally; reads only the repository; sends nothing anywhere; no telemetry. Secret findings never print the matched value. The eval harness executes agents the user configures, in temporary worktrees, and documents that agent commands can modify files and run code.

## 10. Performance targets

Typical repository (under 10,000 files, under 20 instruction files): under 1 second for `lint`. Discovery uses glob patterns; the file list for glob checks is built lazily and cached once per run.
