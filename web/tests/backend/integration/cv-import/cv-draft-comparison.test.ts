import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { PrismaCvDraftQueryRepository } from "@/backend/repositories/cv-import/prisma-cv-draft-query-repository";
import {
  cleanupReviewAccounts,
  seedReviewDraft,
} from "../../../helpers/cv-review-fixture";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const accounts: string[] = [];

afterEach(async () => {
  const client = await pool.connect();
  try {
    await cleanupReviewAccounts(client, accounts.splice(0));
  } finally {
    client.release();
  }
});
afterAll(async () => pool.end());

describe.sequential("owned CV draft comparison", () => {
  it("loads the live Profile at read time and bounded verified evidence", async () => {
    const client = await pool.connect();
    const seeded = await seedReviewDraft(client, "comparison");
    accounts.push(seeded.accountId);
    await client.query(
      `UPDATE "CandidateProfile" SET "headline" = 'Live value', "revision" = 1 WHERE "id" = $1`,
      [seeded.profileId],
    );
    await client.query(
      `INSERT INTO "ProfileExperience" ("id", "profileId", "position", "title", "company", "startDate", "endDate", "isCurrent", "createdAt", "updatedAt")
       VALUES ('owned-target-fixture', $1, 0, 'Owned role', 'Owned company', DATE '2020-01-01', DATE '2021-01-01', false, $2, $2)`,
      [seeded.profileId, new Date("2026-08-01T08:00:00.000Z")],
    );
    client.release();
    const result = await new PrismaCvDraftQueryRepository().getOwnedComparison(
      seeded.accountId,
      seeded.draftId,
    );
    expect(result?.currentProfile).toMatchObject({
      headline: "Live value",
      revision: 1,
    });
    expect(result?.proposals.scalars[0]?.evidence).toEqual({
      confidence: 0.9,
      locations: ["segment-heading-1"],
      contextAvailable: false,
      context: null,
    });
    expect(result?.currentProfile.experiences.map(({ id }) => id)).toEqual([
      "owned-target-fixture",
    ]);
    const stored = await pool.query(
      `SELECT "proposalPayload"::text AS proposals FROM "CvDraft" WHERE "id" = $1`,
      [seeded.draftId],
    );
    expect(stored.rows[0].proposals).not.toContain("Live value");
    expect(JSON.stringify(result)).not.toMatch(
      /source text|storageLocator|liveProfile/u,
    );
  });

  it("makes foreign, expired, and inaccessible drafts unavailable", async () => {
    const client = await pool.connect();
    const seeded = await seedReviewDraft(client, "denial");
    accounts.push(seeded.accountId);
    client.release();
    const repository = new PrismaCvDraftQueryRepository();
    expect(
      await repository.getOwnedComparison("foreign-account", seeded.draftId),
    ).toBeNull();
    await pool.query(
      `UPDATE "CvDraft" SET "expiresAt" = $2 WHERE "id" = $1`,
      [seeded.draftId, new Date("2026-08-31T00:00:00.000Z")],
    );
    expect(
      await repository.getOwnedComparison(
        seeded.accountId,
        seeded.draftId,
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toBeNull();
    await pool.query(
      `UPDATE "CvDraft" SET "contentInaccessibleAt" = $2 WHERE "id" = $1`,
      [seeded.draftId, new Date("2026-08-01T08:00:00.000Z")],
    );
    expect(
      await repository.getOwnedComparison(seeded.accountId, seeded.draftId),
    ).toBeNull();
  });

  it("projects explicit unavailable evidence when provenance is missing", async () => {
    const client = await pool.connect();
    const seeded = await seedReviewDraft(client, "missing-provenance");
    accounts.push(seeded.accountId);
    await client.query(
      `UPDATE "CvDraft"
          SET "provenancePayload" = "provenancePayload" - 'proposal_skill_fixture'
        WHERE "id" = $1`,
      [seeded.draftId],
    );
    client.release();
    const result = await new PrismaCvDraftQueryRepository().getOwnedComparison(
      seeded.accountId,
      seeded.draftId,
    );
    expect(result?.proposals.skills[0]?.evidence).toEqual({
      confidence: null,
      locations: [],
      contextAvailable: false,
      context: null,
    });
  });

  it("revalidates an ACTIVE owned account on every comparison read", async () => {
    const client = await pool.connect();
    const seeded = await seedReviewDraft(client, "inactive-read");
    accounts.push(seeded.accountId);
    await client.query(
      `UPDATE "user"
          SET "state" = 'SUSPENDED', "stateChangedAt" = $2, "updatedAt" = $2
        WHERE "id" = $1`,
      [seeded.accountId, new Date("2026-08-01T08:05:00.000Z")],
    );
    client.release();

    await expect(
      new PrismaCvDraftQueryRepository().getOwnedComparison(
        seeded.accountId,
        seeded.draftId,
      ),
    ).resolves.toBeNull();
  });
});
