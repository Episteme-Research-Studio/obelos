# Contributing

Thanks for helping. Obelos is small and opinionated, so please open an issue before a large change.

## Setup

```bash
npm install
npm run check      # typecheck, tests, build
npm run smoke      # end-to-end scenarios against the built CLI
npm run self-lint  # lint this repo's own instruction files
```

Node 20 or newer. Conventions are in [AGENTS.md](AGENTS.md).

## Adding or changing a rule

1. Cite the source (vendor documentation with a date, or mark the rule `heuristic`) in [docs/RULES.md](docs/RULES.md).
2. Rules are pure functions: no network, no writes, no `fs` imports; read through the `Workspace`.
3. Heuristic rules are never `error` severity.
4. Add one passing and one failing test, and never print a matched secret value.
5. Check precision on real files with `npm run corpus:*` ([docs/TESTING.md](docs/TESTING.md)).

## Pull requests

- Keep them focused; update [CHANGELOG.md](CHANGELOG.md).
- Sign off commits (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/). No CLA is required.
- By contributing you agree that your work is licensed under the MIT licence.

## Security

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
