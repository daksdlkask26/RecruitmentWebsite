# CF-401 Home performance (pre-change baseline)

- Generated: 2026-09-14T15:37:38.034Z
- Phase: pre-change
- Commit: 583171bf8cdb3cc76fea4a6ce818e89208a99dfb
- Database: candidate_phase3_test_20260911 (isolated test endpoint)
- Seed: 1000 jobs; namespace 80455955-ab1e-423b-b6bb-71061d51ad91
- Samples: 20 sequential; concurrency 10

## Measurements

| Role      | First p95 (ms) | Warm p95 (ms) | Warm query p95 | Warm payload p95 (bytes) | Cache hit rate | Errors |
| --------- | -------------: | ------------: | -------------: | -----------------------: | -------------: | -----: |
| guest     |           67.8 |          21.7 |             11 |                     4527 |           0.0% |      0 |
| candidate |          301.7 |         291.8 |             40 |                     5853 |           0.0% |      0 |
| employer  |          249.6 |         288.7 |             40 |                     5853 |           0.0% |      0 |

## Evidence boundary

This artifact is the fresh pre-change service baseline from a task-owned copy of the exact starting commit. The direct service harness runs outside a Next request store, so its zero cache-hit rate is not production cache evidence. Production-browser transfer and live job-ID recall comparisons are recorded separately.
