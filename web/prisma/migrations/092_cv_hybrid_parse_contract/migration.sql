-- CF-205 live E2E exposed that the original CV parse-job check constraint
-- accepted only the v1 extraction contract. Hybrid OCR deliberately produces
-- the v2 contract, so permit both version-paired contracts while retaining
-- the existing queue, lease, terminal, and consent invariants.
ALTER TABLE "CvParseJob" DROP CONSTRAINT "CvParseJob_terminal";

ALTER TABLE "CvParseJob" ADD CONSTRAINT "CvParseJob_terminal"
  CHECK (
    "attemptNumber" BETWEEN 1 AND 5 AND
    char_length("provider") BETWEEN 1 AND 100 AND
    char_length("model") BETWEEN 1 AND 200 AND
    char_length("purposeVersion") BETWEEN 1 AND 100 AND
    (
      ("inputVersion" = 'cv-segments-v1' AND
       "instructionVersion" = 'cv-extract-v1' AND
       "schemaVersion" = 'cv-draft-v1') OR
      ("inputVersion" = 'cv-segments-v2' AND
       "instructionVersion" = 'cv-extract-v2' AND
       "schemaVersion" = 'cv-draft-v2')
    ) AND
    ("providerRequestIdHmac" IS NULL OR octet_length("providerRequestIdHmac") = 32) AND
    (("status" = 'PROCESSING' AND "leaseOwner" IS NOT NULL AND
      "leaseExpiresAt" IS NOT NULL AND "startedAt" IS NOT NULL) OR
     ("status" <> 'PROCESSING' AND "leaseOwner" IS NULL AND
      "leaseExpiresAt" IS NULL)) AND
    ("status" NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') OR
      "completedAt" IS NOT NULL) AND
    ("parserClass" <> 'EXTERNAL_OPENAI' OR
      "status" NOT IN ('PROCESSING', 'SUCCEEDED') OR
      "consentEventId" IS NOT NULL)
  );

-- Rollback: drop this replacement constraint and recreate the prior v1-only
-- CvParseJob_terminal definition from migration 008.
