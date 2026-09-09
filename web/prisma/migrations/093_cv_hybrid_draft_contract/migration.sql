-- CF-205 live E2E exposed that the original CV draft check constraint
-- accepted only cv-draft-v1. Hybrid OCR produces the paired cv-draft-v2
-- payload; keep the same byte, deletion, and revision caps for both versions.
ALTER TABLE "CvDraft" DROP CONSTRAINT "CvDraft_json_caps";

ALTER TABLE "CvDraft" ADD CONSTRAINT "CvDraft_json_caps"
  CHECK (
    "schemaVersion" IN ('cv-draft-v1', 'cv-draft-v2') AND
    "revision" >= 0 AND
    "payloadBytes" BETWEEN 0 AND 262144 AND
    "provenanceBytes" BETWEEN 0 AND 131072 AND
    COALESCE(octet_length("proposalPayload"::text), 0) +
      COALESCE(octet_length("reviewPayload"::text), 0) <= 262144 AND
    COALESCE(octet_length("provenancePayload"::text), 0) <= 131072 AND
    ("payloadDeletedAt" IS NULL OR
      ("proposalPayload" IS NULL AND "reviewPayload" IS NULL AND
       "provenancePayload" IS NULL))
  );

-- Rollback: drop this replacement constraint and recreate the prior v1-only
-- CvDraft_json_caps definition from migration 008.
