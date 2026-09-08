import "server-only";

import { prisma } from "@/backend/database/prisma";
import { safeFilename } from "@/backend/services/cv-import/cv-import-projection";
import type { CvUploadPurpose } from "@/backend/generated/prisma/client";
import { CV_SECURITY_POLICY_VERSION } from "@/shared/contracts/cv-import/common";

export class CvSafetyEvidenceError extends Error {
  constructor(
    readonly code:
      | "CV_NOT_FOUND"
      | "CV_NOT_CLEAN"
      | "CV_EXPIRED"
      | "CV_PURPOSE_MISMATCH"
      | "CV_INTEGRITY_FAILED",
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type AssertCvArtifactSafeInput = Readonly<{
  candidateUserId: string;
  uploadId: string;
  artifactId?: string;
  assessmentId?: string;
  expectedPurpose?: CvUploadPurpose;
  allowedPurposes?: readonly CvUploadPurpose[];
  now?: Date;
}>;

export type SafeCvArtifactEvidence = Readonly<{
  uploadId: string;
  candidateUserId: string;
  artifactId: string;
  assessmentId: string;
  storageLocator: string;
  storageAdapter: string;
  encryptionKeyVersion: number;
  plaintextBytes: number;
  ciphertextBytes: number;
  checksumSha256: string;
  fileName: string;
  mimeType: string;
  scanStatus: "CLEAN";
  completedAt: Date;
}>;

export class CvSafetyEvidenceService {
  async assertCvArtifactSafeForUse(
    input: AssertCvArtifactSafeInput,
  ): Promise<SafeCvArtifactEvidence> {
    const now = input.now ?? new Date();

    // 1. Verify upload ownership, state, and purpose
    const upload = await prisma.cvUpload.findFirst({
      where: {
        id: input.uploadId,
        accountId: input.candidateUserId,
        deletedAt: null,
        contentInaccessibleAt: null,
      },
      select: {
        id: true,
        accountId: true,
        status: true,
        purpose: true,
        processingMode: true,
        declaredMediaType: true,
        declaredBytes: true,
        actualBytes: true,
        policyVersion: true,
        confirmedAt: true,
        displayFilenameCiphertext: true,
        expiresAt: true,
      },
    });

    if (!upload) {
      throw new CvSafetyEvidenceError("CV_NOT_FOUND", "CV upload not found.");
    }

    if (input.expectedPurpose && upload.purpose !== input.expectedPurpose) {
      throw new CvSafetyEvidenceError(
        "CV_PURPOSE_MISMATCH",
        "CV upload purpose does not match expected purpose.",
      );
    }

    if (
      input.allowedPurposes &&
      !input.allowedPurposes.includes(upload.purpose)
    ) {
      throw new CvSafetyEvidenceError(
        "CV_PURPOSE_MISMATCH",
        "CV upload purpose is not allowed for this use.",
      );
    }

    const expectedProcessingMode =
      upload.purpose === "PROFILE_IMPORT" ? "IMPORT_AND_PARSE" : "SCAN_ONLY";
    if (upload.processingMode !== expectedProcessingMode) {
      throw new CvSafetyEvidenceError(
        "CV_PURPOSE_MISMATCH",
        "CV upload processing mode does not match expected purpose.",
      );
    }

    // Direct uploads become usable only after the security-only pipeline
    // reaches SECURITY_CLEAN. Imported profile CVs become usable only after
    // the explicit review/confirmation lifecycle reaches CONFIRMED. A
    // transient extraction/parsing state is not evidence of usability.
    const expectedStatuses =
      upload.purpose === "PROFILE_IMPORT"
        ? new Set(["CONFIRMED"])
        : new Set(["SECURITY_CLEAN"]);

    if (!expectedStatuses.has(upload.status)) {
      throw new CvSafetyEvidenceError(
        "CV_NOT_CLEAN",
        "CV has not completed safety scanning or is not clean.",
      );
    }
    if (upload.purpose === "PROFILE_IMPORT" && !upload.confirmedAt) {
      throw new CvSafetyEvidenceError(
        "CV_NOT_CLEAN",
        "CV import has not completed confirmation.",
      );
    }

    // 2. Verify stored artifact is available and unexpired
    const artifact = await prisma.cvStoredArtifact.findFirst({
      where: {
        uploadId: upload.id,
        accountId: input.candidateUserId,
        kind: "SOURCE_DOCUMENT",
        status: "AVAILABLE",
        deletedAt: null,
        contentInaccessibleAt: null,
        ...(input.artifactId ? { id: input.artifactId } : {}),
      },
      select: {
        id: true,
        storageAdapter: true,
        storageLocator: true,
        encryptionKeyVersion: true,
        plaintextBytes: true,
        ciphertextBytes: true,
        candidateCvs: {
          where: { archivedAt: null },
          take: 1,
          select: { id: true },
        },
        applicationDocuments: {
          where: { deletedAt: null },
          take: 1,
          select: { id: true },
        },
        teamApplications: {
          where: { cvDeletedAt: null },
          take: 1,
          select: { id: true },
        },
      },
    });

    if (!artifact) {
      throw new CvSafetyEvidenceError(
        "CV_NOT_FOUND",
        "Available source artifact not found.",
      );
    }

    const retainedByBusinessRecord =
      Boolean(artifact.candidateCvs?.length) ||
      Boolean(artifact.applicationDocuments?.length) ||
      Boolean(artifact.teamApplications?.length);
    if (upload.expiresAt <= now && !retainedByBusinessRecord) {
      throw new CvSafetyEvidenceError("CV_EXPIRED", "CV upload has expired.");
    }

    // PrismaPg currently returns PostgreSQL bytea projections in a shape the
    // generated client cannot deserialize as Bytes. Keep the model queries
    // free of bytea columns and reconstruct the two digests from PostgreSQL's
    // stable hex representation. Lightweight unit doubles may still provide
    // the byte fields directly, so preserve that contract without touching
    // the database in those tests.
    const uploadWithOptionalBytes = upload as typeof upload & {
      sourceSha256?: Uint8Array | null;
    };
    const artifactWithOptionalBytes = artifact as typeof artifact & {
      plaintextSha256?: Uint8Array | null;
    };
    let sourceSha256 =
      uploadWithOptionalBytes.sourceSha256 === undefined
        ? undefined
        : uploadWithOptionalBytes.sourceSha256
          ? Buffer.from(uploadWithOptionalBytes.sourceSha256)
          : null;
    let artifactSha256 =
      artifactWithOptionalBytes.plaintextSha256 === undefined
        ? undefined
        : artifactWithOptionalBytes.plaintextSha256
          ? Buffer.from(artifactWithOptionalBytes.plaintextSha256)
          : null;
    if (sourceSha256 === undefined || artifactSha256 === undefined) {
      const digestRows = await prisma.$queryRaw<
        Array<{
          sourceSha256Hex: string | null;
          artifactSha256Hex: string | null;
        }>
      >`
        SELECT encode(upload."sourceSha256", 'hex') AS "sourceSha256Hex",
               encode(artifact."plaintextSha256", 'hex') AS "artifactSha256Hex"
          FROM "CvUpload" upload
          JOIN "CvStoredArtifact" artifact
            ON artifact."uploadId" = upload."id"
           AND artifact."accountId" = upload."accountId"
         WHERE upload."id" = ${upload.id}
           AND artifact."id" = ${artifact.id}
         LIMIT 1
      `;
      const digestRow = digestRows[0];
      sourceSha256 ??= digestRow?.sourceSha256Hex
        ? Buffer.from(digestRow.sourceSha256Hex, "hex")
        : null;
      artifactSha256 ??= digestRow?.artifactSha256Hex
        ? Buffer.from(digestRow.artifactSha256Hex, "hex")
        : null;
    }

    // 3. Verify scan assessment is present and CLEAN
    const assessment = await prisma.cvScanAssessment.findFirst({
      where: {
        uploadId: upload.id,
        accountId: input.candidateUserId,
        status: "CLEAN",
        completedAt: { not: null },
        sourceArtifactId: artifact.id,
        policyVersion: CV_SECURITY_POLICY_VERSION,
        ...(input.assessmentId ? { id: input.assessmentId } : {}),
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        completedAt: true,
        policyVersion: true,
        engineName: true,
        engineVersion: true,
        signatureVersion: true,
        signaturePublishedAt: true,
      },
    });

    if (
      !assessment ||
      assessment.status !== "CLEAN" ||
      !assessment.completedAt ||
      assessment.policyVersion !== upload.policyVersion ||
      assessment.engineName !== "clamav" ||
      !assessment.engineVersion ||
      !assessment.signatureVersion ||
      !assessment.signaturePublishedAt ||
      !sourceSha256 ||
      !artifactSha256 ||
      !sourceSha256.equals(artifactSha256) ||
      artifact.plaintextBytes !== upload.actualBytes ||
      artifact.plaintextBytes !== upload.declaredBytes
    ) {
      throw new CvSafetyEvidenceError(
        "CV_INTEGRITY_FAILED",
        "CV safety evidence does not match the admitted artifact.",
      );
    }

    const decryptedFileName = safeFilename(upload.displayFilenameCiphertext, {
      accountId: upload.accountId,
      uploadId: upload.id,
    });

    return Object.freeze({
      uploadId: upload.id,
      candidateUserId: upload.accountId,
      artifactId: artifact.id,
      assessmentId: assessment.id,
      storageLocator: artifact.storageLocator,
      storageAdapter: artifact.storageAdapter,
      encryptionKeyVersion: artifact.encryptionKeyVersion,
      plaintextBytes: artifact.plaintextBytes,
      ciphertextBytes: artifact.ciphertextBytes,
      checksumSha256: sourceSha256.toString("hex"),
      fileName: decryptedFileName || "cv-document",
      mimeType: upload.declaredMediaType,
      scanStatus: "CLEAN" as const,
      completedAt: assessment.completedAt,
    });
  }
}
