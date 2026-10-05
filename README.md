<div align="center">

<img src="docs/assets/obelos-mark.svg" alt="Obelos" width="96" height="96">

# Obelos

### CI for agent context

*Verify the instructions your coding agents run on, before they run on them.*

[![CI](https://github.com/Episteme-Research-Studio/obelos/actions/workflows/ci.yml/badge.svg)](https://github.com/Episteme-Research-Studio/obelos/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/obelos/alpha?label=npm%20%40alpha&color=B08D3C)](https://www.npmjs.com/package/obelos)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-1F2A44)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-1F2A44)](package.json)

[Quick start](#quick-start) · [What it checks](#what-it-checks) · [Use in CI](#use-in-ci) · [Why the name](#why-the-name) · [Documentation](docs/)

</div>

---

Obelos reads the files your AI coding agents are briefed by (`CLAUDE.md`, `AGENTS.md`, Cursor rules, Copilot instructions, `GEMINI.md`), checks every claim they make against the repository itself, and gives the set a score. It finds the instructions that are silently ignored, point at paths and scripts that no longer exist, contradict each other, outgrow what a tool will read, or leak a secret.

Teams have started to call this discipline *ContextOps*: treating the context an agent receives as a maintained artefact, with the same care as the code. Obelos is the continuous-integration step of that practice.

- **Offline and deterministic.** The same files always give the same result. No model calls, no telemetry, no network.
- **It marks; it never rewrites.** Findings carry the reason and the fix. Your files stay yours.
- **Sourced.** Each rule cites vendor documentation and carries a verification date, because vendor behaviour changes.
- **Open core.** The linter is MIT-licensed and will stay so.

> **Status: alpha** (`0.1.0-alpha.0`). Checked against 150 public repositories with no crashes; see [Honest limits](#honest-limits) for what that does and does not establish.

## Quick start

```bash
npx obelos@alpha lint .
```

```text
CLAUDE.md (31 lines, ~290 tokens)
  warn  OBL006  AGENTS.md exists next to this file but is not imported; Claude Code reads only CLAUDE.md when both are present.
        Add `@AGENTS.md` to CLAUDE.md (then keep shared rules in AGENTS.md), or symlink one to the other.

AGENTS.md (212 lines, ~2400 tokens)
  warn  OBL004:14  `src/legacy/api.ts` is referenced but does not exist in the repository.
  warn  OBL005:22  Script "test:unit" is not defined in any package.json in scope.

2 files, 0 errors, 3 warnings, 0 notes. Context health: 88/100 (B)
```

Start a new repository from what is already there with `npx obelos@alpha init` (a dry run unless you pass `--write`), and ask any finding to justify itself with `obelos explain OBL004`.

## How it works

1. **Discover.** Find every instruction file in the tree and work out which tool reads it, and when.
2. **Parse.** Read frontmatter, `@imports`, path mentions, script mentions and commands.
3. **Compare with the repository.** Ask the real file tree and the real `package.json` files whether what the instructions say is true.
4. **Apply the rules.** Twenty-one small, pure rules plus an optional policy engine. Heuristic rules are never allowed to be errors.
5. **Score and report.** Findings are weighted (error 12, warning 4, note 1), averaged per file, and rendered as text, JSON, SARIF, JUnit and other formats. Exit codes let CI pass or fail the build.

## What it checks

| Concern | Examples |
|---|---|
| **Will the agent even read it?** | Cursor `.md` files that Cursor ignores; frontmatter that does not parse; scoped rules with a `paths`, `globs` or `applyTo` that matches nothing; a `CLAUDE.md` that never imports the neighbouring `AGENTS.md` |
| **Is it true?** | `@imports`, file paths and package scripts that do not exist in the repository |
| **Is it the right size?** | Per-file and combined budgets (including the 32 KiB limit on a Codex `AGENTS.md` chain); walls of text |
| **Is it coherent?** | Duplicated and contradictory instructions, conflicting package managers, vague wording, shouting |
| **Is it safe?** | Secrets in many credential formats (entropy-filtered), a personal `CLAUDE.local.md` that is not gitignored |
| **Is it complete and maintained?** | Placeholders and near-empty files, a missing build or test command, expired suppressions |
| **Does it meet your own rules?** | Organisation policies: `require`, `forbid`, `requireHeading` |

The full table, with sources and false-positive notes, is in [docs/RULES.md](docs/RULES.md).

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

Presets are `obelos:recommended`, `obelos:strict` and `obelos:minimal`, or a shared file path. A `obelos.config.json` in a subdirectory overrides its subtree in a monorepo. Policies are explained in [docs/POLICY.md](docs/POLICY.md).

### Silencing and adopting

Doubt can be recorded without being resolved. Inline:

```markdown
<!-- obelos-disable-next-line OBL012 until=2026-12-31 reason="rewrite after v2" -->
```

After the `until` date the suppression lapses and is reported, so a deferred decision cannot quietly become permanent. For a repository that already has many findings, `obelos baseline` records them, and `obelos lint --baseline obelos.baseline.json` reports only what is new.

## Use in CI

```yaml
- run: npx obelos@alpha lint . --since origin/main --fail-on warn --format github
```

`--format sarif` uploads to GitHub code scanning; `--format junit` and `checkstyle` feed other CI systems. Ready-made workflows, pre-commit, lefthook, husky and GitLab snippets are in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). A packaged GitHub Action with pull-request comments is planned ([docs/ROADMAP.md](docs/ROADMAP.md)).

## Honest limits

- **Evidence so far.** Obelos has been run over 150 public repositories (144 with instruction files) without a crash, and its factual claims (line counts, missing paths, globs that match nothing) were re-checked independently against those repositories. A human-reviewed precision figure for every rule is still outstanding, which is why the judgement-based rules are notes, not errors.
- **Sampling bias.** The corpus favours popular, recently active projects.
- **Estimates.** Token counts are characters divided by four unless you set `--chars-per-token`.
- **Heuristics.** The contradiction check can miss paraphrases or flag scoped rules.
- **Scope.** Rules check what the files say, not whether agents behave better; behavioural evaluation is on the roadmap.
- **Vendor facts** were verified on 4 October 2026 and may have changed since. Every rule records its date.

## Why the name

The *obelos* (ὀβελός, "spit") was the mark that Alexandrian editors, from Zenodotus to Aristarchus, set in the margin beside a line of Homer they suspected was not genuine. It did not delete the line. It flagged it, left the text intact, and let the reader judge.

Obelos treats your agent instructions the same way: it checks them against the repository, marks what is broken, stale or contradictory, and never rewrites your files. The package uses the Greek spelling; English books write *obelus*. Built by [Denis Hakszer](https://orcid.org/0000-0002-3354-7315) at [Episteme Research Studio](https://github.com/Episteme-Research-Studio).

## Development

```bash
npm install
npm run check        # typecheck, tests, build
npm run self-lint    # lint this repo's own instruction files
```

Specification, architecture, rules and roadmap live in [docs/](docs/). Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Cite

If Obelos is useful in your work, please cite it. GitHub's "Cite this repository" button reads [CITATION.cff](CITATION.cff); a DOI for each release is archived on Zenodo.

```bibtex
@software{hakszer_obelos_2026,
  author  = {Hakszer, Denis},
  title   = {Obelos: CI for agent context},
  year    = {2026},
  version = {0.1.0-alpha.0},
  url     = {https://github.com/Episteme-Research-Studio/obelos},
  license = {MIT}
}
```

## Licence

MIT. Copyright (c) 2026 Episteme Research Studio.
