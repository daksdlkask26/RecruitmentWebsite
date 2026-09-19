# CF-501 contract and privacy evidence

- Generated: 2026-09-19
- Verdict: **VERIFIED**
- Source: `583171bf` plus preserved dirty working tree
- Isolated PostgreSQL: `candidate_phase5_final_20260917_e2e_test` (`e2e`), migration sequence `97/97`; database and four migration-verifier databases were queried absent after cleanup.
- Shared `smarthire`, PID `32700`, `web/.local/next-output.lock`, and unowned `web/.next/dev` were not mutated or removed.

## Required behavior

All CF-501 contract classes passed: immutable CV/JD/config lineage, completeness and presentation states, numeric eligibility, parser/evidence provenance, Profile/CV separation, Candidate ownership with neutral denial, advisory-only semantics, and content-free logs.

The isolated PostgreSQL suite passed **1 file / 8 tests / 0 failures / 0 skips**. It covers immutable lineage, cross-account read/list/retry/delete denial, concurrent retry convergence, expired/revoked/deleted neutral denial, company deletion success/rollback, content-free failure logging, and real company-scoped deletion.

## Supporting executable evidence

- Core contract/projection/Home/source guard: **6 files / 30 passed / 0 failed**.
- Private Match UI/accessibility: **3 files / 12 passed / 0 failed**.
- Candidate application/private-match regression: **14 files / 44 passed / 0 failed / 0 skipped**.
- Home suite: **39 files / 104 passed / 0 failed / 0 skipped**.
- CF-105 focused: **11 files / 46 passed / 0 failed / 0 skipped**.
- CF-106 focused: **3 files / 25 passed / 0 failed / 0 skipped**.
- Prisma validation and migration sequence: **PASS**, 97 migrations, latest `097_public_discovery_invalidation_watermark`.
- Production build: **PASS**, task-owned `.next-phase5-final-20260918-rerun`, TypeScript PASS, static pages `116/116`; two existing dynamic-filesystem tracing warnings.
- The historical Prettier command retained in the JSON references the superseded single-run CF-406 summary exactly as executed; the canonical replacement is `../phase-4/evidence/cf406-repeatability.json`.
- Prettier, targeted ESLint, and `git diff --check`: **PASS**. The diff check emitted only LF/CRLF normalization notices.
- Final-source revalidation after the final projection/evidence changes: **3 files / 10 tests passed / 0 failed / 0 skipped**; the recreated isolated database was dropped and verified absent.

## Unrelated baseline

`node scripts/phase5-run-isolated.mjs npm.cmd run test:scoring -- --reporter=dot` remains **22 files / 104 passed / 1 failed / 105 total**. The failure is the untouched `documents-tab.test.tsx` expectation `CV PDF preview` versus existing component text `Original CV PDF preview`; neither the test nor `web/src/frontend/scoring` is in the Phase 5 diff. It remains recorded as an external baseline failure.

## Current classification

CF-501 is **VERIFIED independently**: every CF-501 acceptance class has current executable evidence on the final source state, including the isolated PostgreSQL behavior suite. The final Phase 4–5 gate is recorded separately and does not downgrade this slice.

The unrelated scoring baseline remains a documented `FAIL` outside the Phase 5 paths; it is not relabelled as a passing scoring suite and is handled as an allowed baseline exception in the integrated gate.

The task-owned production build and server logs were removed after verification. Canonical evidence and retained failure/baseline artifacts remain. The task-owned server is stopped; port `3003` has no listener. PID `32700` was never targeted or stopped; the final process query no longer found that PID. `web/.local/next-output.lock` and `web/.next/dev` were preserved.
