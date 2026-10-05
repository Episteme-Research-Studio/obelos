# Roadmap

What exists today is described in [SPEC.md](SPEC.md), [RULES.md](RULES.md) and [POLICY.md](POLICY.md). This file lists what is planned. Plans change; nothing here is a promise.

## Next

- **Accuracy study** on a sample of public repositories ([CORPUS-STUDY.md](CORPUS-STUDY.md)): measure precision per rule, demote or fix rules that are noisy, freeze a regression corpus.
- **First npm release** with provenance and an SBOM.
- **Packaged GitHub Action** with pull-request comments and SARIF upload.
- **Drift rules**: instructions that mention commands, scripts or paths that no longer exist (partly shipped as OBL004, OBL005 and OBL019).

## Later

- Rules for skills, scoped rules and `.cursorrules` migration (OBL020 to OBL025, OBL040).
- Editor support through a language server.
- MCP server and Claude Code plugin.
- Evaluation: repeated-run experiments that measure whether a rule or instruction file changes agent behaviour.
- Rule packs distributed through npm or git.

## Not planned

Telemetry, mandatory network access, or LLM calls in the default lint path.

Suggestions and rule proposals are welcome as issues; see [../CONTRIBUTING.md](../CONTRIBUTING.md).
