# Candidate-first Phase 2 Plan: Recoverable CV Import

**Version:** 1.0
**Prepared:** 8 September 2026
**Scope:** CF-201 through CF-205
**Starting point:** commit `b677ee16` — Pre-Phase 2 `DONE_WITH_LIMITATION`
**Current status:** `DONE_WITH_LIMITATION` — CF-201 through CF-205 are individually verified and the integrated Candidate-first Phase 2 gate is green. Docker Scout remains `DEFERRED_ENVIRONMENT_LIMITATION`, and the optional live OpenAI compatibility test is intentionally not enabled; neither blocks the Phase 2 scope. CF-301 implementation must wait for the roadmap prerequisites CF-105 through CF-107, which remain open after the 9 September dependency audit. No CF-301 work was started.

## 1. Purpose

Phase 2 shall make the Candidate CV Import journey recoverable, transparent, and safe to continue after an interruption. A Candidate must be able to upload a CV, follow its actual processing state, recover after refresh, network loss, tab closure, or re-authentication, review extracted data, resolve conflicts, and confirm selected Profile changes without losing progress or repeating unintended side effects.

The target journey is:

`Upload → Scan → Extract → Review → Confirm`

The server remains authoritative for workflow state. The Candidate remains authoritative over which extracted values are applied to the Profile. The browser must not persist the CV file, extracted content, review data, or other personally identifiable information (PII).

## 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** define implementation requirements:

- **MUST / MUST NOT:** required for Phase 2 acceptance.
- **SHOULD:** expected unless source evidence demonstrates a safer or simpler alternative.
- **MAY:** optional and must not expand the scope or weaken an invariant.

## 3. Review of the proposed plan

The proposed CF-201–CF-205 sequence is appropriate. The following refinements are necessary for technical accuracy and scope control:

1. Cross-device recovery is supported only after the Candidate authenticates with the same account. The implementation MUST NOT introduce public resume tokens.
2. The URL provides durable identity; the database projection provides authoritative state. The client MUST NOT infer workflow state from the URL, elapsed time, or an artificial progress timer.
3. `SECURITY_CLEAN` is not terminal for a Profile CV Import. It confirms completion of the Scan step, while Extract and Review may still remain. Existing `SCAN_ONLY` consumers outside this journey retain their own contract.
4. Polling MUST stop while the page is hidden. Merely reducing the polling frequency does not meet CF-202.
5. Browser storage is unnecessary because the durable URL and import history already provide recovery. The existing empty-storage invariant SHOULD be retained.
6. Stage-aware retry, per-field decisions, optimistic concurrency, idempotent confirmation, and durable receipts already have substantial implementations. Luna Max MUST verify their gaps before changing them and MUST NOT build a parallel workflow engine.
7. Byte-upload progress MAY show real XMLHttpRequest progress. Server-side Scan, Extract, Review, and Confirm MUST use state-based progress rather than fabricated percentages.

## 4. Verified implementation baseline

The following baseline was established through current source and CodeGraph review. It prevents Phase 2 from rebuilding capabilities that already exist.

| Capability | Existing implementation | Remaining Phase 2 gap |
| --- | --- | --- |
| Durable status route | `/profile/cv-imports/[uploadId]` reads a server-side database projection and preserves an exact login `returnTo` | The upload page continues polling in component memory instead of navigating after content acceptance |
| Ownership and IDOR protection | Status lookup is scoped by `id + accountId`; missing and foreign imports resolve through the same content-free 404 path | Add browser evidence for foreign access and post-login return |
| Status polling | The status component uses `pollingAfterMs` and stops for configured terminal states | Fixed interval, hidden tabs still poll, no bounded backoff/jitter, and `SECURITY_CLEAN` is incorrectly terminal for Profile Import |
| Import history | The list is loaded from the database and links to durable status URLs | It is ordered only by creation time and does not prioritise active or review-ready work |
| Workflow presentation | The list page has a static three-step explanation and the status page has status-specific presentation | No authoritative five-step progress model exists |
| Failure recovery | Safe failure codes, suggested actions, retry counters, and EN/VI copy exist | Status, failure category, workflow step, and allowed CTA need one consistent mapping |
| Stage-aware retry | The server selects Scan, Extraction, or Parse; limits, leases, consent checks, and idempotency exist | Prove that only the required stage and side effects repeat under replay and concurrency |
| Review decisions | Editable proposals and `ADD/REPLACE/SKIP` decisions exist | Verify every field group and clarify the Candidate-facing conflict choices |
| Conflict handling | Draft/Profile revision conflicts, compare, reapply, and discard/reload paths exist | Confirm all three business outcomes with two-session browser evidence |
| Confirmation and receipt | Confirmation uses an idempotency digest, transaction, Profile revisions, and a durable receipt | A successful POST currently changes client state; use a canonical reloadable receipt location to make Post/Redirect/Get explicit |

## 5. Scope boundaries

### 5.1 Included

- Candidate routes under `/profile/cv-imports`.
- API, service, repository, contract, and worker behaviour directly required by CF-201–CF-205.
- Status, stage, action, failure, polling, retry, review, conflict, confirmation, and receipt contracts.
- EN/VI, 320/375/768/1280 px layouts, light/dark themes, keyboard operation, focus management, screen-reader output, and reduced motion for affected UI.
- Risk-based unit, component, contract, integration, concurrency, browser E2E, and accessibility evidence.

### 5.2 Excluded

- CF-301 and later phases.
- Job Application, Recruiter, Company Owner, and Admin work unless a shared CV contract change directly causes a regression.
- WebSocket or realtime progress infrastructure; HTTP polling is sufficient.
- CV, extracted data, draft data, or PII in browser storage.
- Redis, a new queue, a new storage provider, or a broad CV architecture refactor.
- Bulk rebranding of historical SmartHire technical identifiers.
- Deferred Applications and Job Board baseline failures unless Phase 2 demonstrably causes them.
- Reopening the Docker Scout `DEFERRED_ENVIRONMENT_LIMITATION` unless the environment has materially changed.

## 6. Execution rules for Luna Max

Luna Max MUST process the work as five sequential vertical slices. For each slice it must:

1. Read `AGENTS.md`, confirm the repository and inspect the working tree.
2. Preserve all existing work; do not reset, clean, or overwrite unrelated changes.
3. Use CodeGraph to inspect callers, dependencies, and affected tests before editing.
4. Establish current behaviour and identify the smallest root-cause change.
5. Implement only the active CF work item.
6. Test the success path, material failure paths, concurrency/idempotency where relevant, and affected UX states.
7. Review the diff, record exact evidence, and clean temporary resources.
8. Mark the work item `VERIFIED` only when its acceptance criteria have executed evidence.

Luna Max MUST NOT commit, push, deploy, restart user-owned services, or mutate the shared `smarthire` database without explicit authorisation. Any data-writing test MUST use an isolated database whose name contains `test`, `spec`, or `e2e` and MUST clean its namespace afterwards.

## 7. Work plan

### Slice 1 — CF-201: Durable URL after upload

#### Problem

`useCvImport` keeps processing state and polling in the upload page's component memory. A successful content upload does not immediately move the Candidate to the durable status route that already exists.

#### Required work

1. Parse the upload reservation response using the existing shared schema.
2. After the content PUT returns its accepted success response, navigate with the Next.js router to `/profile/cv-imports/{uploadId}`.
3. Stop the previous page's polling responsibility; the durable status page becomes responsible for reading server state.
4. Reservation or PUT failure MUST keep the Candidate on the upload form and provide a valid recovery path.
5. Preserve the existing server-rendered route, exact login `returnTo`, and content-free ownership 404 unless a test proves a defect.
6. Extend the browser journey to verify refresh, Back/Forward, a second authenticated session, and absence of duplicate reservation/content requests.

#### Acceptance criteria

- A successful PUT navigates to the exact status URL containing its `uploadId`.
- Refresh immediately after navigation loads the same import from the database.
- Back/Forward does not repeat POST or PUT and does not create another import.
- A second session for the same account can open the URL and see the same state.
- A different account and a nonexistent ID receive the same content-free 404 behaviour.
- Upload failure does not navigate to a status URL.

#### Minimum evidence

- Hook/component navigation tests.
- Status route, response-contract, and ownership tests.
- Desktop and mobile Playwright coverage for upload → URL → refresh → Back/Forward → authenticated second session.

### Slice 2 — CF-202: Server-state resumption and smart polling

#### Problem

The status route already reads the database, but polling uses a fixed two-second interval, continues in hidden tabs, and stops incorrectly at `SECURITY_CLEAN`.

#### Required work

1. Define Profile Import states as `active`, `action-required`, or `terminal` using existing persisted status and stage data.
2. Correct the Profile Import projection so `SECURITY_CLEAN` marks Scan complete and Extract pending or active; it MUST NOT indicate overall completion.
3. Introduce a small, testable polling policy that:
   - refreshes when the status page first becomes active;
   - applies bounded backoff and jitter when status does not change or a request fails;
   - resets its delay when status or stage advances;
   - stops completely while `document.hidden` is true;
   - refreshes once immediately after the page becomes visible;
   - stops at `REVIEW_READY`, actionable failure, `CONFIRMED`, `CANCELLED`, `DELETED`, or `EXPIRED`.
4. Prevent overlapping status requests and state updates after unmount.
5. Order import history by active processing first, Candidate action/review second, and remaining records last. Within each group, preserve deterministic `createdAt desc, id desc` ordering.
6. Use “Resume” for active/action-required imports and “View result” for completed imports.
7. Do not add localStorage, sessionStorage, or IndexedDB state.

#### Acceptance criteria

- Refresh, tab closure/reopen, and re-authentication during Scan, Extract, and Review recover the same import without re-upload.
- Hidden tabs issue no polling requests; returning to visible performs one immediate refresh.
- Polling stops in action-required and terminal states.
- Import history ordering is deterministic and does not hide records.
- Browser storage remains free of CV state and PII.

#### Minimum evidence

- Polling-policy unit tests with a fixed clock and deterministic random source.
- Component tests for Page Visibility, bounded backoff, no overlap, and unmount.
- Projection/list integration tests across representative statuses.
- Playwright recovery during Scan, Extract, and Review.

### Slice 3 — CF-203: Five-step progress and error taxonomy

#### Problem

The current UI combines status-specific messages with a static three-step introduction. It lacks one authoritative mapping for the five processing steps, failure categories, and Candidate actions.

#### Required work

1. Define a pure presentation mapping from server `status + stage + failureCode + availableActions` to:
   - current workflow step;
   - completed steps;
   - `pending`, `active`, `complete`, `error`, or `action-required` presentation;
   - safe Candidate-facing error category;
   - only the actions allowed by the server.
2. Present exactly five steps: Upload → Scan → Extract → Review → Confirm.
3. Retain real byte-upload progress while the PUT is in progress. After content acceptance, present server states without fabricated percentages.
4. Cover these error categories:
   - file type, structure, or size;
   - malware detection;
   - scanner unavailable, stale, or timed out;
   - OCR, extraction, or parser failure;
   - consent required or invalid;
   - draft or Profile conflict;
   - expired or deleted import;
   - temporary system failure.
5. Render a CTA only when its action appears in `availableActions`. The client MUST NOT grant Retry or Review eligibility.
6. Complete EN/VI copy for loading, empty, processing, action-required, error, retry, and success states.
7. Use semantic list markup, expose the current step programmatically, and avoid excessive live-region announcements.

#### Acceptance criteria

- Every `CvUploadStatus` and supported failure code has a deterministic tested presentation.
- `SECURITY_CLEAN` completes Scan only; it does not complete the entire journey.
- Every failure displays an accurate safe explanation and an authorised recovery action.
- The UI works at 320 px without horizontal overflow.
- Keyboard, focus, screen-reader semantics, dark mode, reduced motion, and EN/VI rendering pass the agreed matrix.

#### Minimum evidence

- Table-driven tests covering all statuses and failure codes.
- Component and axe tests for active, success, action-required, and failure states.
- Browser matrix at 320/375/768/1280 px with EN/VI, light/dark, and reduced motion.

### Slice 4 — CF-204: Stage-aware retry

#### Problem

The existing retry foundation already selects stages on the server and implements limits, leases, consent checks, and idempotency. Phase 2 must prove its end-to-end invariants and repair only demonstrated gaps.

#### Required retry matrix

| Persisted failure | Server-selected retry | Reusable evidence or artifact | Side effect that MUST NOT repeat |
| --- | --- | --- | --- |
| Retryable `SCAN_FAILED` | Scan | Valid encrypted source bytes | Creating a second upload or source artifact |
| Retryable `EXTRACTION_FAILED` | Extraction/OCR appropriate to the failure | Current CLEAN assessment and valid source bytes | Malware scan while safety evidence remains valid |
| Retryable `PARSE_FAILED` | Parse | Valid CLEAN evidence and extraction output | Scan or extraction |
| Confirm timeout or replay | Confirm using the same revisions and idempotency key | Saved draft and review decisions | A second confirmation or Profile revision outcome |

#### Required work

1. Compare the repository and service implementation with the retry matrix; change only branches that violate an invariant.
2. Continue deriving retry stage exclusively from persisted server state. The client request MUST NOT contain a stage override.
3. Fail closed when scan evidence is stale or missing, encrypted bytes are missing, external consent has expired, or retry limits are exhausted.
4. Make concurrent retry with the same key converge on one attempt. Different keys racing for the same failed work must still produce only one valid lease owner.
5. Preserve previous failure and attempt history for audit.
6. Store only a digest of an idempotency key; never log or persist its raw value.

#### Acceptance criteria

- Retry creates neither a second upload nor a second source artifact.
- Scan, Extraction/OCR, and Parse repeat only when required by current evidence.
- Double-click, replay, and concurrent requests do not duplicate side effects.
- The client cannot bypass security or consent checks.
- Prior failures and retry outcomes remain traceable.

#### Minimum evidence

- Eligibility and fail-closed unit/service tests.
- Isolated-database integration tests for replay, concurrency, lease ownership, limits, and history.
- Worker probes comparing stage attempt counts before and after retry.
- Desktop and mobile failure-recovery browser tests.

### Slice 5 — CF-205: Review, conflict resolution, and canonical receipt

#### Problem

Per-field review, optimistic concurrency, and durable receipts already exist. Phase 2 must make the three conflict outcomes explicit, verify all Profile field groups, and move successful confirmation to a canonical reloadable receipt state.

#### Required work

1. Retain the existing `ADD/REPLACE/SKIP` contract for scalar fields, experience, education, skills, and social links. Do not create another merge engine.
2. Present three clear Candidate outcomes when a conflict occurs:
   - keep the latest Profile/saved review and discard local edits;
   - load the latest revision and reapply the Candidate's CV decisions;
   - return to field-level editing before Save and Confirm.
3. Save MUST update only the review draft. Only Confirm may mutate the Candidate Profile.
4. Preserve optimistic checks for draft and Profile revisions. A conflict MUST preserve unsaved local edits until the Candidate chooses an outcome.
5. Preserve the current idempotency digest, transaction, revisions, and receipt; verify replay and concurrent Confirm.
6. After successful Confirm, replace the browser location with a canonical URL that the server can reload as a receipt. Refresh MUST perform a GET and MUST NOT repeat the POST.
7. The receipt SHOULD show the receipt identifier, confirmation time, Profile revision before/after, applied counts, and links to Profile and import status. It must not expose unnecessary PII.

#### Acceptance criteria

- Before Confirm, the Candidate can inspect current values, proposed values, relevant source/evidence, and projected actions.
- The Candidate can keep, apply, or edit field-level values using only the keyboard.
- Concurrent edits from two sessions produce an explicit conflict; the losing session retains unsaved edits.
- Duplicate Confirm or replay after timeout returns the same receipt and one Profile mutation outcome.
- Refresh, Back, and Forward on the canonical receipt location do not issue another mutation.

#### Minimum evidence

- Component tests for every review group and decision type.
- Draft/Profile conflict integration tests and two-session Playwright coverage.
- Confirmation replay and concurrency integration tests.
- Receipt refresh/Back/Forward E2E and accessibility evidence.

## 8. Expected impact area

This list guides CodeGraph review. It does not require every file to change.

- `web/src/frontend/features/cv-import/client/use-cv-import.ts`
- `web/src/frontend/features/cv-import/client/use-cv-draft-review.ts`
- `web/src/frontend/features/cv-import/components/cv-import-status.tsx`
- `web/src/frontend/features/cv-import/components/cv-import-list.tsx`
- `web/src/frontend/features/cv-import/components/cv-import-page.tsx`
- `web/src/frontend/features/cv-import/components/cv-draft-review.tsx`
- `web/src/frontend/features/cv-import/components/cv-review-conflict.tsx`
- `web/src/frontend/features/cv-import/components/cv-confirmation-receipt.tsx`
- Related CSS modules and CV Import EN/VI copy.
- `web/src/shared/contracts/cv-import/common.ts`
- `web/src/shared/contracts/cv-import/upload.ts`
- `web/src/shared/contracts/cv-import/retry.ts`
- `web/src/shared/contracts/cv-import/review.ts`
- `web/src/backend/services/cv-import/cv-import-projection.ts`
- Retry or confirmation services/repositories only when a failing invariant proves that a change is required.
- Corresponding tests under `web/tests/{backend,frontend,architecture,system}`.

No database migration is currently expected. If implementation discovers a required schema change, Luna Max MUST stop that slice, document the necessity, and add an expand/rollback plan before creating a migration.

## 9. Gate after each slice

Each slice MUST satisfy all applicable checks before work proceeds:

1. CodeGraph impact and caller review before editing; affected-test review after editing.
2. Focused unit, component, and contract tests with zero failures and no new skips.
3. Data-writing integration tests only on a verified isolated database, followed by namespace cleanup.
4. Typecheck, affected lint scope, and `git diff --check` pass.
5. Diff review confirms no scope creep, PII logging, client-authorised stage, artificial progress, or weakened assertion.
6. Evidence records the command, environment, PASS/FAIL/SKIP totals, cleanup, and unverified items.

## 10. Phase 2 Definition of Done

Phase 2 may be marked `DONE` only when:

- CF-201, CF-202, CF-203, CF-204, and CF-205 are individually `VERIFIED`.
- Desktop and mobile browser E2E complete upload → scan → extract → review → confirm → receipt.
- Refresh, Back/Forward, new tab, authenticated second session, and Page Visibility recovery pass.
- Foreign status and review access return a content-free 404.
- Scan, Extract, Parse retry and Confirm replay do not repeat unnecessary side effects.
- Stepper, errors, review, and conflict handling pass EN/VI, 320 px, keyboard, focus, and axe checks.
- Browser storage contains no CV file, extracted data, review data, or PII.
- Candidate-first focused tests and affected CV Import tests contain no new regression.
- Pre-Phase 2 ClamAV CLEAN/EICAR and safe-open invariants still pass.
- Typecheck, lint, and `git diff --check` pass.
- Temporary test databases, workers, processes, fixtures, storage, environment files, and Playwright artifacts are cleaned; the main stack remains running and `smarthire` remains unmodified.

Docker Scout may remain `DEFERRED_ENVIRONMENT_LIMITATION` if the environment is unchanged. Deferred Applications and Job Board baseline failures block Phase 2 only if evidence shows that CF-201–CF-205 introduced or worsened them.

## 11. Status and reporting model

Each CF work item must have exactly one current status:

- `PLANNED`: no implementation has started.
- `IMPLEMENTED`: source changed, but acceptance evidence is incomplete.
- `VERIFIED`: all acceptance criteria have executed evidence.
- `PARTIAL`: some criteria passed and specific work remains.
- `BLOCKED`: a precise blocker remains after reasonable safe approaches were attempted.

Lint, typecheck, or a focused green suite alone is insufficient for `VERIFIED`. A slice must not be silently abandoned when a test fails: classify the failure as an in-scope regression, a proven pre-existing baseline, or a precise blocker.

The report for each slice should contain:

1. Root cause addressed.
2. Behaviour before and after.
3. Important files changed.
4. Test evidence with PASS/FAIL/SKIP totals.
5. Security, privacy, concurrency, and recovery invariants checked.
6. Remaining unverified work or blockers.
7. Temporary resources created and cleaned.
8. Exact next step.

## 12. Time estimate for Codex Luna Max

The estimate represents active agent time for source review, implementation, regression diagnosis, tests, browser/worker execution, evidence, and cleanup. It assumes Docker, isolated PostgreSQL, ClamAV, and Playwright remain available as established during Pre-Phase 2.

| Work item | Expected time | Reasonable maximum |
| --- | ---: | ---: |
| Establish Phase 2 baseline and impact | 1–2 hours | 4 hours |
| CF-201 | 1.5–3 hours | 5 hours |
| CF-202 | 3–5 hours | 9 hours |
| CF-203 | 4–6 hours | 10 hours |
| CF-204 | 4–7 hours | 12 hours |
| CF-205 | 4–7 hours | 12 hours |
| Integrated Phase 2 gate, evidence, and cleanup | 4–6 hours | 10 hours |
| **Total** | **22–36 hours** | **approximately 60 hours** |

The most likely total is **26–32 active hours** when Luna Max changes only verified gaps. The approximate **60-hour maximum** allows for concurrency regressions, worker or ClamAV instability, and repeated browser-matrix runs. If the work exceeds 60 active hours without closing the gate, Luna Max MUST stop iterative patching and report the unresolved root cause and blocker.

Phase 2 should be assigned one CF at a time rather than as one uninterrupted run. Each run should end with a reviewable diff, exact evidence, and resource cleanup.

## 13. Implementation evidence log

This log records executed evidence without changing the acceptance criteria above.

### CF-201 — Durable URL after upload

- Status: `VERIFIED`.
- Root cause addressed: the accepted content upload stayed on the in-memory upload screen and did not enter the durable status route.
- Source change: the client now parses the reservation and accepted-content contracts, then navigates to `/profile/cv-imports/{uploadId}` after the accepted PUT; failed reservation/content requests remain on the upload form.
- Evidence: `npx vitest run tests/frontend/components/cv-import/cv-upload-route-navigation.test.tsx tests/frontend/components/cv-import/cv-upload-and-status.test.tsx --passWithNoTests` — 2 files, 10 tests PASS, 0 FAIL, 0 SKIP.
- Evidence: the isolated production-server Candidate run reached reservation (201), content acceptance (202), durable status, review, draft save, and confirm (201); the later Job Board Apply navigation failed at the proven pre-existing Job Board baseline and is not classified as a CF-201 failure.
- Evidence: final complete isolated browser run `npx playwright test tests/system/e2e/cv-import --project=desktop-chromium --project=mobile-320 --workers=1` — 20 PASS, 0 FAIL, 0 SKIP, including upload, scan, extract, review, confirm, receipt, refresh, and canonical receipt navigation.
- Evidence: the same final browser matrix covers canonical receipt reload, Back/Forward, new-tab/second-session recovery, and no duplicate confirm POST; the focused rerun of the transient desktop performance case also passed (`confirmMs=1490ms`).

### CF-202 — Server-state resumption and smart polling

- Status: `VERIFIED`.
- Root cause addressed: Profile Import treated `SECURITY_CLEAN` as terminal, used a fixed polling interval in hidden tabs, and ordered history only by creation time.
- Source change: Profile Import now carries `processingMode`, keeps `SECURITY_CLEAN` active for `IMPORT_AND_PARSE`, prioritises active/action-required history, and uses bounded backoff/jitter, visibility recovery, and an in-flight guard without browser storage.
- Evidence: `npx vitest run tests/frontend/components/cv-import/cv-import-polling-policy.test.ts tests/frontend/components/cv-import/cv-upload-and-status.test.tsx tests/frontend/accessibility/cv-import/cv-import-workflow.accessibility.test.tsx tests/backend/contract/cv-import/cv-upload.contract.test.ts --passWithNoTests` — 4 files, 22 tests PASS, 0 FAIL, 0 SKIP.
- Evidence: `npm run typecheck` — PASS.
- Evidence: final complete isolated browser matrix — 20 PASS, 0 FAIL, 0 SKIP, including Page Visibility pause/resume and one visible recovery poll.

### CF-203 — Five-step progress and error taxonomy

- Status: `VERIFIED`.
- Root cause addressed: the UI exposed a variable 8-step internal timeline and did not have one deterministic mapping from server state to the Candidate-facing workflow.
- Source change: added a pure five-step `Upload → Scan → Extract → Review → Confirm` presentation mapping, safe failure categories, server-authorised action filtering, semantic action-required/error step states, and a five-step profile introduction.
- Evidence: `npx vitest run tests/frontend/components/cv-import/cv-import-presentation.test.ts tests/frontend/components/cv-import/cv-upload-and-status.test.tsx tests/frontend/accessibility/cv-import/cv-import-workflow.accessibility.test.tsx --passWithNoTests` — 3 files, 27 tests PASS, 0 FAIL, 0 SKIP.
- Evidence: `npm run typecheck` — PASS.
- Evidence: final complete isolated browser matrix — 20 PASS, 0 FAIL, 0 SKIP; it covers upload/review/receipt, multi-device recovery, failure recovery, 320 px, and disclosed safe error codes.

### CF-204 — Stage-aware retry

- Status: `VERIFIED`.
- Source evidence before editing: `EXTRACTION_FAILED` currently returns retry stage `SCAN` from `prisma-cv-retry-repository.ts`, while `ExtractionStageProcessor` has already persisted a CLEAN scan and failed extraction attempt. `CvRetryStage` contains only `SCAN` and `PARSE`, and `CvRetryRequest` has no prior/new extraction binding. This violates the required matrix because an OCR/extraction retry would repeat the malware scan and cannot be replay-bound to one extraction attempt.
- Required schema expansion: add the `EXTRACTION` retry stage plus nullable prior/new extraction foreign-key bindings. The final shared database is back at migration 090 with no 091 columns or extraction retry rows; migration 091 was applied only to the verified isolated test database for live evidence.
- Rollback strategy: this is an expand-only migration. Revert application code first to stop producing/reading `EXTRACTION` rows; leave the nullable columns and enum value unused because PostgreSQL cannot safely remove an enum value in-place. If data rollback is required, restore the isolated test database or remove only its namespaced rows. A production rollback would use the same expand-only application rollback followed by a planned backup restore, not an unsafe `DROP VALUE`.

- Root cause fixed: `EXTRACTION_FAILED` now retries the extraction stage against the existing CLEAN scan instead of repeating malware scanning.
- Source change: added the `EXTRACTION` retry stage, nullable prior/new extraction bindings, extraction-specific counter and response field, CLEAN-scan/evidence checks, serializable creation, and exact idempotent replay. The migration extends `CvRetryRequest_stage_binding` so SCAN, PARSE, and EXTRACTION bindings remain mutually exclusive and complete.
- Isolated migration evidence: recreated `cf_phase2_e2e_test_20260908` and deployed migrations `001` through `091_cv_extraction_retry` successfully; Prisma identified the target database explicitly.
- Evidence: `npx vitest run tests/backend/integration/cv-import/cv-retry-policy.test.ts --passWithNoTests` against `cf_phase2_e2e_test_20260908` — 1 file, 21 tests PASS, 0 FAIL, 0 SKIP. The extraction case proves two candidate retries, exact replay, one CLEAN scan, three extraction attempts, and cap exhaustion without hidden queued work.
- Shared-database safety evidence: an incorrect environment-path attempt briefly applied 091 to `smarthire`; a guarded transaction verified zero extraction rows and removed only 091's columns, constraints, enum-dependent table shape, and ledger row. Final read-only checks show 090 present, 091 absent, retry enum `SCAN,PARSE`, no 091 columns, and zero retry/extraction rows.

### CF-205 — Review, conflict resolution, and canonical receipt

- Status: `VERIFIED`.
- Root cause addressed: confirmation had no durable receipt route after mutation, so refresh/reload could return the Candidate to an ambiguous review state.
- Source change: successful confirmation now replaces the URL with `/profile/cv-imports/{uploadId}/receipt`; the receipt is a server-rendered, ownership-checked, no-store read surface and returns content-free 404 for missing, tombstoned, or foreign resources.
- Evidence: focused review/conflict/accessibility/contract tests — 6 files, 23 PASS, 0 FAIL, 0 SKIP; isolated draft-save/confirmation/concurrency/conflict/comparison integration tests — 6 files, 25 PASS, 0 FAIL, 0 SKIP.
- Evidence: final complete browser matrix — 20 PASS, 0 FAIL, 0 SKIP, including receipt reload and replay-safe confirm; the multi-device cases cover second-session conflict handling.

### Final integrated gate evidence

- Candidate-first focused suite: `npm run test:candidate-first` — 16 files, 46 PASS, 0 FAIL, 0 SKIP, on `cf_phase2_e2e_test_20260908`.
- Affected CV Import suite: `npm run test:cv-import -- --no-file-parallelism --maxWorkers=1` — 64 files, 410 PASS, 0 FAIL, 1 intentional optional-provider SKIP (`CV_OPENAI_LIVE` disabled), on the isolated database. No in-scope test was skipped.
- Browser gate: the complete `cv-import` Playwright matrix — 20 PASS, 0 FAIL, 0 SKIP across desktop/mobile upload-to-receipt, review/receipt replay, multi-device conflict, OCR, and failure-recovery/visibility specs. The final run used the isolated app server, isolated database, temporary CV storage, one cloned worker, and the existing ClamAV service.
- Migration 090 clean database: verifier PASS and reconciliation dry-run PASS. Migration 090 database with one legacy CV lacking evidence: verifier PASS, reconciliation dry-run PASS with `legacy_denied=1`, and safe-open rejection PASS (`CV_NOT_FOUND`); no legacy row was auto-marked CLEAN.
- Migration 091 integration: `cv-retry-policy.test.ts` — 1 file, 21 PASS, 0 FAIL, 0 SKIP; migrations 092 and 093 were also required by the live v2 parse/draft contracts and deployed only to the isolated database. No acceptance criterion was changed.
- Migration rollback procedure:
  1. Stop Phase 2 writers and workers before application rollback. Confirm that no retry request uses stage `EXTRACTION` and that no active parse/draft row requires a v2 contract, or retain the expanded database constraints until those rows finish or are reconciled.
  2. Roll application code back first. Migration 091 is expand-only: leave the PostgreSQL `EXTRACTION` enum value and nullable extraction-binding columns in place but unused. Removing an enum value in place is not an approved rollback. A later contracted migration may remove unused columns only after a verified retention window and backup.
  3. Migration 092 may be rolled back only after every producer has returned to the v1 parse contract. In one transaction, drop `CvParseJob_terminal` and recreate its migration-008 definition requiring `inputVersion = 'cv-segments-v1'`, `instructionVersion = 'cv-extract-v1'`, and `schemaVersion = 'cv-draft-v1'`, while retaining the original attempt, provider, lease, terminal-status, HMAC, and consent checks.
  4. Migration 093 may be rolled back only after no persisted draft has `schemaVersion = 'cv-draft-v2'`. In the same guarded maintenance window, drop `CvDraft_json_caps` and recreate its migration-008 definition requiring `schemaVersion = 'cv-draft-v1'`, while retaining the revision, payload/provenance byte caps, and deleted-payload nullability checks.
  5. Re-run migration verification, the v1 CV Import focused suite, safe-open checks, and a read-only query for remaining v2 rows. If any prerequisite query is non-zero, abort the constraint contraction and restore the expanded application/database pair. Production recovery uses the verified backup rather than destructive enum surgery.
- ClamAV: direct clean probe PASS, direct EICAR probe PASS (`Eicar-Signature FOUND`, non-zero scanner result), and the live container boundary suite 4 PASS, 0 FAIL, 0 SKIP.
- Static gates: production build PASS (only existing tracing warnings), typecheck PASS, lint PASS, and `git diff --check` PASS (the existing CSS line-ending warning is not a whitespace error).
- Diagnostic failures were resolved and rerun: the first failure-recovery browser attempt exposed stale selectors/labels (4 FAIL), one combined run exposed a worker/parser timing race (2 FAIL), and one full browser run had a boundary-only performance sample (`2000.4267ms` versus `2000ms`). Corrected isolated reruns passed; none was an assertion weakening or a final-gate classification.
- UI/accessibility evidence: the affected workflow matrix passed EN/VI, 320/375/768/1280 px, light/dark, reduced motion, keyboard/focus, horizontal-overflow, and axe checks; browser storage remained free of CV data and PII.
- Docker Scout: `DEFERRED_ENVIRONMENT_LIMITATION`; the environment was not changed for this slice. Applications and Job Board failures remain the previously proven baseline backlog and were not introduced or worsened by CF-201 through CF-205.
- Cleanup: the isolated database `cf_phase2_e2e_test_20260908`, temporary worker, temporary app/email processes, temporary CV storage, migration harness, env/process state, logs, and Playwright artifacts were removed. Exactly 30 direct `web/.local/mail/*.eml` files dated 2026-09-08 in the verified 15:50:56–17:11:08 generation window and containing only test-domain evidence were deleted; the 26 older files were preserved (`2026-09-03:2`, `2026-09-05:4`, `2026-09-06:20`). The main Docker stack remains running. Final read-only checks on `smarthire` show migration 090 present, migration 091 absent, retry enum `SCAN,PARSE`, no 091 columns, and zero retry rows.
- Conclusion: CF-201 through CF-205 and all required Phase 2 evidence gates are green. Mark this plan `DONE_WITH_LIMITATION` because Docker Scout and the optional live OpenAI provider remain explicitly deferred environment limitations; they do not block Phase 2. The Phase 2 deliverable may be checkpointed independently, but CF-301 implementation must not begin until CF-105, CF-106, and CF-107 satisfy their roadmap acceptance criteria. No CF-301 work was started here.

## 14. Historical execution note

The original authorization required the first implementation run to perform CF-201 first, confirm the working tree and CodeGraph impact, preserve commit `b677ee16`, and report evidence before CF-202. That sequential execution has now completed through CF-205; the factual evidence and final gate decision are recorded in Section 13. The acceptance criteria in this plan were not changed.
