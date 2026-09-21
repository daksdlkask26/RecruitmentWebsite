# Candidate-first Phase 8 Plan: Platform Readiness

**Version:** 1.0  
**Prepared:** 21 September 2026  
**Scope:** CF-801 through CF-805, then the integrated Phase 8 gate  
**Starting point:** commit `eeb17d759a68` on branch `audit_improvement`; working tree clean when this plan was prepared  
**Dependency:** Phase 7 and Phase 6A are recorded as `DONE / VERIFIED`; Phase 6B remains conditional on a multi-instance deployment  
**Current status:** **`DONE_WITH_LIMITATIONS / LOCALLY_VERIFIED`** — all locally executable Phase 8 contracts, isolated DB/filesystem recovery rehearsal, production build/browser smoke, regression/static/migration checks, and task-owned cleanup pass. Private-artifact restore, registry/hosted-CI, target operations/topology/RPO/RTO, operator alert, timezone process parity, representative scale, Owner/Admin cross-role journeys, and one pre-existing architecture direction finding remain explicitly deferred in the [integrated gate](integrated-gate.md); this is not an unconditional production `DONE / VERIFIED` claim.

## 1. Purpose and decision boundary

Phase 8 closes the applicable platform risks that still prevent NextGen Careers from claiming readiness for real Candidate data or production traffic. It follows the five work items in the [Candidate-first roadmap](../roadmap.md#đợt-8--platform-readiness-và-phần-còn-lại): mutation security, durable cross-store work, worker and restore recovery, dependencies and CI, then observability and scale.

The phase is complete only when the required behavior has run on the **final source**, recovery has been rehearsed with isolated data, the intended deployment dependencies have been checked, and the integrated gate records every applicable finding as `PASS`, `FAIL`, or `UNVERIFIED`. A plan, a green unit suite, a local database restore, and a successful build are each narrower evidence. The [historical system audit](../../consolidated-system-audit.md) identifies risks; its old counts and line numbers are not current proof.

The work proceeds sequentially: `entry baseline -> CF-801 -> CF-802 -> CF-803 -> CF-804 -> CF-805 -> integrated gate`. Finish and verify one slice before changing the next. Do not stop after the first green test, source patch, or intermediate checkpoint while an in-scope criterion remains open. If an external dependency prevents execution, record the exact blocker and continue independent work without calling the blocked criterion `PASS`.

## 2. Scope and invariants

### Included

- Recruiter/Admin mutations that affect Candidate or company/job data, especially the recruiter job-posting route; existing origin, session, CSRF, body, and tenant boundaries.
- Company deletion across PostgreSQL and legacy JSON catalogues; Candidate export completion, audit, artifact ownership, and recovery.
- Backup lease reclaim; affected export/scoring/backup worker lifecycle; health/readiness; bounded export and backup processing; database **and private-artifact** restore.
- Dependency advisory triage, isolated CI gates, affected architecture/security/test debt, operational metrics, timezone boundaries, and data-scale evidence.
- Minimal changes to the owning modules, focused tests, representative cross-role regression, and a final integrated evidence record.

### Excluded unless a current acceptance failure proves otherwise

- Phase 6B shared realtime bus/adapter, Redis, or multi-instance presence. Reassess only if the chosen deployment actually has multiple application instances.
- Candidate UI redesign, a new component framework, broad CSS rewrite, microservices, a generic worker framework, or a new monitoring platform by default.
- Rebranding technical names, wholesale database timestamp conversion, speculative indexes/partitions, and dependency upgrades without reachability or compatibility evidence.
- SpecKit artifacts, shared `smarthire` data, user-owned services, and unrelated dirty work.

### Non-negotiable invariants

1. Authentication, CSRF, and tenant/role authorization are separate checks; a valid proof never grants data access by itself.
2. A completed deletion/export/backup has a durable, truthful receipt. Retry and concurrent workers must not create duplicate destructive effects or delete an artifact claimed by a completed operation.
3. Legal hold, retention, private CV/application access, audit actor/scope, and existing idempotency rules remain intact.
4. A stale worker cannot publish completion after losing its lease; timeouts and shutdown cannot silently leave unbounded work running.
5. Health consumers can distinguish process liveness from readiness of mandatory dependencies; optional capability failures are reported without falsely failing unrelated capabilities.
6. Logs, traces, artifacts, CI output, and audit evidence contain no credentials, tokens, private document bytes, raw PII, or connection strings.
7. Every database-writing test uses an isolated `test`, `spec`, or `e2e` database with matching `DATABASE_URL` and `DIRECT_URL`; verify the guard before any write. Cleanup only task-owned resources.
8. Do not reset, clean, commit, push, deploy, stop user-owned processes, or weaken/skip tests without explicit authorization.
9. Any schema or compatibility change needs an explicit forward/backward compatibility check and a documented rollback path before migration or rollout.

## 3. Current repository baseline — inspection only

CodeGraph reported an up-to-date index at plan creation: 2,865 files, 224,817 nodes, and 441,607 edges. `codegraph explore` traced the request boundary, company deletion, export worker, backup service, health service, and search metrics. The table below is a **source snapshot**, not a rerun of the historical failures. Recheck each path and its callers at the start of its slice because later commits may change it.

| Work item | Current source evidence                                                                                                                                                                                                                                                                                                                                                                               | What remains unverified                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF-801    | `web/src/app/api/recruiter/job-postings/route.ts`: POST/PATCH call `requireSession` then `request.json()`; DELETE calls `requireJobActor(request, { mutation: true })`. `web/src/backend/security/account-request-boundary.ts` and `web/src/backend/security/csrf/` already provide shared checks.                                                                                                    | Current end-to-end exploitability, all related route/client callers, and the final negative request matrix.                                          |
| CF-802    | `web/src/backend/services/jobs/recruiter-job-posting-data.ts`: `deleteRecruiterCompany` commits DB deletion, then calls `deleteLegacyCompanyData` for three catalogue writes; the existing deletion request/manifest covers other durable cleanup. `web/src/backend/exports/candidate-export-worker.ts` calls `succeed`, then audit append inside one `try`; the catch deletes the uploaded artifact. | Fault outcomes at each I/O boundary, recovery of legacy catalogue changes, and whether a completed export remains downloadable after audit failure.  |
| CF-803    | `web/src/backend/backup/backup-service.ts` claims only `QUEUED` runs and updates completion by ID; `web/src/backend/services/system/get-system-health.ts` converts a failed DB read to `[]` while returning `status: ok`. The export worker accumulates all rows before writing. `web/src/backend/backup/postgres-backup.ts` and `google-drive-backup.ts` buffer the dump/upload.                     | Lease reclaim and fencing, bounded resource use, worker drain, dependency-failure HTTP behavior, and production-path object restore.                 |
| CF-804    | `.github/workflows/ci.yml` has PostgreSQL, unit/build and selected browser gates, but the selected gates do not establish every Phase 8 failure path. The old 35-test baseline is historical.                                                                                                                                                                                                         | Fresh dependency audit/reachability, current full-suite triage, CI run results, and whether touched architecture boundaries pass.                    |
| CF-805    | `web/src/backend/observability/search-resolution-metrics.ts` emits bounded search metrics; existing account timezone UI/tests and search performance work provide foundations. The historical F21/F22 concerns overlap with Phase 4/7 work.                                                                                                                                                           | Metric-to-consumer/alert path, timestamp behavior under different process zones, current F21 residuals, and query plans under representative volume. |

The [Stage 0 restore rehearsal](../pre-phase/evidence/cf004-restore.json) passed a local PostgreSQL restore and a **separate** object-manifest copy. It explicitly did not prove automated private-artifact backup or readiness of the eventual deployment. Phase 6A's two outside-scope baseline failures and Phase 7's two legacy `UNVERIFIED` probes remain separately recorded; neither is silently reclassified by this plan.

## 4. Entry gate — establish a safe, current baseline

Before CF-801 changes, record in `phase-8/evidence/entry-baseline.md` (create it when execution starts): source commit/diff or source manifest, CodeGraph status, relevant current test failures, selected deployment topology/storage adapters, and which old F01/F06–F08/F12–F22 findings still reproduce. Trace actual callers before changing a shared boundary. Do not carry a historical failure forward as current `FAIL` without reproducing it; do not erase it without a current passing check.

Confirm an isolated database and fixture namespace, object-storage sandbox, service/process ownership, and cleanup procedure before integration, browser, crash, or restore tests. For the final production-readiness claim, record the intended target environment and owner-approved RPO/RTO targets **before** comparing measured restore results. Do not invent those targets or treat a local measurement as a target-environment measurement. If the target is not available, keep that gate `UNVERIFIED` and continue all safe local work.

## 5. CF-801 — mutation and CSRF boundary (F01)

**Outcome:** every in-scope authenticated write reaches the established mutation boundary before body parsing or service work, while role/tenant authorization remains enforced by the owning service.

1. Inventory POST/PATCH/DELETE for recruiter job postings and adjacent recruiter/admin Candidate-data writes. Classify each as read or mutation and identify the current browser client that sends it. Do not change unrelated reads.
2. Reuse the existing `requireJobActor` / `requireAccountRequest` and CSRF proof pattern. Make POST/PATCH enforce trusted origin, fetch metadata, session proof, and JSON content type before parsing; preserve bounded-body rules where the existing contract provides them. Reconcile the client request headers/proof path so valid EN/VI UI actions still work.
3. Keep authorization at the service/repository boundary: wrong company, wrong role, revoked session, and valid proof with foreign tenant still fail closed. Keep response codes and field errors usable by the existing form.
4. Add focused negative request tests for foreign/missing origin, missing/wrong proof, simple-request content type, invalid JSON, unauthenticated user, and foreign tenant. Assert **zero service writes** for rejected requests; test valid create/edit/delete and browser-originated save flow on isolated data.

**Gate CF-801:** all classified in-scope mutations have the correct boundary; negative tests and valid browser/API paths pass on final source; no authorization regression for Recruiter, Owner, or Admin. A static import assertion alone is insufficient.

## 6. CF-802 — dual-write, export, and audit (F06–F07)

### 6.1 Company deletion and legacy catalogues

1. Reproduce the current operation order with isolated DB/JSON fixtures and fault injection before and after DB commit and after each catalogue write. Identify which catalogue is still read by production and whether a retry can reconstruct its target after the company row is gone.
2. Use the existing company deletion request/manifest when it can durably describe the remaining work. Add only the minimal durable checkpoint/reconciliation state that is missing; do not assume a PostgreSQL transaction also covers files. Preserve the legal-hold and object-purge path already established by CF-107.
3. Make re-entry idempotent under process death and concurrent retries. Return `BLOCKED_BY_LEGAL_HOLD` or `PURGE_PENDING` while required work remains; return `deleted: true` only after all required DB, object, and still-live catalogue effects are complete. Do not remove private bytes or another tenant's entries to make reconciliation green.
4. Test failures at each boundary, restart/retry, same request repeated, two workers, and permission loss. Verify surviving Candidate CV/application data, retained audit/receipt, and no externally visible false completion.

### 6.2 Candidate export completion

1. Reproduce `storage.put -> requests.succeed -> audit.append` with audit failure and with worker lease loss. Distinguish unclaimed temporary output from an artifact already recorded as a completed export.
2. Make completion and its audit obligation durable together where the existing repository transaction allows it; otherwise persist a retryable audit obligation that cannot roll back or delete an already completed artifact. Check the result of the lease-owner compare-and-set before announcing success.
3. Verify the artifact exists, matches the stored checksum/size, and is downloadable only by the authorized requester. Retry audit independently of export generation; orphan cleanup may delete **only** unclaimed output after checking current references.
4. Test audit outage immediately after success, storage failure, completion CAS loss, duplicate worker, retry, expiry, and authorized/unauthorized download.

**Gate CF-802:** no false `deleted`/`SUCCEEDED` receipt, no deletion of a claimed artifact, eventual reconciliation for recoverable work, and exact actor/scope/result audit evidence. Run focused company-deletion and recruitment-analytics suites plus isolated integration/fault tests. F13 export memory/long-lease behavior proceeds in CF-803.

## 7. CF-803 — backup lease, workers, health, and restore (F08, F12–F16)

Execute these substeps in order; each uses the existing worker/storage contracts unless a demonstrated failure requires a narrow extension.

### 7.1 Backup lease and publication

- Reclaim an expired `LEASED` backup with a bounded attempt policy. Claim/reclaim must be atomic; completion/failure updates must compare the current owner/attempt token so a late former owner cannot overwrite the new result or clear the active slot.
- Bound each dump/upload attempt with cancellation/deadline appropriate to the existing provider. An expired or permanently failed run must release the active slot through a recorded transition; manual idempotency remains intact.
- Test two claimers, worker kill after claim and during upload, expiry/reclaim, late completion, retry exhaustion, and active-slot recovery. Do not retry a destructive restore automatically.

### 7.2 Export and affected worker lifecycle

- For Candidate export, measure peak rows/bytes/RSS with representative volume. Replace whole-result accumulation with bounded output or a proven size cap, according to the CSV/XLSX writer and storage contracts. Renew or bound the lease; require owner CAS before final publication; reconcile unclaimed artifacts.
- Inspect the existing export, scoring, backup, and CV worker stop paths. For an in-scope worker with a demonstrated open task, stop new claims, drain or signal cancellation within a documented deadline, then release owned resources. A timeout alone must not be described as cancellation. Preserve scoring's human-decision and stale-publication guards.
- Test slow processor, timeout, signal/shutdown, restart, and late completion with two owners. Record which workers were exercised and which are outside this slice.

### 7.3 Liveness and readiness

- Keep a lightweight liveness response for process supervision. Give readiness a bounded dependency check and non-200 response when mandatory DB or required service dependencies are unavailable. Optional CV/OCR/image-search capabilities retain explicit separate states.
- Update CI/startup probes to call the endpoint matching their intent. Do not expose internal URLs, credentials, or raw errors in public health output.
- Test healthy, DB timeout/failure, optional capability outage, and recovery at service and HTTP level.

### 7.4 Restorable backup set

- Inventory all storage roots referenced by Candidate CVs, submitted application documents, export artifacts, and required private evidence. Define the minimum consistent backup set and versioned manifest with digest, object locator, encryption-key version, and DB snapshot relationship. Reuse current adapters; do not introduce a new backup provider merely for uniformity.
- Bound backup memory and deadlines; avoid passing the database password in process arguments. Ensure encrypted backup and key material have a recovery path without putting keys in the backup artifact or audit record.
- Rehearse backup and restore into a new isolated database and object root. Verify referential checks, checksum, authorized open/download of sample CV and application documents, and absence of access from a foreign account. Record elapsed RPO/RTO and compare to the owner-approved targets in the intended deployment topology. Restore must not touch shared data.

**Gate CF-803:** expired lease recovery, stale-owner rejection, worker drain/cancel semantics, truthful HTTP readiness, bounded resources, and a restore of DB **plus** private artifacts all have executable evidence. The older local separate-manifest rehearsal cannot satisfy the automated backup or target-environment criterion.

## 8. CF-804 — dependencies, CI, tests, and architecture (F17–F20)

1. Run a **fresh** dependency advisory inventory and trace each affected package through the current lockfile and reachable application path. Record severity, applicability, fixed compatible version, and test impact. Patch applicable high-risk paths in compatible groups; do not mass-upgrade or call every transitive advisory exploitable. Recheck the lockfile and affected suites after each group.
2. Make CI execute a fast, explicit PR gate for Phase 8 security/integrity/recovery contracts on an isolated DB and a broader scheduled/manual regression gate. Preserve artifact/error logs for failures with secret redaction. Check that environment loading cannot override test DB safeguards; verify the real CI run, not only local YAML syntax. Align PostgreSQL version or explicitly test the supported versions.
3. Re-run and re-triage the old 35-failure inventory against the current source. Map each remaining failure to product defect, test setup, obsolete assertion, environment, or outside-scope owner. Do not lower counts, add `skip`, or replace a security behavior test with a source-string assertion just to reach green.
4. Use CodeGraph impact and architecture tests for modules changed by CF-801–803. Correct real dependency-direction/server-only violations in those paths. Split a large module only when the split makes an invariant clearer or a failing contract testable; file length alone is not acceptance evidence.
5. Run affected Recruiter, Owner, Admin, Candidate, CV/document, export, and notification regressions plus typecheck, lint, formatting of edited files, migration checks if applicable, and production build.

**Gate CF-804:** applicable high-risk advisories have a documented disposition; isolated CI gates run green or retain exact `FAIL` evidence; every current test failure is owned; touched architecture contracts and affected role regressions pass. Historical 35 failures are a triage input, not a required current failure count.

## 9. CF-805 — observability, timezone, and data scale (F21–F22)

1. Recheck F21 on the current Phase 7 UI before making CSS changes. Test the actual company-location keyboard path (`ArrowDown -> ArrowDown -> Enter`, Escape/focus return) and inspect computed layout/contrast in EN/VI and light/dark. Fix only a reproduced residual and its owning styles/component; do not append another global override or rewrite large stylesheets.
2. Trace an existing metric from producer through the runtime subscriber/exporter to an operator-visible query or alert. Fill only missing measurements needed to operate the Phase 8 paths: upload/scan, application, search/cache, notification, export, backup, queue age, lease reclaim, dead work, orphan artifacts, and restore result. Use bounded labels and redacted structured logs; do not log search text, CV content, names, tokens, or raw storage locators. A test double receiving a metric is not proof that operators can see it.
3. Verify create/read/claim/expire boundaries with identical fixtures under UTC and Asia/Bangkok process timezones. Standardize the boundary in the affected adapters if behavior differs; preserve stored data semantics and provide a reversible migration/rollback plan before any schema conversion.
4. Measure representative search/retention/export query plans and workload at realistic volume. Inspect latency, pool wait, result correctness/recall when candidate caps are reached, and company-location coverage. Add an index or partition **only** if a before/after plan proves benefit without unacceptable write/maintenance cost. Carry forward Phase 4's verified search behavior rather than rebuilding search.
5. Exercise one actionable alert/failure path end to end and verify the operator can identify the failed work and recovery action without seeing PII. Record baseline and after measurements, traffic shape, dataset size, and environment.

**Gate CF-805:** any residual F21 behavior is fixed or marked already satisfied with current browser evidence; operational signals reach a consumer; timezone behavior matches the contract; scale claims have representative correctness and performance proof. Unavailable target monitoring is `UNVERIFIED`, not `PASS`.

## 10. Integrated verification and closure

After CF-805, rerun the affected suites and production-like journeys on one identified final source. A source change after a gate reruns only the evidence classes it can invalidate; record that impact using CodeGraph and the diff. Do not repeat expensive suites without a concrete reason.

| Evidence class | Minimum final proof                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Security       | Negative and valid mutation requests through real route boundaries; role/tenant denial and browser save flow.                          |
| Consistency    | DB/file/storage/audit fault injection; idempotent deletion/export recovery; two-worker/lease-loss races.                               |
| Operations     | Worker kill/restart/drain, HTTP dependency-failure readiness, bounded memory/deadline measurements.                                    |
| Restore        | Isolated DB + private-artifact backup/restore; checksum and authorized sample open/download; measured RPO/RTO versus approved targets. |
| Regression     | Affected Candidate, Recruiter, Owner, Admin, CI, architecture, dependency, static, migration (if touched), and build checks.           |
| Safety         | Matching isolated DB URLs; task-owned object/process cleanup; no secret/PII in evidence; `git diff --check`.                           |

Create `phase-8/integrated-gate.md` and concise `phase-8/evidence/` records **during execution**, not empty placeholder evidence now. Each record must include source identity, environment/topology, exact command or probe, counts and result, fault injected, limitations, cleanup, and a link to the owning work item. Keep one canonical result per run; retain a short failure history when a previously failing check is repaired.

The final ledger has one row for CF-801–805 and each required evidence class.
There are two explicit closure outcomes:

1. `DONE / VERIFIED` requires every applicable row to be `PASS` on the final
   source, no unresolved P0/P1 platform issue affects real Candidate data, and
   the target deployment/restore conditions are evidenced.
2. `DONE_WITH_LIMITATIONS / LOCALLY_VERIFIED` is allowed when every locally
   executable criterion passes, no P0/P1 issue remains, any remaining
   architecture failure is current but pre-existing and outside the touched
   Phase 8 boundary, external gaps are precisely identified as requiring
   hosted CI/registry access, production credentials/topology, or approved
   RPO/RTO, and all task-owned resources are cleaned. This status must not be
   shortened to `DONE / VERIFIED`.

If a locally executable criterion fails, report `PARTIAL` or `FAIL` with the
exact reason and next executable step. Phase 6B is separately
`NOT_APPLICABLE` only with documented single-instance topology; a later
multi-instance decision activates CF-651–653 before that deployment.

## 11. Execution discipline and next step

The implementer starts at the entry gate, then completes CF-801, CF-802, CF-803, CF-804, and CF-805 **in that order**. Within each slice: reproduce current behavior; confirm actor/data contract; make the smallest correction; test success and important failure/concurrency paths; inspect the diff; clean only task-owned fixtures; record the result; then continue. A finding already fixed on current source may close with current executable proof and no production edit. A new adjacent issue enters this phase only if it blocks its gate, was caused by current work, or is P0/P1; otherwise record a bounded follow-up.

The local execution sequence is complete and recorded in
`integrated-gate.md`. The next action is external/target-environment closure:
obtain the approved deployment topology and RPO/RTO, run private-artifact
backup/restore and operator/scale drills, run hosted CI and registry advisory
triage, and schedule the separate pre-existing repository-direction redesign.
