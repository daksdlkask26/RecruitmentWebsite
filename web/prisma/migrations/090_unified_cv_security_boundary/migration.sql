-- Pre-Phase 2: Unified CV Security Boundary schema expansion
-- Expand phase: add unified security boundary enums, upload purpose/mode/policyVersion,
-- and nullable evidence foreign keys to CandidateCv, ApplicationDocument, and TeamApplication.

-- 1. Create unified CV purpose and processing mode enums
CREATE TYPE "CvUploadPurpose" AS ENUM (
  'PROFILE_IMPORT',
  'PROFILE_DIRECT',
  'JOB_APPLICATION_DIRECT',
  'TEAM_APPLICATION_DIRECT'
);

CREATE TYPE "CvProcessingMode" AS ENUM (
  'IMPORT_AND_PARSE',
  'SCAN_ONLY'
);

-- 2. Add SECURITY_CLEAN status to CvUploadStatus
ALTER TYPE "CvUploadStatus" ADD VALUE IF NOT EXISTS 'SECURITY_CLEAN';

-- 3. Expand CvUpload with purpose, processingMode, and policyVersion with backfill defaults
ALTER TABLE "CvUpload"
  ADD COLUMN "purpose" "CvUploadPurpose" NOT NULL DEFAULT 'PROFILE_IMPORT',
  ADD COLUMN "processingMode" "CvProcessingMode" NOT NULL DEFAULT 'IMPORT_AND_PARSE',
  ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT 'unified-cv-v1';

-- Keep the exact policy used for a clean assessment so readers can reject
-- evidence produced by a retired or incompatible scan policy.
ALTER TABLE "CvScanAssessment"
  ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT 'unified-cv-v1';

-- 4. Expand CandidateCv with nullable scan evidence foreign keys
ALTER TABLE "CandidateCv"
  ADD COLUMN "sourceArtifactId" TEXT,
  ADD COLUMN "scanAssessmentId" TEXT;

CREATE INDEX "CandidateCv_sourceArtifactId_idx" ON "CandidateCv"("sourceArtifactId");
CREATE INDEX "CandidateCv_scanAssessmentId_idx" ON "CandidateCv"("scanAssessmentId");

ALTER TABLE "CandidateCv"
  ADD CONSTRAINT "CandidateCv_sourceArtifactId_fkey"
  FOREIGN KEY ("sourceArtifactId") REFERENCES "CvStoredArtifact"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CandidateCv"
  ADD CONSTRAINT "CandidateCv_scanAssessmentId_fkey"
  FOREIGN KEY ("scanAssessmentId") REFERENCES "CvScanAssessment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Expand ApplicationDocument with nullable scan evidence foreign keys
ALTER TABLE "ApplicationDocument"
  ADD COLUMN "sourceArtifactId" TEXT,
  ADD COLUMN "scanAssessmentId" TEXT;

CREATE INDEX "ApplicationDocument_sourceArtifactId_idx" ON "ApplicationDocument"("sourceArtifactId");
CREATE INDEX "ApplicationDocument_scanAssessmentId_idx" ON "ApplicationDocument"("scanAssessmentId");

ALTER TABLE "ApplicationDocument"
  ADD CONSTRAINT "ApplicationDocument_sourceArtifactId_fkey"
  FOREIGN KEY ("sourceArtifactId") REFERENCES "CvStoredArtifact"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApplicationDocument"
  ADD CONSTRAINT "ApplicationDocument_scanAssessmentId_fkey"
  FOREIGN KEY ("scanAssessmentId") REFERENCES "CvScanAssessment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Expand TeamApplication with nullable scan evidence foreign keys
ALTER TABLE "TeamApplication"
  ADD COLUMN "cvSourceArtifactId" TEXT,
  ADD COLUMN "cvScanAssessmentId" TEXT;

CREATE INDEX "TeamApplication_cvSourceArtifactId_idx" ON "TeamApplication"("cvSourceArtifactId");
CREATE INDEX "TeamApplication_cvScanAssessmentId_idx" ON "TeamApplication"("cvScanAssessmentId");

ALTER TABLE "TeamApplication"
  ADD CONSTRAINT "TeamApplication_cvSourceArtifactId_fkey"
  FOREIGN KEY ("cvSourceArtifactId") REFERENCES "CvStoredArtifact"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TeamApplication"
  ADD CONSTRAINT "TeamApplication_cvScanAssessmentId_fkey"
  FOREIGN KEY ("cvScanAssessmentId") REFERENCES "CvScanAssessment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
