ALTER TABLE "SearchCatalogVersion"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SearchMappingReview"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "SearchCatalogVersion_status_revision_idx"
  ON "SearchCatalogVersion"("status", "revision");

CREATE INDEX "SearchMappingReview_status_version_idx"
  ON "SearchMappingReview"("status", "version");
