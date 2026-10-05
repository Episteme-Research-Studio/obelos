# Testing Obelos by hand

Three layers, in the order you should run them. Everything works on macOS, Linux and Windows with Node 20 or newer.

| Layer | Command | Tells you | Time |
|---|---|---|---|
| 1. Unit and integration tests | `npm run check` | The code does what the developers intended | 1 min |
| 2. Feature smoke test | `npm run build && npm run smoke` | Every user-visible feature works from the built CLI, on your machine | 1 min |
| 3. Corpus run | `npm run corpus:*` (section 3) | Whether the rules are right on real repositories | 1 to 3 hours |

If layer 1 or 2 fails on your machine, open an issue with the failing lines; the code has so far mainly been run on Linux.

## 1. Setup

```bash
npm install
npm run check          # typecheck, 96 tests, build
npm run self-lint      # lints this repo's own AGENTS.md and CLAUDE.md; expect 100/100
```

## 2. Feature checklist (one line per feature)

`npm run smoke` runs all of these automatically on throw-away repositories it builds itself (so no secret-like text is ever committed). `npm run smoke -- --list` lists the scenarios; `--only secrets,baseline` runs some; `--keep` leaves the fixtures on disk so you can poke at them. To try a feature on your own project, use the manual command in the third column. Tick the box when the result matches.

| Done | Feature | Manual command (run inside a repository) | What you should see |
|---|---|---|---|
| [ ] | Lint and score | `obelos lint` | Findings per file and a score out of 100 |
| [ ] | Exit codes | `obelos lint; echo $?` (Windows: `echo %errorlevel%`) | 0 clean, 1 findings, 2 bad config or usage, 3 internal error |
| [ ] | Fail thresholds | `obelos lint --fail-on warn` and `--max-warnings 0` | Exit 1 when warnings exist |
| [ ] | Broken references | Add `@docs/nope.md`, `` `src/ghost.ts` `` and `npm run deploy` to AGENTS.md, then lint | OBL003 (error), OBL004, OBL005 |
| [ ] | Silent-ignore trap | Have CLAUDE.md and AGENTS.md side by side without `@AGENTS.md` | OBL006 |
| [ ] | Secrets | Add `password = Zq8wX2vL9mP4nR7tY1uK5` | OBL013, and the value is not printed anywhere |
| [ ] | Inline suppression | `<!-- obelos-disable-next-line OBL012 -->` above a vague line | Finding hidden; `suppressed` count in JSON |
| [ ] | Expiring suppression | Add `until=2026-01-01 reason="x"` | OBL018 reports it; `obelos suppressions` marks it EXPIRED |
| [ ] | Baseline | `obelos baseline` then `obelos lint --baseline obelos.baseline.json` | Old findings hidden; a new one appears |
| [ ] | Presets | `{"extends":"obelos:strict"}` in `obelos.config.json` | Advisory findings become warnings |
| [ ] | Monorepo cascade | Put a `obelos.config.json` with `{"rules":{"OBL012":"off"}}` in a subfolder | Only that subtree is affected; `--no-cascade` undoes it |
| [ ] | Policies | Add a policy from docs/POLICY.md | `POL-<ID>` findings |
| [ ] | Bad config | Put `{"nope":1}` in the config | Exit 2 with "Unknown config key" |
| [ ] | Limits | `{"limits":{"maxFileBytes":2000}}` and a bigger file | A "Skipped" notice, not a crash |
| [ ] | Changed-only | In a git repo edit one AGENTS.md, then `obelos lint --changed-only` | Only findings related to the edit; `--since main` for a branch |
| [ ] | resolve | `obelos resolve src/some/file.ts` | Which files apply, per tool, with certainty labels |
| [ ] | budget | `obelos budget src/some/file.ts` | Always-loaded tokens per tool; `--max-tokens 1` exits 1 |
| [ ] | init | `obelos init` then `obelos init --write` | A dry-run preview, then AGENTS.md and CLAUDE.md with your real commands; never overwrites |
| [ ] | Reporters | `-f json`, `sarif`, `junit`, `checkstyle`, `markdown`, `github` | Each renders; unknown format exits 2 |
| [ ] | Badge | `obelos badge -o badge.svg` and `--shields` | An SVG; shields.io JSON |
| [ ] | History | `obelos history --record` twice, then `obelos history` | A trend line and dated entries |
| [ ] | scan | `obelos scan ~/work` | One line per repository plus findings per rule |
| [ ] | explain, rules, config, inspect | `obelos explain OBL006`, `rules`, `config`, `inspect` | Help text, the rule list, effective config, file list |
| [ ] | Watch (experimental) | `obelos lint --watch`, edit AGENTS.md | The report refreshes on save |
| [ ] | Verbose and debug | `obelos lint --verbose`; `obelos --debug lint --baseline nope.json` | Timings on stderr; a stack trace on error |

Ideas that tests cannot judge: is the wording of each message clear? Would you know what to do next? Does anything feel slow, noisy or wrong? Write those down; they are the most valuable findings.

## 3. Corpus run

Goal: find out whether the rules are right on real files. Steps are restartable and each writes a file you can inspect.

**3a. Warm-up on your own repositories (15 minutes).** No GitHub needed:

```bash
npm run build
node scripts/corpus.mjs run --dir ~/work --out corpus/mine.json     # ~/work = a folder containing your repositories
open corpus/review.csv    # macOS; fill the verdict column
```

**3b. Build the public sample.** Needs the GitHub CLI logged in (`gh auth login`) or `GITHUB_TOKEN`:

```bash
npm run corpus:sample -- --limit 150 --min-stars 50     # writes corpus/sample.json (query, date, seed are recorded)
```

GitHub code search is rate limited (about 10 requests a minute), so this takes several minutes. If it fails or you prefer to curate by hand, put `owner/name` lines in a text file and use `npm run corpus:sample -- --from-list repos.txt`.

**3c. Download.** Shallow, blob-less clones; about a few hundred MB:

```bash
npm run corpus:fetch                  # into corpus/repos (git-ignored); restartable, skips what exists
```

**3d. Run and make the hand-check sheet:**

```bash
npm run corpus:run                    # corpus/results.json and corpus/review.csv
```

`review.csv` has up to 20 randomly chosen findings per rule. Open it in Numbers or Excel. For each row decide: `tp` (a real problem a developer would want to know), `fp` (the rule is wrong here) or `unsure`. Open the repository file at the given line if the message alone does not settle it. Take notes in the `notes` column; they become rule fixes. Re-running `run` never overwrites your verdicts (it writes a timestamped sheet instead unless you pass `--force`).

**3e. Report:**

```bash
npm run corpus:report                 # prints and writes corpus/report.md
```

The report shows coverage, crashes, score distribution, and for each rule: findings, repositories affected, hit rate, hand-checked precision and a verdict. The accuracy checklist at the bottom turns green when there are no crashes, at least 100 repositories with instruction files, enough verdicts, and every reviewed rule is at or above 80% precision. Rules below target should be demoted to `info` or fixed.

**3f. Act on the results:** fix or demote the rules below target, freeze about 40 anonymised files as regression fixtures, and share `corpus/report.md` (with the `notes` column) when opening an issue about a rule.

Ethics and limits: see docs/CORPUS-STUDY.md. Keep the clones local, never commit `corpus/repos`, do not name repositories critically in anything you publish, and never publish a secret that a rule found (report the count; tell the owner privately).

## 4. When something fails

| Symptom | Likely cause | What to do |
|---|---|---|
| `dist/cli.js not found` | Not built | `npm run build` |
| Tests fail only on Windows | Path separators or symlink permissions | Send the failing test names; symlink tests are skipped on Windows by design |
| `corpus:sample` returns 403 or nothing | Not logged in to `gh`, or rate limited | `gh auth login`, wait a minute, or use `--from-list` |
| `fetch` shows `failed(128)` | Repository renamed, private or deleted | Safe to ignore a few; they are listed in the output |
| Many `OBL004` false positives | Generated or optional paths | Note them in `review.csv`; fix is a rule or `ignorePathRefs` change |
