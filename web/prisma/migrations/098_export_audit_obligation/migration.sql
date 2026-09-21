-- CF-802: keep successful export completion durable when audit storage is
-- temporarily unavailable.  The obligation is retryable and owns no file
-- bytes; the ExportRequest remains the source of artifact truth.
CREATE TYPE "ExportAuditObligationState" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "ExportAuditObligation" (
  "id" TEXT NOT NULL,
  "exportRequestId" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "format" "ExportFormat" NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "state" "ExportAuditObligationState" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastFailureCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExportAuditObligation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExportAuditObligation_exportRequestId_key"
  ON "ExportAuditObligation"("exportRequestId");
CREATE INDEX "ExportAuditObligation_state_occurredAt_idx"
  ON "ExportAuditObligation"("state", "occurredAt");

ALTER TABLE "ExportAuditObligation"
  ADD CONSTRAINT "ExportAuditObligation_exportRequestId_fkey"
  FOREIGN KEY ("exportRequestId") REFERENCES "ExportRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback: stop export workers, drop the foreign key and indexes, drop
-- ExportAuditObligation, then drop ExportAuditObligationState. Existing
-- ExportRequest rows and their artifacts remain untouched.
