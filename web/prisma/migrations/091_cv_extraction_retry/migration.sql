-- CF-204: bind candidate extraction retries to the existing CLEAN scan and
-- preserve an immutable prior/new extraction attempt pair.
ALTER TYPE "CvRetryStage" ADD VALUE 'EXTRACTION';

ALTER TABLE "CvRetryRequest"
  ADD COLUMN "priorExtractionId" TEXT,
  ADD COLUMN "extractionId" TEXT;

CREATE INDEX "CvRetryRequest_priorExtractionId_idx"
  ON "CvRetryRequest"("priorExtractionId");

CREATE INDEX "CvRetryRequest_extractionId_idx"
  ON "CvRetryRequest"("extractionId");

ALTER TABLE "CvRetryRequest"
  ADD CONSTRAINT "CvRetryRequest_priorExtractionId_fkey"
  FOREIGN KEY ("priorExtractionId") REFERENCES "CvExtraction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CvRetryRequest"
  ADD CONSTRAINT "CvRetryRequest_extractionId_fkey"
  FOREIGN KEY ("extractionId") REFERENCES "CvExtraction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CvRetryRequest"
  DROP CONSTRAINT "CvRetryRequest_stage_binding";

ALTER TABLE "CvRetryRequest"
  ADD CONSTRAINT "CvRetryRequest_stage_binding"
  CHECK (
    (octet_length("idempotencyDigest") = 32)
    AND (
      ("stage" = 'SCAN'
       AND "priorScanAssessmentId" IS NOT NULL
       AND "scanAssessmentId" IS NOT NULL
       AND "priorParseJobId" IS NULL
       AND "parseJobId" IS NULL
       AND "priorExtractionId" IS NULL
       AND "extractionId" IS NULL)
      OR
      ("stage" = 'PARSE'
       AND "priorParseJobId" IS NOT NULL
       AND "parseJobId" IS NOT NULL
       AND "priorScanAssessmentId" IS NULL
       AND "scanAssessmentId" IS NULL
       AND "priorExtractionId" IS NULL
       AND "extractionId" IS NULL)
      OR
      ("stage" = 'EXTRACTION'
       AND "priorExtractionId" IS NOT NULL
       AND "extractionId" IS NOT NULL
       AND "priorScanAssessmentId" IS NULL
       AND "scanAssessmentId" IS NULL
       AND "priorParseJobId" IS NULL
       AND "parseJobId" IS NULL)
    )
  );
