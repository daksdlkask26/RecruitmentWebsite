# Candidate-first Phase 3 Plan: Application Submission and History

**Version:** 1.1
**Prepared:** 9 September 2026
**Scope:** CF-301 through CF-305
**Starting point:** commit `4f9e4f12` — Pre-Phase 3 `CLOSED`
**Current status:** `DONE` — CF-301 through CF-305 are `VERIFIED`; the final integrated Phase 3 gate is `PASS`. CF-105 through CF-107 and CF-201 through CF-205 are `VERIFIED`.

## 1. Purpose

Phase 3 shall make the complete Candidate application journey durable, understandable, and safe under retry, concurrency, document retention, and large histories.

The target ordinary Job Application journey is:

`Review → Submit → Durable receipt → Processing/tracking → Snapshot/document access → Timeline → Application history`

Phase 3 also closes audit finding F10 for Team Application history:

`Candidate Team Applications pagination → Owner Team Applications pagination`

The Candidate must be able to prove what was submitted, recover the same receipt after a timeout or reload, understand the current application state from durable server data, and access every application through stable pagination. Company Owners must be able to review every Team Application in an explicitly selected company scope without exposing another tenant's records.

The server remains authoritative for identity, eligibility, idempotency, snapshots, timeline events, document availability, filters, ordering, and pagination. Client state may improve interaction, but it must not become the source of truth for an application, receipt, stage, company scope, or list position.

## 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** define implementation requirements:

- **MUST / MUST NOT:** required for Phase 3 acceptance.
- **SHOULD:** expected unless current repository evidence demonstrates a safer or simpler alternative.
- **MAY:** optional and must not expand scope, weaken an invariant, or create speculative infrastructure.

## 3. Plan review and anti-over-engineering rules

The CF-301–CF-305 sequence is correct. The following refinements keep the implementation complete without rebuilding capabilities that already exist:

1. Ordinary Job Applications and Team Applications remain separate domains. Phase 3 may align their pagination metadata and UI behaviour, but it MUST NOT merge their entities, workflows, permissions, or routes.
2. The ordinary application flow already has drafts, idempotency keys, submission binding digests, serializable persistence, immutable snapshots, public updates, notification work, audit records, a Candidate tracker, and a cursor. Phase 3 MUST prove and repair gaps in these mechanisms rather than create another application engine.
3. Exact retry semantics MUST distinguish three cases:
   - same Candidate, same idempotency key, and the same logical command returns the committed application and receipt;
   - the same key with a different logical command fails with a deterministic conflict and creates no side effect;
   - a different key for an already-active Candidate/job application creates no duplicate and returns or links to the authoritative existing application according to the current product contract.
4. A receipt is a safe server projection, not a second source of application state. Prefer a canonical GET-backed receipt/tracker route over a new receipt table unless executable evidence proves the existing application record cannot support replay.
5. Candidate document access SHOULD reuse the existing CV safety evidence, application document storage, and retention boundaries. Prefer authorized server streaming when it already satisfies the requirement. Introduce signed URLs only if the active storage adapter requires them; any signed URL MUST be short-lived and MUST NOT be logged.
6. New applications MUST render from immutable submission snapshots. Legacy applications MAY use a clearly defined safe fallback when old snapshot fields are absent; the implementation MUST NOT silently rewrite historical rows.
7. Timeline contracts SHOULD expose stable event/status codes and timestamps. EN/VI labels belong to the existing locale boundary; the backend MUST NOT require user-facing English titles to be the localization key.
8. Candidate pagination comes first. The resulting small, proven contract is then applied to Owner Team Applications. Do not create a repository-wide generic pagination framework.
9. A cursor MUST be opaque, bounded, validated, deterministic, and bound to the active sort/filter contract. Reuse an existing cursor utility or pattern when compatible; do not add a cursor service, cache, or external store.
10. `hasMore` is required. `total` SHOULD be returned when a measured PostgreSQL count is acceptable at the Phase 3 corpus size. If total is omitted, the decision and query evidence MUST be recorded; the UI must not present a loaded-page count as the total.
11. URL query parameters are authoritative for list filter/sort state. Browser storage MUST NOT hold application payloads, document metadata, Candidate PII, or Owner tenant scope for this flow.
12. No schema migration is assumed. Existing columns and tables must be inspected first. A new index or additive field is allowed only after a failing acceptance case or query plan proves it necessary.
13. UI work is a **Refine** scope: reuse current routes, components, `--sh-*` semantic tokens, EN/VI locale boundaries, dark mode, focus patterns, and reduced-motion behaviour. Do not introduce a new theme, UI package, animation system, or duplicate component family.

## 4. Verified implementation baseline

This baseline is taken from the current source at commit `4f9e4f12`. It defines what should be preserved and what Phase 3 still needs to prove or improve.

| Capability | Existing implementation | Remaining Phase 3 gap |
| --- | --- | --- |
| Candidate submit route | `POST /api/candidate/applications` validates the session, CSRF boundary, bounded JSON command, and idempotency key | Add direct service/route evidence for exact replay, changed-command key reuse, lost response, and concurrent submission |
| Submission transaction | `JobApplicationService` and `PrismaJobApplicationRepository` use a binding digest, duplicate checks, a serializable transaction, stage/public update, notification work, in-app notifications, and audit | Confirm every side effect is atomic or durably retryable and no post-commit projection/provider failure invalidates the application |
| Replay after consumed draft | `CandidateApplicationSubmissionService` checks an existing `(candidateUserId, idempotencyKey)` before loading the consumed draft | The early replay currently selects only the application ID; prove that a changed command cannot reuse the key and receive the old receipt silently |
| Submission snapshots | Profile, CV, job, answers, contact, consent, message, and cover-letter data already have substantial snapshot/persistence support | Verify completeness/version semantics and ensure Candidate detail reads snapshot values instead of mutable live values where required |
| Durable receipt/tracker | Submission returns a parsed receipt and routes to `/jobs/applied/{applicationId}/processing`; Candidate detail is loaded by application ID and Candidate ownership | Verify canonical reload, timeout recovery, Back/Forward, second session, and content-free foreign/not-found behaviour |
| Candidate-visible timeline | `ApplicationPublicUpdate` and candidate-visible stage events are merged into a deterministic timeline | Verify complete stage mapping, remove English-title authority from localization, enforce timezone/locale display, and prove private events never leak |
| Candidate file projection | Tracker exposes safe file descriptors without storage locators or checksums | Candidate file actions are disabled; no Candidate-owned download/open journey currently satisfies CF-302 |
| Ordinary application list | Candidate applications have bounded `limit`, a cursor, server loading, and a Candidate-owned repository query | Contract exposes only `applications` and `nextCursor`; filter is client-only over loaded rows, URL state is absent, `hasMore`/total are absent, and cursor stability under insertion/change is unproven |
| Candidate Team Applications | Candidate can list and open Team Applications separately from ordinary Job Applications | Repository uses `take: 100` with no cursor, `hasMore`, total, or complete-history evidence |
| Owner Team Applications | Owner authorization is company-scoped; list/detail/CV/decision paths already exist | Repository uses `take: 100`; Owner needs stable pagination, explicit multi-company scope, server filters, resilient selection, and 101/1,000-row evidence |
| Existing design system | Candidate and Owner screens already use workspace locale and established components/styles | Any touched screen still needs explicit EN/VI, light/dark, 320 px, keyboard, focus, non-color status, loading/empty/error/retry, and reduced-motion evidence |

Known evidence boundary: the last Pre-Phase 3 ledger recorded eight failures in the broader Applications baseline. They were classified as existing frontend/architecture mismatches outside the CF-105–CF-107 focused tests. Phase 3 MUST re-triage any failure whose owner or affected path is CF-301–CF-305; it MUST NOT hide, skip, or relabel those failures without evidence.

## 5. Scope boundaries

### 5.1 Included

- CF-301 through CF-305.
- Ordinary Candidate Job Application submit, receipt, tracking detail, immutable snapshot projection, Candidate-owned document access, timeline, and history list.
- Candidate Team Applications pagination required to close F10.
- Owner Team Applications pagination after the Candidate contract is stable.
- Existing application, document safety, retention, audit, notification, authorization, and company-scope contracts where directly required by Phase 3.
- EN/VI copy and locale-aware date/time formatting for affected Candidate and Owner views.
- Loading, empty, error, retry, permission-restricted, document-unavailable, and success states.
- Responsive behaviour at 320/375/768/1280 CSS pixels, light/dark themes, keyboard navigation, visible focus, screen-reader semantics, non-color cues, and reduced motion.
- Risk-based unit, contract, integration, fault-injection, concurrency, security, accessibility, browser E2E, and 101/1,000-record performance evidence.

### 5.2 Excluded

- CF-401 and later discovery/Home/cache work.
- CF-501 and later matching/scoring presentation, except preserving the invariant that scores do not decide or reorder Candidate application history.
- CF-601 and later notification/messaging realtime improvements; Phase 3 only verifies that existing durable notification work does not corrupt application submission.
- Recruiter ordinary-job pipeline/Kanban redesign.
- Changes to Team Application decision, invitation, membership, or retention semantics unless pagination reveals a blocking defect in an existing contract.
- A generic pagination framework for the whole product.
- Redis, a new queue, event sourcing, CQRS, a new receipt database, a new document store, or a new client state library.
- Account-wide erasure, legacy JSON-only company deletion, and external object-inventory restore drills retained outside CF-107's verified source boundary.
- Bulk SmartHire-to-NextGen technical renaming.
- Broad UI redesign, new typography, new hard-coded colors, or a new component library.
- Production deployment, shared-database migration, commit, push, or service restart without separate authorization.

## 6. Execution and agent-routing rules

Phase 3 MUST be executed as five sequential vertical slices. Each slice must become reviewable and evidence-backed before the next slice begins.

For each slice, the executing Codex task must:

1. Read the active `AGENTS.md`, confirm the repository/branch/HEAD, and inspect the working tree.
2. Preserve the existing `.gitignore` modification and every other unrelated user change; do not reset, clean, or overwrite them.
3. Use CodeGraph before code search to identify current owners, callers, dependents, and affected tests.
4. Reproduce the current behaviour and write down the exact failing or missing invariant before changing production code.
5. Choose the smallest shared change that closes the active acceptance criteria.
6. Use GPT-5.6 Luna with Max reasoning as the root agent for investigation, architecture, implementation, tests, self-review, and final completion decisions.
7. Root Luna Max is the sole writer and directly implements the active vertical slice. Do not reduce it to a read-only scout role.
8. Do not call, spawn, delegate to, or escalate to any subagent, reviewer, Terra, Sol, Astra, or Antigravity unless the user explicitly requests that role or model in the current task.
9. Risk or complexity alone does not authorize delegation. When additional review may help but was not requested, Luna Max must perform a risk-focused self-review and report any remaining uncertainty.
10. If Luna Max cannot establish a safe decision after two materially different reasonable approaches, it must stop speculative changes and report the exact blocker to the user instead of automatically escalating.

No task may commit, push, deploy, stop a user-owned process, or mutate the shared `smarthire` database without explicit authorization. Every data-writing test MUST use an isolated database whose name contains `test`, `spec`, or `e2e`. The isolated database must apply the full current migration sequence before Phase 3 integration tests and must be removed after evidence is captured. For CF-301, the active sequence ended at 096, so both isolated evidence databases were migrated through 096 (including 095).

## 7. Work plan

### Slice 1 — CF-301: Idempotent application submission and durable receipt

#### Problem

The application stack already implements most submission primitives, but Phase 3 does not yet have direct evidence that every retry and failure shape converges safely. In particular, the pre-draft replay shortcut must not allow the same idempotency key with a changed logical command to return an unrelated old receipt.

#### Required work

1. Define one normalized logical submission binding using the existing application command and snapshot inputs. At minimum, the binding must cover Candidate ownership, job, draft identity/revision, selected CV identity/version or digest, cover-letter identity/digest, contact-sharing choice, consent version, and any submitted answers/message that affect the committed application.
2. Preserve the existing repository `submissionBindingDigest` authority when it already covers the required data. Do not introduce a second digest owner.
3. Add failing tests for the early replay path before changing it:
   - exact same key and logical command after draft consumption;
   - same key with changed draft/revision or Candidate choice;
   - foreign Candidate using the same raw key;
   - two simultaneous requests with the same key;
   - two simultaneous requests with different keys for the same active Candidate/job pair.
4. Make exact replay return the same `applicationId`, submitted timestamp, intake state, and immutable file receipt without loading a deleted draft or creating another side effect.
5. Make changed-command reuse return a deterministic conflict. It must not return the old receipt, consume another draft, create a second application, enqueue notifications, or change audit state.
6. Recheck immediately before commit: active Candidate/account, job publication/deadline, CV ownership/confirmation/archive/safety evidence, current consent, required answers, draft revision, duplicate active application, and document promotion ownership.
7. Keep application creation, immutable snapshots, initial stage/public update, durable notification intent, in-app notification deduplication, draft consumption, and audit success inside the current transaction where the existing architecture requires atomicity.
8. Provider delivery MUST remain outside the commit-critical path. Notification/email provider failure after commit must leave one valid application and durable retryable work.
9. Inject failure at storage promotion, transaction preparation, application creation, notification-work creation, audit append, post-commit receipt projection, and lost HTTP response. Classify whether each failure rolls back or recovers through exact retry.
10. Preserve the existing canonical processing/tracker route. If a dedicated receipt path is unnecessary, do not add one; prove that the current GET-backed route satisfies reload and retry recovery.
11. Keep response data minimal: no storage key, document checksum, internal scoring value, recruiter-only state, raw idempotency key, or unnecessary Candidate PII.

#### Acceptance criteria

- One valid submission creates exactly one application in canonical `APPLIED` with one coherent set of versioned snapshots, initial public update, audit success, and durable notification work.
- An exact retry after success, timeout, connection loss, or receipt-projection failure returns the same application and equivalent safe receipt.
- The same key with a different logical command returns a conflict and performs zero new side effects.
- Concurrent submissions converge to one authoritative active application and do not leak another Candidate's receipt.
- A transaction failure exposes no partial application, snapshot, event, notification success, or consumed draft.
- A provider failure after commit does not roll back or misreport the application; notification work remains retryable and deduplicated.
- Success is not shown before the commit has succeeded.
- Refresh, Back/Forward, and a new authenticated session load the same committed application through GET and do not repeat POST.

#### Minimum evidence

- Application command/binding unit tests.
- Candidate submit route and receipt contract tests.
- Isolated PostgreSQL integration tests for exact replay, changed-command conflict, duplicate active application, same-key concurrency, different-key concurrency, and transaction rollback.
- Fault-injection tests for post-commit receipt and notification/provider failure.
- Desktop and mobile browser coverage for submit → processing/receipt → refresh → Back/Forward → second authenticated session.
- Content-free not-found/cross-account security tests.

### Slice 2 — CF-302: Immutable submission snapshot and Candidate document access

#### Problem

Application snapshots and safe file descriptors exist, but the Candidate tracker still mixes snapshot and mutable live job values, and submitted-file actions are disabled. A Candidate cannot yet reliably review or download the exact CV/cover letter used for the application.

#### Required work

1. Inventory the persisted profile, contact, CV, job, answer, message, text cover-letter, and file-document snapshots for new and legacy applications.
2. Define a safe Candidate detail projection that clearly distinguishes:
   - immutable values submitted with the application;
   - current public job availability or current company branding when intentionally live;
   - unavailable legacy snapshot fields.
3. Use immutable snapshot values for submitted job title, company name at submission, location, employment type, experience level, work arrangement, required skills, job version, and other fields the Candidate is told were submitted. Do not silently replace them with current posting values.
4. Preserve a narrow live availability field only for current navigation/action guidance. Closing, editing, unpublishing, or removing the live job must not erase the submitted snapshot.
5. Project the exact selected CV version and submitted cover letter:
   - CV descriptor and immutable source version;
   - uploaded cover-letter document when present;
   - submitted text cover letter when present;
   - an explicit “not provided” state when absent.
6. Add Candidate-owned document open/download routes or extend an existing Candidate route with server-derived ownership. Unknown, deleted, foreign, or unauthorized documents must use the same content-free unavailable response.
7. Reuse the existing safe-open and application-retention checks. A CV must have valid ownership, exact artifact/assessment evidence, CLEAN policy, checksum/length agreement, and non-expired retention state before bytes are opened.
8. Cover-letter files must use the existing application document storage contract, bounded metadata, and retention state. Do not weaken their current admission policy.
9. Prefer server streaming through the authorized route. If an active adapter requires a signed URL, keep the TTL short, bind access to the authorized object, and prevent logging/caching of the URL.
10. Return explicit Candidate states for `AVAILABLE`, `EXPIRED`, `DELETED`, `HELD`, `TEMPORARILY_UNAVAILABLE`, and unsupported preview where the underlying domain can distinguish them. Do not render a broken link.
11. Never expose storage keys, locators, checksums, malware details, legal-hold reasons, recruiter-only notes, or another Candidate's data.
12. Keep legacy fallback read-only and conservative. Do not backfill or rewrite historical snapshots merely to satisfy the UI.

#### Acceptance criteria

- Editing, closing, unpublishing, or deleting the live job does not alter the Candidate's submitted job snapshot.
- Updating the Candidate Profile or CV library does not alter the submitted application evidence.
- The Candidate can inspect the exact submitted CV version and cover letter when retention and safety policy allow it.
- Foreign Candidate, unknown application/document, and unauthorized access return the same non-disclosing result.
- Expired or legitimately deleted evidence produces a clear status and no broken download.
- Unsafe, stale, mismatched, or missing CV evidence fails closed and returns no bytes.
- No response, UI, log, or URL exposes a storage locator, checksum, internal hold reason, or unnecessary PII.
- Snapshot and document UI works in EN/VI, light/dark, keyboard-only use, screen readers, reduced motion, and 320 px layouts.

#### Minimum evidence

- Snapshot projection unit/contract tests, including live job/profile mutation after submission.
- Candidate document ownership and content-free response security tests.
- Safe-open/retention integration tests for available, expired, deleted, held, stale-assessment, digest mismatch, and storage-failure states.
- Streaming/download tests that dispose resources and preserve byte limits.
- Browser tests for snapshot view, successful download, unavailable document, removed job, and second-session reload.
- Axe and responsive checks for submitted evidence states.

### Slice 3 — CF-303: Unified Candidate timeline

#### Problem

The current tracker combines public updates and candidate-visible stage events, which is the correct durable foundation. However, some titles are generated as English strings in the backend, locale/timezone behaviour is not fully evidenced, and the complete mapping from canonical stage to Candidate language has not been accepted as one contract.

#### Required work

1. Define one public timeline mapping for the existing canonical stages and Candidate events:
   - submitted;
   - viewed;
   - under review/shortlisted;
   - interview;
   - offered;
   - hired/offer accepted;
   - offer declined;
   - rejected;
   - waitlisted;
   - withdrawn;
   - safe technical/file-processing updates where Candidate action is required.
2. Keep durable `ApplicationPublicUpdate` and candidate-visible stage events as sources. Notifications, unread state, score records, UI timers, and current list position MUST NOT infer timeline events.
3. Use stable event kind/stage/outcome codes in the transport contract. Resolve EN/VI labels and descriptions through the existing application locale copy. User-authored content must remain unchanged and must not be machine-translated.
4. Preserve deterministic ordering by effective timestamp plus a stable unique tie-breaker. Deduplicate a public update and its referenced stage event so one logical transition appears once.
5. Ensure recruiter-private notes, internal rejection detail, scoring evidence, actor identity, report information, and hidden stage events never enter the Candidate projection.
6. Format stored instants consistently using the active workspace locale and the existing timezone boundary. The same event must represent the same instant in EN and VI even when the displayed format differs.
7. Provide text labels and semantic icons for every state. Color may reinforce meaning but must never be the only cue.
8. Use an ordered list and programmatic timestamps. Announce only meaningful new/current status; do not make the whole historical timeline a noisy live region.
9. Preserve bounded responses. Do not add timeline pagination unless current data or a failing bound proves the existing maximum cannot meet Phase 3 acceptance.
10. Keep application intake/file-processing status separate from human recruitment decisions while presenting both clearly to the Candidate.

#### Acceptance criteria

- Every supported canonical stage maps to one deterministic Candidate-visible stage, title, description, and non-color cue in EN and VI.
- One logical transition produces one visible timeline entry, including replayed or concurrently delivered updates.
- Timeline order is deterministic when timestamps match.
- Candidate history remains available when the job is closed or removed.
- No timeline item is derived from notification delivery or score state.
- Private/recruiter-only events and details are absent from the API and rendered UI.
- Locale/timezone tests prove the same stored instant displays correctly in EN and VI.
- Keyboard, focus, screen-reader, light/dark, reduced-motion, and 320 px checks pass.

#### Minimum evidence

- Table-driven mapping tests for every canonical stage/outcome.
- Repository/service tests for source-event deduplication, equal timestamps, replay, withdrawal, and private-event suppression.
- Contract tests proving stable codes and safe fields.
- Component/axe tests for all timeline groups and empty/error states.
- Browser coverage for submitted → viewed → review → interview → decision, refresh, and removed-job history.

### Slice 4 — CF-304: Candidate application pagination, filters, and URL state

#### Problem

The ordinary Candidate application list has an initial cursor implementation, but it filters only loaded rows in the browser and does not expose complete pagination metadata or URL state. Candidate Team Applications still stop at 100 rows. These behaviours do not prove that every application remains reachable.

#### Required work

1. Define a small Candidate pagination contract that can be applied to both lists without merging their domain models. It must include:
   - a bounded collection (`applications` or `items`, preserving the current name unless a versioned change is justified);
   - `nextCursor`;
   - `hasMore`;
   - `total` when the measured count is accepted;
   - the normalized active filter and sort where response echo is useful.
2. Do not rename `applications` to `items` only for aesthetic consistency. Avoid permanent duplicate aliases. Choose one bounded migration path if a shared envelope change is truly required.
3. Use an opaque, versioned keyset cursor bound to the active list type, Candidate, filter, sort, and stable sort tuple. Invalid, foreign-context, or mismatched cursors must fail safely and direct the UI to restart from the first page.
4. Choose a stable default traversal order. Prefer immutable `submittedAt DESC, id DESC` for complete history unless evidence establishes another immutable key. If `lastUpdatedAt` sorting remains available, define and test how stage changes between pages affect traversal.
5. Move ordinary Job Application status filter and sort to the server. The browser must not present counts or filtered results as complete when only one page is loaded.
6. Put filter, sort, and cursor/page state in the URL. Refresh, direct link, Back, and Forward must reconstruct the same query and visible selection.
7. Keep ordinary Job Applications and Team Applications on their existing separate Candidate pages and labels.
8. Replace Candidate Team Applications `take: 100` with bounded keyset pagination and safe status/role filters that match Feature 028 terminology.
9. Preserve current Candidate ownership in every query. The request must never accept a Candidate identity from the client.
10. Handle insertion between page requests without duplicating or skipping records across the tested cursor boundary. Deduplication in the client may be defensive but MUST NOT hide an unstable server contract.
11. Provide consistent loading, load-more, empty, no-filter-match, invalid-cursor recovery, request-error, retry, and permission states. A failed next-page request must retain already loaded records.
12. Use compact existing empty-state and pagination patterns. Reuse `--sh-*` tokens and existing controls; do not add infinite-scroll infrastructure unless explicitly requested.
13. Test with 0, 1, 24/25, 100/101, and 1,000 records, including equal timestamps and a concurrent insertion at the cursor boundary.
14. Measure the list query and count query on the 1,000-record fixture. Add an index only if the plan proves a query problem; record the before/after plan.

#### Acceptance criteria

- Every ordinary Job Application and Candidate Team Application in the 101- and 1,000-record fixtures has a reachable path.
- Traversing pages under the agreed insertion scenario produces no duplicate or omitted application IDs.
- Server-side status filters and sorts return complete, correct result sets rather than filtering only loaded rows.
- `nextCursor` and `hasMore` are consistent. Any displayed total is authoritative for the active filter.
- Refresh, direct link, Back, and Forward preserve filter/sort/list state through the URL.
- Invalid or mismatched cursors reveal no data and provide a safe restart path.
- A failed load-more request retains the current list and selection and supports retry.
- Candidate ownership isolation passes for first and subsequent pages.
- EN/VI, 320/375/768/1280 px, light/dark, keyboard, focus, axe, and reduced-motion checks pass.

#### Minimum evidence

- Cursor encode/decode/binding unit tests with fixed fixtures.
- Ordinary and Team Candidate list contract tests.
- Isolated PostgreSQL integration tests for filters, sorts, equal keys, page boundaries, 101/1,000 rows, concurrent insertion, invalid cursor, and cross-account isolation.
- Component tests for URL synchronization, reload, Back/Forward, load failure, retry, and accurate counts.
- Desktop/mobile browser tests for full multi-page traversal and deep-linked filters.
- Measured query plans and timings for 1,000 records, with no index change unless justified.

### Slice 5 — CF-305: Owner Team Applications pagination and explicit company scope

#### Problem

Owner Team Applications remain capped at 100 records. The existing authorization correctly requires company ownership, but the paginated list must preserve explicit tenant scope, prioritize actionable records, and remain stable when a decision or page request changes state.

#### Required work

1. Apply the proven CF-304 pagination metadata and cursor rules to Owner Team Applications. Reuse the small primitives; do not create an Owner-only pagination engine.
2. Keep the API and repository query scoped by the company ID authorized from the current session. Do not accept an Owner ID or trust a company ID before authorization.
3. When an Owner has more than one eligible company, require an explicit valid `companyId`. Do not select the first company implicitly and do not use stale browser storage as authorization.
4. Preserve company scope in list, detail, CV access, accept, reject, invitation status, pagination, filters, direct links, refresh, and Back/Forward navigation.
5. Support bounded server-side filters for current Team Application status and applied role. Use existing Feature 028 role/status values and copy.
6. Make pending/actionable applications easy to reach. If the default order prioritizes `SUBMITTED`/`VIEWED`, define a deterministic status rank plus stable tie-breakers and bind them into the cursor.
7. Define list reconciliation after a decision:
   - a successful accept/reject updates or removes the item according to the active filter;
   - a failed decision retains the item and selection;
   - a stale version reports conflict and reloads authoritative state without switching company;
   - invitation email retry does not create another invitation.
8. A failed next-page request must not clear the selected application, loaded rows, current company, or filter state.
9. Keep Owner list/detail projections free of CV contents and unnecessary Candidate data. CV bytes remain behind the existing Owner authorization and audit boundary.
10. Preserve the Feature 028 invariant: Team Applications have no scoring, AI recommendation, ordinary Job Application pipeline, automatic invitation, or automatic membership.
11. Test one, two, and three-company Owners; inactive/removed membership; cross-company IDs/cursors; unknown applications; and company status changes.
12. Test 0, 1, 100/101, and 1,000 Team Applications with pending, viewed, rejected, invitation-sent, joined, and withdrawn states.
13. Refine the current screen only as needed for pagination/filter/status clarity. Reuse PageHeader, compact empty/error states, existing modal/drawer decisions, `--sh-*` tokens, and locale copy.

#### Acceptance criteria

- An authorized Owner can reach every Team Application in 101- and 1,000-record company fixtures.
- No first-page cap silently hides older or pending applications.
- One-, two-, and three-company Owner journeys retain the explicitly selected company through pagination, detail, decision, refresh, and Back/Forward.
- Missing, invalid, or cross-company scope fails closed without leaking Candidate identity, email, CV metadata, application counts, or status.
- Pending/actionable ordering and filters are deterministic and have stable cursor evidence.
- Load or decision failure retains list state and the current selection.
- Accept/reject and invitation retry semantics remain idempotent and human-controlled.
- Owner UI passes EN/VI, light/dark, keyboard, focus restoration, axe, reduced motion, and 320/375/768/1280 px checks.

#### Minimum evidence

- Owner query/contract tests for pagination, filters, explicit company scope, and cursor binding.
- Isolated PostgreSQL integration tests for 101/1,000 rows, equal keys, insertion, status changes, stale decisions, and one/two/three-company authorization.
- Security tests for cross-company list/detail/CV/cursor access and neutral errors.
- Component tests for selection retention, load failure, retry, decision reconciliation, and URL state.
- Browser tests for multi-company scope, complete traversal, CV access, accept/reject, refresh, Back/Forward, and mobile layouts.
- Regression tests proving no scoring, automatic invitation, or automatic membership was added.

## 8. Expected impact area

This list guides CodeGraph review. It does not require every file to change.

### 8.1 Ordinary Job Application

- `web/src/app/api/candidate/applications/route.ts`
- `web/src/app/api/candidate/applications/[applicationId]/route.ts`
- Candidate document route(s) only if CF-302 proves they are absent.
- `web/src/app/jobs/applied/page.tsx`
- `web/src/app/jobs/applied/[applicationId]/page.tsx`
- `web/src/app/jobs/applied/[applicationId]/processing/page.tsx`
- `web/src/backend/candidate-applications/candidate-application-submission-service.ts`
- `web/src/backend/candidate-applications/candidate-application-tracking-service.ts`
- `web/src/backend/repositories/candidate-applications/prisma-candidate-application-repository.ts`
- `web/src/backend/services/jobs/job-application-service.ts`
- `web/src/backend/services/jobs/application-policy.ts`
- `web/src/backend/repositories/jobs/prisma-job-application-repository.ts`
- Existing CV safe-open, application document storage, retention, audit, and notification services only where a failing Phase 3 invariant requires a change.
- `web/src/shared/contracts/candidate-applications/index.ts`
- `web/src/frontend/features/candidate-applications/components/application-review-submit.tsx`
- `web/src/frontend/features/candidate-applications/components/application-processing.tsx`
- `web/src/frontend/features/candidate-applications/components/application-tracker.tsx`
- `web/src/frontend/features/candidate-applications/components/candidate-applications-list-page.tsx`
- `web/src/frontend/features/candidate-applications/i18n/application-copy.ts`
- Existing application workflow styles and shared `--sh-*` components.

### 8.2 Team Applications

- `web/src/app/api/candidate/team-applications/route.ts`
- `web/src/app/api/recruiter/company/team/applications/route.ts`
- `web/src/app/jobs/applied/team/page.tsx`
- `web/src/app/recruiter/company-settings/team/applications/page.tsx`
- `web/src/backend/repositories/company-members/prisma-team-application-repository.ts`
- `web/src/backend/services/company-members/team-application-service.ts`
- `web/src/backend/services/company-members/team-application-owner-service.ts`
- Existing Team Application authorization and CV services only when required by pagination/security evidence.
- `web/src/shared/contracts/company-members/team-applications.ts`
- `web/src/frontend/features/candidate-company/team-application-status.tsx`
- `web/src/frontend/features/recruiter-workspace/company-team-applications-screen.tsx`
- Existing Candidate Company and Recruiter Workspace EN/VI copy and styles.

### 8.3 Tests and evidence

- Existing tests under `web/tests/backend/{applications,unit,integration,contract}`.
- Existing tests under `web/tests/frontend/applications` and Candidate Company/Team Application suites.
- Existing architecture and security boundary suites.
- New or extended Phase 3 Playwright journeys under the existing Candidate-first or feature-owned directories.
- A small deterministic 101/1,000-record fixture/harness in the existing test-helper structure; do not add a permanent benchmark service.

## 9. Data, migration, and compatibility strategy

No database migration was expected at the start of Phase 3 because the baseline schema already contained application idempotency identity, submission binding digest, immutable snapshot JSON, application documents, public updates, stage events, notification work, and Team Application records. CF-301 subsequently exposed a concrete provider-boundary gap: `RecruitmentNotificationWork` had no runtime claim/handoff path into the existing `EmailOutbox` provider boundary. The smallest additive fix was migration `096_recruitment_notification_delivery`, adding the generic `RECRUITMENT_NOTIFICATION` email kind and a lease owner/expiry pair for atomic work claiming. It was applied only to isolated test databases in this task. Rollback/deployment note: do not enable the new worker against an environment that has not applied 096; stopping the worker leaves existing work durable, while removal of the additive enum/columns requires a separately planned future migration rather than an unsafe enum rollback.

Before adding any migration, the active task MUST:

1. demonstrate the missing invariant or unacceptable query plan on an isolated database;
2. prove that an existing column/index/constraint cannot satisfy it safely;
3. propose the smallest additive schema change;
4. include forward compatibility, rollback, legacy-row behaviour, and deployment ordering;
5. run clean migration, upgraded migration, drift, and rollback-precondition checks;
6. avoid editing migrations that have already been applied.

Potential indexes for pagination MUST be justified by `EXPLAIN (ANALYZE, BUFFERS)` or the repository's approved equivalent on representative filtered 1,000-record data. Do not add an index solely because a query contains `ORDER BY`.

The shared `smarthire` database was historically recorded at migration 093; the current read-only check verified its latest applied migration is `095_company_deletion_manifest`, with 096 not applied there. The current source includes migrations 094, 095, and 096. Phase 3 tests MUST use an isolated database migrated through the active source sequence. The plan grants no permission to migrate `smarthire`.

Legacy application rows may have incomplete snapshot/document evidence. Reads must fail safely or use an explicitly documented minimal fallback. Phase 3 MUST NOT bulk-backfill, delete, or reinterpret legacy records without a separate migration/data-repair plan and rollback.

## 10. Test strategy and required matrices

### 10.1 Submission/replay matrix

| Scenario | Required result |
| --- | --- |
| First valid submit | One application, snapshots, receipt, public update, audit, and durable notification work |
| Exact retry before response loss | Same application and equivalent receipt; no duplicate side effects |
| Exact retry after draft consumption | Same application and receipt without requiring the deleted draft |
| Same key, changed command | Deterministic conflict; no new side effect |
| Two requests, same key | One commit; both converge to the same outcome |
| Two requests, different keys, same Candidate/job | One active application; duplicate is prevented |
| Failure before transaction commit | No visible partial application |
| Receipt projection/response lost after commit | Retry recovers the committed receipt |
| Notification provider unavailable | Application remains committed; durable work remains retryable |
| Foreign Candidate/application ID | Content-free unavailable result |

### 10.2 Snapshot/document matrix

| Scenario | Required result |
| --- | --- |
| Live Profile/CV changes after submit | Submitted evidence remains unchanged |
| Live job edited/closed/removed | Submitted job snapshot remains readable; live availability is shown separately |
| Exact CLEAN CV evidence | Authorized Candidate can open/download exact bytes |
| Missing/stale/mismatched evidence | Fail closed; no bytes |
| Expired/deleted document | Explicit unavailable state; no broken link |
| Active hold | Candidate-safe held/unavailable state without hold details |
| Storage failure | Retryable neutral error; no locator leakage |
| Cross-account/unknown ID | Same content-free response |

### 10.3 Pagination matrix

Run each applicable Candidate and Owner list with:

- 0, 1, page-size minus one, page-size, and page-size plus one records;
- 100, 101, and 1,000 records;
- equal primary sort timestamps and deterministic ID tie-breakers;
- active filter combinations and each supported sort;
- insertion immediately before/at/after a cursor boundary;
- invalid, expired/version-mismatched, filter-mismatched, and cross-scope cursors;
- request failure followed by retry;
- refresh, deep link, Back, and Forward;
- Owner with one, two, and three eligible companies.

For every traversal, collect all returned IDs and assert reachability, uniqueness, correct order, correct filter membership, and tenant ownership.

### 10.4 UI/accessibility matrix

For every affected Candidate and Owner state, verify:

- EN and VI locale copy from existing boundaries;
- light and dark themes using existing `--sh-*` semantic tokens;
- 320, 375, 768, and 1280 CSS-pixel viewports;
- 200% zoom where supported by the existing browser harness;
- keyboard-only operation, logical focus order, focus restoration, and visible focus;
- semantic headings, ordered timeline, labels/names/roles/values, and polite status announcements;
- non-color status cues and sufficient contrast;
- reduced-motion behaviour;
- long company/job/CV names and long localized labels;
- loading, empty, no-match, error, retry, unavailable document, invalid cursor, permission, and success states.

### 10.5 Regression scope

At minimum, rerun:

- Candidate-first focused suite;
- affected Applications suites;
- affected Job Board application tests;
- Feature 028 Candidate/Owner Team Application suites;
- CV safe-open and application-retention tests touched by CF-302;
- authorization/security boundary tests;
- typecheck, affected lint, formatting/whitespace checks, schema validation, and migration sequence checks when applicable.

A broad failing suite must be classified per assertion as in-scope regression, proven pre-existing baseline, environment limitation, or unresolved blocker. Existing failures are not automatically acceptable merely because they predate Phase 3.

## 11. Gate after each slice

Each slice MUST satisfy all applicable checks before the next slice begins:

1. Current behaviour/root cause and CodeGraph impact are recorded.
2. The implementation changes only the active CF work item and necessary shared contracts.
3. Focused unit, contract, component, and security tests pass with zero in-scope failures and no new skips.
4. Data-writing integration tests use a verified isolated database migrated through the current sequence (096 for this Phase 3 baseline).
5. Concurrency/fault tests prove the relevant replay, transaction, cursor, or decision invariant.
6. Affected browser journey and accessibility states have executed evidence; source inspection alone is not a browser PASS.
7. Typecheck, affected lint, `git diff --check`, schema validation, and migration checks pass as applicable.
8. Diff review finds no PII/locator leakage, tenant-scope regression, score-driven decision, hidden data cap, client-authorized state, test weakening, or unrelated refactor.
9. Exact PASS/FAIL/SKIP totals, environment limitations, and cleanup are recorded.
10. Temporary databases, rows, storage objects, app/worker processes, mail captures, logs, and Playwright artifacts created by the slice are removed without touching user-owned resources.

## 12. Phase 3 Definition of Done

Phase 3 may be marked `DONE` only when:

- CF-301 and CF-302 are individually `VERIFIED`; CF-303 through CF-305 remain `PLANNED`.
- Exact retry, changed-command key reuse, same-key concurrency, different-key duplicate submission, transaction failure, response loss, and provider failure have passing evidence.
- Every new ordinary Job Application stores and displays coherent versioned profile/contact/CV/job/answer/cover-letter/consent snapshots.
- Candidate-owned document access passes ownership, safe-open, retention, expiry/deletion, and content-free denial tests.
- Candidate timeline is durable, complete for supported stages, deterministic, localized, timezone-correct, non-color-dependent, and free of private/scoring-derived events.
- Ordinary Candidate Applications and Candidate Team Applications have stable server pagination, server filters/sorts, URL state, `nextCursor`, `hasMore`, and an evidence-backed total decision.
- Owner Team Applications use the proven pagination contract with explicit company scope and no first-100 cap.
- 101- and 1,000-record traversal proves every record is reachable without duplicates or omissions under the agreed insertion scenarios.
- Candidate and Owner flows pass refresh, direct link, Back/Forward, request-failure retry, and state-retention checks.
- EN/VI, light/dark, keyboard, focus, screen reader/axe, reduced motion, 200% zoom where supported, and 320/375/768/1280 px evidence is green for affected screens.
- Scores remain advisory and do not reorder, hide, or change application state in Phase 3.
- Team Applications remain separate from ordinary applications and do not gain scoring, pipeline, automatic invitation, or automatic membership behaviour.
- Candidate-first, affected Applications, affected Job Board, Feature 028, safe-open/retention, static, schema, and migration gates contain no new in-scope regression.
- All temporary resources are cleaned, the main user-owned stack remains running, and the shared `smarthire` database remains unmodified.

An environment or unrelated baseline limitation may be reported separately only when evidence proves it does not prevent a Phase 3 acceptance criterion. `UNVERIFIED` must never be converted to `PASS`.

## 13. Status and reporting model

Each CF work item must have exactly one current status:

- `PLANNED`: no implementation has started.
- `IMPLEMENTED`: source changed, but acceptance evidence is incomplete.
- `VERIFIED`: every acceptance criterion has executed evidence.
- `PARTIAL`: some criteria passed and explicitly listed work remains.
- `BLOCKED`: a precise blocker remains after reasonable safe approaches were attempted.

Lint, typecheck, static inspection, or a focused green suite alone is insufficient for `VERIFIED`.

The report for each slice must contain:

1. Root cause addressed.
2. Behaviour before and after.
3. Important files changed.
4. Acceptance criteria classified `PASS`, `FAIL`, or `UNVERIFIED`.
5. Exact test commands and PASS/FAIL/SKIP totals.
6. Authorization, privacy, transaction, concurrency, idempotency, retention, pagination, and accessibility evidence as applicable.
7. Existing failures encountered and their evidence-based classification.
8. Remaining unverified work or exact blocker.
9. Temporary resources created and cleanup result.
10. Exact next work item; do not stop at a checkpoint while in-scope work remains and the environment is usable.

## 14. Time estimate

The estimate represents active agent time for source review, implementation, regression diagnosis, isolated-database tests, fault/concurrency runs, browser/accessibility execution, 101/1,000-record evidence, review, and cleanup. It excludes waiting for user authorization, unavailable external services, CI queue time, and production deployment.

| Work item | Expected time | Reasonable maximum |
| --- | ---: | ---: |
| Establish Phase 3 baseline, contracts, and affected tests | 2–4 hours | 6 hours |
| CF-301 | 4–7 hours | 11 hours |
| CF-302 | 5–8 hours | 12 hours |
| CF-303 | 3–5 hours | 8 hours |
| CF-304 | 6–10 hours | 14 hours |
| CF-305 | 5–8 hours | 12 hours |
| Integrated Phase 3 gate, Luna Max self-review, evidence, and cleanup | 5–8 hours | 10 hours |
| **Total** | **30–50 hours** | **approximately 60 hours** |

The most likely total is **34–42 active hours** when the implementation changes only verified gaps and no migration is required. The approximate **60-hour maximum** allows for difficult submission races, document-storage fault reproduction, pagination query tuning, and repeated browser matrices. If Phase 3 exceeds 60 active hours without closing the gate, stop iterative patching and report the unresolved root cause, evidence, and smallest next decision.

The work should be assigned one CF item at a time. Each task must end with a reviewable diff, focused evidence, a risk-focused Luna Max self-review, and cleanup. An independent reviewer is optional and may be used only when explicitly requested by the user.

## 15. Initial risk register

| Risk | Candidate/Owner impact | Required control |
| --- | --- | --- |
| Same idempotency key accepts a changed command | Wrong receipt or hidden Candidate intent | Binding-conflict test before replay shortcut; one digest authority |
| Response lost after commit | Candidate retries and creates/confuses submissions | GET-backed receipt recovery and exact replay |
| Notification provider failure is treated as submission failure | Candidate resubmits a valid application | Durable notification work outside provider delivery; truthful response |
| Tracker reads mutable live job/profile data | Historical evidence changes after submission | Snapshot-first projection with explicit live availability only |
| Candidate document route leaks storage details or foreign bytes | PII/CV exposure | Session-derived ownership, safe-open, neutral denial, no locator projection |
| Cursor uses a mutable or incomplete sort key | Repeated or missing applications | Stable compound keyset cursor and insertion/state-change tests |
| Browser filters only the loaded page | False empty/count and hidden records | Server filtering/count; URL as source of truth |
| Owner company scope is implicit or stale | Cross-tenant data exposure | Explicit authorized `companyId` on every Owner path |
| Pending priority changes cursor position | Owner misses actionable records | Deterministic rank/tie-breaker and reconciliation tests |
| UI refactor expands beyond Phase 3 | Regression and wasted effort | Refine-only design scope; reuse components/tokens/copy |
| Test data reaches `smarthire` | Shared-data mutation | Test-name database guard, isolated migrations, namespace cleanup |

## 16. Evidence log template

This evidence log is populated from the execution history below. Current reruns are labelled separately from prior evidence, and no PASS claim is made without an executed check.

### CF-301 — `VERIFIED`

- Evidence provenance: the CF-301 commands and totals in this section are historical evidence from the preceding CF-301 task, not reruns in the current CF-302 task; they remain here for traceability only.

- Root cause: `CandidateApplicationSubmissionService` previously returned a receipt solely from `(candidateUserId, idempotencyKey)` before the draft was loaded. It bypassed the repository's authoritative `submissionBindingDigest` comparison after a successful transaction consumed the draft. A concurrent `Serializable` submit could also surface PostgreSQL/Prisma `P2034` rather than converge. The first delivery-boundary implementation then compared the Company work target (`companyId`) directly with the outbox recipient (`member userId`), so every valid Company notification was rejected; its negative test passed for the wrong reason. Migration evidence also stopped at SQL/comment inspection and did not exercise the rollback precondition after a new-kind outbox row existed.
- Behaviour change: the existing repository digest now includes normalized Candidate, Job, and draft-revision context. The immutable submitted job snapshot retains only the normalized replay metadata needed to compare a consumed-draft retry; a mismatched revision or contact-sharing choice returns `409 APPLICATION_IDEMPOTENCY_KEY_REUSED` without a receipt or new side effect. The existing submission transaction retries only bounded `P2034` conflicts; provider/post-commit work is outside that retry callback. Recruitment notification work now has an atomic lease/claim boundary and hands off idempotently to the existing `EmailOutbox` provider boundary; provider delivery remains outside the application commit. Immediately before every provider attempt, Candidate delivery binds application Candidate = work target = outbox user, while Company delivery binds application company = work target and independently authorizes the outbox member; account state and current email preferences are reloaded. Revoked or exhausted work is terminated with a safe error instead of being sent.
- Legacy-row policy: a pre-CF-301 application without `jobSnapshot.submissionBinding` is `LEGACY_UNVERIFIABLE` and fails closed with the same safe `409`; the service never fabricates an exact replay or reopens a consumed draft.
- Acceptance evidence:
  - PASS — one successful submission creates one `APPLIED` application with versioned snapshots, the initial public update/stage event, audit success, in-app notification, and one durable `RecruitmentNotificationWork` row; an exact repository retry returns the same application and does not duplicate those effects.
  - PASS — exact consumed-draft replay returns the same safe receipt; changed revision/contact binding, changed repository digest, and legacy/unverifiable rows return a deterministic conflict without loading the draft, receipt, or creating side effects.
  - PASS — same-key concurrency, different-key concurrency for one Candidate/job, duplicate-active-application handling, and foreign-Candidate raw-key isolation converge to one application without receipt crossover.
  - PASS — serializable `P2034` conflicts retry at most three times; non-`P2034` errors do not retry and retry exhaustion is surfaced. Transaction-boundary faults at application creation, stage-event append, notification-work enqueue, and audit append leave no partial application, snapshot, event, notification, audit, intake, or consumed-draft state.
  - PASS — deferred storage-promotion tests cover deterministic ledger staging, lost storage response preservation, at-most-once cleanup, and retryable cleanup failure. The committed application path keeps downstream notification work outside the transaction; post-commit projection failure does not misreport the committed application, and the durable work intent remains deduplicated/retryable.
  - PASS — provider delivery boundary: two concurrent notification processors claim one `RecruitmentNotificationWork`, create one idempotent `EmailOutbox`, and a restart claims no duplicate work. An authorized Candidate reaches the provider; an authorized Company member reaches the provider exactly once with the member email; a provider timeout leaves the committed application `APPLIED`, the notification work durably handed off, and the `EmailOutbox` retryable with a safe error code; retry sends the same outbox row once. Permission revocation after handoff, Company account disablement after handoff, and preference changes before retry are revalidated immediately before provider delivery and terminate the outbox without sending. Invalid or mismatched target data is terminally rejected without an email, and an expired lease at the five-attempt limit becomes `DEAD` without reclaim.
  - PASS — the canonical GET-backed processing/receipt route is authorized by the authenticated Candidate, returns content-free denial for foreign/missing resources, and preserves the same receipt through refresh, Back/Forward, and a second authenticated session.
- Tests and totals:
  - Baseline reproduction before the production fix: `D:\HCMUS\PROJECT\web> npx vitest run tests/backend/integration/email/recruitment-notification-work.test.ts --reporter=verbose --maxWorkers=1` with isolated `cf301_company_binding_test_20260910` — exit 1; 1 FAIL, 6 PASS, 0 SKIP. The active Company-member test reached the provider zero times, confirming the unconditional Company target/recipient comparison defect.
  - Current focused provider suite on isolated `cf301_company_binding_test_20260910`: the same Vitest command — exit 0; 1 file, 9 PASS, 0 FAIL, 0 SKIP. It covers authorized Candidate and Company delivery, exactly-once provider delivery, provider timeout/successful retry, concurrent claim/restart, membership revocation, Company account disablement, Candidate preference change, target mismatch, and expired-lease exhaustion.
  - Current CF-301 focused bundle from `D:\HCMUS\PROJECT\web` with `DATABASE_URL`/`DIRECT_URL` set to `cf301_company_binding_test_20260910`: `npx vitest run tests/backend/applications/candidate-application-submission-idempotency.test.ts tests/backend/contract/candidate-application-submission-route.contract.test.ts tests/backend/integration/jobs/job-application.test.ts tests/backend/unit/jobs/job-application-service-ownership.test.ts tests/backend/unit/jobs/prisma-job-application-repository-ownership.test.ts tests/backend/integration/email/recruitment-notification-work.test.ts tests/backend/unit/email/recruitment-notification-template.test.tsx tests/backend/unit/email/recruitment-notification-migration.test.ts --reporter=verbose --maxWorkers=1` — exit 0; 8 files, 38 PASS, 0 FAIL, 0 SKIP.
  - Current Candidate-first regression from `D:\HCMUS\PROJECT`: `npm run test:candidate-first --workspace @smarthire/web -- --reporter=verbose --maxWorkers=1` — exit 0; 16 files, 50 PASS, 0 FAIL, 0 SKIP.
  - Current static gates: `D:\HCMUS\PROJECT> npm run typecheck --workspace @smarthire/web` — exit 0; `D:\HCMUS\PROJECT\web> npx eslint --max-warnings=0 src/backend/email/workers/email-outbox.ts src/backend/email/workers/recruitment-notification-work.ts src/backend/repositories/notifications/recruitment-notification-work-repository.ts src/backend/email/templates/recruitment-notification.tsx scripts/verify-recruitment-notification-migration.mjs tests/backend/integration/email/recruitment-notification-work.test.ts tests/backend/unit/email/recruitment-notification-migration.test.ts tests/backend/unit/email/recruitment-notification-template.test.tsx` — exit 0; `D:\HCMUS\PROJECT> npm run db:validate --workspace @smarthire/web` — exit 0; `D:\HCMUS\PROJECT> npm run db:migrations:check --workspace @smarthire/web` — exit 0 with `migrationCount: 96`; `D:\HCMUS\PROJECT> git diff --check` — exit 0. All are PASS with no test skips.
  - Current migration/deployment/rollback evidence: fresh isolated `cf301_company_binding_test_20260910` ran `npx prisma migrate deploy` from `D:\HCMUS\PROJECT\web` and applied 001–096 — exit 0. Upgrade isolated `cf301_migration_upgrade_test_20260910` used harness `D:\HCMUS\PROJECT\web\.local\cf301-migration-upgrade-20260910`: 001–095 deploy — exit 0; pre-096 read-only check returned `095_company_deletion_manifest|0|0|0`; adding only 096 then `npx prisma migrate deploy --config ...\prisma.config.ts` — exit 0. `npm run recruitment-notification:migration:verify -- --assert-rollback-safe` on the upgraded DB — exit 0, confirming both migration records, enum, nullable lease columns, index, and zero active new-kind rows. The runtime integration creates `RecruitmentNotificationWork` with the pre-096 writer shape (lease fields remain null), materializes a `RECRUITMENT_NOTIFICATION` outbox row through the shared `EmailOutbox` boundary, and invokes the verifier: with that row active the verifier exits 1 and reports `rollback.ready=false`; after the row is terminal `SENT`, it exits 0 and reports `rollback.ready=true`. This is the executable rollback precondition; no claim is made that the pre-096 shared runtime can process active new-kind rows.
  - Upgrade-runtime evidence: `D:\HCMUS\PROJECT\web> npx vitest run tests/backend/integration/email/recruitment-notification-work.test.ts --reporter=verbose --maxWorkers=1` against `cf301_migration_upgrade_test_20260910` after 001–095→096 — exit 0; 1 file, 9 PASS, 0 FAIL, 0 SKIP. This proves the current single shared runtime processes already-materialized recruitment outbox rows after an upgrade and keeps the old writer shape compatible. No second queue or worker framework was introduced.
  - Previously captured browser evidence is not claimed as a current rerun: the final source changes in this task do not touch browser-visible routes or receipt behavior, so the requested browser rerun condition was not met. The existing 2/2 desktop/mobile browser result remains unchanged, while the current-turn functional and migration evidence above is new.
  - Database/runtime safety and cleanup: both current-turn databases (`cf301_company_binding_test_20260910`, `cf301_migration_upgrade_test_20260910`) were dropped; the company-binding storage, migration-upgrade storage, and migration harness under `web\.local` were removed after exact-path validation. The main Docker stack was not stopped. A read-only shared check remained `smarthire|095_company_deletion_manifest`; no 096 migration was applied to `smarthire`. Existing `.local` user resources, `.gitignore`, and unrelated dirty work were preserved.
- Remaining limitations: CF-301 has no remaining `UNVERIFIED` acceptance criterion after combining the prior unchanged browser proof with the current functional/migration evidence. Migration 096 must be deployed before enabling the recruitment-notification worker in a real environment; production/shared deployment was intentionally not performed. CF-301 through CF-305 are `VERIFIED`; the final integrated gate is `PASS`.

### CF-302 — `VERIFIED`

- Root cause: the Candidate tracker mixed immutable job snapshot fields with mutable live job fields, omitted the persisted profile/contact/consent evidence from its Candidate projection, and offered no Candidate-owned document-open route. The repository did not apply document-level ordinary-access/retention expiry to the document query and could fall back to legacy cover-letter text after the persisted text had been deleted.
- Behaviour change: the tracker now separates immutable `submission` evidence from the intentionally live public listing context. It projects only safe Candidate-owned fields from `profileSnapshot`, `contactSnapshot`, `consentVersion`, and `consentedAt`, plus submitted job, answers, message, exact CV version, and text/file/absent cover-letter state. Missing or incomplete legacy profile/contact/consent snapshots become explicit unavailable states without backfill. The Candidate-owned document route derives ownership from the authenticated session, reuses safe-open and retention checks, streams authorized bytes, and returns a neutral no-store 404 for unavailable or unauthorized access.
- Acceptance evidence:
  - PASS — the unit projection keeps submitted job/CV/answer/text values after mutable job/company/CV changes; the isolated integration test also changes the live Candidate profile and CV library and confirms the persisted `profileSnapshot`/`cvSnapshot` and Candidate projection remain unchanged.
  - PASS — live job title/location/status/removal is exercised in desktop and mobile browser smoke; the current listing becomes unavailable while the submitted snapshot remains visible. New applications render title, company, location, employment type, experience level, work arrangement, required skills and job version from the immutable snapshot.
  - PASS — the isolated integration matrix covers exact CLEAN CV bytes, uploaded cover-letter bytes, text cover letter, no cover letter, ordinary-access expiry, retention expiry, deleted evidence, active hold, stale assessment binding, missing storage, digest mismatch and length mismatch. The service unit covers unsupported preview, unsafe evidence, temporary storage failure, streaming and safe-reader disposal.
  - PASS — Candidate ownership is server-derived. Unknown/foreign application and document requests are content-free unavailable results; the route contract proves the same empty 404 for unauthenticated, invalid and unavailable requests and excludes storage metadata. Successful inline/download responses have bounded content length, correct disposition and no locator/checksum headers.
  - PASS — EN/VI component states cover submitted and not-provided evidence; the browser matrix covers production desktop Chromium, 320 px mobile, refresh, Back/Forward, second authenticated session, keyboard focus, dark mode, reduced motion, no horizontal overflow and axe serious/critical violations at zero.
  - PASS — the current isolated PostgreSQL integration asserts `profileSnapshot`, `contactSnapshot`, `consentVersion`, and `consentedAt` remain unchanged after live profile/account/contact-sharing/CV changes; legacy missing fields project as unavailable, and current contact sharing remains a separate mutable control.
  - PASS — the current production browser journey opens and downloads the available submitted CV, expires it through the isolated E2E control, reloads the tracker with both actions removed and a localized unavailable status, then proves the same empty no-store 404 for open and download without metadata leakage.
- Current reruns executed in this task (all commands run from the stated cwd):
  - Focused unit/contract/component/service/integration bundle from `D:\HCMUS\PROJECT\web`: `npx vitest run tests/backend/integration/applications/candidate-application-document.test.ts tests/backend/applications/open-application-document.test.ts tests/backend/unit/applications/candidate-application-tracking.test.ts tests/backend/contract/candidate-application-document-route.contract.test.ts tests/frontend/applications/application-processing.test.tsx tests/frontend/applications/application-tracker.test.tsx tests/shared/applications/candidate-application-workflow-contracts.test.ts --reporter=verbose --maxWorkers=1` — exit 0; 7 files, 47 PASS, 0 FAIL, 0 SKIP.
  - Candidate-first regression from `D:\HCMUS\PROJECT`: `npm run test:candidate-first --workspace @smarthire/web -- --reporter=verbose --maxWorkers=1` — exit 0; 16 files, 50 PASS, 0 FAIL, 0 SKIP.
  - Isolated database deployment from `D:\HCMUS\PROJECT\web`: `npm run db:deploy` with `DATABASE_URL` and `DIRECT_URL` forwarded only to `cf302_candidate_test_20260911` — exit 0; migrations 001–096 applied.
  - Production browser smoke from `D:\HCMUS\PROJECT\web`, with `NODE_ENV=production`, `PLAYWRIGHT_PRODUCTION=1`, and the one-off CV worker pointed only at `cf302_candidate_test_20260911`: `npx playwright test tests/system/e2e/candidate-first/candidate-first-smoke.spec.ts --project=desktop-chromium --reporter=line` — exit 0; 1 PASS, 0 FAIL, 0 SKIP; `npx playwright test tests/system/e2e/candidate-first/candidate-first-smoke.spec.ts --project=mobile-320 --reporter=line` — exit 0; 1 PASS, 0 FAIL, 0 SKIP.
  - Final production build from `D:\HCMUS\PROJECT\web`: `npm run build` — exit 0; TypeScript and 116 static pages completed. Only the two pre-existing dynamic-filesystem tracing warnings were emitted.
  - Final typecheck from `D:\HCMUS\PROJECT\web`: `npm run typecheck` — exit 0.
  - Focused ESLint from `D:\HCMUS\PROJECT\web`: `npx eslint --max-warnings=0 --no-error-on-unmatched-pattern` over the changed CF-302 source, contract, helper, component, and test files - exit 0.
  - Targeted Prettier from `D:\HCMUS\PROJECT\web`: `npx prettier --check` over the changed CF-302 source, contract, helper, component, and test files - exit 0; all matched files use the configured style.
  - Candidate document route gate from `D:\HCMUS\PROJECT\web`: `npx eslint --max-warnings=0 src/app/api/candidate/applications/[applicationId]/documents/[kind]/route.ts` and `npx prettier --check src/app/api/candidate/applications/[applicationId]/documents/[kind]/route.ts` - exit 0 for both.
  - Prisma/schema gates from `D:\HCMUS\PROJECT\web`: `npm run db:validate` — exit 0; `npm run db:migrations:check` — exit 0 with 96 migrations; `npx prisma migrate status` against `cf302_candidate_test_20260911` — exit 0, database up to date.
  - Repository whitespace check from `D:\HCMUS\PROJECT`: `git diff --check` — exit 0; only the pre-existing CSS LF/CRLF warning was emitted.
  - Shared `smarthire` migration status was read-only checked from `D:\HCMUS\PROJECT\web`: `npx prisma migrate status` — exit 1 because 096 remains pending on the shared database; no shared migration or data mutation was performed.
- Database/runtime safety for current reruns: all data-writing CF-302 integration/browser checks used only `cf302_candidate_test_20260911`, migrated through 096, then the exact database was dropped. The one-off CV worker and production browser server were task-owned; the main Compose stack remained running and healthy. The shared `smarthire` database was read-only checked and was not migrated.
- Cleanup for current reruns: the exact one-off CV worker, stale task-owned Next output lock, and generated `web/test-results/.last-run.json` were removed after ownership/PID checks. The isolated database was dropped and verified absent; no task env file was written and unrelated `.local` resources were preserved.
- Previous evidence (not rerun in this task and not counted in the current totals):
  - Focused CF-302 bundle from `D:\HCMUS\PROJECT\web`: `npx vitest run tests/backend/integration/applications/candidate-application-document.test.ts tests/backend/applications/open-application-document.test.ts tests/backend/unit/applications/candidate-application-tracking.test.ts tests/backend/contract/candidate-application-document-route.contract.test.ts tests/frontend/applications/application-processing.test.tsx tests/frontend/applications/application-tracker.test.tsx --reporter=verbose --maxWorkers=1` — exit 0; 6 files, 39 PASS, 0 FAIL, 0 SKIP.
  - Isolated document integration rerun from `D:\HCMUS\PROJECT\web`: `npx vitest run tests/backend/integration/applications/candidate-application-document.test.ts --reporter=verbose --maxWorkers=1` — exit 0; 1 file, 9 PASS, 0 FAIL, 0 SKIP.
  - Candidate-first rerun from `D:\HCMUS\PROJECT`: `npm run test:candidate-first --workspace @smarthire/web -- --reporter=verbose --maxWorkers=1` — exit 0; 16 files, 50 PASS, 0 FAIL, 0 SKIP.
  - Affected Applications rerun from `D:\HCMUS\PROJECT\web`: `npm run test:applications -- --reporter=verbose --maxWorkers=1` — exit 1; 35 files, 134 PASS, 8 baseline FAIL, 0 SKIP. The failures are limited to existing pipeline/architecture/privacy assertions (`application-boundaries`, guarded drag dialog, review checkbox count, pipeline columns, pipeline recovery constant, rejection-note privacy, consequential-stage copy and pipeline movement copy); CF-302 focused/application-tracker tests all pass.
  - Affected CV-import run from `D:\HCMUS\PROJECT\web`: `npm run test:cv-import -- --reporter=verbose --maxWorkers=1` — exit 1; 64 files, 400 PASS, 9 baseline/environment FAIL, 2 optional SKIP. Failures are the existing dependency/Docker/Scout and same-host Compose probes, `IMPORT_STATE_CONFLICT`, `CV_STAGE_RESULT_DISCARDED`, and serialization-conflict baseline; the relevant safe-open, retention, storage and ClamAV CLEAN/EICAR checks passed. The two skips are the existing opt-in/live environment probes.
  - Shared contract fixture from `D:\HCMUS\PROJECT\web`: `npx vitest run tests/shared/applications/candidate-application-workflow-contracts.test.ts --reporter=verbose --maxWorkers=1` — exit 0; 1 file, 3 PASS, 0 FAIL, 0 SKIP.
  - Browser smoke against production build and isolated DB `cf302_e2e_test_20260910` from `D:\HCMUS\PROJECT\web`: `npx playwright test tests/system/e2e/candidate-first/candidate-first-smoke.spec.ts --project=desktop-chromium --reporter=line` — exit 0, 1 PASS, 0 FAIL, 0 SKIP; the same command with `--project=mobile-320` — exit 0, 1 PASS, 0 FAIL, 0 SKIP.
  - Production build from `D:\HCMUS\PROJECT\web`: `npm run build` — exit 0. Only the pre-existing dynamic-filesystem tracing warnings for `job-catalogue-repository-factory.ts` and `business-evidence/filesystem.ts` were emitted.
  - Static and schema gates: `npm run typecheck` — exit 0; targeted `npx eslint --max-warnings=0 --no-error-on-unmatched-pattern ...` — exit 0; `npm run db:validate` — exit 0; `npm run db:migrations:check` — exit 0 with 96 migrations; `npx prisma migrate status` against `cf302_e2e_test_20260910` — exit 0, 96 migrations applied; `git diff --check` — exit 0. A non-gating Prettier check reported existing formatting warnings in 15 touched files and was not used as a completion claim.
- Previous database/runtime safety: all data-writing CF-302 integration/browser checks used the loopback isolated PostgreSQL database `cf302_e2e_test_20260910`, migrated through 096, with the task-owned bind-mounted CV storage and `cf302-e2e-cv-worker` using the existing ClamAV service. The shared `smarthire` database was read-only checked before and after cleanup; its latest migrations remained `095_company_deletion_manifest`, `094_experience_interval_evidence`, and `093_cv_hybrid_parse_contract`.
- Previous cleanup: stopped the exact task-owned production server tree (root PID 29908; port child PID 4252) after the browser runs and removed its stale `web/.local/next-output.lock`; removed `cf302-e2e-cv-worker`; dropped only `cf302_e2e_test_20260910`; removed `web/.local/cf302-e2e-20260910`, the task debug script, and the generated Playwright `.last-run.json`. The main Docker containers remain running/healthy; no task env file was written and unrelated `.local` resources, `.gitignore`, dirty work and the Phase 3 plan were preserved.
- Remaining limitations: CF-302 has no remaining `UNVERIFIED` acceptance criterion. The aggregate Applications and CV-import failures listed under Previous evidence remain bounded baseline/environment follow-up and are not CF-302 acceptance failures. CF-301 through CF-305 are `VERIFIED`; the final integrated gate is `PASS`.

### CF-303 — `VERIFIED`

- Root cause: the existing Candidate tracker did not yet provide one durable, source-safe timeline contract. It could mix public updates with mutable or private projections, had no stable event-code boundary for EN/VI copy, and lacked executable proof for source deduplication, equal timestamps, replay, withdrawal, and private-event suppression.
- Behaviour change: the tracker now consumes only durable `ApplicationPublicUpdate` and Candidate-visible stage events, exposes stable event kind/stage/outcome codes and safe timestamps, preserves user-authored messages byte-for-byte, deduplicates a public update against its referenced stage event and replay, sorts by effective timestamp plus stable ID, and bounds the result without adding timeline pagination. Private notes, rejection details, scoring/ranking, actors, reports, notifications, unread state, timers, list position, and mutable job availability are excluded. File-processing progress is rendered as technical progress, separate from recruitment decisions.
- Tests and totals: current focused bundle from `D:\HCMUS\PROJECT\web` — `npx vitest run tests/backend/unit/applications/application-list-cursor.test.ts tests/backend/unit/applications/candidate-application-tracking.test.ts tests/backend/contract/team-application-candidate.contract.test.ts tests/backend/contract/team-application-owner.contract.test.ts tests/shared/unit/company-team-applications.contracts.test.ts tests/frontend/applications/candidate-applications-list.test.tsx tests/frontend/applications/application-tracker.test.tsx tests/frontend/company-team-applications/team-application-status.test.tsx tests/frontend/company-team-applications/owner-review.test.tsx --reporter=verbose --maxWorkers=1` — exit 0; 9 files, 60 PASS, 0 FAIL, 0 SKIP. The table-driven timeline coverage includes submitted, viewed, shortlisted/under review, interview, offer, hired/accepted, offer declined, rejected, waitlisted, withdrawn, and file-processing updates, plus deduplication, replay, equal timestamp, withdrawal and private-event suppression.
- EN/VI/timezone/accessibility evidence: stable event codes resolve through existing frontend EN/VI copy; component tests prove locale and timezone represent the same stored instant, exact user text, semantic ordered list, programmatic `<time>`, empty/error states, keyboard focus, and zero serious/critical axe findings. The current production browser matrix covers the timeline journey on desktop Chromium and 320 px mobile, refresh, removed-job history, dark mode, reduced motion, focus, and no horizontal overflow.
- Browser evidence: from `D:\HCMUS\PROJECT\web`, `RUN_CANDIDATE_PHASE3_E2E=1 PLAYWRIGHT_APP_ONLY=1 PLAYWRIGHT_PRODUCTION=1 PLAYWRIGHT_REUSE_SERVER=1 node scripts/run-candidate-phase3-isolated.mjs npx playwright test tests/system/e2e/candidate-first/candidate-phase3.spec.ts --project=desktop-chromium --project=mobile-320 --reporter=line` — exit 0; 6 PASS, 0 FAIL, 0 SKIP. The timeline assertions cover submitted → viewed → review → interview → decision, refresh, job removal, unavailable live listing, and retained immutable submission evidence.
- Remaining limitations: none for the CF-303 acceptance criteria. The existing full CV-import smoke remains an environment limitation because the local worker cannot reach the configured ClamAV socket; CF-302's historical safe-open evidence is retained and the current Owner CV journey passed.
- Cleanup: the task-owned production server, exact Next output lock, Playwright fixture namespace, and isolated `candidate_phase3_test_20260911` database were removed after evidence. The shared `smarthire` database and main Compose stack were not mutated or stopped.

### CF-304 — `VERIFIED`

- Root cause: ordinary Candidate applications had incomplete server-side filter/sort and URL recovery semantics, while Candidate Team Applications still used the fixed `take: 100` cap. Cursor context was not a single shared, opaque contract bound to list type, Candidate, filters, sort, and the complete stable keyset tuple.
- Behaviour change: ordinary and Team Candidate lists now reuse versioned opaque keyset cursors bound to authenticated Candidate, list type, normalized filter/sort and `submittedAt DESC, id DESC` (or the complete normalized tuple). Responses retain existing field names and include bounded records, `nextCursor`, `hasMore`, and authoritative totals/counts. Invalid, malformed, foreign, and mismatched cursors fail safely and restart from page one without data leakage. Filter, sort, cursor and selection state are URL-backed; retry preserves loaded rows and selection; no infinite scroll or second pagination framework was added.
- Tests and totals: current isolated integration from `D:\HCMUS\PROJECT\web` — `node scripts/run-candidate-phase3-isolated.mjs vitest run tests/backend/integration/applications/candidate-phase3-pagination.test.ts --reporter=verbose --maxWorkers=1` — exit 0; 1 file, 8 PASS, 0 FAIL, 0 SKIP. Current focused component/contract bundle is the 9-file, 60 PASS bundle recorded under CF-303. Fixtures execute 0, 1, 24, 25, 100, 101 and 1,000 ordinary rows, equal timestamps, filtered counts, invalid/cross-account cursors, and concurrent insertion at the cursor boundary; the UI tests cover reload, Back/Forward, failed load-more, retry and selection retention.
- 101/1,000-record and cursor evidence: ordinary traversal reaches all 1,000 IDs exactly once with total 1,000; ordinary 101 reaches all 101 IDs; Candidate Team traversal reaches all 1,126 IDs exactly once; Owner traversal used by the shared contract reaches 1,000, 101 and 25 rows with no duplicates or omissions. Equal-timestamp insertion is returned once after the boundary cursor. The executed query-plan evidence was `CF304_QUERY_PLAN_EVIDENCE {"candidateList":{"nodeType":"Limit","actualRows":101,"actualTotalTimeMs":7.826},"candidateCount":{"nodeType":"Aggregate","actualRows":1,"actualTotalTimeMs":0.359},"ownerList":{"nodeType":"Limit","actualRows":101,"actualTotalTimeMs":3.626},"ownerCount":{"nodeType":"Aggregate","actualRows":1,"actualTotalTimeMs":0.465},"candidateRepositoryMs":15.75,"ownerRepositoryMs":12.71}`. No index was added because the measured plan/timings did not justify one.
- Remaining limitations: none for CF-304. The eight failures in the broader Applications aggregate are recorded as pre-existing recruiter pipeline/architecture/privacy baseline failures and do not exercise the CF-304 Candidate/Team pagination paths.
- Cleanup: the isolated PostgreSQL database used for traversal and plans was dropped; no shared database, migration, index, container, or user-owned server was changed.

### CF-305 — `VERIFIED`

- Root cause: Owner Team Applications had a fixed-size list and could implicitly select the first eligible company, allowing pagination/detail/action paths to lose explicit tenant scope. Failure/retry and decision reconciliation also needed to preserve company, filter, cursor and selection state.
- Behaviour change: Owner list, detail, CV, decision, invitation and pagination paths now authorize company scope from the current session and require an explicit valid `companyId` when multiple eligible companies exist. Missing, invalid, inactive, removed, foreign and cross-company contexts return neutral denials. The Owner list reuses CF-304 cursor primitives with company scope, status/role filters and deterministic ordering; safe list/detail projections exclude CV bytes and unnecessary Candidate data, while CV bytes remain behind the existing authorization/audit boundary. Accept/reject reconciles the active filter and authoritative state without switching company; invitation retry remains idempotent; failed paging/decisions retain loaded rows and selection. Feature 028 no-scoring, no-automatic-invitation and no-automatic-membership invariants remain intact.
- Tests and totals: the isolated 8-test integration file passed with Owner fixtures for one, two and three eligible companies, inactive/removed memberships, unknown applications, cross-company IDs/cursors, company status changes, 0/1/25/101/1,000 volumes, equal ordering keys, state changes, filters, decision and invitation side effects. Owner contract/repository/service and component tests are included in the current 9-file, 60 PASS focused bundle.
- Multi-company/security/browser evidence: the current production browser command recorded under CF-303 passed 6/6 across desktop Chromium and 320 px mobile. It proves explicit multi-company selection, bounded traversal, authorized CV response without storage metadata, accept/reject reconciliation, invitation success, refresh, direct URL, Back/Forward, failure/retry state, dark/reduced-motion/focus/axe checks, and mobile overflow protection. Integration assertions prove content-free cross-company list/detail/CV/cursor denials, no Candidate email/CV metadata in Candidate projections, no scoring/order side effects, no automatic invitation, and no automatic membership.
- Remaining limitations: none for CF-305 acceptance criteria. The broad Applications aggregate remains a bounded non-Phase-3 baseline failure and is not reclassified as an Owner Team Applications failure.
- Cleanup: the task-owned production server and lock were stopped/removed by exact ownership, the browser fixture namespace was deleted by its control, the isolated database was dropped, and no task-owned worker/container or env file remains.

### Final integrated gate — `PASS`

- Acceptance criteria PASS/FAIL/UNVERIFIED: `PASS` for Candidate timeline and immutable submitted evidence (current CF-303 browser plus historical CF-302 safe-open/snapshot evidence); ordinary Candidate, Candidate Team and Owner Team bounded pagination; 101/1,000 traversal; cursor isolation and insertion; authorization/content-free denials; retry/state retention; EN/VI; desktop/mobile 320 px; light/dark; keyboard/focus; reduced motion; serious/critical axe findings; Feature 028 invariants; and migration/build/static gates. `FAIL (non-gating baseline)` remains for the unrelated Applications aggregate: `npm run test:applications -- --reporter=verbose --maxWorkers=1` from `D:\HCMUS\PROJECT\web` exited 1 with 35 files, 139 PASS, 8 FAIL, 0 SKIP; the eight known failures are recruiter pipeline/architecture/privacy assertions outside CF-303–CF-305 and were not weakened or hidden. `UNVERIFIED` is not assigned to any CF-303–CF-305 acceptance criterion.
- Candidate-first and affected-suite totals: `D:\HCMUS\PROJECT> npm run test:candidate-first --workspace @smarthire/web -- --reporter=verbose --maxWorkers=1` — exit 0; 16 files, 50 PASS, 0 FAIL, 0 SKIP. CF-303–CF-305 focused bundle — exit 0; 9 files, 60 PASS, 0 FAIL, 0 SKIP. Isolated pagination/security integration — exit 0; 1 file, 8 PASS, 0 FAIL, 0 SKIP. Historical CF-301/CF-302 evidence remains separately labelled and was reused only where the current source did not change that guarantee.
- Browser/accessibility matrix: from `D:\HCMUS\PROJECT\web`, the production browser command with `RUN_CANDIDATE_PHASE3_E2E=1`, `PLAYWRIGHT_APP_ONLY=1`, `PLAYWRIGHT_PRODUCTION=1`, `PLAYWRIGHT_REUSE_SERVER=1`, and `--project=desktop-chromium --project=mobile-320` exited 0 with 6 PASS, 0 FAIL, 0 SKIP in 2.7 minutes. The matrix covered timeline, removed-job history, ordinary/Team traversal and URL state, Owner company scope, CV, decisions, invitation idempotency, refresh, direct links, Back/Forward, keyboard/focus, dark mode, reduced motion, feature-scoped serious/critical axe zero, and no horizontal overflow.
- Migration/database status: current task DB creation/migration applied the complete 001–096 sequence; `node scripts/run-candidate-phase3-isolated.mjs npx prisma migrate status` from `D:\HCMUS\PROJECT\web` exited 0 with `candidate_phase3_test_20260911` up to date. Final `npm run db:validate` and `npm run db:migrations:check` exited 0; migration count 96, sequence check PASS. No index or new migration was introduced for CF-303–CF-305; migration 096 was pre-existing CF-301 work and only isolated databases were mutated.
- Static/build gates: final `D:\HCMUS\PROJECT\web> npm run build` exited 0 (Next/Turbopack compiled, TypeScript completed, 116 static pages); final `npx tsc --noEmit --pretty false` exited 0; affected-file ESLint exited 0 with `--max-warnings=0`; targeted Prettier check exited 0; `D:\HCMUS\PROJECT> git diff --check` exited 0. Build emitted only the two known dynamic-filesystem tracing warnings.
- Luna Max self-review verdict: `PASS` — session-derived Candidate/company authorization is preserved on every list/detail/CV/decision/cursor/filter path; projections suppress private events and PII; cursors are opaque/context-bound; traversal and equal-key insertion have no duplicates/omissions; totals are authoritative where measured; failed UI operations retain state; invitation/decision retries are bounded/idempotent; assertions were not weakened; no speculative index, infinite scroll, realtime infrastructure, second pagination engine, scoring, automatic invitation or automatic membership was added.
- Temporary-resource cleanup: exact task-owned `candidate_phase3_test_20260911` was dropped; production server/child and `.local/next-output.lock` were stopped/removed after ownership validation; browser fixture cleanup completed; port 3001 is free; no worker/container, task env file, storage namespace, Playwright artifact or secret was retained. Main Compose services were not recreated or stopped.
- Final Phase 3 decision: `DONE`. No commit, push, deploy, reset, clean, shared `smarthire` migration, or shared-database mutation occurred. The unrelated aggregate Applications baseline and local ClamAV worker/socket limitation remain explicitly recorded follow-ups, not hidden as Phase 3 PASS evidence.

## 17. Out of scope

Do not use Phase 3 to implement Home/discovery caching, scoring explanations, realtime infrastructure, general recruiter pipeline changes, product-wide pagination abstractions, broad architecture cleanup, account-wide deletion, rebranding, or production operations. Adjacent defects should be fixed only when they block a Phase 3 acceptance criterion, were caused by Phase 3, or are P0/P1 data-loss, authorization, PII, or consistency issues. Otherwise, record a bounded follow-up with evidence.

## 18. Recommended execution order

1. **CF-301 first:** it establishes the authoritative application and receipt that every later view consumes.
2. **CF-302 second:** it makes the committed snapshots/documents safely inspectable before timeline and list presentation are finalized.
3. **CF-303 third:** it stabilizes the Candidate-facing status/event contract used by detail and list summaries.
4. **CF-304 fourth:** it applies the stable Candidate contracts to complete ordinary and Team Application history at scale.
5. **CF-305 last:** it reuses the proven pagination primitives for Owner Team Applications while preserving explicit tenant scope.
6. **Integrated gate:** run the full Candidate journey, Team Application Candidate/Owner journey, 101/1,000-record traversal, security, accessibility, regression, Luna Max self-review, and cleanup before changing the Phase 3 status. Use an independent reviewer only if the user explicitly requests one.

This order minimizes rework: submission defines the immutable record, snapshot/timeline define what a list item means, Candidate pagination proves the shared paging behaviour, and Owner pagination reuses it without inventing a second contract.

## 19. Historical remediation rerun (superseded) - 2026-09-12

This section records the interrupted 2026-09-12 remediation attempt. It is retained for traceability only and is superseded by the complete 2026-09-13 rerun below; its `UNVERIFIED` entries are not the current Phase 3 verdict.

### Root causes and implemented contract

- All three list experiences now use a bounded page-navigation contract. The URL parameters are authoritative; `cursor` is the exclusive boundary before the requested page, and a successful Next-page action replaces the loaded page and pushes the resulting cursor into the URL. Refresh, direct links, Back, and Forward request that exact bounded page instead of implicitly replaying an unbounded append history.
- Filter, sort, candidate/company scope, and Owner selection reset or preserve the cursor as one URL state. Invalid, foreign, version-mismatched, or context-mismatched cursors fail closed and restart at the safe first page. Failed paging retains the loaded rows and selection and exposes retry. Decision success refreshes the active filter without changing company scope.
- Owner `pendingCount` is now an authoritative server-side actionable count bound to the authorized company and active role/status filter. It is no longer derived from rows currently loaded in the browser.
- Candidate and Owner cursor integration evidence documents the bounded insertion contract: rows at and after an issued boundary remain reachable exactly once with deterministic ID tie-breaking; a row inserted strictly before the already-issued exclusive boundary is outside the bounded snapshot guarantee and requires a fresh first-page navigation.

### Historical executable evidence at that checkpoint

- Focused Phase 3 bundle: exit 0; 9 files, 69 PASS, 0 FAIL, 0 SKIP. This includes cursor context binding, CF-303 timeline mapping/privacy/deduplication/equal-time ordering, Candidate ordinary/Team and Owner contracts/components, URL refresh/direct/Back/Forward, failed-page retry, selection retention, multi-company scope, truthful Owner counts, and safe cursor restart.
- Candidate-first regression: exit 0; 16 files, 50 PASS, 0 FAIL, 0 SKIP.
- Production build: exit 0; Next/Turbopack compilation, TypeScript, and 116/116 static pages completed. Only the two known dynamic filesystem tracing warnings were emitted.
- Typecheck: exit 0. Affected-file ESLint with `--max-warnings=0`: exit 0. Targeted Prettier: exit 0. Prisma schema validation: exit 0. Migration sequence check: exit 0 with 96 migrations, `001_identity_foundation` through `096_recruitment_notification_delivery`. `git diff --check`: exit 0.
- Broader Applications suite: exit 1 with 35 files, 141 PASS, 8 FAIL, 0 SKIP. The eight failures remain the known recruiter pipeline/architecture/privacy baseline and are outside the affected Candidate-first Phase 3 paths; no assertion was weakened.

### Historical acceptance classification at that checkpoint

| Work item / evidence | Historical status at 2026-09-12 | Reason |
| --- | --- | --- |
| CF-301 | UNVERIFIED for a current rerun; historical VERIFIED retained | Current isolated PostgreSQL/browser rerun was unavailable; no regression was found in the affected source/focused checks. |
| CF-302 | UNVERIFIED for a current rerun; historical VERIFIED retained | Historical immutable snapshot and safe-open evidence is retained, but the required current DB/browser rerun was unavailable. |
| CF-303 source and focused contract | PASS | Current focused evidence covers durable public/stage projection, stable event codes, privacy exclusion, deduplication, deterministic equal-time ordering, and closed-job timeline behavior. |
| CF-304 URL contract and component behavior | PASS | Current focused tests cover ordinary Candidate and Candidate Team bounded URL navigation, refresh, Back/Forward, invalid cursor restart, failed paging, retry, and state retention. |
| CF-305 URL/count/security component behavior | PASS | Current focused tests cover Owner bounded navigation, explicit company scope, selection retention, invalid cursor/selection restart, retry, and authoritative pending count. |
| Isolated PostgreSQL traversal/insertion/security/query-plan evidence | UNVERIFIED | `P1001: Can't reach database server at localhost:55432`; no PostgreSQL listener was available and the shared `smarthire` database was not touched. |
| Production desktop/mobile browser matrix and axe | UNVERIFIED | The production runner could not complete setup because the isolated DB dependency was unavailable; no browser test case was counted as a current PASS. |
| Full current integrated Phase 3 gate | UNVERIFIED | Mandatory current PostgreSQL and browser evidence remains unavailable. CF-304/CF-305 and the final gate must not be promoted to VERIFIED/PASS from focused tests alone. |

### Cleanup and safety

The task-owned production server process tree was stopped after ownership validation; the exact stale `web/.local/next-output.lock` was removed after confirming its PID was absent; port 3001 was free; no Playwright artifact, worker, container, task env file, or secret remained from that interrupted attempt. The isolated database was not created by the failed command and could not be dropped while PostgreSQL was offline. The main Compose stack and shared `smarthire` database were not stopped, recreated, migrated, or mutated.

## 20. Current complete remediation and closure - 2026-09-13

This is the authoritative current status. It supersedes the interrupted 2026-09-12 checkpoint while preserving that checkpoint above as historical evidence.

### Root causes fixed

- CF-303 duplicate `APPLICATION_SUBMITTED` output was traced through the durable stage/public projections and the browser fixture. The visible assertion now proves exactly one event with `:visible` and `toHaveCount(1)`; no `.first()` or weakened locator is used.
- CF-304 Back/Forward used one ownership model: the components use the native `window.history.pushState`/`replaceState` contract with Next history state, handle real `popstate`/`pageshow`, and rehydrate the exact server-rendered page when the URL already matches. Synthetic `PopStateEvent`, URL polling, and unconditional mount refetch were removed. Initial props restore the bounded page after reload; invalid cursors restart safely and stale requests cannot overwrite the active URL state.
- CF-305 keeps explicit authorized company scope across list, cursor, filter, selection, CV, decision, refresh, direct URL, Back, and Forward. The stale selected-for-request cursor race was closed, and Owner pending counts remain authoritative server-side counts.
- The Candidate accessibility overflow was a real count-pill sizing defect (`25 applications` constrained to a 40px badge), not a test-only exception. The badge now grows to its content while retaining the design tokens and responsive layout.

### Current executable evidence

- Focused Phase 3 bundle: exit 0; 9 files, **69 PASS, 0 FAIL, 0 SKIP**.
- Isolated PostgreSQL pagination/security integration: exit 0; 1 file, **10 PASS, 0 FAIL, 0 SKIP**. Current query-plan evidence: Candidate list `Limit`, 101 actual rows, 8.869 ms; Candidate count `Aggregate`, 0.604 ms; Owner list `Limit`, 101 actual rows, 3.609 ms; Owner pending count `Aggregate`, 0.157 ms. Repository timings were 13.22 ms (Candidate) and 8.43 ms (Owner).
- Candidate-first regression: exit 0; 16 files, **50 PASS, 0 FAIL, 0 SKIP**.
- Production build after the final formatting-only test change: exit 0; TypeScript completed and **116/116** static pages generated. Only the two known dynamic filesystem tracing warnings were emitted (`job-catalogue-repository-factory.ts` and `business-evidence/filesystem.ts`).
- Typecheck: exit 0. Affected-file ESLint with `--max-warnings=0`: exit 0. Targeted Prettier check: exit 0 after formatting `candidate-first-accessibility.spec.ts`. Prisma validation: exit 0. Migration sequence check: exit 0 with 96 migrations (`001_identity_foundation` through `096_recruitment_notification_delivery`). `git diff --check`: exit 0.
- Broader Applications baseline: exit 1 with 35 files, **141 PASS, 8 FAIL, 0 SKIP**. The eight failures remain the previously identified recruiter pipeline/architecture/privacy assertions outside CF-303--CF-305; no assertion was weakened and none exercises the Phase 3 Candidate/Team/Owner pagination contract.

### Current browser and accessibility matrix

- Production browser command completed uninterrupted with the task-owned server and isolated `candidate_phase3_test_20260911` database: **12 PASS, 0 FAIL, 0 SKIP** in 2.6 minutes across `desktop-chromium` (1280px), `mobile-320` (320px), `mobile-375` (375px), and `tablet-768` (768px). It covers timeline/replay and removed-job history, ordinary and Team bounded traversal, refresh/direct URLs, real Back/Forward, explicit multi-company Owner scope, authorized CV safe-open, accept/reject reconciliation, retry/state retention, dark mode, reduced motion, keyboard focus, and overflow.
- Accessibility command completed on the same production build: **25/25 PASS**, 0 serious/critical axe violations, 0 horizontal-overflow cases, and visible keyboard focus. It covers 320/375/768/1280px at 100% and the existing Chromium CDP 200% zoom case.
- A prior browser attempt in this turn had transient environment failures (`Prisma ECONNREFUSED` and one resulting CV 404); it is not counted. The final uninterrupted 12/12 run above is the only browser total used for the verdict.

### Current acceptance classification

| Work item / evidence | Current status | Evidence |
| --- | --- | --- |
| CF-301 | VERIFIED | Historical idempotent submission/notification evidence remains valid; current Candidate-first regression and production browser timeline/receipt paths show no regression. No new CF-301 source contract was introduced by this closure slice. |
| CF-302 | VERIFIED | Historical immutable snapshot and safe-open evidence remains valid; current production timeline/removed-job journey, Candidate-first regression, and static/build gates show no regression. |
| CF-303 | VERIFIED | Current focused 69/69, exact-one visible submitted event, current 12/12 production browser matrix, and 25/25 accessibility matrix. |
| CF-304 | VERIFIED | Current focused 69/69, isolated 10/10 bounded pagination/security/query-plan evidence, and current 12/12 browser traversal/history matrix. |
| CF-305 | VERIFIED | Current focused 69/69, isolated 10/10 authorization/count/query-plan evidence, current 12/12 browser Owner scope/CV/decision matrix, and safe-open response checks. |
| Integrated Phase 3 gate | PASS | All mandatory CF-301--CF-305 criteria have current or still-valid labelled evidence; no mandatory criterion remains `FAIL` or `UNVERIFIED`. |

### Cleanup and repository safety

The exact task-owned production server PID was stopped after lock/port ownership validation; port 3001 is free and `web/.local/next-output.lock` was removed. The exact isolated database `candidate_phase3_test_20260911` was dropped and verified absent; the shared `smarthire` database remained present and was not migrated, mutated, or dropped. Browser fixture cleanup completed. No task-owned worker, container, environment file, secret, or uncertain artifact was removed. The working tree remains intentionally dirty with the user's existing Phase 3 changes; no commit, push, deploy, reset, or clean was performed.

### Final Phase 3 decision

`DONE` — CF-301 through CF-305 are verified under the labelled current/historical evidence boundary, CF-303--CF-305 have current executable closure evidence, and the integrated gate is `PASS`.
