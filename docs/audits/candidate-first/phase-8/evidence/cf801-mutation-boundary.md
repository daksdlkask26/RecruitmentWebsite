# CF-801 mutation and CSRF boundary

**Recorded:** 2026-09-22; verification refreshed on the final uncommitted source.  
**Source identity:** base `eeb17d759a68437c6d15cc473a8d3cdb150cd59c` on `audit_improvement`; final Phase 8 changes are uncommitted in the working tree.  
**Owner:** [plan section 5](../plan.md#5-cf-801--mutation-and-csrf-boundary-f01)

## Implementation

- Recruiter job-posting `POST`/`PATCH` now call `requireJobActor(request, { mutation: true })` before bounded JSON parsing or service work.
- Adjacent recruiter Candidate mutations for rescore, manual score, AI retry, and priority use `requireAccountRequest(request, { mutation: true })` before parsing.
- Existing client mutation callers send the current CSRF proof; tenant and role authorization remains in the owning services.

## Executable evidence

Environment: Windows PowerShell, `D:\HCMUS\PROJECT\web`, final uncommitted Phase 8 source. The route probe used PostgreSQL 16.12 at `localhost:55432` with the task-owned database `candidate_phase8_test_20260921`; `DATABASE_URL` and `DIRECT_URL` matched that database and the test-database guard returned **PASS**. Migrations `001` through `100` were applied only to that isolated database. The shared `smarthire` database was checked read-only and was never used by the write harness.

Final command:

```text
npm run test:phase8
```

Result: **12 test files passed, 73 tests passed**. The mutation-boundary contract contributes **11 passed tests**, covering missing/foreign origin, missing/wrong proof, simple content type, invalid JSON, unauthenticated access before parsing, valid create/edit/delete, and foreign-tenant denial with mocked zero-write assertions. The final Phase 8 run also includes the adjacent recruiter mutation boundary assertions.

Real route matrix on the isolated database:

- 9 negative requests passed: missing origin, foreign origin, missing proof, wrong proof, unauthenticated, missing content type, simple content type, invalid JSON, and foreign tenant.
- Every rejected request returned the expected fail-closed response and left the task-owned catalogue unchanged.
- Valid create returned `201`, valid edit returned `200`, and valid delete returned `200` with a truthful deletion receipt; a follow-up read confirmed the deleted posting was absent.

Real browser journey on the same isolated database and task-owned catalogue:

- Recruiter login returned `200`; the Draft management screen rendered the created draft.
- The UI opened the editor at `/recruiter/job-postings/{id}/edit`; browser save produced `PATCH ... 200` in the server log and the management screen displayed the edited title.

The direct contract probe was:

```text
..\node_modules\.bin\vitest.cmd run tests/backend/contract/job-post-management/mutation-boundary.contract.test.ts --passWithNoTests
```

Result: **1 test file passed, 11 tests passed**.

Final adjacent UI/runtime regression after adding the scoped React Query
provider to both workspace and home shells:

```text
..\node_modules\.bin\vitest.cmd run tests/frontend/components/auth/navigation-shells.test.tsx tests/frontend/components/notifications/notification-center.test.tsx tests/frontend/accessibility/notifications/notification-center.accessibility.test.tsx tests/frontend/company-discovery/company-list.test.tsx --passWithNoTests
```

Result: **4 test files passed, 32 tests passed**. The workspace account chip
now renders the full name and email contract expected by the existing shell
test; the greeting remains surname-oriented.

The production browser smoke used the final build and an isolated database:

```text
npx playwright test tests/system/e2e/search-platform-v2.spec.ts --project=desktop-chromium --project=mobile-320
```

Result: **4 tests passed** across Jobs and Company Search on desktop and
320px mobile. The flow included serious/critical axe checks and the mobile
no-horizontal-overflow assertion. No `QueryClientProvider` runtime error
remained after the home/workspace provider fix.

## Boundary and limitation

The real route and browser proof closes the primary CF-801 request-boundary
criterion locally. Owner/Admin cross-role browser journeys remain
**UNVERIFIED**; they require the role fixtures and target deployment
topology. This is therefore **LOCALLY VERIFIED WITH LIMITATIONS**, not an
unconditional production PASS.

## Cleanup

The two Phase 8 draft fixtures were deleted through the real route and a final read returned no `Phase 8` drafts. The final production-browser
database `candidate_phase8_e2e_final_20260922` had all 100 migrations,
reported no remaining sessions, and was dropped without force. The task-owned
Next processes/listener, production build/browser output, catalogue, export,
CV/evidence storage roots, mail root, and Playwright result file were removed
after absolute-path checks. No shared data was touched.
