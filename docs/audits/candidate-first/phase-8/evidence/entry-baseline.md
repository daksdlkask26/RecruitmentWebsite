# Phase 8 entry baseline

**Recorded:** 2026-09-21  
**Owning work item:** Phase 8 entry gate / CF-801 prerequisite  
**Source identity:** `eeb17d759a68437c6d15cc473a8d3cdb150cd59c` on `audit_improvement`  

## Scope and repository safety

- The working tree already contained `docs/audits/candidate-first/README.md` with one local modification and the untracked `docs/audits/candidate-first/phase-8/plan.md`. These files are preserved as user work; no reset, clean, commit, push, deploy, database write, or process stop was performed.
- The Phase 8 evidence directory was created as part of this execution. No fixture, database, object-storage sandbox, or worker process has been created yet.
- The failed baseline test was read-only and did not create task-owned data.

## Source and impact baseline

- CodeGraph status: **PASS — up to date**, 2,865 files, 224,817 nodes, 441,607 edges, 1,474.21 MB index, SQLite WAL backend.
- Relevant callers traced before editing: recruiter job-posting route and its editor/management clients; company deletion service and manifest service; candidate export worker/repository/storage; backup service/dump/upload adapters; health route/service; server worker runtimes.
- Current source diff before Phase 8 implementation: README modification only; no Phase 8 production source change.

## Local topology and storage adapters

- The repository server is a single custom Node HTTP/Next process in `web/server.ts`. It starts the scoring runtime, Candidate export runtime, and in-process Socket.IO gateway. This is source evidence only; the intended production topology is not owner-confirmed in this baseline.
- `.env.local` contains both `DATABASE_URL` and `DIRECT_URL` for the shared `smarthire` database. It is not safe for database-writing Phase 8 tests and will not be used for them.
- Local configuration exposes filesystem CV storage and the export implementation falls back to the task-local `.local/analytics-exports` filesystem root when an export provider is not configured. Actual production object-storage, backup destination, key-recovery path, and target deployment topology are **UNVERIFIED**.
- No owner-approved target RPO/RTO values were available at entry. Local measurements must not be compared to invented targets.

## Baseline executable check

Command, run from `D:\HCMUS\PROJECT\web`:

```text
..\node_modules\.bin\vitest.cmd run tests/backend/unit/jobs/recruiter-job-posting-data.test.ts tests/backend/unit/job-post-management tests/backend/contract/job-post-management tests/frontend/components/recruiter-workspace/job-posting-management.test.tsx tests/architecture/job-post-management-boundaries.test.ts --passWithNoTests
```

Result: **70 passed, 2 failed, 11 test files**. Both failures were in the pre-existing `job-posting-management.test.tsx` file (`preserves spaces and commas while editing skills`; `persists a withdrawn draft before submitting it again`). They are retained as baseline failures and are not attributed to Phase 8 until independently triaged.

## Historical finding reproduction at entry

| Finding | Entry status | Evidence and boundary |
| --- | --- | --- |
| F01 | **SOURCE CONFIRMED; runtime matrix pending** | `POST`/`PATCH /api/recruiter/job-postings` call `requireSession` and parse the body before service work; `DELETE` already calls `requireJobActor(..., { mutation: true })`. |
| F06 | **SOURCE CONFIRMED; fault/retry matrix pending** | Database company deletion commits inside PostgreSQL before `deleteLegacyCompanyData` mutates legacy JSON catalogues. A durable deletion manifest exists for database/object work, but recovery after the company row is gone and a legacy write fails is not yet proven. |
| F07 | **SOURCE CONFIRMED; fault test pending** | Candidate export calls `storage.put`, `requests.succeed`, then audit append inside one `try`; the `catch` deletes the artifact even after completion was recorded. |
| F08 | **SOURCE CONFIRMED; lease test pending** | Backup claim selects only `QUEUED` runs and does not reclaim expired `LEASED` runs; completion/failure updates are not fenced by owner token. |
| F12 | **SOURCE CONFIRMED; HTTP fault test pending** | `getSystemHealth` catches the dependency query and still returns `status: "ok"`; `/api/health` always returns JSON without a readiness failure status. |
| F13 | **SOURCE CONFIRMED; resource test pending** | Candidate export appends every projected batch to one array, then materializes CSV/XLSX; the worker does not check the completion CAS count. |
| F14 | **SOURCE CONFIRMED; runtime test pending** | Socket setup uses in-process registry/presence and performs awaited per-conversation work before the late disconnect path; current runtime query/race behavior is not verified. |
| F15 | **SOURCE CONFIRMED; shutdown test pending** | Server stop clears scoring/export timers without awaiting/draining an active tick; timeout wrappers do not prove processor cancellation. |
| F16 | **SOURCE CONFIRMED; restore test pending** | PostgreSQL dump and encrypted Google Drive upload buffer their content; the dump URL is passed to `pg_dump`, and no complete DB-plus-private-artifact manifest/restore rehearsal exists in this phase. |
| F17 | **HISTORICAL INPUT; fresh advisory inventory pending** | Historical advisory table is not current proof. Reachability, compatible fixes, and affected suites must be rerun from the current lockfile. |
| F18 | **PARTIAL / source only** | CI has a PostgreSQL job and selected checks, but no explicit Phase 8 security/integrity/recovery gate or verified current CI run for this source. |
| F19 | **HISTORICAL INPUT; current triage pending** | The old 35-failure count is not carried forward as current failure evidence. |
| F20 | **PARTIAL / source only** | Existing architecture tests and server-only boundaries are available; changed-path impact and current architecture results are pending. |
| F21 | **UNVERIFIED at entry** | No current browser keyboard/computed-layout check was run in the entry gate. |
| F22 | **UNVERIFIED at entry** | No current operator-consumer trace, UTC/Asia-Bangkok parity run, representative query-plan run, or actionable alert drill was run. |

## Isolation and cleanup contract

Before any DB-writing, integration, browser, crash, or restore check:

1. Provision a task-owned database whose name contains `test`, `spec`, or `e2e`.
2. Set matching `DATABASE_URL` and `DIRECT_URL` only for the child command and verify `web/tests/helpers/test-database-guard.ts` accepts it.
3. Use task-owned fixture IDs and object roots under a task-specific namespace.
4. Record process ownership before starting a server/worker and stop only processes created by this task.
5. Remove only task-owned fixtures, object roots, captured mail, and logs after evidence is recorded; never touch shared `smarthire` data.

## Entry decision

**PASS for starting CF-801 implementation.** The source, safety boundary, current baseline failures, and missing production/target-environment evidence are recorded. CF-801 begins with an isolated route request matrix; no Phase 8 gate is claimed by this entry record.
