# CF-803 lease recovery, workers, health, and restore

**Recorded:** 2026-09-22; verification refreshed on the final uncommitted source.  
**Source identity:** base `eeb17d759a68437c6d15cc473a8d3cdb150cd59c` on `audit_improvement`; final Phase 8 changes are uncommitted in the working tree.  
**Owner:** [plan section 7](../plan.md#7-cf-803--backup-lease-workers-health-and-restore-f08-f12f16)

## Implementation

- Backup claims reclaim expired leases with an incremented epoch and owner token; completion/failure updates are owner/epoch fenced.
- Expired leases at the retry ceiling now transition to `FAILED`, clear `activeKey`, and emit a bounded failure metric instead of remaining stuck.
- PostgreSQL dump credentials are passed through the child environment rather than process arguments; dump, upload, and health dependency checks have deadlines and bounded failure output.
- Dump and Drive upload now share one eight-minute operation deadline, which remains below the ten-minute backup lease. A failed upload removes the just-created Drive folder, while stale-publication cleanup removes both the uploaded file and its task-created folder.
- Candidate export and scoring runtimes stop new ticks and await active work during shutdown; the custom server drains both before closing the application.
- `/api/health/live` is lightweight liveness. `/api/health` returns `503` for mandatory database non-readiness while keeping optional capability state separate.

## Executable evidence

Environment: Windows PowerShell, `D:\HCMUS\PROJECT\web`, Vitest unit environment, plus the isolated PostgreSQL 16.12 instance used for the CF-801 route journey. No production Google Drive/object store, pg_dump/pg_restore toolchain, or independently managed worker process was available for a restore rehearsal.

Focused command:

```text
..\node_modules\.bin\vitest.cmd run tests/backend/unit/backup/backup-service.test.ts tests/backend/unit/backup/google-drive-backup.test.ts tests/backend/unit/system/get-system-health.test.ts tests/backend/unit/recruitment-analytics/candidate-export-worker-runtime.test.ts --passWithNoTests
```

Result: **4 test files passed, 8 tests passed**. The suite covers expired-lease reclaim, owner/epoch fencing, retry exhaustion and active-slot release, the shared operation deadline, Drive folder cleanup after upload failure, health dependency classification, and runtime drain behavior.

The real isolated recovery rehearsal added DB-backed lease evidence:

```text
npm run test:phase8:integration
```

Result: **4/4 integration tests passed**. The backup case used a real
`backupRun` row, reclaimed an expired lease by incrementing its epoch, and
proved that the stale owner could not publish `SUCCEEDED`.

The final production build also passed: compiled successfully, TypeScript
completed, and **117/117** static pages generated. The two earlier
dynamic-filesystem tracing warnings were resolved by marking the intentionally
runtime-configured paths for Turbopack; the final build emitted no warnings.

## Restore boundary and limitation

The selected DB lease/recovery path is now verified against isolated
PostgreSQL, while independent worker processes, process kill during upload,
DB timeout HTTP probes, and bounded RSS/volume measurements remain
**UNVERIFIED**.

The required DB-plus-private-artifact restore is not claimed. The current
production `BackupService` publishes an encrypted PostgreSQL dump only. The
existing restore script explicitly performs a separate local object-manifest
copy rehearsal, not an automated private CV/application/export/evidence
artifact backup. No owner-approved target topology or RPO/RTO was available,
so target restore compliance is **DEFERRED_EXTERNAL / UNVERIFIED**. CF-803 is
**LOCALLY VERIFIED WITH LIMITATIONS** for the executable local recovery
surface.

## Cleanup

The task-owned databases had no remaining sessions and were dropped without
force. Browser/build output, catalogue root, mail/storage roots, and the
task-owned Next process/listener were removed after ownership and absolute
paths were verified. No Drive object, production object-storage root,
unrelated worker/container, credential, or environment file was created or
changed.
