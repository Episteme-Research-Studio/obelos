# Changelog

All notable changes. Format follows Keep a Changelog; versions follow semantic versioning (pre-1.0: minors may change rule IDs, with an entry here).

## [Unreleased] - 0.1.0-alpha.0

### Changed
- Rule accuracy pass after linting six real public repositories: OBL004 accepts sub-package-relative paths and skips generated, optional and URL-like references; OBL005 accepts scripts defined in any package.json and skips hedged lines; OBL003 ignores `@scope/package` names; OBL009 is now `info` and satisfied by `description` (VS Code documents `applyTo` as optional); OBL010 no longer splits `{a,b}` brace patterns; OBL011 ignores comments, headings, symlinks and unrelated directories, and reports exact copies once; OBL014 accepts import-only files; OBL026 treats list items, tables and comments as separate blocks.
- Score formula v2: average of per-file scores (`scoreVersion` 2).
- Documentation split: planning and strategy documents moved out of the repository; added ROADMAP.md and CONTRIBUTING.md; DECISIONS.md now lists technical decisions only.
- File discovery uses an own picomatch-based walker; `fast-glob` was removed because its `micromatch`/`braces` chain carried an unfixed high-severity advisory. `npm audit --omit=dev` is clean.

### Added
- Discovery and parsing of CLAUDE.md, CLAUDE.local.md, `.claude/rules`, AGENTS.md, Cursor rules, Copilot instructions and GEMINI.md.
- Rules OBL001 to OBL017, then OBL018 (expired suppression), OBL019 (no build or test command), OBL026 (wall of text), OBL027 (emphasis overuse); a policy engine (OBL900, findings as `POL-<ID>`).
- Better secret detection (more credential formats, URL credentials, entropy filter, allow list).
- Commands: `lint`, `baseline`, `resolve`, `budget`, `explain`, `inspect`, `rules`, `init`, `badge`, `history`, `scan`, `suppressions`, `config`.
- `lint` options: `--changed-only`, `--since`, `--no-cascade`, `--today`, `--verbose`, `--watch` (experimental), `--debug` (global).
- Config: `extends` with presets (`recommended`, `strict`, `minimal`) and shared files, per-rule options, `limits`, `policies`, monorepo cascade; unknown keys and rule IDs are reported.
- Suppression comments with `until=` and `reason=`.
- Reporters: text, json, sarif, markdown, github, junit, checkstyle, behind a registry (`registerReporter`).
- Baseline files with line-independent fingerprints.
- JSON Schemas for output and config; optional `scope`, `column`, `endLine`, `endColumn`, `fix` fields.
- `FileSystem` seam with `diskFs` and `memoryFs`, so the engine runs without a disk.
- Typed errors and a documented exit-code contract (0, 1, 2, 3).
- Hard limits and encoding guards (file size, count, depth, time, BOM, UTF-16, binary, symlink loops).
- Pre-commit hook definition; CI, release, Dependabot and PR-lint workflow examples; SECURITY.md and supply-chain documentation.

### Changed
- Renamed from ContextOps to Obelos (package `obelos`, CLI `obelos`, config `obelos.config.json`, comments `obelos-disable`, presets `obelos:*`). Rule IDs are now `OBLnnn` instead of `CTXnnn`. Nothing had been published, so there is no compatibility layer.
- Internal errors now exit with `3` (previously `2`); `2` is reserved for usage and configuration errors.
