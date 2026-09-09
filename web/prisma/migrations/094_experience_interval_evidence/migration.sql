-- Preserve deterministic month-interval evidence produced by CF-106.
-- Legacy scoring rows remain valid because the field is nullable and the
-- repository falls back to detectedExperienceYears when it is absent.
ALTER TABLE "AutomaticMatchResult"
  ADD COLUMN "experienceEvidence" JSONB;

-- Rollback: stop interval-evidence writers, deploy the repository fallback,
-- then drop this nullable column. Legacy years remain available.
