ALTER TABLE "SearchMappingReview"
  ADD COLUMN "resultCatalogVersionId" TEXT;

CREATE INDEX "SearchMappingReview_resultCatalogVersionId_idx"
  ON "SearchMappingReview"("resultCatalogVersionId");

ALTER TABLE "SearchMappingReview"
  ADD CONSTRAINT "SearchMappingReview_resultCatalogVersionId_fkey"
  FOREIGN KEY ("resultCatalogVersionId") REFERENCES "SearchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
