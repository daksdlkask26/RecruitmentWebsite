# Candidate-first Phase 4 integrated gate

- Generated: 2026-09-17 (CF-406 repeatability closure rerun)
- Source snapshot: commit `583171bf8cdb3cc76fea4a6ce818e89208a99dfb` plus the preserved working-tree changes listed below
- Branch: `audit_improvement`
- Scope: CF-401 through CF-406 only
- Verdict: **DONE — Phase 4 PASS — VERIFIED**
- Phase 5: **FROZEN / NOT CLAIMED**

## Root causes closed

1. Home public discovery is now separated from identity, saved/applied state, Profile, CSRF, recruiter state, and private Match work. The visitor-safe projection is cacheable; request-private overlays are merged at the server boundary.
2. Jobs and Company discovery now share the canonical visibility policies, including active verification and moderation state.
3. Public cache invalidation is wired after successful Job/Company publication, lifecycle, moderation, verification, and profile mutations. Safety invalidation expires immediately and fails closed when a static cache store is unavailable.
4. The affected search flow has an explicit keyboard-submit fallback, URL restoration, parity coverage, and live expected-ID recall.
5. Candidate application reads now use the canonical candidate-visible job policy, so moderation/verification safety mutations cannot leave an application form usable during a navigation race.
6. Public Home theme bootstrap/provider state now honors the selected light/dark theme, and dark public accents meet the serious/critical contrast gate.

## Work-item ledger

| Work item | Status | Current evidence |
| --- | --- | --- |
| CF-401 | **VERIFIED** | Same-configuration isolated pre/post artifacts: 1,000 jobs, 20 samples, concurrency 10, zero errors. Guest `21.74 → 23.65 ms` (`+8.8%`), Candidate `291.81 → 153.70 ms`, Employer `288.72 → 176.56 ms`; payloads decreased. The 2026-09-15 repeatability run stayed below the 3 s absolute Home budget with zero errors. The direct-harness Candidate/Employer query increase (`40 → 48`) is documented as the correctness cost of the public/private split; that harness runs outside the Next request cache store. |
| CF-402 | **VERIFIED** | Public/private snapshot, rendered-data privacy, role parity, and failure-isolation gate: **10 files, 22 tests PASS**; Home focused suite: **39 files, 101 tests PASS**. |
| CF-403 | **VERIFIED** | `docs/audits/candidate-first/phase-4/evidence/cf403-authoritative-invalidation.json`: **13/13 PASS** across profile edit, validation rollback, moderation, approve/republish, close/reopen, concurrency race, lifecycle worker, verification approval, watermark, and first-read checks. |
| CF-404 | **VERIFIED** | Isolated cross-surface parity **1/1**, explicit Jobs-search fallback **14/14**, and live expected-ID recall **5/5 cases** (exact/normalized 100%, broad 100%, zero-result PASS). |
| CF-405 | **VERIFIED** | Current production-build matrix: light **32/32 PASS** and dark **32/32 PASS** across 320/375/768/1280. Applied theme, axe serious/critical = 0; 200% zoom, keyboard/focus, reduced motion, overflow, EN/VI, and revoked/expired navigation race pass. |
| CF-406 | **VERIFIED** | Cache probe remains **20/20 warm hits (100%)**, zero public repository calls on true hit, stable snapshot, and first-read-after-mutation PASS. Final same-server repeatability chain: **3 desktop + 3 mobile runs**, each 100 Home + 100 Search samples, dataset **1,002**, concurrency **10**, error rate **0%**. Desktop Home/Search p95: **1,755.2/1,186.8**, **1,893.9/1,671.0**, **1,759.1/1,236.4 ms**. Mobile Home/Search p95: **1,350.1/996.0**, **1,761.7/1,348.0**, **1,313.2/1,155.5 ms**. All six pass thresholds; evidence: `docs/audits/candidate-first/phase-4/evidence/cf406-repeatability.json`. |
| Phase 4 integrated gate | **VERIFIED** | CF-401–CF-406 are closed on current evidence; no required Phase 4 blocker remains. |

## Performance, cache, and recall evidence

- Closure browser rerun is consolidated in `docs/audits/candidate-first/phase-4/evidence/cf406-repeatability.json`: each of the six final runs measured 100 Home + 100 Search samples against 1,002 active public jobs with zero request errors and both p95 budgets passing. Earlier pending-stream and launcher failures are summarized in the canonical diagnosis rather than kept as duplicate one-off files.

- CF-401 pre/post: `docs/audits/candidate-first/phase-4/evidence/cf401-performance-baseline.json` and `docs/audits/candidate-first/phase-4/evidence/cf401-performance-current.json`. The same-run service p95 regression budget is **PASS** (`+8.8%` maximum).
- CF-403: the authoritative final probe exercises the real profile, moderation, approval/republish, close/reopen, worker, and verification paths. It proves post-commit watermark advancement, unchanged watermark/body on failure, one-winner race semantics, and non-stale first reads across Home, Jobs, Company, and Job detail.
- CF-406: `docs/audits/candidate-first/phase-4/evidence/cf406-cache.json` wraps the real public repository prototypes only for observation; 20/20 warm snapshots return with zero public repository calls. Mutation-to-read evidence is the same-source authoritative CF-403 report.
- Query plans are in `docs/audits/candidate-first/phase-4/evidence/cf406-query-plans.json` for Home jobs/counts, Company/public projections, exact detail, broad search, normalized short-token search, and filtered search.
- CF-406 live recall was rerun with a task-owned labelled fixture: exact/normalized and broad recall are 100%; zero-result correctness passes (`docs/audits/candidate-first/phase-4/evidence/cf406-recall.json`). The same-run pre-change baseline remains **UNVERIFIED** because checking out/resetting the starting commit was prohibited; historical artifacts are not substituted.
- CF-406 repeatability closure (`docs/audits/candidate-first/phase-4/closure.md`): the first same-server attempts retained real p95 failures and a harness-env failure. Runtime diagnosis found pending RSC/prefetch streams from `domcontentloaded` navigation; the minimal gate correction waits for `load` and drains 250 ms after the measured Search sample. After a clean task-owned server restart for that correction, the final six-run chain passed without restart between rounds. Earlier failure metrics remain consolidated in the canonical JSON.

## Verification totals

- Closure rerun static/database gates (2026-09-17): affected typecheck/build, Home lint, affected ESLint/Prettier, Prisma validate, migration-sequence check (**97 migrations**), isolated current-source production build (**116/116 pages**), and `git diff --check`: **PASS**. The root worktree build was not forced because user-owned PID 32700 holds `web/.local/next-output.lock` and port `3001`; it was not stopped. The task-owned isolated production build is the current build evidence. The build retained two existing Turbopack dynamic-filesystem trace warnings.
- Current Phase 4 focused rerun: **7 files, 17 tests PASS** across Home, discovery parity, discovery units, and public-snapshot security.
- Home focused: **39 files, 101 tests PASS**.
- Cache/privacy/parity: **10 files, 22 tests PASS**.
- Candidate-first regression: **16 files, 50 tests PASS**.
- Additional final-source application/visibility regression: **2 files, 4 tests PASS** (`application-draft-service`, `private-match-job-search`).
- Jobs-search fallback: **2 files, 14 tests PASS**.
- Job-management security/privacy/authorization: **3 files, 4 tests PASS**; architecture boundary: **2 tests PASS**.
- Production browser closure rerun: CF-405 responsive **32/32 per theme**, accessibility **4/4 per theme**, journey **12/12 per theme**; CF-406 final repeatability **6/6 PASS** (three desktop/mobile rounds on one server, no restart between rounds).
- CF-403 authoritative runtime probe: **13/13 PASS**; CF-405 browser matrix: **64/64 PASS** across light/dark; CF-406 cache probe: **4/4 PASS**; live recall: **5/5 cases PASS**.
- Typecheck, affected static gates, production build (**116/116 pages**), and `git diff --check`: **PASS**.
- Final CF-406 gate correction checks: focused affected regression **4/4 PASS**, TypeScript **PASS**, ESLint and Prettier for the performance gate **PASS**, Prisma validate **PASS**, and `git diff --check` **PASS**.

## Retained baseline observations

- The historical broad Home run contained unrelated Help/Support redirect and direct-database-resilience failures. Those paths do not belong to the affected Candidate discovery gate; no assertion was weakened or skipped.
- An initial browser invocation used the wrong local PostgreSQL port and did not execute the test body. The corrected run used the Docker-mapped port `55432` and passed the production browser suites above.

## Cleanup and safety

- The task-owned browser/performance database is dropped after verification; a read-only check confirms it is **ABSENT** while shared `smarthire` remains present.
- The task-owned production server on port `3002`, temporary production workspace, launcher/logs, and task-owned Playwright result directories are removed after exact process-ownership checks. User-owned PID `32700` remains on port `3001` and holds `web/.local/next-output.lock`; it was not stopped.
- Docker/PostgreSQL remains running for the user; shared `smarthire` was not mutated.
- No commit, push, deploy, reset, broad clean, or user-owned service stop was performed. Existing dirty work, including Phase 5 files, was preserved.

## Phase 5 boundary

CF-501 through CF-503 remain frozen and are not part of this verified Phase 4 verdict. Existing Phase 5 files are preserved, but no Phase 5 acceptance or final Phase 4–5 gate is claimed.
