# Corpus study: "What is wrong with public agent context files?"

Purpose: (1) validate that real repositories have real, frequent problems (2) produce publishable findings, (3) build a frozen regression corpus for rule quality.

## Question
In public repositories that contain agent instruction files, how often do those files contain problems that cause agents to ignore, truncate or misread them, and which problems are most common?

## Method

1. **Sample.** Use the GitHub search API (via `gh`) to find repositories containing `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` or `.github/copilot-instructions.md`. Target 150 repositories, stratified by stars (low, medium, high), language and last-commit date (active in the last 12 months). Record the query and date. Exclude forks, archives, templates and repositories that are collections of prompts.
2. **Fetch.** Shallow, blob-less clone (`--depth 1 --filter=blob:none`) into `corpus/repos` (git-ignored), so path and script checks can run against the real tree. Delete the clones once the hand-check is done; store only aggregate results and the frozen, anonymised fixtures.
3. **Run.** `obelos lint --format json` on each. Save findings by rule.
4. **Hand-check.** For each rule that fires, hand-check 20 randomly chosen findings and record true or false positive. Report precision per rule.
5. **Analyse.** Proportion of repositories with at least one error, warning or note; findings per rule; median file size; share with both CLAUDE.md and AGENTS.md and no import (OBL006); share exceeding budgets; broken path and script references.
6. **Publish.** Aggregate numbers and anonymised or permission-cleared examples only. Do not name repositories in a critical context without contacting maintainers first; link to rule explanations, not to individuals.

## Ethics and licensing
Public repositories can be analysed, but individual maintainers should not be shamed. Quote only short excerpts needed to illustrate a rule. Do not publish secrets found; report the count and notify the repository owner privately, if appropriate. Respect GitHub API terms and rate limits.

## Deliverables
- `scripts/corpus.mjs` (sample, fetch, run, hand-check sheet, report). Written and tested on local repositories; the `sample` step against live GitHub search has not been run yet. Runbook: docs/TESTING.md section 3.
- A results table and a short report.
- A blog post "We linted N public agent context files. Here is what we found." with a methods section and honest limits.
- A frozen subset (about 40 files, anonymised) committed as test fixtures once hand-checked.

## Honest limits to state in any publication
Sample bias (repositories that use these files are not typical); search-API ranking effects; false positives in heuristics; vendor behaviour changes over time; findings describe file content, not agent outcomes (that needs the eval harness).

## Success criteria
At least 100 repositories analysed; at least 30% with at least one finding a developer would call real (hand-checked precision at least 80% for the rules counted); at least two rules with a headline-worthy hit rate (for example, both-files-without-import).
