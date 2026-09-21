# Candidate-first Phase 8 integrated gate

**Recorded:** 2026-09-22  
**Source identity:** base `eeb17d759a68437c6d15cc473a8d3cdb150cd59c` on `audit_improvement`; final implementation and evidence changes remain uncommitted in the working tree.  
**Plan:** [Phase 8 plan](plan.md)  
**Closure:** **`DONE_WITH_LIMITATIONS / LOCALLY_VERIFIED`**. This is not an unconditional production `DONE / VERIFIED` claim.

## Final ledger

| Work item / evidence class | Final status | Evidence and exact limitation |
| --- | --- | --- |
| CF-801 mutation security | **LOCALLY VERIFIED WITH LIMITATIONS** | Isolated route matrix passed 9 negative cases plus valid create/edit/delete; the existing browser mutation journey passed. Final source also passed the production desktop/mobile search smoke and adjacent shell/accessibility tests. Owner/Admin cross-role mutation journeys remain **UNVERIFIED**. |
| CF-802 consistency | **LOCALLY VERIFIED WITH LIMITATIONS** | Unit contracts plus real PostgreSQL/filesystem recovery passed: completed export survives audit outage and retry, concurrent audit claim is fenced, bounded retry reaches dead letter, and backup lease reclaim rejects stale publication. Independent OS workers, permission-loss matrix, every private-artifact authorization/checksum path, and production storage recovery remain **UNVERIFIED**. |
| CF-803 operations and restore | **LOCALLY VERIFIED WITH LIMITATIONS** | Lease/epoch fencing, deadlines, cleanup, health classification, drain contracts, real backup-row reclaim, and warning-free `117/117` production build passed. Automated DB-plus-private-artifact restore, process-kill/upload, target topology, RPO/RTO, live dependency outage, and resource measurements are **DEFERRED_EXTERNAL / UNVERIFIED**. |
| CF-804 regression/dependency | **LOCALLY VERIFIED WITH DEFERRED PRE-EXISTING FINDING** | Phase 8 `73/73`, integration recovery `4/4`, affected regression `85/85`, shell/accessibility `32/32`, typecheck, full ESLint, Prisma/migration checks, and build passed. Architecture is `10/11`: one current repository-to-service direction failure is broader and pre-existing; advisory registry access and hosted CI are **UNVERIFIED**. |
| CF-805 observability/scale | **LOCALLY VERIFIED WITH LIMITATIONS** | Company-location keyboard/unit contracts and bounded metrics passed; production browser smoke passed `4/4` with serious/critical axe assertions and mobile overflow check. Operator exporter/query/alert, full theme-locale matrix, timezone process parity, representative query plans, and scale correctness/performance remain **UNVERIFIED**. |
| Security evidence | **PASS** | Isolated database guard and matching URLs passed; route origin/proof/content/auth/tenant negatives, valid mutation paths, and no shared-database writes were verified. |
| Consistency evidence | **PASS WITH LIMITATIONS** | Real isolated DB/filesystem recovery rehearsal passed `4/4`; broader process/storage matrix remains open. |
| Operations evidence | **PASS WITH LIMITATIONS** | Local lease, deadline, health, drain, cleanup, and production build evidence passed; target outage and capacity evidence remain open. |
| Restore evidence | **DEFERRED_EXTERNAL / UNVERIFIED** | Current backup path is encrypted PostgreSQL dump only; private CV/application/export/evidence backup and target restore were not available without approved topology, credentials, and RPO/RTO. |
| Regression evidence | **PASS WITH LIMITATIONS** | Focused and affected suites are green; the full architecture assertion still reports one pre-existing direction failure and is documented below. |
| Safety evidence | **PASS** | Isolated URLs and guard passed; shared `smarthire` was not written; task-owned DBs had no sessions and were dropped without force; task-owned processes and filesystem outputs were cleaned; `git diff --check` passed. |

## Canonical final checks

```text
npm run test:phase8 --workspace @smarthire/web
  12 test files passed, 73 tests passed

npm run test:phase8:integration --workspace @smarthire/web
  1 test file passed, 4 tests passed on isolated PostgreSQL + filesystem storage

..\node_modules\.bin\vitest.cmd run tests/backend/unit/jobs/recruiter-job-posting-data.test.ts tests/backend/unit/job-post-management tests/backend/contract/job-post-management tests/frontend/components/recruiter-workspace/job-posting-management.test.tsx tests/architecture/job-post-management-boundaries.test.ts --passWithNoTests
  12 test files passed, 85 tests passed

..\node_modules\.bin\vitest.cmd run tests/frontend/components/auth/navigation-shells.test.tsx tests/frontend/components/notifications/notification-center.test.tsx tests/frontend/accessibility/notifications/notification-center.accessibility.test.tsx tests/frontend/company-discovery/company-list.test.tsx --passWithNoTests
  4 test files passed, 32 tests passed

npm run typecheck
npm run lint
npm run db:validate --workspace @smarthire/web
npm run db:migrations:check
  all passed; migration count 100, first 001_identity_foundation, last 100_export_audit_retry_fencing

Production build with task-owned PHASE5_NEXT_DIST_DIR
  compiled successfully; TypeScript passed; 117/117 static pages; no build warnings

npx playwright test tests/system/e2e/search-platform-v2.spec.ts --project=desktop-chromium --project=mobile-320
  4 passed: Jobs and Company Search on desktop and 320px mobile; serious/critical axe and mobile overflow checks passed

..\node_modules\.bin\vitest.cmd run tests/architecture/layer-boundaries.test.ts --passWithNoTests
  10 passed, 1 failed; failure is the established repository-to-service direction rule

codegraph status
  index up to date; 2,884 files, 225,885 nodes, 443,634 edges
```

Earlier same-session isolated integration checks also passed: candidate
application documents `10/10`, company deletion manifest `5/5`, CV deletion
reconciliation `6/6`, and private CV storage contract `6/6` (**31/31 across
5 files including the Phase 8 recovery file**). The shared `smarthire`
database was read-only throughout.

## Architecture limitation

The remaining architecture failure is not hidden or weakened. The exact
current inventory is recorded in [CF-804 evidence](evidence/cf804-ci-dependency.md):
company discovery/company job, seven CV-import repositories, job application,
job-post review, and public-job repositories import existing service/policy
modules. This is a broad company/job/CV dependency-direction redesign outside
the changed CF-801–805 contracts. It is recorded as
**DEFERRED_PREEXISTING / UNVERIFIED** and should be handled as a separate
bounded architecture work item with cross-feature contract coverage.

## External limitations

The following are intentionally not promoted to PASS:

- `npm audit --omit=dev --json` could not reach the registry; advisory
  applicability and fixed-version disposition require a host with registry
  access.
- Hosted CI artifact/redaction proof was not available for this uncommitted
  tree.
- Production Google Drive/object storage, private-artifact manifest restore,
  target deployment topology, owner-approved RPO/RTO, worker kill/drain under
  outage, operator alert/query, and representative scale measurements were
  not available locally.

These are external or target-environment evidence gaps, not silent PASS
claims. No P0/P1 data-loss, authorization, privacy, or consistency defect
remains in the locally exercised Phase 8 paths.

## Decision

The maximum safe local scope is complete and executable evidence is green for
the available Candidate-first Phase 8 contracts, isolated DB/filesystem
recovery rehearsal, production build, browser smoke, regression, static
checks, and cleanup. Under the Phase 8 closure allowance, the final status is
**`DONE_WITH_LIMITATIONS / LOCALLY_VERIFIED`**. It must be reopened or
promoted only after the external/target evidence above and the separate
pre-existing architecture redesign are resolved; do not shorten this status
to `DONE / VERIFIED`.

## Cleanup and ownership

The final isolated databases `candidate_phase8_e2e_20260921` and
`candidate_phase8_e2e_final_20260922` reported no sessions and were dropped
without `WITH FORCE`. The task-owned Next listeners on port 3021, build and
browser output, catalogue fixture, CV/export/evidence roots, mail root, and
Playwright result file were removed after absolute-path checks. Generated
Next `tsconfig` include entries were reverted. No shared database, user-owned
service, credential, token, PII, or private document bytes were retained.
