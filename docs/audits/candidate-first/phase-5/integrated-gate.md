# Candidate-first Phase 5 integrated gate

Generated: 2026-09-19  
Source identity: `583171bf` plus the preserved dirty working tree  
Overall verdict: **DONE / VERIFIED**

The prior ledger was not used as current proof. Each slice is classified independently from current executable evidence. The two documented exceptions below remain visible: the historical Phase 4 discovery before/after baseline is `UNVERIFIED` but accepted by the Phase 4 gate policy, and the untouched full scoring suite has one outside-path baseline failure that is not called a passing suite.

## Work-item status

| Slice | Current status | Current executable boundary |
| --- | --- | --- |
| Phase 5 entry gate | `PASS / VERIFIED` | Phase 4 dependency is `DONE / VERIFIED`; CF-501, CF-502, and CF-503 each pass their own required current evidence. |
| CF-501 | `VERIFIED` | Isolated PostgreSQL `1 file / 8 passed`; contract/evidence revalidation `3 files / 10 passed`; private regression `14 / 44`; Home `39 / 104`; CF-105 `11 / 46`; CF-106 `3 / 25`; migration sequence `97/97`; content-free logs; isolated DB dropped and verified absent. |
| CF-502 | `VERIFIED` | Real production build/start with no authorization or projection `page.route()` substitute: light `16/16`, dark `16/16`; `27` states x `4` viewports = `108` machine rows per theme; serious/critical axe `0`; quality rows pass. |
| CF-503 | `VERIFIED` | Final `34`-case/`17`-pair corpus passes with required and preferred support, aggregate metrics, pair semantics, and a separately reconstructed pre-change baseline validated by the final evaluator. |
| Final Phase 4-5 gate | `PASS / VERIFIED` | CF-406 final-source repeatability is `6/6`; discovery baseline is an accepted historical `UNVERIFIED` limitation; the untouched full scoring failure is an allowed outside-path baseline exception with unaffected-path proof. |

## CF-502 production environment

- Build: production build passed in task-owned `.next-phase5-final-20260918-rerun`; TypeScript passed and static pages were `116/116`. A second final-source build `.next-phase5-repeatability-20260919` also passed and was removed after the CF-406 run.
- Runtime: task-owned `next start` on `http://localhost:3003`; server stopped and port `3003` has no listener.
- Database: `candidate_phase5_final_20260917_e2e_test` (`e2e`); dropped and independently queried absent. Shared `smarthire` was not targeted.
- Browser command: `node scripts/phase5-run-isolated.mjs npx.cmd playwright test --config=playwright.phase5.config.ts`.
- Browser config: `web/playwright.phase5.config.ts`, `tests/system/e2e/candidate-first/phase5-cf502-accessibility.spec.ts`; `routeMocks=false`.
- Light: Playwright `16/16`, unexpected `0`, skipped `0`; machine rows `108/108`; `27/27` states; serious/critical axe `0`.
- Dark: Playwright `16/16`, unexpected `0`, skipped `0`; machine rows `108/108`; `27/27` states; serious/critical axe `0`.
- Coverage includes Guest, Employer, Candidate without Profile, Profile/CV available, report variants, incomplete/missing criteria/evidence, failed/queued/analyzing/retrying, expired/revoked/deleted, evidence-empty, long EN/VI, direct link/refresh/Back/Forward, second authenticated tab, cross-account denial, and closed/expired Apply.
- Quality rows cover 320/375/768/1280 CSS pixels, light/dark, 200% CSS reflow, reduced motion, keyboard/focus, overflow, and privacy/source semantics.

## Phase 4 affected checks

- CF-403 authoritative invalidation: current artifact `13/13 PASS`.
- CF-405 current production browser journey/accessibility: light `16/16 PASS`, dark `16/16 PASS`; serious/critical axe `0`.
- CF-406 cache: warm-hit checks pass, true-hit database calls `0`, projection stable, and mutation-to-first-read check passes.
- CF-406 recall: catalog coverage `796/796`, recall@10 `1`, MRR `1`, nDCG `1`, and zero-result cases pass. The before/after baseline comparison remains `UNVERIFIED` because no same-run pre-change expected-ID baseline was available; Phase 4 explicitly accepts this historical limitation and it is not a new Phase 5 blocker.
- CF-406 production performance final-source repeatability: one task-owned production `next start`, one isolated database, no restart between rounds, dataset `1002`, concurrency `10`, and `100 Home + 100 Search` samples per viewport round. Desktop rounds p95 `1972.5053/835.7017`, `1360.225/1256.8704`, `1715.4538/1491.035` ms; mobile rounds `1728.1831/808.3802`, `1475.0173/910.7546`, `1530.3183/752.3161` ms; error rate `0%`; unchanged thresholds (`Home <= 3000 ms`, `Search <= 2000 ms`); result `6/6 PASS`. The initial-chain desktop round-3 Search p95 `2525.8495` and two wrong-cwd preflight failures remain retained in raw evidence and did not change thresholds or get relabelled.

## Mandatory gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Private Match, Home, CF-105, CF-106 | `PASS` | CF-501 current evidence: private regression `14/44`, Home `39/104`, CF-105 `11/46`, CF-106 `3/25`. |
| Deterministic corpus | `PASS` | Final evaluator exits `0`; `34` cases / `17` pairs; required `TP/FP/FN/support=38/0/0/38`; preferred `2/0/0/2`; precision/recall/F1 all `1`; pair deterministic difference `0`. |
| Isolated PostgreSQL | `PASS` | Eight integration tests on the isolated e2e database; shared database untouched; database dropped and verified absent. |
| Production Playwright and accessibility | `PASS` for CF-502 | Light/dark `16/16` each; machine-readable rows preserve every state x viewport; serious/critical axe `0`. |
| Phase 4 affected regression | `PASS` with accepted historical limitation | CF-403, CF-405, cache, recall metrics, and current CF-406 `6/6` repeatability pass. Discovery-recall before/after remains explicitly `UNVERIFIED` under the already accepted Phase 4 limitation. |
| Build/typecheck/lint/format/Prisma/migration/diff | `PASS` | Production build `116/116`; TypeScript, lint, Prettier, targeted ESLint, Prisma validation, migration `97/97`, and `git diff --check` pass. |
| Full scoring baseline | `PASS` gate exception; underlying suite `FAIL` | `22 files / 104 passed / 1 failed / 105 total`; focused rerun is `4 passed / 1 failed / 5 total`. Untouched `tests/frontend/scoring/documents-tab.test.tsx` expects `CV PDF preview`, while the untouched component renders `Original CV PDF preview`; both paths remain outside the Phase 5 diff. This suite is not called PASS, and the Phase 4/5 gate permits the documented unaffected baseline exception. |

## CF-503 baseline boundary

The pre-change corpus baseline was reconstructed from the full source commit `583171bf8cdb3cc76fea4a6ce818e89208a99dfb` using a task-owned snapshot, with its exact evaluator command, artifact provenance, payload hash, and integrity metadata. Its metrics are recorded in `cf503-pre-change-baseline.json`; it is not a final result copied into the before slot. The final evaluator validated the artifact and ran `34` cases / `17` pairs with exit `0`. The snapshot/archive was removed only after hash-identical canonical reports were retained.

## Cleanup and safety

- Task-owned production server: stopped; port `3003` has no listener.
- Task-owned isolated database: dropped; direct PostgreSQL check returned `present=false`.
- Task-created CF-406 performance jobs: `1000` created and `1000` deleted; post-cleanup public-job count `0`.
- Canonical evidence, raw Playwright evidence, retained CF-406 failure evidence, and the validated baseline reports are retained for auditability; the task-owned production build, repeatability temp data, baseline snapshot/archive, and server logs were removed after ownership/hash verification.
- `web/.next/dev` and `web/.local/next-output.lock` were preserved because their ownership was not task-owned. PID `32700` was never targeted or stopped; the final process query no longer found that PID. The build/start wrapper correctly refused to touch the shared output.
- No commit, push, deploy, reset, clean, shared `smarthire` mutation, route-mock substitution, test weakening, threshold change, or uncertain artifact deletion occurred.

Phase 5 is **DONE / VERIFIED** under the documented baseline-exception policy. The underlying outside-path scoring suite failure and the historical discovery-baseline limitation remain explicit and are not hidden.
