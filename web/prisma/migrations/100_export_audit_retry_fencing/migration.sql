-- CF-802: bound audit retry work and fence concurrent reconciliation workers.
ALTER TYPE "ExportAuditObligationState" ADD VALUE 'LEASED';
ALTER TYPE "ExportAuditObligationState" ADD VALUE 'DEAD_LETTER';

ALTER TABLE "ExportAuditObligation"
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

DROP INDEX "ExportAuditObligation_state_occurredAt_idx";
CREATE INDEX "ExportAuditObligation_state_nextAttemptAt_occurredAt_idx"
  ON "ExportAuditObligation"("state", "nextAttemptAt", "occurredAt");
CREATE INDEX "ExportAuditObligation_state_leaseExpiresAt_idx"
  ON "ExportAuditObligation"("state", "leaseExpiresAt");

-- Rollback: stop export workers, wait for active leases to expire, remove the
-- two indexes and three columns, recreate the original state/occurredAt index,
-- then rebuild the enum without LEASED and DEAD_LETTER. Resolve dead letters
-- before rollback so a successful export never silently loses its audit trail.
