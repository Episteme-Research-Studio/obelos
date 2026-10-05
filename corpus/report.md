# Obelos corpus run

Tool version 0.1.0-alpha.0, run 2026-10-05, folder `/Users/denishakszer/Documents/Claude/Projects/Research Studio/obelos/corpus/repos`.

## Coverage

- Repositories: 150; with agent instruction files: 144 (96%).
- Crashes: 0. Gate target: 0.
- Median score: 99; grades: A=129 B=12 C=3.
- Median instruction size: 2655 estimated tokens; median run time per repository: 15 ms.

## Findings by rule

| Rule | Findings | Repos affected | Hit rate | Reviewed | Precision | Verdict |
|---|---|---|---|---|---|---|
| OBL001 | 284 | 31 | 22% | 0 | n/a | needs review |
| OBL002 | 21 | 13 | 9% | 0 | n/a | needs review |
| OBL003 | 13 | 2 | 1% | 0 | n/a | needs review |
| OBL004 | 356 | 55 | 38% | 0 | n/a | needs review |
| OBL005 | 4 | 2 | 1% | 0 | n/a | needs review |
| OBL006 | 18 | 18 | 13% | 0 | n/a | needs review |
| OBL007 | 1 | 1 | 1% | 0 | n/a | needs review |
| OBL008 | 3 | 3 | 2% | 0 | n/a | needs review |
| OBL010 | 204 | 13 | 9% | 0 | n/a | needs review |
| OBL011 | 618 | 30 | 21% | 0 | n/a | needs review |
| OBL012 | 13 | 7 | 5% | 0 | n/a | needs review |
| OBL014 | 25 | 9 | 6% | 0 | n/a | needs review |
| OBL015 | 5 | 5 | 3% | 0 | n/a | needs review |
| OBL016 | 1 | 1 | 1% | 0 | n/a | needs review |
| OBL019 | 19 | 19 | 13% | 0 | n/a | needs review |
| OBL026 | 237 | 25 | 17% | 0 | n/a | needs review |
| OBL027 | 8 | 7 | 5% | 0 | n/a | needs review |

Precision = true positives / (true positives + false positives) among hand-checked findings; "unsure" is excluded. Target 80% with at least 10 verdicts per rule (backlog CO-020). Hit rate = share of repositories with instruction files where the rule fired at least once.

## Accuracy checklist

- [x] No crashes
- [x] At least 100 repositories with instruction files (have 144)
- [ ] Hand-checked findings recorded (0)
- [ ] Every reviewed rule at or above 80% precision

Limits of this study: repositories were found through GitHub code search and favour popular, recently active projects; one reviewer judged the findings; instruction files change fast.
