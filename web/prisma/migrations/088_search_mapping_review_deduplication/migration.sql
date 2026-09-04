-- Additive queue-maintenance state. No review decision is implied by this
-- state; it records that a duplicate row was consolidated into another row.
ALTER TYPE "SearchMappingReviewStatus" ADD VALUE IF NOT EXISTS 'DEDUPLICATED';

ALTER TABLE "SearchMappingReview"
  ADD COLUMN "deduplicatedIntoReviewId" TEXT,
  ADD COLUMN "deduplicatedAt" TIMESTAMP(3);

CREATE INDEX "SearchMappingReview_deduplicatedIntoReviewId_idx"
  ON "SearchMappingReview"("deduplicatedIntoReviewId");
