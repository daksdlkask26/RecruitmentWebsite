-- CF-301: bridge transactionally-created recruitment notification work to the
-- existing leased EmailOutbox/provider boundary. The enum value is generic so
-- APPLICATION_SUBMITTED, APPLICATION_RECEIVED, and APPLICATION_STAGE_CHANGED
-- remain domain event kinds while EmailOutbox owns provider delivery truth.
-- Rollback compatibility: the new columns are nullable, so pre-096 writers can
-- continue to create work; stopping the new worker leaves existing work
-- durable. There is no destructive down step for the enum value.
ALTER TYPE "EmailKind"
  ADD VALUE IF NOT EXISTS 'RECRUITMENT_NOTIFICATION';

ALTER TABLE "RecruitmentNotificationWork"
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "RecruitmentNotificationWork_leaseExpiresAt_idx"
  ON "RecruitmentNotificationWork" ("leaseExpiresAt");
