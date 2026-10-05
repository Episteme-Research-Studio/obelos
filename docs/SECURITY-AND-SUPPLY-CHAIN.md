# Security and supply chain

Buyers of a developer tool that reads their repositories will ask these questions. The answers below are what is true today; items marked **planned** are not done yet.

## 1. Threat model

Obelos is run on repositories the user may not fully trust (a cloned third-party repository, a pull request from a fork).

| Concern | Control |
|---|---|
| Executing repository code | None is executed. Files are read and parsed as text, JSON and YAML. `package.json` is parsed, never run. |
| Hostile or huge files | Hard limits (config `limits`): 1 MiB per instruction file, 500 instruction files, depth 20, 30 second soft time limit. Binary files (NUL bytes) are skipped with a notice. |
| Symlink tricks | Symlinked directories are never traversed (no loops, no escaping the root through a directory link). Dangling links are ignored. |
| Path traversal in references | Rules only test whether a path exists via the file-system interface rooted at the target directory; contents of referenced files are read only for `@import` depth and `budget`, and only inside the root. Imports starting with `~` or `/` are not followed. |
| Secrets | Detected values are never printed, logged, put in SARIF or JSON, or written to the baseline (fingerprints use rule, file and message only). |
| Regular expressions in policies | Written by the repository owner in the config file, length-capped at 500 characters, applied per line to lines up to 5,000 characters. There is no timeout, so avoid nested quantifiers; do not run policies from an untrusted `extends` source. |
| git | Used only for `--changed-only` and `--since`, called without a shell with fixed arguments; refs beginning with `-` or containing unusual characters are rejected. |
| Config `extends` | Resolves JSON files by relative path and detects cycles; no code is loaded from config. A config can point at a file outside the repository, so treat a config from an untrusted repository as untrusted input. |
| Telemetry | None. No network access in any command. |

## 2. Supply chain

Controls in place:

- Three runtime dependencies (`commander`, `picomatch`, `yaml`), all widely used; a committed `package-lock.json`; installs in CI use `npm ci`.
- No install scripts of our own.
- CI runs `npm audit --omit=dev --audit-level=high` and `npm audit signatures` (`examples/github/ci.yml.example`).
- Release workflow (`examples/github/release.yml.example`): publishes from CI with `npm publish --provenance`, so the package links to the exact source commit and build; attaches a CycloneDX SBOM generated with `npm sbom`.
- Dependabot for npm and for GitHub Actions (`examples/github/dependabot.yml.example`).
- Minimal workflow permissions (`contents: read` by default).

Planned or to do by hand:

- Pin third-party GitHub Actions to full commit SHAs (Dependabot can then update them). The example workflows use version tags for readability; pinning is a one-time task on first setup because commit SHAs must be looked up live.
- Enable two-factor authentication on the npm account and the GitHub organisation; require review for the release environment.
- Verify the `npm sbom` command and flags on the Node and npm version used by the release runner (it needs a recent npm).
- Reproducible-build check and a signed release tag.

## 3. Disclosure

See SECURITY.md in the repository root.
