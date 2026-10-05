# Obelos

CI for agent context: a TypeScript CLI that lints, scores and (later) tests agent instruction files (CLAUDE.md, AGENTS.md, Cursor rules, Copilot instructions). Owner: Episteme Research Studio.

## Read first

- Product behaviour: `docs/SPEC.md`; architecture: `docs/ARCHITECTURE.md`; rule sources: `docs/RULES.md`
- Policies: `docs/POLICY.md`; integrations: `docs/INTEGRATIONS.md`; testing: `docs/TESTING.md`
- Technical decisions: `docs/DECISIONS.md`; planned work: `docs/ROADMAP.md`

## Commands

- Install: `npm install`
- Typecheck: `npm run typecheck`
- Tests: `npm test`
- Build: `npm run build`
- Everything before a commit: `npm run check`
- Lint this repo's own instruction files: `npm run self-lint` (needs a build first)
- Run the CLI from source: `npm run dev -- lint .`

## Layout

- `src/core/` file-system seam, parsing, discovery, config, errors, runner, score, budget, init, history, scan
- `src/rules/` one export per rule, registered in `src/rules/index.ts`
- `src/report/` output formatters and the reporter registry (`index.ts`)
- `src/cli.ts` command-line entry
- `test/` vitest tests; `test/helpers.ts` builds temporary repositories

## Conventions

- TypeScript strict, ESM, Node 20 or newer. Relative imports end in `.js`.
- Rules are pure functions: no network, no writes, no printing, no `fs` imports (read through the `Workspace`), never throw on malformed input.
- Never include a matched secret value in a message.
- Every rule needs a documented source in `docs/RULES.md` and tests for one passing and one failing case.
- Heuristic rules are never `error` severity.
- Vendor behaviour is verified against current vendor documentation and dated; do not rely on memory.
- No telemetry, and no model calls in the default lint path.
- Config errors and other expected failures throw `ObelosError` with a code; exit codes are a contract (`docs/SPEC.md`).
- Keep the repository's own score at 100: fix the rule or configure it, and record why in `docs/DECISIONS.md`.

## Definition of done

`npm run check` and `npm run self-lint` pass, new behaviour has tests, and `CHANGELOG.md` is updated.
