# Candidate-first baseline — 2026-09-05

This record is the CF-004 baseline for the first implementation slice. It
separates measured checks from work that could not be run safely.

## Identity and environment

| Field                      | Value                                                                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical audit input     | [`verification.json`](../../../verification.json)                                                                                                                                                                                                                                                 |
| Historical audited commit  | `60711785`                                                                                                                                                                                                                                                                                                     |
| Current branch             | `audit_improvement`                                                                                                                                                                                                                                                                                            |
| Current source state       | Uncommitted CF-001–004/CF-101 slice; pre-existing untracked audit documents preserved                                                                                                                                                                                                                          |
| Node / npm                 | `v24.18.0` / `11.16.0`                                                                                                                                                                                                                                                                                         |
| CodeGraph                  | 2,733 files, 216,472 nodes, 423,506 edges; index up to date                                                                                                                                                                                                                                                    |
| Hardware inventory         | Not available: the managed PowerShell session denied WMI access; no values are inferred                                                                                                                                                                                                                        |
| Database policy            | `.env.local` still resolves to `localhost:55432/smarthire`; the guard rejects this development/shared URL before connection. A separate `smarthire_candidate_first_test` database was provisioned on the same local PostgreSQL instance and received all 88 migrations; no shared `smarthire` data was mutated |
| Browser / container access | CUA reports no interactive browser; Playwright Chromium 1.57.0 is installed and a real app-only server run was possible, but Docker CLI/Compose is unavailable in this session                                                                                                                                 |

The historical audit itself used PostgreSQL 16.12 read-only data and overrode
the database connection to loopback port 1. Its Vitest baseline was 122 files,
104 passed files, 18 failed files, 610 tests, 575 passed, and 35 failed in
241.09 seconds. The complete failure-to-owner mapping is in
[`baseline-triage.md`](baseline-triage.md).

This checkpoint also corrected the test teardown after the first isolated
integration run exposed the database-enforced append-only `AuditEvent` trigger:
fixture cleanup now retains immutable audit evidence and removes only mutable
rows. That correction is included in the results below.

## Checks measured for this slice

| Check                                 | Command                                                                                                                         | Result                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate focused unit/contract tests | `npm run test:candidate-first`                                                                                                  | Pass; 9 files, 26 tests                                                                                                                                                                                                                                   |
| Job application contract              | `npm exec --workspace @smarthire/web -- vitest run tests/backend/contract/jobs/job-application.contract.test.ts --reporter=dot` | Pass; 1 file, 3 tests                                                                                                                                                                                                                                     |
| Isolated test database                | Temporary `DATABASE_URL`/`DIRECT_URL` override to `smarthire_candidate_first_test`; `prisma migrate deploy`                     | Pass; PostgreSQL 16.12, 88 migrations applied, 165 public tables; shared `smarthire` untouched                                                                                                                                                            |
| Fixture control lifecycle             | `candidate-first-e2e-control.mjs` create/delete via `tsx`                                                                       | Pass; two consecutive create/delete cycles returned `deleted: true`, storage cleanup returned no error, and the post-teardown read-only probe found 0 namespaced users/applications/accounts/memberships/threads/messages/notifications/uploads/artifacts |
| Existing job application integration  | Same test file against the isolated database                                                                                    | Pass; 1 file, 1 test; idempotent submission creates one `RecruitmentNotificationWork`, with teardown completing and leaving 0 fixture rows                                                                                                                |
| TypeScript                            | `npm run typecheck --workspace @smarthire/web`                                                                                  | Pass; exit 0                                                                                                                                                                                                                                              |
| Wrong-database refusal                | `npm exec --workspace @smarthire/web -- vitest run tests/backend/integration/jobs/job-application.test.ts --reporter=dot`       | Refused before a database connection; `TestDatabaseGuardError` with `TEST_DATABASE_NAME_UNSAFE` for the development database URL                                                                                                                          |
| Candidate smoke collection            | `npm exec --workspace @smarthire/web -- playwright test tests/system/e2e/candidate-first/candidate-first-smoke.spec.ts --list`  | Pass; 2 project tests in 1 file (desktop Chromium and mobile 320)                                                                                                                                                                                         |
| Live desktop smoke                    | App-only server + isolated DB, `RUN_CANDIDATE_FIRST_E2E=1`, desktop project                                                     | Diagnostic fail at `CV status` after 90s; login/upload API passed (200/201), no review-ready state because worker/ClamAV socket unavailable                                                                                                               |
| Formatting for changed code/artifacts | Prettier check on changed source/test helpers and Candidate-first baseline                                                      | Pass; the whole historical plan document still emits a pre-existing formatting warning and was left un-reformatted to avoid documentation churn                                                                                                           |
| Diff hygiene                          | `git diff --check`                                                                                                              | Pass at the time of this record                                                                                                                                                                                                                           |
| CodeGraph freshness                   | `codegraph status`                                                                                                              | Pass; index up to date                                                                                                                                                                                                                                    |

The wrong-database command is a safety proof, not an integration pass. It was
also repeated against the explicitly provisioned `smarthire_candidate_first_test`
database. The fixture control create/delete lifecycle passed through the `tsx`
subprocess boundary, and a read-only post-teardown probe found zero namespaced
users, applications, uploads, and stored artifacts. The test database is local
and disposable; it is not the development database and is not production
evidence.

An additional headless probe launched Chromium against `about:blank` at a
320-pixel viewport successfully. This validates the installed browser binary
only; it does not validate the application journey, accessibility, screenshots,
or download behavior.

The Candidate-first plan itself still reports a whole-file Prettier warning from
its pre-existing documentation layout. The source and test changes, the
baseline artifact, and the triage artifact were formatted and checked; the plan
was not mass-reformatted so that the audit diff stays reviewable.

## Current implementation checkpoint - 2026-09-05

The focused Candidate-first set now contains **9 files and 26 tests**, including database guard cases, candidate/base fixture rollback fault injection, post-commit artifact ownership, concurrent temporary cleanup, replay and confirmed-CV promotion. The guard is fail-closed for a pathless/full Vitest invocation, requires both matching DATABASE_URL and DIRECT_URL, and rejects the current development database before Prisma. The isolated `smarthire_candidate_first_test` database has 88 applied migrations and 165 public tables; no shared `smarthire` data was touched.

Two consecutive real fixture-control cycles through the `tsx` subprocess returned `deleted: true`. A read-only probe after both cycles found zero namespaced users, applications, accounts, memberships, threads, messages, notifications and fixture CV storage rows. Immutable `AuditEvent` rows are intentionally retained because the database trigger makes them append-only; mutable fixture rows are deleted. Home, recruitment-pipeline and messaging E2E controls also invoke the guard before importing Prisma.

The broad full Vitest rerun captured before the final reconciliation-fixture adjustment completed with **807 files: 723 passed, 84 failed; 3152 tests: 3013 passed, 134 failed, 5 skipped**. This is a broad current inventory after the Candidate-first changes, not a replacement for the historical 18-suite/35-test triage. Representative remaining categories are Playwright tests collected by Vitest, storage/scanner availability, architecture/static contract drift, and DOM/accessibility/provider setup drift.

The scanner/retry/reconciliation integration boundary was then run separately: **3 files and 32 tests passed**. It deterministically covers CLEAN, INFECTED, unavailable, stale definitions, timeout, stream limit, retry lease finalization, delete lease recovery, provider absence and orphan reconciliation. It does not prove a live ClamAV socket or production worker is available.

### Home browser evidence

With the app-only server and isolated database, Playwright Chromium passed:

- `home-keyboard-responsive.spec.ts`: **8/8** across desktop Chromium and mobile-320 projects, including the existing 1366/768/390 paths and 200% zoom case.
- `home-responsive-matrix.spec.ts`: **8/8** across the same projects, covering exact `320x720`, `375x812`, `768x1024`, `1280x800` viewports, EN/VI, dark mode, reduced motion, overflow, keyboard focus and screenshot attachments.

These are browser behavior checks for Home. They do not close the full Candidate journey, query/performance metrics, realtime load, accessibility score, or restore drill.

## Browser baseline

The Candidate smoke spec is present at
`web/tests/system/e2e/candidate-first/candidate-first-smoke.spec.ts`. It is
disabled unless `RUN_CANDIDATE_FIRST_E2E=1`, creates a namespaced fixture only
after the database guard passes, records the current URL and step on failure,
and cleans the exact candidate storage locators plus the scoped rows.

| Dimension   | Required matrix                                                                                                                                      | Observed result                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewport    | 320, 375, 768, 1280 px                                                                                                                               | Only desktop Chromium was exercised; 320/375/768/1280 matrix remains open                                                                                                                                |
| Zoom        | 200%                                                                                                                                                 | Not run                                                                                                                                                                                                  |
| Locale      | EN and VI                                                                                                                                            | Not run                                                                                                                                                                                                  |
| Input       | keyboard journey and visible focus                                                                                                                   | Not run                                                                                                                                                                                                  |
| Theme       | supported light/dark paths                                                                                                                           | Not run                                                                                                                                                                                                  |
| Motion      | `prefers-reduced-motion`                                                                                                                             | Not run                                                                                                                                                                                                  |
| Journey     | login → profile → CV import/status/review/confirm → Home → Jobs/Company → Job Detail → Apply → application detail/file action → notification/message | Live desktop run reached login, profile, and upload API (200/201), then timed out at CV status after 90s because the CV worker/ClamAV Unix socket was unavailable; later steps and mobile are unverified |
| Home matrix | 320, 375, 768, 1280 px; EN/VI; dark; reduced motion; keyboard; screenshots                                                                           | Pass; `home-keyboard-responsive.spec.ts` 8/8 and `home-responsive-matrix.spec.ts` 8/8 across desktop/mobile projects                                                                                     |

No screenshot, accessibility score, or full browser timing is claimed. The
headless Chromium binary and one desktop run prove that the harness can start;
they do not prove the required viewport/locale/theme/keyboard matrix. The live
run is blocked by the required CV worker scanner readiness (`/run/clamav/clamd.sock`)
and Docker is unavailable, so the worker cannot be started through the normal
local supervisor.

## Backend and realtime performance baseline

The dedicated Playwright performance config was also exercised: `home-page-performance.spec.ts` was run with the desktop project and stopped at its safety gate before creating visitors because the isolated database contains 0 active public jobs (the test requires at least 1,000). No latency samples were claimed.

The following values are intentionally `not measured`. The current local URL
does not pass the test guard, and there is no approved load harness or safe
test corpus in this slice. The historical audit did not provide these metrics.

| Flow / profile              | Query count | p50 | p95 | p99 | Pool wait | Status       |
| --------------------------- | ----------: | --: | --: | --: | --------: | ------------ |
| Home guest                  |         N/A | N/A | N/A | N/A |       N/A | Not measured |
| Home candidate              |         N/A | N/A | N/A | N/A |       N/A | Not measured |
| Home employer               |         N/A | N/A | N/A | N/A |       N/A | Not measured |
| Realtime, 1 conversation    |         N/A | N/A | N/A | N/A |       N/A | Not measured |
| Realtime, 10 conversations  |         N/A | N/A | N/A | N/A |       N/A | Not measured |
| Realtime, 40 conversations  |         N/A | N/A | N/A | N/A |       N/A | Not measured |
| Realtime, 100 conversations |         N/A | N/A | N/A | N/A |       N/A | Not measured |

The follow-up measurement must record commit, fixture seed/corpus, request
profile, worker count, database version, pool configuration, warm-up, sample
count, and the raw output. Until then, no p95 or optimization claim is made.

## Fault and replay baseline

The historical fault simulations documented these pre-slice observations:

- post-export audit append failure left database state `SUCCEEDED` but deleted
  the artifact;
- team submission read failure after transaction commit invoked CV cleanup;
- retry and concurrent-load, scanner, worker-lease, and disconnect evidence was
  not a full live candidate journey.

The new CF-101 focused tests cover the ownership boundary, concurrent temporary
cleanup, post-commit projection failure, duplicate active-key replay, and
confirmed-CV promotion through verified artifact/reuse paths. The scanner/retry/
reconciliation integration boundary also passes 3 files and 32 tests with a
deterministic transport fixture; real ClamAV readiness remains unavailable. The fixture
control lifecycle also exercises real Prisma/storage cleanup on the isolated
database. The ordinary job-application integration now asserts the current
notification-work invariant and passes. A live post-commit fault run through
the worker/scanner remains pending because the scanner readiness contract is
unavailable in this session.

## Reproduction notes

Run the focused slice from the repository root:

```powershell
npm run test:candidate-first
npm run typecheck --workspace @smarthire/web
npm exec --workspace @smarthire/web playwright test tests/system/e2e/candidate-first/candidate-first-smoke.spec.ts --list
```

To run the live smoke journey, provision and verify an isolated database whose
name contains a test marker and whose `DATABASE_URL`/`DIRECT_URL` match; then
set `RUN_CANDIDATE_FIRST_E2E=1` and run
`npm run test:candidate-first:e2e`. In this checkpoint the command was run with
an app-only server and recorded as a diagnostic failure at `CV status`, not as a
pass, because ClamAV/worker readiness was unavailable.

## Current verification checkpoint — 2026-09-06

Checkpoint này cập nhật bằng chứng thực chạy sau các điều chỉnh CF-001/CF-101; các snapshot lịch sử phía trên vẫn được giữ nguyên.

- Focused Candidate-first: **12 files / 42 tests passed**.
- Selected CV review/concurrency integration: **6 files / 25 tests passed**.
- Ordinary job application integration: **1 file / 1 test passed**.
- Scanner/retry/reconciliation: **3 files passed, 34 tests passed, 1 skipped**; live Compose boundary blocked because Docker is unavailable.
- Historical full Vitest snapshot: **807 files (735 passed, 72 failed); 3,167 tests (3,046 passed, 116 failed, 5 pending); exit 1**. The current machine-readable acceptance evidence is [full-run-raw.json](full-run-raw.json) with [full-run-triage](full-run-triage.json).
- Guard proofs: pathless DB-required invocation rejects a shared-looking URL before connection; DB-free guard unit is **9/9**; guarded performance path rejects the same unsafe URL.
- Real isolated lifecycle controls: sequential A/B and concurrent A/B create/delete passed; a read-only residue probe found **0 mutable namespaced rows**. Immutable audit rows remain by design.
- Typecheck, ESLint and `git diff --check` passed. CodeGraph is up to date at 2,736 files / 216,520 nodes / 423,719 edges.

The full Candidate browser journey, live ClamAV/worker, 1,000-job performance corpus, realtime fan-out, axe Candidate screens, real zoom and restore drill remain open. No browser or infrastructure limitation is converted into a passing result.
Inventory update: static discovery found **122 write-like references** across test and script paths. Runtime database paths are covered by the integration/compatibility global guard, direct performance/security guards, guarded E2E/helpers, and explicit guards for the two real-Prisma identity unit tests; mocked/static and operator-only references are labeled separately in [db-write-inventory.json](db-write-inventory.json).
Final post-change rerun: the retention-worker reconciliation suite is 1 file/6 tests PASS; the regenerated triage is v2 with one record per 116 failed assertions and five explicit pending entries.
Fixture teardown now tracks created Skill ownership and rechecks job-posting/profile references before deletion; the shared-Skill rollback test passes.
The post-change sequential/concurrent lifecycle checks remain covered by the long-term Candidate fixture tests; their final Stage 0 cleanup decision is recorded in [integrated-gate.json](../integrated-gate.json).

The final full rerun after the shared-Skill fixture guard is the current source-of-truth; the earlier 807/3,166 snapshot remains historical.
