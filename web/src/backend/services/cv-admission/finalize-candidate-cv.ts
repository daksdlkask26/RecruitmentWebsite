import "server-only";

import { prisma } from "@/backend/database/prisma";
import {
  CvSafetyEvidenceError,
  CvSafetyEvidenceService,
} from "./cv-safety-evidence-service";
import type { CvUploadPurpose } from "@/backend/generated/prisma/client";

const candidateCvSelect = {
  id: true,
  candidateUserId: true,
  displayName: true,
  fileName: true,
  mimeType: true,
  byteSize: true,
  storageKey: true,
  checksumSha256: true,
  sourceArtifactId: true,
  scanAssessmentId: true,
  version: true,
  confirmedAt: true,
  archivedAt: true,
} as const;

export type FinalizedCandidateCv = {
  id: string;
  candidateUserId: string;
  displayName: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  checksumSha256: string;
  sourceArtifactId: string | null;
  scanAssessmentId: string | null;
  version: number;
  confirmedAt: Date | null;
  archivedAt: Date | null;
};

export class CandidateCvFinalizationError extends Error {
  readonly name = "CandidateCvFinalizationError";

  constructor(
    readonly code:
      | "CV_NOT_FOUND"
      | "CV_NOT_READY"
      | "CV_EXPIRED"
      | "CV_PURPOSE_MISMATCH"
      | "CV_INTEGRITY_FAILED",
    message?: string,
  ) {
    super(message ?? code);
  }
}

function mapSafetyError(
  error: CvSafetyEvidenceError,
): CandidateCvFinalizationError {
  return new CandidateCvFinalizationError(
    error.code === "CV_NOT_CLEAN" ? "CV_NOT_READY" : error.code,
    error.message,
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002",
  );
}

/**
 * Materialize the CandidateCv projection only from a matching CLEAN scan
 * assessment and AVAILABLE encrypted source artifact. The bridge storage key
 * is deliberately not opened here; readers must use the evidence service.
 */
export async function finalizeCandidateCvFromUpload(input: {
  candidateUserId: string;
  uploadId: string;
  expectedPurpose: CvUploadPurpose;
  /**
   * Job-direct uploads use CandidateCv as a transaction bridge only. Keeping
   * that projection archived prevents it from extending source-artifact
   * retention after the application/document lifecycle ends.
   */
  archive?: boolean;
  now?: Date;
}): Promise<FinalizedCandidateCv> {
  const finalizedAt = input.now ?? new Date();
  const shouldArchive = input.archive === true;
  const evidenceService = new CvSafetyEvidenceService();
  let evidence;
  try {
    evidence = await evidenceService.assertCvArtifactSafeForUse({
      candidateUserId: input.candidateUserId,
      uploadId: input.uploadId,
      expectedPurpose: input.expectedPurpose,
      now: finalizedAt,
    });
  } catch (error) {
    if (error instanceof CvSafetyEvidenceError) throw mapSafetyError(error);
    throw error;
  }

  const candidateCvId = `candidate-cv-${input.uploadId}`;
  const existing = await prisma.candidateCv.findFirst({
    where: {
      candidateUserId: input.candidateUserId,
      sourceArtifactId: evidence.artifactId,
    },
    select: candidateCvSelect,
  });
  if (existing) {
    if (
      existing.scanAssessmentId === evidence.assessmentId &&
      existing.checksumSha256.toLowerCase() === evidence.checksumSha256 &&
      existing.byteSize === evidence.plaintextBytes &&
      existing.sourceArtifactId === evidence.artifactId &&
      existing.storageKey === evidence.storageLocator &&
      (shouldArchive ? existing.archivedAt !== null : existing.archivedAt === null)
    ) {
      return existing;
    }
    return prisma.candidateCv.update({
      where: { id: existing.id },
      data: {
        sourceArtifactId: evidence.artifactId,
        scanAssessmentId: evidence.assessmentId,
        byteSize: evidence.plaintextBytes,
        checksumSha256: evidence.checksumSha256,
        mimeType: evidence.mimeType,
        fileName: evidence.fileName,
        storageKey: evidence.storageLocator,
        confirmedAt: finalizedAt,
        archivedAt: shouldArchive ? finalizedAt : null,
      },
      select: candidateCvSelect,
    });
  }

  try {
    return await prisma.candidateCv.create({
      data: {
        id: candidateCvId,
        candidateUserId: input.candidateUserId,
        displayName: evidence.fileName.replace(/\.[^/.]+$/u, "") || "resume",
        fileName: evidence.fileName,
        mimeType: evidence.mimeType,
        byteSize: evidence.plaintextBytes,
        storageKey: evidence.storageLocator,
        checksumSha256: evidence.checksumSha256,
        sourceArtifactId: evidence.artifactId,
        scanAssessmentId: evidence.assessmentId,
        version: 1,
        confirmedAt: finalizedAt,
        archivedAt: shouldArchive ? finalizedAt : null,
      },
      select: candidateCvSelect,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await prisma.candidateCv.findFirst({
      where: {
        candidateUserId: input.candidateUserId,
        sourceArtifactId: evidence.artifactId,
      },
      select: candidateCvSelect,
    });
    if (raced) return raced;
    throw error;
  }
}
