/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CvAdmissionService } from "@/backend/services/cv-admission/cv-admission-service";
import { prisma } from "@/backend/database/prisma";

describe("Slice 2 — Common admission and envelope encryption", () => {
  const candidateUserId = "candidate-test-user-1";
  const profileId = "profile-test-1";
  const validPdf = new TextEncoder().encode(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n%%EOF",
  );

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects payload when declared length exceeds 5MB limit", async () => {
    const service = new CvAdmissionService();
    await expect(
      service.admit({
        candidateUserId,
        purpose: "PROFILE_DIRECT",
        fileName: "resume.pdf",
        contentType: "application/pdf",
        contentLength: 6 * 1024 * 1024,
        body: (async function* () {
          yield new Uint8Array(10);
        })(),
        idempotencyKey: "test-key-1",
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects a purpose and processing mode combination that cannot reach a valid terminal state", async () => {
    const service = new CvAdmissionService();
    await expect(
      service.admit({
        candidateUserId,
        purpose: "PROFILE_IMPORT",
        processingMode: "SCAN_ONLY",
        fileName: "resume.pdf",
        contentType: "application/pdf",
        contentLength: 1,
        body: (async function* () {
          yield new Uint8Array([0x25]);
        })(),
        idempotencyKey: "test-key-processing-mode",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects payload when actual stream length exceeds declared content length", async () => {
    vi.spyOn(prisma.candidateProfile, "findFirst").mockResolvedValueOnce({
      id: profileId,
      candidateUserId,
    } as any);

    const service = new CvAdmissionService();
    await expect(
      service.admit({
        candidateUserId,
        purpose: "PROFILE_DIRECT",
        fileName: "resume.pdf",
        contentType: "application/pdf",
        contentLength: 10,
        body: (async function* () {
          yield new Uint8Array(15);
        })(),
        idempotencyKey: "test-key-2",
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects payload when actual stream length is less than declared content length", async () => {
    vi.spyOn(prisma.candidateProfile, "findFirst").mockResolvedValueOnce({
      id: profileId,
      candidateUserId,
    } as any);

    const service = new CvAdmissionService();
    await expect(
      service.admit({
        candidateUserId,
        purpose: "PROFILE_DIRECT",
        fileName: "resume.pdf",
        contentType: "application/pdf",
        contentLength: 100,
        body: (async function* () {
          yield new Uint8Array(50);
        })(),
        idempotencyKey: "test-key-3",
      }),
    ).rejects.toMatchObject({ code: "CONTENT_LENGTH_MISMATCH" });
  });

  it("encrypts plaintext with envelope before storage and creates QUARANTINED artifact + QUEUED scan assessment", async () => {
    vi.spyOn(prisma.candidateProfile, "findFirst").mockResolvedValueOnce({
      id: profileId,
      candidateUserId,
    } as any);
    vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValueOnce(null);
    const storedChunks: Buffer[] = [];
    const mockStorage = {
      assertReady: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockImplementation(async ({ source, locator }) => {
        for await (const chunk of source) {
          storedChunks.push(Buffer.from(chunk));
        }
        return {
          locator,
          bytes: storedChunks.reduce((a, c) => a + c.byteLength, 0),
        };
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    let createdUploadData: any = null;
    let createdArtifactData: any = null;
    let createdScanData: any = null;
    let quotaUpdateData: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ accountId: "candidate-1" }]),
          cvAccountQuota: {
            upsert: vi.fn().mockResolvedValue({}),
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              reservedBytes: 0,
              retainedBytes: 0,
            }),
            update: vi.fn().mockImplementation(async ({ data }) => {
              quotaUpdateData = data;
              return {};
            }),
          },
          cvUpload: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockImplementation(async ({ data }) => {
              createdUploadData = data;
              return data;
            }),
          },
          cvStoredArtifact: {
            create: vi.fn().mockImplementation(async ({ data }) => {
              createdArtifactData = data;
              return data;
            }),
          },
          cvScanAssessment: {
            create: vi.fn().mockImplementation(async ({ data }) => {
              createdScanData = data;
              return data;
            }),
          },
        };
        return await callback(tx);
      },
    );

    const plaintextMarker = "CONFIDENTIAL_PLAINTEXT_CV_BODY_MARKER";
    const pdfHeader =
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nstream\n" +
      plaintextMarker +
      "\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
    const pdfBytes = new TextEncoder().encode(pdfHeader);

    const service = new CvAdmissionService(mockStorage as any);
    const result = await service.admit({
      candidateUserId,
      purpose: "TEAM_APPLICATION_DIRECT",
      fileName: "secure-cv.pdf",
      contentType: "application/pdf",
      contentLength: pdfBytes.byteLength,
      body: (async function* () {
        yield pdfBytes;
      })(),
      idempotencyKey: "test-idempotency-clean-1",
    });

    expect(result.uploadId).toBeDefined();
    expect(result.status).toBe("SCAN_QUEUED");
    expect(result.replayed).toBe(false);

    // GATE VERIFICATION 1: Storage contains ciphertext and NEVER plaintext marker
    const storedBuffer = Buffer.concat(storedChunks);
    expect(storedBuffer.includes(plaintextMarker)).toBe(false);

    // GATE VERIFICATION 2: Artifact stored as QUARANTINED with AES-256-GCM envelope
    expect(createdArtifactData).toBeDefined();
    expect(createdArtifactData.status).toBe("QUARANTINED");
    expect(createdArtifactData.encryptionKeyVersion).toBeGreaterThan(0);
    expect(createdArtifactData.encryptionIv.byteLength).toBe(12);
    expect(createdArtifactData.authenticationTag.byteLength).toBe(16);
    expect(createdArtifactData.plaintextBytes).toBe(pdfBytes.byteLength);

    // GATE VERIFICATION 3: Assessment QUEUED created exactly once
    expect(createdScanData).toBeDefined();
    expect(createdScanData.status).toBe("QUEUED");
    expect(createdScanData.attemptNumber).toBe(1);
    expect(createdScanData.uploadId).toBe(result.uploadId);
    expect(createdScanData.sourceArtifactId).toBe(createdArtifactData.id);

    // GATE VERIFICATION 4: Upload purpose and processingMode
    expect(createdUploadData.purpose).toBe("TEAM_APPLICATION_DIRECT");
    expect(createdUploadData.processingMode).toBe("SCAN_ONLY");
    expect(createdUploadData.policyVersion).toBe("unified-cv-v1");
    expect(quotaUpdateData).toEqual({
      retainedBytes: { increment: pdfBytes.byteLength },
      reservedBytes: { increment: 0 },
    });
  });

  it("handles duplicate idempotency: replays on matching digest, conflicts on different digest", async () => {
    const pdfHeader = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n%%EOF";
    const pdfBytes = new TextEncoder().encode(pdfHeader);

    const service = new CvAdmissionService();

    // Matching sha256 -> replayed
    vi.spyOn(prisma.candidateProfile, "findFirst").mockResolvedValue({
      id: profileId,
      candidateUserId,
    } as any);

    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(pdfBytes).digest();

    vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValueOnce({
      id: "existing-upload-123",
      status: "SCAN_QUEUED",
      sourceSha256: digest,
    } as any);

    const replayedResult = await service.admit({
      candidateUserId,
      purpose: "PROFILE_DIRECT",
      fileName: "resume.pdf",
      contentType: "application/pdf",
      contentLength: pdfBytes.byteLength,
      body: (async function* () {
        yield pdfBytes;
      })(),
      idempotencyKey: "idempotent-key-same",
    });

    expect(replayedResult.replayed).toBe(true);
    expect(replayedResult.uploadId).toBe("existing-upload-123");

    // Replay with different sha256 -> 409 conflict
    vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValueOnce({
      id: "existing-upload-123",
      status: "SCAN_QUEUED",
      sourceSha256: Buffer.from(
        "different-digest-bytes-00000000000000000000000000000000",
      ),
    } as any);

    await expect(
      service.admit({
        candidateUserId,
        purpose: "PROFILE_DIRECT",
        fileName: "resume.pdf",
        contentType: "application/pdf",
        contentLength: pdfBytes.byteLength,
        body: (async function* () {
          yield pdfBytes;
        })(),
        idempotencyKey: "idempotent-key-different",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("cleans a committed storage object only after DB confirms no artifact row", async () => {
    vi.spyOn(prisma.candidateProfile, "findFirst").mockResolvedValueOnce({
      id: profileId,
      candidateUserId,
    } as any);
    vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValueOnce(null);
    vi.spyOn(prisma.cvStoredArtifact, "findUnique").mockResolvedValueOnce(
      null,
    );
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    const mockStorage = {
      assertReady: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockImplementation(async ({ source, locator }) => {
        for await (const chunk of source) void chunk;
        return { locator, bytes: validPdf.byteLength };
      }),
      delete: vi.fn().mockResolvedValue({ deleted: true }),
    };

    await expect(
      new CvAdmissionService(mockStorage as any).admit({
        candidateUserId,
        purpose: "JOB_APPLICATION_DIRECT",
        fileName: "resume.pdf",
        contentType: "application/pdf",
        contentLength: validPdf.byteLength,
        body: (async function* () {
          yield validPdf;
        })(),
        idempotencyKey: "storage-commit-db-failure",
      }),
    ).rejects.toThrow("database unavailable");
    expect(mockStorage.delete).toHaveBeenCalledOnce();
  });

  it("preserves the planned locator when storage outcome is unknown", async () => {
    vi.spyOn(prisma.candidateProfile, "findFirst").mockResolvedValueOnce({
      id: profileId,
      candidateUserId,
    } as any);
    vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValueOnce(null);
    const transaction = vi.spyOn(prisma, "$transaction");

    const mockStorage = {
      assertReady: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockImplementation(async ({ source }) => {
        for await (const chunk of source) void chunk;
        throw new Error("provider response timed out after commit");
      }),
      delete: vi.fn().mockResolvedValue({ deleted: true }),
    };

    await expect(
      new CvAdmissionService(mockStorage as any).admit({
        candidateUserId,
        purpose: "TEAM_APPLICATION_DIRECT",
        fileName: "resume.pdf",
        contentType: "application/pdf",
        contentLength: validPdf.byteLength,
        body: (async function* () {
          yield validPdf;
        })(),
        idempotencyKey: "storage-unknown-outcome",
      }),
    ).rejects.toThrow("provider response timed out after commit");
    expect(mockStorage.delete).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
