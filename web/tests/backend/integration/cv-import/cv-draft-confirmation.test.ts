import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { PrismaCvConfirmationRepository } from "@/backend/repositories/cv-import/prisma-cv-confirmation-repository";
import { ConfirmCvDraftService } from "@/backend/services/cv-import/confirm-cv-draft";
import { getCvImportResource } from "@/backend/services/cv-import/cv-import-projection";
import {
  cleanupReviewAccounts,
  cvReviewFixtureNow,
  cvReviewFixtureSha256,
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

describe.sequential("atomic CV draft confirmation", () => {
  it("applies only saved choices in one Profile revision and replays one receipt", async () => {
    const client = await pool.connect();
    const seeded = await seedReviewDraft(client, "confirm", {
      reviewSaved: true,
    });
    accounts.push(seeded.accountId);
    client.release();
    const repository = new PrismaCvConfirmationRepository();
    const service = new ConfirmCvDraftService(
      repository,
      "fixture-confirm-secret",
    );
    const input = {
      accountId: seeded.accountId,
      draftId: seeded.draftId,
      idempotencyKey: "confirm-" + seeded.uploadId,
      request: {
        draftRevision: 0,
        sourceProfileRevision: 0,
        reviewedProfileRevision: 0,
      },
    };
    const first = await service.execute(input);
    const replay = await service.execute(input);
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    const resource = await getCvImportResource(
      seeded.accountId,
      seeded.uploadId,
    );
    expect(resource).toMatchObject({
      uploadId: seeded.uploadId,
      status: "CONFIRMED",
      stage: "COMPLETE",
      draft: { draftId: seeded.draftId },
      receipt: {
        uploadId: seeded.uploadId,
        draftId: seeded.draftId,
      },
    });
    const profile = await pool.query(
      `SELECT "headline", "revision" FROM "CandidateProfile" WHERE "id" = $1`,
      [seeded.profileId],
    );
    expect(profile.rows[0]).toMatchObject({
      headline: "Platform Engineer",
      revision: 1,
    });
    expect(first.receipt.appliedCounts).toEqual({
      scalars: 1,
      experiences: 1,
      education: 0,
      skills: 1,
      socialLinks: 0,
    });
    const savedCv = await pool.query(
      `SELECT "id", "candidateUserId", "displayName", "fileName",
              "storageKey", "checksumSha256", "confirmedAt"
         FROM "CandidateCv"
        WHERE "candidateUserId" = $1`,
      [seeded.accountId],
    );
    expect(savedCv.rows).toHaveLength(1);
    expect(savedCv.rows[0]).toMatchObject({
      id: "candidate-cv-" + seeded.uploadId,
      candidateUserId: seeded.accountId,
      displayName: "candidate-cv.pdf",
      fileName: "candidate-cv.pdf",
      checksumSha256: cvReviewFixtureSha256,
    });
    // Confirmation replaces the temporary bridge with a private storage
    // locator; retaining the bridge would make later profile reads unsafe.
    expect(savedCv.rows[0].storageKey).not.toBe(
      "candidate-cv-" + seeded.uploadId,
    );
    expect(savedCv.rows[0].storageKey).toMatch(/^[A-Za-z0-9_-]{32,128}$/u);
    expect(savedCv.rows[0].confirmedAt).toEqual(
      new Date(first.receipt.confirmedAt),
    );
    const scheduled = await pool.query(
      `SELECT artifact."deleteAfter",
              artifact."deleteAfter" = receipt."confirmedAt" + interval '7 days' AS exact_window
         FROM "CvStoredArtifact" artifact
         JOIN "CvImportConfirmation" receipt ON receipt."uploadId" = artifact."uploadId"
        WHERE artifact."uploadId" = $1`,
      [seeded.uploadId],
    );
    expect(scheduled.rows.every((row) => row.deleteAfter instanceof Date)).toBe(
      true,
    );
    expect(scheduled.rows.every((row) => row.exact_window === true)).toBe(true);
    const evidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM "CvImportConfirmation" WHERE "draftId" = $1) AS receipts,
         (SELECT count(*)::int FROM "AuditEvent" WHERE "targetId" = $2 AND "action" = 'cv_import.confirmed') AS audits`,
      [seeded.draftId, first.receipt.receiptId],
    );
    expect(evidence.rows[0]).toMatchObject({ receipts: 1, audits: 1 });

    for (const rebound of [
      { draftRevision: 1 },
      { sourceProfileRevision: 1 },
      { reviewedProfileRevision: 1 },
    ])
      await expect(
        service.execute({
          ...input,
          request: { ...input.request, ...rebound },
        }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rolls every write back after every injected transaction failure point", async () => {
    for (const point of [
      "after-scalars",
      "after-experiences",
      "after-education",
      "after-skills",
      "after-social-links",
      "after-profile-revision",
      "after-receipt",
      "after-draft-freeze",
      "after-upload-freeze",
      "after-artifact-freeze",
      "after-audit",
      "before-commit",
    ]) {
      const client = await pool.connect();
      const seeded = await seedReviewDraft(client, `rollback-${point}`, {
        reviewSaved: true,
      });
      accounts.push(seeded.accountId);
      client.release();
      const repository = new PrismaCvConfirmationRepository((current) => {
        if (current === point) throw new Error(`fixture rollback ${point}`);
      });
      await expect(
        repository.confirm({
          accountId: seeded.accountId,
          draftId: seeded.draftId,
          idempotencyDigest: randomBytes(32),
          draftRevision: 0,
          sourceProfileRevision: 0,
          reviewedProfileRevision: 0,
          now: cvReviewFixtureNow,
        }),
      ).rejects.toThrow(`fixture rollback ${point}`);
      const profile = await pool.query(
        `SELECT "headline", "revision" FROM "CandidateProfile" WHERE "id" = $1`,
        [seeded.profileId],
      );
      expect(profile.rows[0]).toMatchObject({ headline: null, revision: 0 });
      const state = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM "CvImportConfirmation" WHERE "draftId" = $1) AS receipts,
           (SELECT count(*)::int FROM "AuditEvent" WHERE "actorUserId" = $2 AND "action" = 'cv_import.confirmed') AS audits,
           (SELECT "status"::text FROM "CvDraft" WHERE "id" = $1) AS draft_status`,
        [seeded.draftId, seeded.accountId],
      );
      expect(state.rows[0]).toMatchObject({
        receipts: 0,
        audits: 0,
        draft_status: "EDITABLE",
      });
    }
  });
});
