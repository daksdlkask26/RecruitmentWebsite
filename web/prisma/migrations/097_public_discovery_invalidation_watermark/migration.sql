-- CF-403: durable cross-process public-discovery revision.
--
-- The Next web process and the standalone Admin worker do not share module
-- memory or a request cache store. A single-row revision in PostgreSQL is the
-- smallest shared safety signal. Triggers advance it in the same transaction
-- as public Company/Job writes, so a committed mutation is visible to the
-- next web request before the old cache key can be reused.
CREATE TABLE "PublicDiscoveryInvalidation" (
  "id" TEXT NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicDiscoveryInvalidation_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PublicDiscoveryInvalidation" ("id", "version")
VALUES ('singleton', 0);

CREATE OR REPLACE FUNCTION "advance_public_discovery_invalidation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "PublicDiscoveryInvalidation" ("id", "version", "updatedAt")
  VALUES ('singleton', 1, CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO UPDATE
    SET "version" = "PublicDiscoveryInvalidation"."version" + 1,
        "updatedAt" = CURRENT_TIMESTAMP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Company_public_discovery_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "Company"
FOR EACH ROW EXECUTE FUNCTION "advance_public_discovery_invalidation"();

CREATE TRIGGER "JobPosting_public_discovery_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "JobPosting"
FOR EACH ROW EXECUTE FUNCTION "advance_public_discovery_invalidation"();

CREATE TRIGGER "JobPostReviewAggregate_public_discovery_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "JobPostReviewAggregate"
FOR EACH ROW EXECUTE FUNCTION "advance_public_discovery_invalidation"();

-- Rollback: stop public writers, drop the three triggers, drop the trigger
-- function, then drop PublicDiscoveryInvalidation. This removes only the
-- derived safety watermark and never deletes Company or Job data.
