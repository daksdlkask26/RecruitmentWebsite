import "server-only";

import { cvConfiguration } from "@/backend/cv/config";
import { createMetadataCryptor } from "@/backend/cv/encryption/metadata-cryptor";
import { prisma } from "@/backend/database/prisma";
import {
  CV_AVAILABLE_ACTIONS,
  CV_ACCOUNT_MAX_IMPORTS,
  type CvProcessingMode,
  type CvUploadStatus,
} from "@/shared/contracts/cv-import/common";
import {
  CV_ACCOUNT_LIMITS,
  CV_SAFE_FAILURE_CODES,
  cvImportListSchema,
  cvImportResourceSchema,
  cvProcessingNotice,
} from "@/shared/contracts/cv-import/upload";
import {
  cvRetryTerminalActions,
  isCvCandidateRetryAvailable,
} from "@/shared/contracts/cv-import/retry";
import { CvImportServiceError, cvContentFreeTombstone } from "./cv-http-errors";
import { CvConsentService } from "./cv-consent-service";

type CvSafeFailureCode = (typeof CV_SAFE_FAILURE_CODES)[number];

const failureCodes = new Set<CvSafeFailureCode>(CV_SAFE_FAILURE_CODES);

function isSafeFailureCode(value: string): value is CvSafeFailureCode {
  return failureCodes.has(value as CvSafeFailureCode);
}

function metadataCryptor() {
  return createMetadataCryptor({
    activeKeyVersion: cvConfiguration.encryption.activeKeyVersion,
    keys: Object.fromEntries(
      Object.entries(cvConfiguration.encryption.encodedKeys).map(
        ([version, encoded]) => [
          Number(version),
          Buffer.from(encoded, "base64"),
        ],
      ),
    ),
  });
}

export function safeFilename(
  encrypted: string | null,
  context: { accountId: string; uploadId: string },
): string | null {
  if (!encrypted) return null;
  const cryptor = metadataCryptor();
  try {
    return cryptor.decryptDisplayFilename(encrypted, context);
  } catch {
    return null;
  } finally {
    cryptor.destroy();
  }
}

function stage(
  status: CvUploadStatus,
  ocrStatus?: string,
  processingMode: CvProcessingMode = "IMPORT_AND_PARSE",
) {
  if (status === "AWAITING_CONTENT") return "UPLOAD" as const;
  if (status === "VALIDATION_QUEUED") return "VALIDATE" as const;
  if (status === "SCAN_QUEUED" || status === "SCANNING") return "SCAN" as const;
  if (status === "SECURITY_CLEAN")
    return processingMode === "SCAN_ONLY"
      ? ("COMPLETE" as const)
      : ("EXTRACT" as const);
  if (status === "EXTRACTION_QUEUED" || status === "EXTRACTING")
    return ["QUEUED", "PROCESSING"].includes(ocrStatus ?? "")
      ? ("OCR" as const)
      : ("EXTRACT" as const);
  if (status === "AWAITING_CONSENT") return "CONSENT" as const;
  if (status === "PARSE_QUEUED" || status === "PARSING")
    return "PARSE" as const;
  if (status === "REVIEW_READY") return "REVIEW" as const;
  if (status === "CONFIRMED") return "COMPLETE" as const;
  return "TERMINAL" as const;
}

function actions(input: {
  status: CvUploadStatus;
  retryAvailable: boolean;
  consentGranted: boolean;
}) {
  const values: string[] = [];
  if (input.status === "AWAITING_CONTENT") values.push("UPLOAD_CONTENT");
  if (input.status === "AWAITING_CONSENT") values.push("GRANT_CONSENT");
  if (
    input.consentGranted &&
    !["CONFIRMED", "DELETED", "EXPIRED"].includes(input.status)
  )
    values.push("REVOKE_CONSENT");
  if (input.status === "REVIEW_READY") values.push("REVIEW");
  if (input.retryAvailable) values.push("RETRY");
  if (!["CONFIRMED", "CANCELLED", "DELETED", "EXPIRED"].includes(input.status))
    values.push("DELETE");
  if (
    [
      "AWAITING_CONSENT",
      "VALIDATION_FAILED",
      "INFECTED",
      "SCAN_FAILED",
      "EXTRACTION_FAILED",
      "PARSE_FAILED",
    ].includes(input.status)
  )
    values.push("MANUAL_PROFILE");
  return values.filter(
    (value): value is (typeof CV_AVAILABLE_ACTIONS)[number] =>
      CV_AVAILABLE_ACTIONS.includes(
        value as (typeof CV_AVAILABLE_ACTIONS)[number],
      ),
  );
}

function failureFor(
  status: CvUploadStatus,
  stored: string | null,
  remaining: Readonly<{
    scanRetriesRemaining: number;
    parseRetriesRemaining: number;
    extractionRetriesRemaining: number;
  }>,
) {
  const fallback: Partial<
    Record<CvUploadStatus, (typeof CV_SAFE_FAILURE_CODES)[number]>
  > = {
    VALIDATION_FAILED: "UNSUPPORTED_DOCUMENT",
    INFECTED: "MALWARE_DETECTED",
    SCAN_FAILED: "CV_PROCESSING_FAILED",
    EXTRACTION_FAILED: "EXTRACTION_FAILED",
    PARSE_FAILED: "CV_PROCESSING_FAILED",
    EXPIRED: "IMPORT_EXPIRED",
    DELETED: "IMPORT_DELETED",
  };
  const code = stored && isSafeFailureCode(stored) ? stored : fallback[status];
  if (!code) return null;
  const retryState =
    status === "SCAN_FAILED" ||
    status === "EXTRACTION_FAILED" ||
    status === "PARSE_FAILED"
      ? {
          status,
          failureCode: code,
          ...remaining,
        }
      : null;
  const retryable = retryState
    ? isCvCandidateRetryAvailable(retryState)
    : false;
  return {
    code,
    message: retryable
      ? "Processing could not finish. You may retry or update your profile manually."
      : "This document could not continue through CV processing.",
    retryable,
    suggestedActions: retryState
      ? cvRetryTerminalActions(retryState)
      : (["REPLACE_DOCUMENT", "MANUAL_PROFILE", "DELETE"] as const),
  };
}

export async function listCvImports(accountId: string) {
  const rows = await prisma.cvUpload.findMany({
    where: { accountId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      accountId: true,
      documentKind: true,
      parserClass: true,
      processingMode: true,
      status: true,
      displayFilenameCiphertext: true,
      createdAt: true,
      expiresAt: true,
      confirmedAt: true,
    },
  });
  const activeStatuses = new Set<CvUploadStatus>([
    "AWAITING_CONTENT",
    "VALIDATION_QUEUED",
    "SCAN_QUEUED",
    "SCANNING",
    "EXTRACTION_QUEUED",
    "EXTRACTING",
    "AWAITING_CONSENT",
    "PARSE_QUEUED",
    "PARSING",
  ]);
  const actionRequiredStatuses = new Set<CvUploadStatus>([
    "REVIEW_READY",
    "VALIDATION_FAILED",
    "INFECTED",
    "SCAN_FAILED",
    "EXTRACTION_FAILED",
    "PARSE_FAILED",
  ]);
  const priority = (row: (typeof rows)[number]) => {
    if (
      activeStatuses.has(row.status) ||
      (row.status === "SECURITY_CLEAN" &&
        row.processingMode === "IMPORT_AND_PARSE")
    )
      return 0;
    if (actionRequiredStatuses.has(row.status)) return 1;
    return 2;
  };
  const orderedRows = [...rows]
    .sort((left, right) => {
      const priorityDifference = priority(left) - priority(right);
      if (priorityDifference !== 0) return priorityDifference;
      const createdDifference =
        right.createdAt.getTime() - left.createdAt.getTime();
      if (createdDifference !== 0) return createdDifference;
      return right.id < left.id ? -1 : right.id > left.id ? 1 : 0;
    })
    .slice(0, CV_ACCOUNT_MAX_IMPORTS);
  return cvImportListSchema.parse({
    items: orderedRows.map((row) => ({
      uploadId: row.id,
      displayFilename: safeFilename(row.displayFilenameCiphertext, {
        accountId: row.accountId,
        uploadId: row.id,
      }),
      documentKind: row.documentKind,
      parserClass: row.parserClass,
      processingMode: row.processingMode,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
    })),
    limits: CV_ACCOUNT_LIMITS,
    processingNotice: cvProcessingNotice("DETERMINISTIC_INTERNAL"),
  });
}

export async function getCvImportResource(accountId: string, uploadId: string) {
  const row = await prisma.cvUpload.findFirst({
    where: { id: uploadId, accountId },
    select: {
      id: true,
      accountId: true,
      documentKind: true,
      parserClass: true,
      processingMode: true,
      status: true,
      displayFilenameCiphertext: true,
      candidateScanRetriesUsed: true,
      candidateParseRetriesUsed: true,
      retryRequests: {
        where: { stage: "EXTRACTION" },
        select: { id: true },
      },
      failureCode: true,
      createdAt: true,
      expiresAt: true,
      contentInaccessibleAt: true,
      deleteAfter: true,
      deletedAt: true,
      draft: { select: { id: true, revision: true, accountId: true } },
      extractions: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        select: {
          ocrAttempt: {
            select: {
              status: true,
              inputUnitCount: true,
              succeededUnitCount: true,
              reviewUnitCount: true,
              failedUnitCount: true,
              units: {
                select: { status: true, materialConflict: true },
              },
            },
          },
        },
      },
      confirmation: {
        select: {
          id: true,
          uploadId: true,
          draftId: true,
          confirmedAt: true,
          draftRevision: true,
          sourceProfileRevision: true,
          reviewedProfileRevision: true,
          profileRevisionBefore: true,
          profileRevisionAfter: true,
          appliedScalarCount: true,
          appliedExperienceCount: true,
          appliedEducationCount: true,
          appliedSkillCount: true,
          appliedSocialLinkCount: true,
        },
      },
    },
  });
  if (
    !row ||
    row.accountId !== accountId ||
    (row.draft && row.draft.accountId !== accountId)
  )
    throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
  if (["CANCELLED", "DELETED", "EXPIRED"].includes(row.status))
    return cvContentFreeTombstone({
      uploadId: row.id,
      status: row.status as "CANCELLED" | "DELETED" | "EXPIRED",
      contentInaccessibleAt: row.contentInaccessibleAt ?? undefined,
      deleteAfter: row.deleteAfter ?? undefined,
      deletedAt: row.deletedAt,
    });
  const consentEligible =
    row.parserClass === "EXTERNAL_OPENAI" && row.contentInaccessibleAt === null;
  const consent = consentEligible
    ? await new CvConsentService().notice(accountId, row.id)
    : null;
  const consentGranted = consent?.granted ?? false;
  const scanRetriesRemaining = Math.max(0, 2 - row.candidateScanRetriesUsed);
  const parseRetriesRemaining = Math.max(0, 2 - row.candidateParseRetriesUsed);
  const extractionRetriesRemaining = Math.max(0, 2 - row.retryRequests.length);
  const failure = failureFor(row.status, row.failureCode, {
    scanRetriesRemaining,
    parseRetriesRemaining,
    extractionRetriesRemaining,
  });
  const confirmation = row.confirmation;
  const ocr = row.extractions[0]?.ocrAttempt ?? null;
  return cvImportResourceSchema.parse({
    uploadId: row.id,
    displayFilename: safeFilename(row.displayFilenameCiphertext, {
      accountId: row.accountId,
      uploadId: row.id,
    }),
    documentKind: row.documentKind,
    parserClass: row.parserClass,
    status: row.status,
    processingMode: row.processingMode,
    stage: stage(row.status, ocr?.status, row.processingMode),
    availableActions: actions({
      status: row.status,
      retryAvailable: failure?.retryable ?? false,
      consentGranted,
    }),
    scanRetriesRemaining,
    extractionRetriesRemaining,
    parseRetriesRemaining,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    draft: row.draft
      ? {
          draftId: row.draft.id,
          revision: row.draft.revision,
          reviewUrl: `/profile/cv-imports/${row.id}/review`,
        }
      : null,
    ocr: ocr
      ? {
          status: ocr.status,
          accountedUnitCount: ocr.units.length,
          totalUnitCount: ocr.inputUnitCount,
          lowConfidenceUnitCount: ocr.units.filter(
            (unit) => unit.status === "LOW_CONFIDENCE",
          ).length,
          conflictUnitCount: ocr.units.filter((unit) => unit.materialConflict)
            .length,
        }
      : null,
    processingNotice: cvProcessingNotice(row.parserClass),
    consent,
    failure,
    receipt: confirmation
      ? {
          receiptId: confirmation.id,
          uploadId: confirmation.uploadId,
          draftId: confirmation.draftId,
          confirmedAt: confirmation.confirmedAt.toISOString(),
          draftRevision: confirmation.draftRevision,
          sourceProfileRevision: confirmation.sourceProfileRevision,
          reviewedProfileRevision: confirmation.reviewedProfileRevision,
          profileRevisionBefore: confirmation.profileRevisionBefore,
          profileRevisionAfter: confirmation.profileRevisionAfter,
          appliedCounts: {
            scalars: confirmation.appliedScalarCount,
            experiences: confirmation.appliedExperienceCount,
            education: confirmation.appliedEducationCount,
            skills: confirmation.appliedSkillCount,
            socialLinks: confirmation.appliedSocialLinkCount,
          },
        }
      : null,
    contentInaccessibleAt: row.contentInaccessibleAt?.toISOString() ?? null,
    deleteAfter: row.deleteAfter?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  });
}
