-- CF-107: keep deletion receipt/state after the Company row is purged.
CREATE TYPE "CompanyDeletionRequestState" AS ENUM (
  'REQUESTED',
  'ELIGIBLE',
  'BLOCKED_BY_LEGAL_HOLD',
  'PURGING',
  'RETRY_REQUIRED',
  'COMPLETED'
);

CREATE TYPE "CompanyDeletionHoldState" AS ENUM (
  'NOT_EVALUATED',
  'CLEAR',
  'ACTIVE',
  'RELEASED'
);

CREATE TYPE "CompanyDeletionPurgeState" AS ENUM (
  'NOT_STARTED',
  'BLOCKED',
  'PENDING',
  'RETRYABLE',
  'COMPLETE'
);

CREATE TYPE "CompanyDeletionManifestResourceKind" AS ENUM (
  'DATABASE_RECORD',
  'OBJECT'
);

CREATE TYPE "CompanyDeletionManifestState" AS ENUM (
  'PENDING',
  'DELETED',
  'RETAINED_SHARED',
  'BLOCKED_BY_LEGAL_HOLD',
  'RETRYABLE',
  'CONFLICT'
);

CREATE TABLE "CompanyDeletionRequest" (
  "id" TEXT NOT NULL,
  "companyId" VARCHAR(128) NOT NULL,
  "requestedByUserId" VARCHAR(128) NOT NULL,
  "state" "CompanyDeletionRequestState" NOT NULL DEFAULT 'REQUESTED',
  "holdState" "CompanyDeletionHoldState" NOT NULL DEFAULT 'NOT_EVALUATED',
  "purgeState" "CompanyDeletionPurgeState" NOT NULL DEFAULT 'NOT_STARTED',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retentionEligibleAt" TIMESTAMP(3) NOT NULL,
  "holdEvaluatedAt" TIMESTAMP(3),
  "physicalPurgeStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastFailureCode" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyDeletionManifestEntry" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "identityKey" VARCHAR(2048) NOT NULL,
  "resourceKind" "CompanyDeletionManifestResourceKind" NOT NULL,
  "resourceType" VARCHAR(80) NOT NULL,
  "recordId" VARCHAR(128),
  "objectKeyEncrypted" VARCHAR(2048),
  "objectVersion" VARCHAR(80),
  "state" "CompanyDeletionManifestState" NOT NULL DEFAULT 'PENDING',
  "outcomeCode" VARCHAR(160),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyDeletionManifestEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyDeletionRequest_manifest_identity_key"
  ON "CompanyDeletionManifestEntry" ("requestId", "identityKey");
CREATE INDEX "CompanyDeletionRequest_company_requested_idx"
  ON "CompanyDeletionRequest" ("companyId", "requestedAt");
CREATE INDEX "CompanyDeletionRequest_state_retention_idx"
  ON "CompanyDeletionRequest" ("state", "retentionEligibleAt");
CREATE INDEX "CompanyDeletionManifestEntry_request_state_idx"
  ON "CompanyDeletionManifestEntry" ("requestId", "state");
CREATE INDEX "CompanyDeletionManifestEntry_resource_state_idx"
  ON "CompanyDeletionManifestEntry" ("resourceKind", "state");

ALTER TABLE "CompanyDeletionManifestEntry"
  ADD CONSTRAINT "CompanyDeletionManifestEntry_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CompanyDeletionRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback: stop deletion request and purge writers, then drop the manifest
-- table, request table, indexes, and enum types. This cannot restore company
-- rows or objects already deleted; the durable receipt is the only state lost.
