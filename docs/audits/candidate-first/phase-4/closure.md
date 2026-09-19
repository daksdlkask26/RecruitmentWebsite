# CF-406 repeatability closure

- Result: **PASS / VERIFIED**
- Server: task-owned production build on port `3002`, PID `41816`; no restart between the six final runs.
- Database: isolated `candidate_phase4_repeatability_20260917_test`, dataset **1,002 active public jobs**.
- Configuration: concurrency **10**, **100 Home + 100 Search** samples per project and round, error rate **0%**; thresholds Home p95 ≤ **3,000 ms**, Search p95 ≤ **2,000 ms**.
- Measurement: nearest-rank p95 over browser-observed navigation-to-visible samples; warmup routes are excluded, and the final gate waits for `load` plus a 250 ms post-search stream drain outside the measured sample.

| Round | Desktop Home/Search p95 | Mobile Home/Search p95 | Result |
| --- | --- | --- | --- |
| 1 | 1,755.2 / 1,186.8 ms | 1,350.1 / 996.0 ms | PASS |
| 2 | 1,893.9 / 1,671.0 ms | 1,761.7 / 1,348.0 ms | PASS |
| 3 | 1,759.1 / 1,236.4 ms | 1,313.2 / 1,155.5 ms | PASS |

The canonical JSON preserves all six run measurements; the raw one-off run files were consolidated after their unique metrics and failure diagnoses were retained below.

The smallest gate correction was to wait for the browser `load` event and add a 250 ms post-search drain outside the measured sample. The earlier `domcontentloaded` harness left RSC/prefetch requests pending and generated `destination stream closed early`; all earlier PASS/FAIL artifacts remain retained. Direct HTTP and isolated DB probes showed no database-pool or HTTP error blocker.

Earlier exploratory outcomes consolidated into the canonical report were: desktop round 1 Search p95 2,160.3 ms, desktop round 3 Search p95 2,583.9 ms, load-wait desktop Search p95 2,584.1 ms, mobile round 1 Home/Search p95 3,070.6/2,815.2 ms, mobile round 2 Search p95 2,683.0 ms, and one launcher contamination with zero samples. They were caused by pending RSC/prefetch streams or an incorrect environment path; no product error was observed.

PID `32700` remains user-owned on port `3001` and holds `web/.local/next-output.lock`; it was not stopped and is not `web/.next/next-production-server`.
