-- CF-803: fencing token and bounded retry accounting for scheduled backups.
ALTER TABLE "BackupRun"
  ADD COLUMN "leaseEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- Rollback: stop backup workers, drop the two columns, and restart only after
-- the previous worker lease has expired. No backup artifact is removed.
