# Decision log (technical)

Selected technical decisions that shape the code and its public contracts. Format: decision, reasons, revisit trigger. Numbering is kept stable; gaps are decisions that are not about the code.

## ADR-001: TypeScript on Node 20+
One codebase can serve the CLI, a GitHub Action and an editor extension, and developers install it with `npx`. Revisit if startup time becomes a problem (consider a single binary).

## ADR-002: Verify-first, not compile-first
Claude Code reads AGENTS.md natively and ships its own instruction audit, so converting one source into many formats is a shrinking need. Obelos leads with deterministic lint, drift detection, a score and (later) evaluation; a thin `sync` command may come later.

## ADR-003: Open core, MIT
The CLI, rules and policy engine are MIT-licensed. Optional team features, if they ship, live in a separate package; the core never requires a licence.

## ADR-004: Deterministic by default, LLM optional
Default lint makes no model calls and gives identical results on every run, which is what makes it usable in CI. Any LLM-assisted check would sit behind an explicit flag.

## ADR-005: No telemetry
The tool is local and offline. Revisit only with an explicit opt-in.

## ADR-007: Token counts are estimates
`bytes / 4` is used and labelled as an estimate everywhere (`--chars-per-token` overrides it). A real tokenizer is optional later work.

## ADR-008: The score is a v0 heuristic
Weights and grade bands are judgement calls, documented in docs/SPEC.md. Treat the score as a trend indicator, not a quality measure.

## ADR-009: Single package now, workspaces later
Keep one package until an editor extension or the Action needs separate dependency sets, then move to workspaces.

## ADR-010: Dogfooding
This repository's AGENTS.md is the canonical instruction file; CLAUDE.md imports it. `npm run self-lint` must stay clean in CI. If a rule is wrong for this repo, fix the rule or configure it, and record why here.

## ADR-012: Integration seams before integrations
A virtual filesystem behind `Workspace`, diagnostics with columns and optional fixes, `apiVersion` on rules, a format registry, a config resolution module, typed errors and a provenance event schema are in place so integrations (Action, editor, MCP) can be added without rewrites. Only the integrations that serve common CI channels are built first.

## ADR-013: Policy as code, engine in the core
The config schema is the public contract that is hardest to change later, so the policy engine ships now: `require`, `forbid`, `requireHeading`, `files`, `tools`, `severity`, `message`, rule IDs `POL-<ID>`, and `extends` for shared files. Writing and running your own policies is free. Regular expressions have no timeout (length-capped, per line, config is trusted input); policies default to `warn` and can be baselined.

## ADR-014: Scope choices
- Exit codes are a contract: 0 clean, 1 findings, 2 usage or configuration error, 3 internal error or limit.
- Result caching is deferred: a full run takes tens of milliseconds on a typical repository.
- The nested-config cascade covers severities, `off` and `ignore` only. Budgets, limits, policies and rule options stay root-level.
- Rule numbering: OBL018 expired suppression, OBL019 no build or test command, OBL026 wall of text, OBL027 emphasis overuse; OBL020 to OBL025 are reserved for drift, skills and scope rules; OBL900 is the policy engine.
- `--watch` is experimental (`fs.watch` recursive mode; tested on Linux only).
- Strict preset: only rules based on documented behaviour are raised to `error`; heuristic rules top out at `warn`.

## ADR-015: Name
The product is **Obelos**: repository `Episteme-Research-Studio/obelos`, npm package `obelos`, CLI `obelos`; descriptor "CI for agent context". The obelos is the mark ancient editors of Homer put against lines they suspected were not genuine. Names of config files, comments and presets follow the product name (`obelos.config.json`, `<!-- obelos-disable -->`, `obelos:recommended`). A bare web search for "obelos" returns unrelated results, so copy and metadata pair the name with "agent context".
