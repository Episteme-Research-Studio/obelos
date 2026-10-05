# Obelos architecture

## 1. Pipeline

```
FileSystem (diskFs | memoryFs | future: git tree, GitHub API)
   |
   v
config layers: defaults <- presets / extends files <- root config   (+ nested configs, applied to findings later)
   |
   v
discoverAll(fs, config)  -->  ContextFile[] + OBL000 notices   (limits, decoding, parse)
   |                                   |
   v                                   v
Workspace (exists, read, allFiles, scriptsFor, today)    Rules[] --run(files, ws)--> Diagnostic[]
                                                              |
   runner: severity overrides (by finding ID, so POL-x works), off, ignore globs, nested-config cascade,
           inline suppression (with expiry), baseline, changed-only scope, timing stats
                                                              |
                                          score  -->  LintResult  -->  reporter registry (text, json, sarif, markdown, github, junit, checkstyle)
```

Everything up to `LintResult` is pure and synchronous except reads through the `FileSystem`. Reporters are pure functions of `LintResult`. Only `core/git.ts` (changed files) and the CLI commands that write files touch anything else.

## 2. Modules

| Path | Responsibility |
|---|---|
| `src/core/types.ts` | Shared types: `ContextFile`, `Diagnostic` (with optional `column`, `endLine`, `endColumn`, `fix`), `Rule`, `Workspace`, `Config`, `Policy`, `Limits`, `LintResult`, `RunStats` |
| `src/core/errors.ts` | `ObelosError` with codes; the exit-code contract (`EXIT`) |
| `src/core/fs.ts` | `FileSystem` interface, `diskFs`, `memoryFs`, safe `decode` (BOM, UTF-16, binary) |
| `src/core/config.ts` | Defaults, presets, `extends` resolution, validation, policy normalisation |
| `src/core/parse.ts` | `classify(path)`, frontmatter split, reference extraction, suppression comments with expiry, pure `parseContent`, disk wrapper `parseFile` |
| `src/core/discover.ts` | `discoverAll(fs, config)` with limits and notices; `createWorkspace(fs, config)` |
| `src/core/runner.ts` | `lint(root, options)`: orchestration, cascade, suppression, baseline, changed-only scope, stats |
| `src/core/git.ts` | `changedPaths(root, since)` (no shell, validated refs) |
| `src/core/score.ts`, `baseline.ts`, `resolve.ts`, `budget.ts` | Scoring, baselines, "which files apply" model, token budget per tool |
| `src/core/stack.ts`, `init.ts` | Stack detection from manifests; `init` planning (pure, returns the files to write) |
| `src/core/badge.ts`, `history.ts`, `scan.ts` | Badge SVG and shields JSON; score history file; multi-repository scan |
| `src/rules/*.ts` | One export per rule, grouped by theme (`size`, `references`, `tooling`, `quality`, `hygiene`, `policy`); `index.ts` registers them |
| `src/report/*.ts` | Reporters and the registry (`index.ts`) |
| `src/cli.ts` | commander entry; maps errors to exit codes |
| `src/index.ts` | Public API |

## 3. Rule contract

```ts
interface Rule {
  id: string;                 // OBLnnn, never reused
  name: string;               // kebab-case, stable
  description: string;
  defaultSeverity: "error" | "warn" | "info";
  apiVersion?: 1;             // reserved for the plugin API
  run(files: ContextFile[], ws: Workspace): Diagnostic[];   // pure; no network; no writes
}
```

Rules never import `fs` (a test enforces it); all reads go through `ws.read`, `ws.exists`, `ws.allFiles`. They receive all files so they can reason across files (duplicates, contradictions, import links). They must not print, must not throw on malformed input, and must not include secret values in messages. Add a rule by: creating it, registering it in `src/rules/index.ts`, adding tests in `test/rules.test.ts`, adding a row to docs/RULES.md with its source.

## 4. Parsing decisions and known limits

- Imports follow Claude Code's documented behaviour: `@path` tokens that start a token, resolved relative to the containing file, skipped inside code spans and fences, maximum four hops. A bare `@word` with no `/` and no extension is treated as a mention, not an import, to avoid false positives (this misses imports like `@README`).
- Path references are only taken from inline code spans and Markdown links, only if they contain a `/` and either an extension or a trailing slash, and exclude URLs and globs. Generated-output directories are ignored by default.
- Script references (`npm|pnpm|yarn|bun run NAME`) are taken from fences and prose. Shorthand like `pnpm test` is not checked.
- Token counts are `bytes / 4`: a rough estimate. A real tokenizer is an optional later dependency; do not present estimates as exact.
- The contradiction rule is a heuristic over "always/must/should use X" versus "never/avoid X" with identical normalised phrases. It will miss paraphrases and can false-positive on scoped rules. Keep at `warn` or lower.

## 5. Planned components

### Drift (Phase 2)
Compare instructions with the repository: extract commands and paths from the files (already done); extract facts from the repo (package.json scripts, Makefile/justfile targets, top-level directories, frameworks from dependencies, CI workflow commands); report documented-but-missing (exists) and present-but-undocumented (new: missing build/test/lint command; major directories never mentioned). Output as `OBL1xx` rules to keep the catalogue together.

### Autofix (Phase 2)
Rules may expose `fix(file, diagnostic): Edit[]`. Only safe, idempotent edits: add `@AGENTS.md` import to CLAUDE.md; rename `.cursor/rules/x.md` to `.mdc`; add `CLAUDE.local.md` to `.gitignore`. Always dry-run by default (`--write` to apply).

### Eval harness (Phase 3)
`src/eval/`: task loader (YAML, validated), worktree manager (`git worktree` into a temp directory), agent adapters (`command` adapter first: runs a user-supplied command template; named adapters wrap `claude -p`, Codex and Copilot CLI after verifying their current non-interactive flags), check runners, statistics (median, min, max), report writer. Never executes outside the temporary worktree; cleans up on exit and on signal.

### Licence (Phase 3)
Optional team features may be offered as a separate package. The open-source core never needs a licence, makes no network calls and sends no telemetry; any licence check in an add-on package is verified offline.

## 6. Testing strategy

- **Unit tests** per rule in `test/rules.test.ts` using temporary repositories built by `test/helpers.ts`.
- **Parse tests** in `test/parse.test.ts`.
- **Snapshot tests** (planned) for reporters.
- **Corpus regression** (planned): a frozen set of anonymised instruction files from public repositories with expected findings; any change in finding counts must be reviewed.
- **Self-lint**: `npm run self-lint` must pass on this repository.
- **CI**: `ci.yml.example` (to be placed at `.github/workflows/ci.yml`) runs typecheck, tests, build and self-lint on Node 20 and 22.

## 7. Performance and safety

Synchronous reads are acceptable at this scale; a full run on a typical repository takes tens of milliseconds, which is why result caching was deferred (ADR-014). Symlinked directories are never traversed (`followSymbolicLinks: false`); symlinked instruction files are listed and their real paths resolved so a CLAUDE.md symlinked to AGENTS.md is recognised. Hard limits are in config `limits` (docs/SPEC.md section 8).

## 8. Extension points (post-1.0)

Custom rules via a plugin API (`obelos.config.js` exporting rules), custom reporters, and a language-server wrapper for editors. None are promised for v0.x.
