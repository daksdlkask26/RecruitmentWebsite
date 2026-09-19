# CF-406 live discovery recall

- Status: **PASS**
- Generated: 2026-09-18T08:21:42.538Z
- Fixture jobs: 11
- Exact/normalized recall: 100%
- Broad recall: 100%
- Zero-result correctness: PASS

| Case | Kind | Expected | Actual | Recall |
| --- | --- | --- | --- | ---: |
| exact-vietnamese-title | exact | 1 | 5 | 100% |
| normalized-no-diacritics | normalized | 1 | 5 | 100% |
| broad-engineer | broad | 1 | 1 | 100% |
| location | location | 5 | 5 | 100% |
| zero-result | zero | 0 | 0 | 100% |

- Limitation: Expected IDs are declared by the task-owned fixture; no result count is used as recall.
- Limitation: This is a deterministic isolated-catalog recall gate, not a production traffic sample.
