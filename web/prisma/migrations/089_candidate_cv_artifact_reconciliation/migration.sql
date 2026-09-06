-- CF-101: persist the plaintext digest on every application-document
-- promotion. Legacy rows that cannot be matched to a live document remain
-- NULL and are treated as unknown by reconciliation; new writes are required
-- to provide the digest in application code.
ALTER TABLE "ApplicationArtifactPromotion"
  ADD COLUMN "contentDigestSha256" CHAR(64);

UPDATE "ApplicationArtifactPromotion" promotion
SET "contentDigestSha256" = document."contentDigestHmac"
FROM "ApplicationDocument" document
WHERE promotion."contentDigestSha256" IS NULL
  AND document."storageKeyEncrypted" = promotion."storageKeyEncrypted"
  AND document."deletedAt" IS NULL;

CREATE INDEX "ApplicationArtifactPromotion_contentDigestSha256_idx"
  ON "ApplicationArtifactPromotion"("contentDigestSha256");

ALTER TABLE "ApplicationArtifactPromotion"
  ADD CONSTRAINT "ApplicationArtifactPromotion_contentDigestSha256_format"
  CHECK (
    "contentDigestSha256" IS NULL OR
    "contentDigestSha256" ~ '^[0-9a-f]{64}$'
  );

CREATE TYPE "CandidateCvArtifactPromotionScope" AS ENUM (
  'PROFILE_CV',
  'TEAM_APPLICATION'
);

CREATE TYPE "CandidateCvArtifactPromotionState" AS ENUM (
  'PROMOTED',
  'COMMITTED',
  'DELETED',
  'DELETE_FAILED'
);

CREATE TABLE "CandidateCvArtifactPromotion" (
  "id" TEXT NOT NULL,
  "candidateUserId" TEXT NOT NULL,
  "scope" "CandidateCvArtifactPromotionScope" NOT NULL,
  "targetId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentDigestSha256" CHAR(64) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "state" "CandidateCvArtifactPromotionState" NOT NULL DEFAULT 'PROMOTED',
  "orphanDeleteAfter" TIMESTAMP(3) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastSafeFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CandidateCvArtifactPromotion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateCvArtifactPromotion_scope_targetId_key"
  ON "CandidateCvArtifactPromotion"("scope", "targetId");
CREATE INDEX "CandidateCvArtifactPromotion_state_orphanDeleteAfter_idx"
  ON "CandidateCvArtifactPromotion"("state", "orphanDeleteAfter");
CREATE INDEX "CandidateCvArtifactPromotion_storageKey_idx"
  ON "CandidateCvArtifactPromotion"("storageKey");
CREATE INDEX "CandidateCvArtifactPromotion_candidateUserId_scope_createdAt_idx"
  ON "CandidateCvArtifactPromotion"("candidateUserId", "scope", "createdAt");

ALTER TABLE "CandidateCvArtifactPromotion"
  ADD CONSTRAINT "CandidateCvArtifactPromotion_contentDigestSha256_format"
  CHECK ("contentDigestSha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CandidateCvArtifactPromotion"
  ADD CONSTRAINT "CandidateCvArtifactPromotion_candidateUserId_fkey"
  FOREIGN KEY ("candidateUserId") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
