CREATE TYPE "SearchCatalogVersionStatus" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'RETIRED'
);

CREATE TYPE "SearchMappingReviewStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'MERGED'
);

CREATE TYPE "SearchReconciliationRunStatus" AS ENUM (
  'RUNNING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TYPE "SearchReconciliationRunMode" AS ENUM (
  'DRY_RUN',
  'APPLY'
);

CREATE TABLE "SearchCatalogVersion" (
  "id" TEXT NOT NULL,
  "version" VARCHAR(64) NOT NULL,
  "status" "SearchCatalogVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "parentVersion" VARCHAR(64),
  "changeReason" VARCHAR(1000),
  "createdByAdminUserId" TEXT,
  "publishedByAdminUserId" TEXT,
  "retiredByAdminUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SearchCatalogVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchOccupation" (
  "id" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "occupationId" VARCHAR(128) NOT NULL,
  "labelVi" VARCHAR(160) NOT NULL,
  "labelEn" VARCHAR(160) NOT NULL,
  "aliasesVi" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "aliasesEn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SearchOccupation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchJobTitle" (
  "id" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "titleId" VARCHAR(180) NOT NULL,
  "occupationId" VARCHAR(128),
  "canonicalVi" VARCHAR(160) NOT NULL,
  "canonicalEn" VARCHAR(160) NOT NULL,
  "aliasesVi" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "aliasesEn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "abbreviations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "excludedTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "skillSignals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "facetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "translationStatus" "JobSearchTranslationStatus" NOT NULL DEFAULT 'REQUIRES_REVIEW',
  "mappingSource" "JobSearchMappingSource" NOT NULL DEFAULT 'MANUAL_REVIEW',
  "mappingConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reviewReason" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SearchJobTitle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchJobTitle_mappingConfidence_range_chk" CHECK ("mappingConfidence" >= 0 AND "mappingConfidence" <= 1)
);

CREATE TABLE "SearchJobTitleTranslation" (
  "id" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "titleId" VARCHAR(180) NOT NULL,
  "locale" "PreferenceLanguage" NOT NULL,
  "value" VARCHAR(160) NOT NULL,
  "status" "JobSearchTranslationStatus" NOT NULL DEFAULT 'REQUIRES_REVIEW',
  "source" "JobSearchMappingSource" NOT NULL DEFAULT 'MANUAL_REVIEW',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reviewReason" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SearchJobTitleTranslation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchJobTitleTranslation_confidence_range_chk" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE TABLE "SearchAlias" (
  "id" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "targetType" VARCHAR(32) NOT NULL,
  "targetId" VARCHAR(180) NOT NULL,
  "phrase" VARCHAR(160) NOT NULL,
  "normalizedPhrase" VARCHAR(160) NOT NULL,
  "locale" "PreferenceLanguage",
  "source" "JobSearchMappingSource" NOT NULL DEFAULT 'MANUAL_REVIEW',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SearchAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchAlias_confidence_range_chk" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE TABLE "SearchFacet" (
  "id" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "facetId" VARCHAR(160) NOT NULL,
  "kind" VARCHAR(48) NOT NULL,
  "labelVi" VARCHAR(160) NOT NULL,
  "labelEn" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SearchFacet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchTitleFacet" (
  "id" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "titleId" VARCHAR(180) NOT NULL,
  "facetId" VARCHAR(160) NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SearchTitleFacet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchMappingReview" (
  "id" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "openKey" VARCHAR(240),
  "originalTitle" VARCHAR(160) NOT NULL,
  "normalizedTitle" VARCHAR(160) NOT NULL,
  "context" JSONB NOT NULL,
  "suggestedTitleId" VARCHAR(180),
  "suggestedTranslationVi" VARCHAR(160),
  "suggestedTranslationEn" VARCHAR(160),
  "suggestedOccupationId" VARCHAR(128),
  "suggestedFacetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "suggestedSkillSignals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" "SearchMappingReviewStatus" NOT NULL DEFAULT 'PENDING',
  "decisionReason" VARCHAR(1000),
  "reviewedByAdminUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SearchMappingReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchMappingReview_confidence_range_chk" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE TABLE "SearchProjectionReconciliationRun" (
  "id" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "mode" "SearchReconciliationRunMode" NOT NULL,
  "status" "SearchReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "inspected" INTEGER NOT NULL DEFAULT 0,
  "refreshed" INTEGER NOT NULL DEFAULT 0,
  "missing" INTEGER NOT NULL DEFAULT 0,
  "stale" INTEGER NOT NULL DEFAULT 0,
  "inconsistent" INTEGER NOT NULL DEFAULT 0,
  "unmapped" INTEGER NOT NULL DEFAULT 0,
  "ambiguous" INTEGER NOT NULL DEFAULT 0,
  "requiresReview" INTEGER NOT NULL DEFAULT 0,
  "orphaned" INTEGER NOT NULL DEFAULT 0,
  "policyFailures" INTEGER NOT NULL DEFAULT 0,
  "cursor" TEXT,
  "errorMessage" VARCHAR(2000),
  "createdByAdminUserId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "SearchProjectionReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchCatalogVersion_version_key" ON "SearchCatalogVersion"("version");
CREATE UNIQUE INDEX "SearchCatalogVersion_active_key" ON "SearchCatalogVersion"("isActive") WHERE "isActive" = true;
CREATE INDEX "SearchCatalogVersion_status_createdAt_id_idx" ON "SearchCatalogVersion"("status", "createdAt" DESC, "id");
CREATE INDEX "SearchCatalogVersion_isActive_status_idx" ON "SearchCatalogVersion"("isActive", "status");

CREATE UNIQUE INDEX "SearchOccupation_catalogVersionId_occupationId_key" ON "SearchOccupation"("catalogVersionId", "occupationId");
CREATE INDEX "SearchOccupation_catalogVersionId_labelVi_idx" ON "SearchOccupation"("catalogVersionId", "labelVi");
CREATE INDEX "SearchOccupation_catalogVersionId_labelEn_idx" ON "SearchOccupation"("catalogVersionId", "labelEn");

CREATE UNIQUE INDEX "SearchJobTitle_catalogVersionId_titleId_key" ON "SearchJobTitle"("catalogVersionId", "titleId");
CREATE INDEX "SearchJobTitle_catalogVersionId_canonicalVi_idx" ON "SearchJobTitle"("catalogVersionId", "canonicalVi");
CREATE INDEX "SearchJobTitle_catalogVersionId_canonicalEn_idx" ON "SearchJobTitle"("catalogVersionId", "canonicalEn");
CREATE INDEX "SearchJobTitle_catalogVersionId_translationStatus_idx" ON "SearchJobTitle"("catalogVersionId", "translationStatus");
CREATE INDEX "SearchJobTitle_facetIds_gin_idx" ON "SearchJobTitle" USING GIN ("facetIds");

CREATE UNIQUE INDEX "SearchJobTitleTranslation_catalogVersionId_titleId_locale_key" ON "SearchJobTitleTranslation"("catalogVersionId", "titleId", "locale");
CREATE INDEX "SearchJobTitleTranslation_catalogVersionId_locale_status_idx" ON "SearchJobTitleTranslation"("catalogVersionId", "locale", "status");

CREATE UNIQUE INDEX "SearchAlias_catalogVersionId_targetType_targetId_normalizedPhrase_locale_key" ON "SearchAlias"("catalogVersionId", "targetType", "targetId", "normalizedPhrase", "locale");
CREATE INDEX "SearchAlias_catalogVersionId_targetType_normalizedPhrase_idx" ON "SearchAlias"("catalogVersionId", "targetType", "normalizedPhrase");

CREATE UNIQUE INDEX "SearchFacet_catalogVersionId_facetId_key" ON "SearchFacet"("catalogVersionId", "facetId");
CREATE INDEX "SearchFacet_catalogVersionId_kind_idx" ON "SearchFacet"("catalogVersionId", "kind");

CREATE UNIQUE INDEX "SearchTitleFacet_catalogVersionId_titleId_facetId_key" ON "SearchTitleFacet"("catalogVersionId", "titleId", "facetId");
CREATE INDEX "SearchTitleFacet_catalogVersionId_facetId_idx" ON "SearchTitleFacet"("catalogVersionId", "facetId");

CREATE UNIQUE INDEX "SearchMappingReview_openKey_key" ON "SearchMappingReview"("openKey");
CREATE INDEX "SearchMappingReview_catalogVersionId_status_createdAt_id_idx" ON "SearchMappingReview"("catalogVersionId", "status", "createdAt", "id");
CREATE INDEX "SearchMappingReview_normalizedTitle_status_idx" ON "SearchMappingReview"("normalizedTitle", "status");

CREATE INDEX "SearchProjectionReconciliationRun_catalogVersionId_startedAt_id_idx" ON "SearchProjectionReconciliationRun"("catalogVersionId", "startedAt" DESC, "id");
CREATE INDEX "SearchProjectionReconciliationRun_status_startedAt_id_idx" ON "SearchProjectionReconciliationRun"("status", "startedAt" DESC, "id");

ALTER TABLE "SearchOccupation"
  ADD CONSTRAINT "SearchOccupation_catalogVersionId_fkey"
  FOREIGN KEY ("catalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SearchJobTitle"
  ADD CONSTRAINT "SearchJobTitle_catalogVersionId_fkey"
  FOREIGN KEY ("catalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SearchJobTitleTranslation"
  ADD CONSTRAINT "SearchJobTitleTranslation_catalogVersionId_fkey"
  FOREIGN KEY ("catalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SearchAlias"
  ADD CONSTRAINT "SearchAlias_catalogVersionId_fkey"
  FOREIGN KEY ("catalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SearchFacet"
  ADD CONSTRAINT "SearchFacet_catalogVersionId_fkey"
  FOREIGN KEY ("catalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SearchTitleFacet"
  ADD CONSTRAINT "SearchTitleFacet_catalogVersionId_fkey"
  FOREIGN KEY ("catalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SearchMappingReview"
  ADD CONSTRAINT "SearchMappingReview_catalogVersionId_fkey"
  FOREIGN KEY ("catalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SearchProjectionReconciliationRun"
  ADD CONSTRAINT "SearchProjectionReconciliationRun_catalogVersionId_fkey"
  FOREIGN KEY ("catalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
