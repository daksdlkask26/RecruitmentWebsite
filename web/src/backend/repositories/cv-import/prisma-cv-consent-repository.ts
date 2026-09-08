import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { prisma } from "@/backend/database/prisma";
import { serverEnvironment } from "@/backend/env/runtime";
import type { Prisma } from "@/backend/generated/prisma/client";
import { CvImportServiceError } from "@/backend/services/cv-import/cv-http-errors";
import { cvConsentChallengeSchema } from "@/shared/contracts/cv-import/consent-retention";
import type {
  CvConsentReadGateway,
  CvExternalConsentBinding,
  LiveCvExternalConsent,
} from "./cv-consent-read-gateway";

const CHALLENGE_LIFETIME_MS = 10 * 60_000;

type ConsentMutationBinding = CvExternalConsentBinding &
  Readonly<{ challenge?: string }>;

type LockedConsentUpload = Readonly<{
  id: string;
  status: string;
  latestConsentId: string | null;
}>;

function challengeSignature(
  secret: string,
  binding: CvExternalConsentBinding,
  payload: string,
): Buffer {
  return createHmac("sha256", secret)
    .update("smarthire:cv-consent-challenge:v2\0", "utf8")
    .update(binding.accountId, "utf8")
    .update("\0", "utf8")
    .update(binding.uploadId, "utf8")
    .update("\0", "utf8")
    .update(binding.providerClass, "utf8")
    .update("\0", "utf8")
    .update(binding.provider, "utf8")
    .update("\0", "utf8")
    .update(binding.model, "utf8")
    .update("\0", "utf8")
    .update(binding.purposeVersion, "utf8")
    .update("\0", "utf8")
    .update(binding.noticeVersion, "utf8")
    .update("\0", "utf8")
    .update(binding.consentTextVersion, "utf8")
    .update("\0", "utf8")
    .update(payload, "utf8")
    .digest();
}

function encodeChallenge(input: {
  secret: string;
  binding: CvExternalConsentBinding;
  latestConsentId: string | null;
  now: Date;
}): string {
  const payload = Buffer.from(
    JSON.stringify({
      u: input.binding.uploadId,
      l: input.latestConsentId ?? "",
      e: input.now.getTime() + CHALLENGE_LIFETIME_MS,
    }),
    "utf8",
  ).toString("base64url");
  const signature = challengeSignature(
    input.secret,
    input.binding,
    payload,
  ).toString("base64url");
  return cvConsentChallengeSchema.parse(`${payload}.${signature}`);
}

function validateChallenge(input: {
  secret: string;
  binding: CvExternalConsentBinding;
  latestConsentId: string | null;
  challenge: string;
  now: Date;
}): void {
  const parsed = cvConsentChallengeSchema.safeParse(input.challenge);
  if (!parsed.success) throw new CvImportServiceError("VALIDATION_ERROR");
  const [payload, encodedSignature] = parsed.data.split(".");
  let value: unknown;
  try {
    value = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    );
  } catch {
    throw new CvImportServiceError("VALIDATION_ERROR");
  }
  if (!value || typeof value !== "object")
    throw new CvImportServiceError("VALIDATION_ERROR");
  const record = value as Record<string, unknown>;
  if (
    record.u !== input.binding.uploadId ||
    record.l !== (input.latestConsentId ?? "") ||
    !Number.isSafeInteger(record.e) ||
    Number(record.e) < input.now.getTime() ||
    Number(record.e) > input.now.getTime() + CHALLENGE_LIFETIME_MS
  ) {
    throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
  }
  let supplied: Buffer;
  try {
    supplied = Buffer.from(encodedSignature ?? "", "base64url");
  } catch {
    throw new CvImportServiceError("VALIDATION_ERROR");
  }
  // Node's base64url decoder ignores non-significant trailing bits. Reject
  // non-canonical encodings before the timing-safe comparison so a one-byte
  // challenge mutation cannot decode to the same signature bytes.
  if (supplied.toString("base64url") !== encodedSignature)
    throw new CvImportServiceError("VALIDATION_ERROR");
  const expected = challengeSignature(
    input.secret,
    input.binding,
    payload ?? "",
  );
  if (
    supplied.byteLength !== expected.byteLength ||
    !timingSafeEqual(supplied, expected)
  )
    throw new CvImportServiceError("VALIDATION_ERROR");
}

async function lockOwnedUpload(
  transaction: Prisma.TransactionClient,
  binding: CvExternalConsentBinding,
  now: Date,
  allowedStatuses: readonly string[],
): Promise<LockedConsentUpload> {
  const rows = await transaction.$queryRaw<LockedConsentUpload[]>`
    SELECT upload."id", upload."status"::text AS "status",
           latest."id" AS "latestConsentId"
      FROM "user" account
      JOIN "CvUpload" upload ON upload."accountId" = account."id"
      LEFT JOIN LATERAL (
        SELECT consent."id"
          FROM "CvProcessingConsent" consent
         WHERE consent."accountId" = upload."accountId"
           AND consent."uploadId" = upload."id"
         ORDER BY consent."occurredAt" DESC, consent."id" DESC
         LIMIT 1
      ) latest ON TRUE
     WHERE account."id" = ${binding.accountId}
       AND account."state" = 'ACTIVE'
       AND account."deletedAt" IS NULL
       AND upload."id" = ${binding.uploadId}
       AND upload."parserClass" = 'EXTERNAL_OPENAI'
       AND upload."expiresAt" > ${now}
       AND upload."contentInaccessibleAt" IS NULL
       AND upload."deletedAt" IS NULL
     FOR UPDATE OF account, upload
  `;
  const upload = rows[0];
  if (!upload) throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
  if (!allowedStatuses.includes(upload.status))
    throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
  return upload;
}

function auditCorrelation(prefix: string, uploadId: string): string {
  return `${prefix}_${uploadId}_${randomUUID()}`.slice(0, 128);
}

export class PrismaCvConsentRepository implements CvConsentReadGateway {
  constructor(
    private readonly challengeSecret = serverEnvironment.TOKEN_SECRET,
  ) {}

  async findLiveExternalConsent(
    binding: CvExternalConsentBinding,
    now = new Date(),
  ): Promise<LiveCvExternalConsent | null> {
    const rows = await prisma.$queryRaw<
      Array<{ consentId: string; occurredAt: Date }>
    >`
      SELECT consent_grant."id" AS "consentId",
             consent_grant."occurredAt" AS "occurredAt"
        FROM "CvProcessingConsent" consent_grant
        JOIN "CvUpload" upload
          ON upload."id" = consent_grant."uploadId"
         AND upload."accountId" = consent_grant."accountId"
        JOIN "user" account
          ON account."id" = consent_grant."accountId"
       WHERE consent_grant."accountId" = ${binding.accountId}
         AND consent_grant."uploadId" = ${binding.uploadId}
         AND consent_grant."action" = 'GRANTED'
         AND consent_grant."provider" = ${binding.provider}
         AND consent_grant."providerClass" = ${binding.providerClass}::"CvParserClass"
         AND consent_grant."model" = ${binding.model}
         AND consent_grant."purposeVersion" = ${binding.purposeVersion}
         AND consent_grant."noticeVersion" = ${binding.noticeVersion}
         AND consent_grant."consentTextVersion" = ${binding.consentTextVersion}
         AND account."state" = 'ACTIVE'
         AND account."deletedAt" IS NULL
         AND upload."expiresAt" > ${now}
         AND upload."contentInaccessibleAt" IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM "CvProcessingConsent" revoke
            WHERE revoke."supersedesConsentId" = consent_grant."id"
              AND revoke."action" = 'REVOKED'
              AND revoke."occurredAt" >= consent_grant."occurredAt"
         )
       ORDER BY consent_grant."occurredAt" DESC, consent_grant."id" DESC
       LIMIT 1
    `;
    const consent = rows[0];
    return consent
      ? Object.freeze({
          consentId: consent.consentId,
          occurredAt: consent.occurredAt,
        })
      : null;
  }

  async requireLiveExternalConsent(
    binding: CvExternalConsentBinding,
    now = new Date(),
  ): Promise<LiveCvExternalConsent> {
    const consent = await this.findLiveExternalConsent(binding, now);
    if (!consent) throw new CvImportServiceError("CONSENT_REQUIRED");
    return consent;
  }

  async issueChallenge(
    binding: CvExternalConsentBinding,
    now = new Date(),
  ): Promise<string> {
    if (Number.isNaN(now.getTime()))
      throw new CvImportServiceError("VALIDATION_ERROR");
    const rows = await prisma.$queryRaw<
      Array<{ latestConsentId: string | null }>
    >`
      SELECT latest."id" AS "latestConsentId"
        FROM "user" account
        JOIN "CvUpload" upload ON upload."accountId" = account."id"
        LEFT JOIN LATERAL (
          SELECT consent."id"
            FROM "CvProcessingConsent" consent
           WHERE consent."accountId" = upload."accountId"
             AND consent."uploadId" = upload."id"
           ORDER BY consent."occurredAt" DESC, consent."id" DESC
           LIMIT 1
        ) latest ON TRUE
       WHERE account."id" = ${binding.accountId}
         AND account."state" = 'ACTIVE'
         AND account."deletedAt" IS NULL
         AND upload."id" = ${binding.uploadId}
         AND upload."parserClass" = 'EXTERNAL_OPENAI'
         AND upload."expiresAt" > ${now}
         AND upload."contentInaccessibleAt" IS NULL
         AND upload."deletedAt" IS NULL
       LIMIT 1
    `;
    if (!rows[0]) throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
    return encodeChallenge({
      secret: this.challengeSecret,
      binding,
      latestConsentId: rows[0].latestConsentId,
      now,
    });
  }

  async grant(
    input: ConsentMutationBinding &
      Readonly<{ challenge: string; occurredAt: Date }>,
  ): Promise<Readonly<{ consentEventId: string; occurredAt: Date }>> {
    if (Number.isNaN(input.occurredAt.getTime()))
      throw new CvImportServiceError("VALIDATION_ERROR");
    return prisma.$transaction(async (transaction) => {
      const upload = await lockOwnedUpload(
        transaction,
        input,
        input.occurredAt,
        ["AWAITING_CONSENT", "PARSE_FAILED"],
      );
      validateChallenge({
        secret: this.challengeSecret,
        binding: input,
        latestConsentId: upload.latestConsentId,
        challenge: input.challenge,
        now: input.occurredAt,
      });
      const extraction = await transaction.cvExtraction.findFirst({
        where: {
          uploadId: input.uploadId,
          accountId: input.accountId,
          status: "SUCCEEDED",
          outputArtifact: {
            status: "AVAILABLE",
            contentInaccessibleAt: null,
            deletedAt: null,
          },
        },
        orderBy: { attemptNumber: "desc" },
        select: { id: true, segmentSchemaVersion: true },
      });
      if (!extraction) throw new CvImportServiceError("IMPORT_STATE_CONFLICT");
      const hybrid = extraction.segmentSchemaVersion === "cv-segments-v2";
      const id = randomUUID();
      await transaction.cvProcessingConsent.create({
        data: {
          id,
          accountId: input.accountId,
          uploadId: input.uploadId,
          action: "GRANTED",
          provider: input.provider,
          providerClass: input.providerClass,
          model: input.model,
          purposeVersion: input.purposeVersion,
          noticeVersion: input.noticeVersion,
          consentTextVersion: input.consentTextVersion,
          occurredAt: input.occurredAt,
        },
        select: { id: true },
      });
      const active = await transaction.cvParseJob.findFirst({
        where: {
          accountId: input.accountId,
          status: { in: ["QUEUED", "PROCESSING"] },
        },
        select: { id: true },
      });
      const previous = await transaction.cvParseJob.findFirst({
        where: { uploadId: input.uploadId },
        orderBy: { attemptNumber: "desc" },
        select: { attemptNumber: true },
      });
      if (active || (previous?.attemptNumber ?? 0) >= 5)
        throw new CvImportServiceError("CV_PROCESSING_UNAVAILABLE");
      await transaction.cvParseJob.create({
        data: {
          id: randomUUID(),
          uploadId: input.uploadId,
          extractionId: extraction.id,
          accountId: input.accountId,
          consentEventId: id,
          attemptNumber: (previous?.attemptNumber ?? 0) + 1,
          trigger: "INITIAL",
          status: "QUEUED",
          parserClass: input.providerClass,
          provider: input.provider,
          model: input.model,
          purposeVersion: input.purposeVersion,
          inputVersion: hybrid ? "cv-segments-v2" : "cv-segments-v1",
          instructionVersion: hybrid ? "cv-extract-v2" : "cv-extract-v1",
          schemaVersion: hybrid ? "cv-draft-v2" : "cv-draft-v1",
          createdAt: input.occurredAt,
        },
        select: { id: true },
      });
      await transaction.cvUpload.update({
        where: { id: input.uploadId },
        data: { status: "PARSE_QUEUED", failureCode: null },
        select: { id: true },
      });
      await transaction.auditEvent.create({
        data: {
          occurredAt: input.occurredAt,
          actorType: "user",
          actorUserId: input.accountId,
          action: "cv_import.consent_granted",
          targetType: "cv_consent",
          targetId: id,
          result: "SUCCESS",
          correlationId: auditCorrelation("cvg", input.uploadId),
          context: {
            state: "GRANTED",
            parserClass: input.providerClass,
            noticeVersion: input.noticeVersion,
          },
        },
      });
      return Object.freeze({
        consentEventId: id,
        occurredAt: input.occurredAt,
      });
    });
  }

  async revoke(
    input: CvExternalConsentBinding & Readonly<{ occurredAt: Date }>,
  ): Promise<Readonly<{ consentEventId: string | null; occurredAt: Date }>> {
    if (Number.isNaN(input.occurredAt.getTime()))
      throw new CvImportServiceError("VALIDATION_ERROR");
    return prisma.$transaction(async (transaction) => {
      await lockOwnedUpload(transaction, input, input.occurredAt, [
        "AWAITING_CONSENT",
        "PARSE_QUEUED",
        "PARSING",
        "PARSE_FAILED",
        "REVIEW_READY",
      ]);
      const grants = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT grant_event."id"
          FROM "CvProcessingConsent" grant_event
         WHERE grant_event."accountId" = ${input.accountId}
           AND grant_event."uploadId" = ${input.uploadId}
           AND grant_event."action" = 'GRANTED'
           AND grant_event."provider" = ${input.provider}
           AND grant_event."providerClass" = ${input.providerClass}::"CvParserClass"
           AND grant_event."model" = ${input.model}
           AND grant_event."purposeVersion" = ${input.purposeVersion}
           AND grant_event."noticeVersion" = ${input.noticeVersion}
           AND grant_event."consentTextVersion" = ${input.consentTextVersion}
           AND NOT EXISTS (
             SELECT 1 FROM "CvProcessingConsent" revoke
              WHERE revoke."action" = 'REVOKED'
                AND revoke."supersedesConsentId" = grant_event."id"
           )
         ORDER BY grant_event."occurredAt" DESC, grant_event."id" DESC
         LIMIT 1
      `;
      const grant = grants[0];
      if (!grant)
        return Object.freeze({
          consentEventId: null,
          occurredAt: input.occurredAt,
        });
      const id = randomUUID();
      await transaction.cvProcessingConsent.create({
        data: {
          id,
          accountId: input.accountId,
          uploadId: input.uploadId,
          action: "REVOKED",
          supersedesConsentId: grant.id,
          provider: input.provider,
          providerClass: input.providerClass,
          model: input.model,
          purposeVersion: input.purposeVersion,
          noticeVersion: input.noticeVersion,
          consentTextVersion: input.consentTextVersion,
          occurredAt: input.occurredAt,
        },
        select: { id: true },
      });
      await transaction.cvParseJob.updateMany({
        where: {
          uploadId: input.uploadId,
          accountId: input.accountId,
          parserClass: "EXTERNAL_OPENAI",
          consentEventId: grant.id,
          status: { in: ["QUEUED", "PROCESSING"] },
        },
        data: {
          status: "CANCELLED",
          failureCode: "CONSENT_REVOKED",
          completedAt: input.occurredAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await transaction.cvUpload.updateMany({
        where: {
          id: input.uploadId,
          accountId: input.accountId,
          status: { in: ["PARSE_QUEUED", "PARSING", "PARSE_FAILED"] },
        },
        data: { status: "AWAITING_CONSENT", failureCode: "CONSENT_REVOKED" },
      });
      await transaction.auditEvent.create({
        data: {
          occurredAt: input.occurredAt,
          actorType: "user",
          actorUserId: input.accountId,
          action: "cv_import.consent_revoked",
          targetType: "cv_consent",
          targetId: id,
          result: "SUCCESS",
          correlationId: auditCorrelation("cvr", input.uploadId),
          context: {
            state: "REVOKED",
            parserClass: input.providerClass,
            noticeVersion: input.noticeVersion,
          },
        },
      });
      return Object.freeze({
        consentEventId: id,
        occurredAt: input.occurredAt,
      });
    });
  }
}
