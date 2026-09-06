import { createHash, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { PoolClient } from "pg";
import { cvConfiguration } from "@/backend/cv/config";
import {
  createCvWorkerCryptor,
  createCvWorkerStorage,
} from "@/backend/cv/workers/cv-worker-resources";

// Keep the disposable review source valid for the current test clock. The
// service intentionally evaluates expiry with `new Date()`, so a fixture that
// expired in the previous audit run would fail before exercising draft/CAS
// behavior. Individual tests still advance this controlled clock to prove
// expiry and retention boundaries.
export const cvReviewFixtureNow = new Date("2026-12-01T08:00:00.000Z");
const cvReviewFixtureBytes = Buffer.from("%PDF-1.7\n", "utf8");
export const cvReviewFixtureSha256 = createHash("sha256")
  .update(cvReviewFixtureBytes)
  .digest("hex");
const fixtureSourceLocators = new Set<string>();

export const cvReviewFixtureProposals = {
  scalars: [
    {
      proposalId: "proposal_headline_fixture",
      field: "headline",
      value: "Platform Engineer",
    },
  ],
  experiences: [
    {
      proposalId: "proposal_experience_fixture",
      value: {
        title: "Engineer",
        company: "Example Laboratory",
        description: "Built test systems.",
        startDate: "2024-01-01",
        endDate: null,
        isCurrent: true,
      },
      duplicateTargetIds: [],
    },
  ],
  education: [],
  skills: [
    {
      proposalId: "proposal_skill_fixture",
      value: "TypeScript",
      duplicate: false,
    },
  ],
  socialLinks: [],
} as const;

export const cvReviewFixtureProvenance = {
  proposal_headline_fixture: {
    confidence: 0.9,
    locations: ["segment-heading-1"],
    contextAvailable: false,
    context: null,
  },
  proposal_experience_fixture: {
    confidence: 0.8,
    locations: ["segment-experience-1"],
    contextAvailable: false,
    context: null,
  },
  proposal_skill_fixture: {
    confidence: null,
    locations: [],
    contextAvailable: false,
    context: null,
  },
} as const;

export const cvReviewFixtureDecisions = {
  reviewComplete: true,
  scalars: [{ proposalId: "proposal_headline_fixture", action: "ADD" }],
  experiences: [
    {
      proposalId: "proposal_experience_fixture",
      action: "ADD",
      targetId: null,
    },
  ],
  education: [],
  skills: [{ proposalId: "proposal_skill_fixture", action: "ADD" }],
  socialLinks: [],
} as const;

export async function seedReviewDraft(
  client: PoolClient,
  label: string,
  options: {
    reviewSaved?: boolean;
    profileRevision?: number;
    existingAccount?: { accountId: string; profileId: string };
  } = {},
) {
  const suffix = `${label}-${randomUUID()}`;
  const ids = {
    accountId: options.existingAccount?.accountId ?? `review-account-${suffix}`,
    profileId: options.existingAccount?.profileId ?? `review-profile-${suffix}`,
    uploadId: `review-upload-${suffix}`,
    sourceId: `review-source-${suffix}`,
    scanId: `review-scan-${suffix}`,
    extractionId: `review-extraction-${suffix}`,
    outputId: `review-output-${suffix}`,
    parseId: `review-parse-${suffix}`,
    draftId: `review-draft-${suffix}`,
  };
  const now = cvReviewFixtureNow;
  const email = `${suffix}@example.invalid`;
  const storage = createCvWorkerStorage();
  await storage.assertReady();
  const cryptor = createCvWorkerCryptor();
  const ciphertext = new PassThrough();
  const storedPromise = storage.put({
    source: ciphertext,
    // AES-GCM does not add ciphertext bytes for this streaming format.
    expectedBytes: cvReviewFixtureBytes.byteLength,
  });
  const envelope = await cryptor.encrypt({
    plaintext: (async function* () {
      yield cvReviewFixtureBytes;
    })(),
    ciphertext,
    context: {
      accountId: ids.accountId,
      uploadId: ids.uploadId,
      artifactId: ids.sourceId,
      kind: "SOURCE_DOCUMENT",
    },
  });
  ciphertext.end();
  const stored = await storedPromise;
  cryptor.destroy();
  fixtureSourceLocators.add(String(stored.locator));
  if (!options.existingAccount) {
    await client.query(
      `INSERT INTO "user" ("id", "name", "email", "normalizedEmail", "emailVerified", "state", "stateChangedAt", "createdAt", "updatedAt")
       VALUES ($1, 'Review Candidate', $2, $2, true, 'ACTIVE', $3, $3, $3)`,
      [ids.accountId, email, now],
    );
    await client.query(
      `INSERT INTO "CandidateIdentity" ("userId", "createdAt", "updatedAt") VALUES ($1, $2, $2)`,
      [ids.accountId, now],
    );
    await client.query(
      `INSERT INTO "CandidateProfile" ("id", "candidateUserId", "revision", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $4)`,
      [ids.profileId, ids.accountId, options.profileRevision ?? 0, now],
    );
  }
  await client.query(
    `INSERT INTO "CvAccountQuota" ("accountId", "reservedBytes", "retainedBytes", "createdAt", "updatedAt")
     VALUES ($1, 0, 2, $2, $2)
     ON CONFLICT ("accountId") DO UPDATE
       SET "retainedBytes" = "CvAccountQuota"."retainedBytes" + 2, "updatedAt" = EXCLUDED."updatedAt"`,
    [ids.accountId, now],
  );
  await client.query(
    `INSERT INTO "CvUpload" (
      "id", "accountId", "profileId", "documentKind", "parserClass", "status",
      "declaredMediaType", "declaredBytes", "actualBytes", "quotaReservationBytes",
      "quotaReservationRemaining", "sourceSha256", "idempotencyDigest", "createBindingDigest",
      "contentReceivedAt", "expiresAt", "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, 'PDF', 'DETERMINISTIC_INTERNAL', 'REVIEW_READY',
      'application/pdf', $5, $5, $5 + 524288, 0, decode($6, 'hex'),
      decode(repeat('12', 32), 'hex'), decode(repeat('13', 32), 'hex'), $4::timestamp(3),
      $4::timestamp(3) + interval '30 days', $4::timestamp(3), $4::timestamp(3))`,
    [
      ids.uploadId,
      ids.accountId,
      ids.profileId,
      now,
      cvReviewFixtureBytes.byteLength,
      cvReviewFixtureSha256,
    ],
  );
  await client.query(
    `INSERT INTO "CvStoredArtifact" (
      "id", "uploadId", "accountId", "kind", "status", "storageAdapter", "storageLocator",
      "encryptionKeyVersion", "encryptionIv", "authenticationTag", "plaintextBytes",
      "ciphertextBytes", "plaintextSha256", "availableAt", "createdAt", "updatedAt"
    ) VALUES
      ($1, $2, $3, 'SOURCE_DOCUMENT', 'AVAILABLE', $4, $5, $6, $7, $8, $9, $9, decode($10, 'hex'), $11, $11, $11),
      ($12, $2, $3, 'EXTRACTED_TEXT', 'AVAILABLE', 'fixture', $13, 1, decode(repeat('16', 12), 'hex'), decode(repeat('17', 16), 'hex'), 1, 1, decode(repeat('18', 32), 'hex'), $11, $11, $11)`,
    [
      ids.sourceId,
      ids.uploadId,
      ids.accountId,
      cvConfiguration.storage.adapter,
      stored.locator,
      envelope.keyVersion,
      envelope.iv,
      envelope.authenticationTag,
      envelope.plaintextBytes,
      cvReviewFixtureSha256,
      now,
      ids.outputId,
      `fixture/${ids.outputId}`,
    ],
  );
  await client.query(
    `INSERT INTO "CvScanAssessment" ("id", "uploadId", "sourceArtifactId", "accountId", "attemptNumber", "status", "engineName", "engineVersion", "signatureVersion", "signaturePublishedAt", "startedAt", "completedAt", "createdAt")
     VALUES ($1, $2, $3, $4, 1, 'CLEAN', 'clamav', '1.4.5', 'fixture', $5, $5, $5, $5)`,
    [ids.scanId, ids.uploadId, ids.sourceId, ids.accountId, now],
  );
  await client.query(
    `INSERT INTO "CvExtraction" ("id", "uploadId", "sourceArtifactId", "scanAssessmentId", "accountId", "outputArtifactId", "attemptNumber", "status", "extractorName", "extractorVersion", "rulesVersion", "pageCount", "segmentCount", "extractedUtf8Bytes", "startedAt", "completedAt", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, 1, 'SUCCEEDED', 'fixture', '1', '1', 1, 1, 1, $7, $7, $7)`,
    [
      ids.extractionId,
      ids.uploadId,
      ids.sourceId,
      ids.scanId,
      ids.accountId,
      ids.outputId,
      now,
    ],
  );
  await client.query(
    `INSERT INTO "CvParseJob" ("id", "uploadId", "extractionId", "accountId", "attemptNumber", "trigger", "status", "parserClass", "provider", "model", "purposeVersion", "inputVersion", "instructionVersion", "schemaVersion", "startedAt", "completedAt", "createdAt")
     VALUES ($1, $2, $3, $4, 1, 'INITIAL', 'SUCCEEDED', 'DETERMINISTIC_INTERNAL', 'smarthire', 'deterministic-v1', 'cv-draft-purpose-v1', 'cv-segments-v1', 'cv-extract-v1', 'cv-draft-v1', $5, $5, $5)`,
    [ids.parseId, ids.uploadId, ids.extractionId, ids.accountId, now],
  );
  await client.query(
    `INSERT INTO "CvDraft" (
      "id", "uploadId", "accountId", "profileId", "parseJobId", "status", "schemaVersion",
      "revision", "sourceProfileRevision", "reviewedProfileRevision", "proposalPayload",
      "reviewPayload", "provenancePayload", "payloadBytes", "provenanceBytes", "expiresAt",
      "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, 'EDITABLE', 'cv-draft-v1', 0, $6, $6,
      $7::jsonb, $8::jsonb, $9::jsonb, 1000, 500, $10, $11, $11)`,
    [
      ids.draftId,
      ids.uploadId,
      ids.accountId,
      ids.profileId,
      ids.parseId,
      options.profileRevision ?? 0,
      JSON.stringify(cvReviewFixtureProposals),
      options.reviewSaved ? JSON.stringify(cvReviewFixtureDecisions) : null,
      JSON.stringify(cvReviewFixtureProvenance),
      new Date(now.getTime() + 30 * 86_400_000),
      now,
    ],
  );
  return ids;
}

export async function cleanupReviewAccounts(
  client: PoolClient,
  accountIds: string[],
) {
  await client.query("BEGIN");
  try {
    await client.query(
      `SELECT set_config('smarthire.cv_retention_mode', 'on', true)`,
    );
    await client.query(
      `DELETE FROM "CandidateCv" WHERE "candidateUserId" = ANY($1::text[])`,
      [accountIds],
    );
    await client.query(
      `DELETE FROM "CandidateIdentity" WHERE "userId" = ANY($1::text[])`,
      [accountIds],
    );
    await client.query(
      `DELETE FROM "EmailOutbox" WHERE "userId" = ANY($1::text[])`,
      [accountIds],
    );
    await client.query(`DELETE FROM "user" WHERE "id" = ANY($1::text[])`, [
      accountIds,
    ]);
    await client.query("COMMIT");
    if (fixtureSourceLocators.size) {
      const storage = createCvWorkerStorage();
      await storage.assertReady();
      for (const locator of fixtureSourceLocators)
        await storage.delete(locator).catch(() => undefined);
      fixtureSourceLocators.clear();
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
