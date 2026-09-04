CREATE TYPE "JobSearchTranslationStatus" AS ENUM (
  'HUMAN_VERIFIED',
  'AUTO_HIGH_CONFIDENCE',
  'REQUIRES_REVIEW',
  'INTENTIONAL_UNTRANSLATED',
  'AMBIGUOUS',
  'UNMAPPED'
);

CREATE TYPE "JobSearchMappingSource" AS ENUM (
  'CURATED',
  'EXACT_CANONICAL',
  'EXACT_VERIFIED_ALIAS',
  'FUZZY_VERIFIED_ALIAS',
  'TAXONOMY_INFERENCE',
  'SEMANTIC_SUGGESTION',
  'MANUAL_REVIEW'
);

ALTER TABLE "JobSearchProjection"
  ADD COLUMN "titleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "canonicalTitleVi" VARCHAR(160),
  ADD COLUMN "canonicalTitleEn" VARCHAR(160),
  ADD COLUMN "normalizedAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "translationStatus" "JobSearchTranslationStatus" NOT NULL DEFAULT 'UNMAPPED',
  ADD COLUMN "mappingSource" "JobSearchMappingSource" NOT NULL DEFAULT 'MANUAL_REVIEW',
  ADD COLUMN "mappingConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "JobSearchProjection"
  ADD CONSTRAINT "JobSearchProjection_mappingConfidence_range_chk"
  CHECK ("mappingConfidence" >= 0 AND "mappingConfidence" <= 1);

CREATE INDEX "JobSearchProjection_catalogVersion_translationStatus_idx"
  ON "JobSearchProjection"("catalogVersion", "translationStatus");
CREATE INDEX "JobSearchProjection_titleIds_gin_idx"
  ON "JobSearchProjection" USING GIN ("titleIds");
CREATE INDEX "JobSearchProjection_normalizedAliases_gin_idx"
  ON "JobSearchProjection" USING GIN ("normalizedAliases");
