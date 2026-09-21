# CF-802 dual-store deletion, export, and audit

**Recorded:** 2026-09-22; verification refreshed on the final uncommitted source.  
**Source identity:** base `eeb17d759a68437c6d15cc473a8d3cdb150cd59c` on `audit_improvement`; final Phase 8 changes are uncommitted in the working tree.  
**Owner:** [plan section 6](../plan.md#6-cf-802--dual-write-export-and-audit-f06f07)

## Implementation

- Company deletion now records aggregate and per-record legacy catalogue checkpoints in the existing durable manifest.
- A committed PostgreSQL delete with a legacy JSON write failure remains retryable; a later retry reconstructs targets from the manifest even after the company row is gone.
- Completion is withheld while legacy catalogue entries remain pending/retryable; legal-hold and object-reference conflict paths remain fail-closed.
- Candidate export completion is fenced by the request compare-and-set. A claimed artifact is retained when the separate audit append fails, with a durable `ExportAuditObligation`. Only an unclaimed artifact is deleted after a lost completion CAS.
- Migration `100_export_audit_retry_fencing` adds claim ownership, lease expiry, retry scheduling, and a terminal `DEAD_LETTER` state. Reconciliation uses a fenced claim, exponential backoff from 30 seconds capped at 1 hour, a bounded attempt ceiling, and redacted retry/dead-letter metrics.
- The repository creates the audit obligation inside the same Prisma transaction as the successful completion CAS. Completion and failure updates require the current audit lease owner, preventing a stale reconciler from publishing a result.

## Executable evidence

Environment: Windows PowerShell, Vitest unit environment with Prisma/storage collaborators mocked, plus isolated PostgreSQL and filesystem integration harnesses. The final recovery rehearsal used `candidate_phase8_e2e_final_20260922`, with matching `DATABASE_URL` and `DIRECT_URL`; the shared `smarthire` database was never written.

Final command:

```text
npm run test:phase8
```

Result: **12 test files passed, 73 tests passed**. The focused deletion, manifest, worker, and repository probe below contributes **49 passed tests**. Fault paths exercised include a legacy write failure after DB commit, manifest target reconstruction after the DB row is gone, legal hold, audit outage after export completion, completion CAS loss, concurrent-claim fencing, bounded retry scheduling, and dead-letter transition.

The focused dual-store/export probe was:

```text
..\node_modules\.bin\vitest.cmd run tests/backend/unit/jobs/recruiter-job-posting-data.test.ts tests/backend/unit/jobs/company-deletion-manifest.test.ts tests/backend/unit/recruitment-analytics/candidate-export-worker.test.ts tests/backend/unit/recruitment-analytics/prisma-export-request-repository.test.ts --passWithNoTests
```

Result: **4 test files passed, 49 tests passed**.

Final production-like recovery rehearsal:

```text
npm run db:deploy
npm run test:phase8:integration
```

Result: **1 test file passed, 4 tests passed** on real PostgreSQL plus a
task-owned filesystem root. It verified that a completed export remains
`SUCCEEDED` and downloadable through an audit failure/retry, a concurrent
claim permits one winner and rejects stale publication, bounded retries reach
`DEAD_LETTER`, and a real backup lease reclaim fences stale publication.
The harness deleted its rows/artifacts and the database was dropped without
force.

## Boundary and limitation

The durable state transitions and the selected cross-store DB/file and race
paths are **LOCALLY VERIFIED**. Independent OS worker processes, permission
loss, the complete checksum/download-authorization matrix for every private
artifact class, and production storage recovery remain **UNVERIFIED**. The
implementation does not report `deleted`/`SUCCEEDED` while the tested durable
checkpoint is incomplete, and it does not delete an artifact already owned by
a completed export. CF-802 is therefore **LOCALLY VERIFIED WITH LIMITATIONS**.

## Cleanup

No shared database, legacy catalogue, private object, or external storage was
changed. Migration 100 was executed and verified on the task-owned isolated
database before that database was dropped. The owning process and all named
Phase 8 filesystem roots were removed; no test fixture secret or private
document bytes were retained in evidence.
