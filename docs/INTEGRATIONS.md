# Integrations and snippets

Everything here uses the CLI or its JSON, SARIF, JUnit and Checkstyle output. Snippets that call `npx obelos@latest` work once the package is published to npm; until then use a local build (`node path/to/dist/cli.js`). Snippets were written against current CI documentation but have not all been run on live systems; treat each as a starting point and tell us what breaks.

## GitHub Actions

Ready-made workflow: `examples/github/obelos-pr.yml.example` (PR annotations via `--format github`, only changes since the base branch via `--since`, SARIF upload to code scanning). Copy it to `.github/workflows/obelos.yml`. Check the current major version of `github/codeql-action/upload-sarif` when you set it up.

## GitLab CI

```yaml
obelos:
  image: node:22
  script:
    - npx obelos@latest lint . --format junit --output obelos-junit.xml --fail-on error
  artifacts:
    when: always
    reports:
      junit: obelos-junit.xml
```

## Pre-commit (pre-commit.com)

The repository ships `.pre-commit-hooks.yaml`. In a consuming repository's `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/Episteme-Research-Studio/obelos
    rev: v0.1.0
    hooks:
      - id: obelos
```

The hook runs `obelos lint . --changed-only --fail-on error`, so it checks only instruction files affected by your uncommitted changes.

## lefthook

```yaml
pre-commit:
  commands:
    obelos:
      glob: "{CLAUDE.md,AGENTS.md,GEMINI.md,.cursor/rules/**,.claude/**,.github/copilot-instructions.md,.github/instructions/**}"
      run: npx obelos lint . --changed-only --fail-on error
```

## husky

`.husky/pre-commit`:

```sh
npx obelos lint . --changed-only --fail-on error
```

## Azure DevOps, Bitbucket, Jenkins and others

Any system that reads JUnit XML: `obelos lint . --format junit --output obelos-junit.xml`. Systems that read Checkstyle XML: `--format checkstyle`. Exit code `1` fails the step on findings; `2` signals a configuration or usage error; `3` an internal error or limit (docs/SPEC.md).

## README badge

```sh
obelos badge . --output docs/context-badge.svg      # static SVG, commit it from CI
obelos badge . --shields --output badge.json         # shields.io endpoint JSON
```

For a live badge, publish `badge.json` (for example to GitHub Pages) and point `https://img.shields.io/endpoint?url=...` at it.

## Score history

`obelos history . --record --label "$GITHUB_SHA"` in CI appends to `.obelos/history.jsonl`; commit or cache the file. `obelos history .` prints the trend.

## Many repositories

`obelos scan ~/work` lints every repository directly under a directory and prints a table plus findings per rule; `-f json` is the input for corpus studies (docs/CORPUS-STUDY.md).

## Programmatic use

```ts
import { lint, memoryFs, computeBudget } from "obelos";

const result = lint("/virtual", { fs: memoryFs({ "AGENTS.md": "# Project\n\nRun `npm test`.\nUse tabs.\nShort lines.\n" }) });
console.log(result.score, result.diagnostics);
```

`memoryFs` makes the engine usable with no disk, which is how the planned client-side web checker will work. Custom reporters: `registerReporter("name", (result, { color }) => string)`.

## Editors and agents (planned)

An LSP server and VS Code extension, an MCP server and a Claude Code plugin. The JSON output already carries ranges (`line`, optional `column`, `endLine`, `endColumn`) and optional `fix` edits for them.
