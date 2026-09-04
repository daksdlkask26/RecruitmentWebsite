CREATE TYPE "JobSearchProfileSource" AS ENUM (
  'EXPLICIT',
  'AUTO_HIGH_CONFIDENCE',
  'REVIEWED',
  'UNMAPPED'
);

CREATE TABLE "JobSearchProjection" (
  "jobPostingId" TEXT NOT NULL,
  "occupationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "facetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "normalizedTitle" VARCHAR(200) NOT NULL,
  "normalizedSkills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "profileSource" "JobSearchProfileSource" NOT NULL,
  "profileConfidence" DOUBLE PRECISION NOT NULL,
  "catalogVersion" VARCHAR(64) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobSearchProjection_pkey" PRIMARY KEY ("jobPostingId")
);

CREATE INDEX "JobSearchProjection_catalogVersion_profileSource_idx"
  ON "JobSearchProjection"("catalogVersion", "profileSource");
CREATE INDEX "JobSearchProjection_occupationIds_gin_idx"
  ON "JobSearchProjection" USING GIN ("occupationIds");
CREATE INDEX "JobSearchProjection_facetIds_gin_idx"
  ON "JobSearchProjection" USING GIN ("facetIds");
CREATE INDEX "JobSearchProjection_normalizedTitle_trgm_idx"
  ON "JobSearchProjection" USING GIN ("normalizedTitle" gin_trgm_ops);

ALTER TABLE "JobSearchProjection"
  ADD CONSTRAINT "JobSearchProjection_jobPostingId_fkey"
  FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
