# CF-401 Home performance (current run)

- Generated: 2026-09-17T18:19:19.026Z
- Phase: post-change-final
- Commit: unknown
- Database: candidate_phase5_final_20260917_e2e_test (isolated test endpoint)
- Seed: 1000 jobs; namespace 1c445395-139a-4570-9101-85d83b2c59e1
- Samples: 20 sequential; concurrency 10

## Measurements

| Role | First p95 (ms) | Warm p95 (ms) | Warm query p95 | Warm payload p95 (bytes) | Cache hit rate | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| guest | 89.7 | 1.5 | 1 | 5422 | 0.0% | 0 |
| candidate | 113.8 | 129.1 | 44 | 6492 | 0.0% | 0 |
| employer | 93.1 | 95.7 | 44 | 6492 | 0.0% | 0 |

## Evidence boundary

This artifact is a current post-change-final service measurement. The direct service harness invokes the Home composition outside a Next request store, so its zero cache-hit rate is not production cache evidence; the real production runtime cache probe is docs/audits/candidate-first/phase-4/evidence/cf406-cache.json. Query plans are captured in docs/audits/candidate-first/phase-4/evidence/cf406-query-plans.json. Production-browser transfer and live job-ID recall comparisons are recorded separately.
