import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/backend/database/prisma";
import { CvSafetyEvidenceService } from "@/backend/services/cv-admission/cv-safety-evidence-service";

const checksum = Buffer.alloc(32, 7);
const now = new Date("2026-09-07T00:00:00.000Z");

function mockEvidence(input: {
  expiresAt?: Date;
  retained?: boolean;
  engineVersion?: string | null;
  purpose?: "PROFILE_DIRECT" | "TEAM_APPLICATION_DIRECT";
}) {
  vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValue({
    id: "upload-1",
    accountId: "candidate-1",
    status: "SECURITY_CLEAN",
    purpose: input.purpose ?? "PROFILE_DIRECT",
    processingMode: "SCAN_ONLY",
    declaredMediaType: "application/pdf",
    declaredBytes: 64,
    actualBytes: 64,
    sourceSha256: checksum,
    policyVersion: "unified-cv-v1",
    confirmedAt: null,
    displayFilenameCiphertext: null,
    expiresAt: input.expiresAt ?? new Date("2027-09-07T00:00:00.000Z"),
  } as never);
  vi.spyOn(prisma.cvStoredArtifact, "findFirst").mockResolvedValue({
    id: "artifact-1",
    storageAdapter: "filesystem",
    storageLocator: "encrypted-source",
    encryptionKeyVersion: 1,
    plaintextBytes: 64,
    ciphertextBytes: 92,
    plaintextSha256: checksum,
    candidateCvs: input.retained ? [{ id: "cv-1" }] : [],
    applicationDocuments: [],
    teamApplications: [],
  } as never);
  vi.spyOn(prisma.cvScanAssessment, "findFirst").mockResolvedValue({
    id: "assessment-1",
    status: "CLEAN",
    completedAt: now,
    policyVersion: "unified-cv-v1",
    engineName: "clamav",
    engineVersion:
      input.engineVersion === undefined ? "1.4.3" : input.engineVersion,
    signatureVersion: "test-signatures",
    signaturePublishedAt: now,
  } as never);
}

describe("CvSafetyEvidenceService", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects a CLEAN row without complete scanner provenance", async () => {
    mockEvidence({ engineVersion: null });

    await expect(
      new CvSafetyEvidenceService().assertCvArtifactSafeForUse({
        candidateUserId: "candidate-1",
        uploadId: "upload-1",
      }),
    ).rejects.toMatchObject({ code: "CV_INTEGRITY_FAILED" });
  });

  it("rejects an expired admission that no business record retained", async () => {
    mockEvidence({ expiresAt: new Date(now.getTime() - 1) });

    await expect(
      new CvSafetyEvidenceService().assertCvArtifactSafeForUse({
        candidateUserId: "candidate-1",
        uploadId: "upload-1",
        now,
      }),
    ).rejects.toMatchObject({ code: "CV_EXPIRED" });
  });

  it("keeps an expired admission usable through its active encrypted projection", async () => {
    mockEvidence({
      expiresAt: new Date(now.getTime() - 1),
      retained: true,
    });

    await expect(
      new CvSafetyEvidenceService().assertCvArtifactSafeForUse({
        candidateUserId: "candidate-1",
        uploadId: "upload-1",
        now,
      }),
    ).resolves.toMatchObject({ artifactId: "artifact-1", scanStatus: "CLEAN" });
  });

  it("rejects a Team Application upload at an application-document boundary", async () => {
    mockEvidence({ purpose: "TEAM_APPLICATION_DIRECT" });

    await expect(
      new CvSafetyEvidenceService().assertCvArtifactSafeForUse({
        candidateUserId: "candidate-1",
        uploadId: "upload-1",
        allowedPurposes: [
          "PROFILE_IMPORT",
          "PROFILE_DIRECT",
          "JOB_APPLICATION_DIRECT",
        ],
      }),
    ).rejects.toMatchObject({ code: "CV_PURPOSE_MISMATCH" });
  });
});
