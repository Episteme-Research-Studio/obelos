# Obelos

**CI for agent context.** Obelos checks the files your AI coding agents run on (`CLAUDE.md`, `AGENTS.md`, Cursor rules, Copilot instructions, `GEMINI.md`) so they are not silently ignored, stale, oversized or leaking secrets.

Local and offline. Deterministic: the same files give the same result every time. No model calls, no telemetry. MIT licence.

> Status: **alpha** (0.1.0-alpha.0). Rules cite vendor documentation; vendor behaviour changes, so every rule carries a verification date in [docs/RULES.md](docs/RULES.md).

## Quick start

```bash
npx obelos lint .
```

Example output:

```
CLAUDE.md (31 lines, ~290 tokens)
  warn  OBL006  AGENTS.md exists next to this file but is not imported; Claude Code reads only CLAUDE.md when both are present.
        Add `@AGENTS.md` to CLAUDE.md (then keep shared rules in AGENTS.md), or symlink one to the other.

AGENTS.md (212 lines, ~2400 tokens)
  warn  OBL004:14  `src/legacy/api.ts` is referenced but does not exist in the repository.
  warn  OBL005:22  Script "test:unit" is not defined in any package.json in scope.

2 files, 0 errors, 3 warnings, 0 notes. Context health: 88/100 (B)
```

## Commands

| Command | What it does |
|---|---|
| `obelos lint [path]` | Check instruction files. `-f text\|json\|sarif\|markdown\|github\|junit\|checkstyle`, `--fail-on`, `--max-warnings`, `--baseline`, `--changed-only`, `--since <ref>`, `--verbose`, `-o`, `-c` |
| `obelos init [path]` | Create AGENTS.md with the commands detected in your repository, plus a CLAUDE.md that imports it (dry run by default) |
| `obelos resolve <file>` | Show which instruction files apply to a given file, per tool |
| `obelos budget <file>` | Estimated instruction tokens an agent carries for a file, per tool |
| `obelos explain <rule>` | Why a rule exists, how to fix it, examples and sources |
| `obelos baseline [path]` | Record current findings so only new ones are reported |
| `obelos badge [path]` | Score badge (SVG or shields.io JSON) for your README |
| `obelos history [path]` | Record the score over time and show the trend |
| `obelos scan <parent>` | Lint many repositories at once |
| `obelos suppressions`, `config`, `inspect`, `rules` | List suppression comments, print effective config, list files, list rules |

Exit codes: `0` clean at the chosen threshold, `1` findings at or above it, `2` usage or configuration error, `3` internal error or limit.

## What it checks

Twenty-two rules plus your own policies. File and combined size budgets, broken `@imports`, references to paths and package scripts that do not exist, the Claude Code case where `AGENTS.md` is ignored because `CLAUDE.md` does not import it, Cursor `.md` files that Cursor ignores, missing frontmatter and `applyTo`, scoped globs that match nothing, duplicate and contradictory instructions, vague wording, secrets (many credential formats, entropy-filtered), placeholders, a personal `CLAUDE.local.md` that is not gitignored, expired suppressions, missing build and test commands, walls of text and shouting. Full table with sources and false-positive notes: [docs/RULES.md](docs/RULES.md).

## Configuration

`obelos.config.json` in the repository root (JSON Schema in `schema/`):

```json
{
  "extends": ["obelos:strict"],
  "rules": { "OBL012": "off", "OBL027": ["warn", { "max": 5 }] },
  "ignore": ["vendor/**"],
  "policies": [
    { "id": "security-section", "requireHeading": "Security", "severity": "error" },
    { "id": "no-todo", "forbid": "\\bTODO\\b", "severity": "warn" }
  ]
}
```

Presets `obelos:recommended`, `obelos:strict`, `obelos:minimal`, or a shared file path. A `obelos.config.json` in a subdirectory overrides its subtree in a monorepo. Policies (your own `require` / `forbid` / `requireHeading` rules) are explained in [docs/POLICY.md](docs/POLICY.md).

## Silencing and adopting

Inline: `<!-- obelos-disable-next-line OBL012 until=2026-12-31 reason="rewrite after v2" -->` or `<!-- obelos-disable-file OBL011 -->`; after the `until` date the suppression stops applying and is reported. Existing repository with many findings? `obelos baseline` then `obelos lint --baseline obelos.baseline.json` reports only new ones.

## Use in CI

```yaml
- run: npx obelos@latest lint . --since origin/main --fail-on warn --format github
```

`--format sarif` uploads to GitHub code scanning; `--format junit` and `checkstyle` feed other CI systems. Ready-made workflows, pre-commit, lefthook, husky and GitLab snippets: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

A packaged GitHub Action with pull-request comments and SARIF output is planned (see [docs/ROADMAP.md](docs/ROADMAP.md)).

## Honest limits

- Token counts are estimates (characters divided by four unless you set `--chars-per-token`).
- Rules have been tested on synthetic repositories; a study on real repositories is the next step.
- The contradiction check is a heuristic and can miss paraphrases or flag scoped rules.
- Rules check what the files say, not whether agents behave better; behavioural evaluation is planned.
- Anything described as vendor behaviour was verified on 4 October 2026 and may have changed.

## Development

```bash
npm install
npm run check        # typecheck, tests, build
npm run self-lint    # lint this repo's own instruction files
```

Specification, architecture, rules and roadmap live in [docs/](docs/). See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Why the name

The *obelos* (÷) is the mark that Alexandrian editors such as Zenodotus and Aristarchus set beside lines of Homer they suspected were not genuine. Obelos does the same for the instructions you give your agents: it marks the lines that are broken, stale, contradictory or not doing what you think.

## Licence

MIT. Copyright (c) 2026 Episteme Research Studio.
