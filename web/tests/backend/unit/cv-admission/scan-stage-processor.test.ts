/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScanStageProcessor } from "@/backend/cv/workers/scan-stage";
import { prisma } from "@/backend/database/prisma";
import * as workerResources from "@/backend/cv/workers/cv-worker-resources";
import type { CvWorkClaim } from "@/backend/repositories/cv-import/prisma-cv-work-repository";

describe("Slice 3 — ScanStageProcessor and policy freshness", () => {
  const claim: CvWorkClaim = {
    id: "assessment-1",
    uploadId: "upload-1",
    accountId: "account-1",
    attemptNumber: 1,
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(Date.now() + 60_000),
  };

  const dummyContext = {
    now: new Date("2026-08-01T04:00:00.000Z"),
    signal: new AbortController().signal,
  };

  const sampleSha256 = Buffer.alloc(32, 1);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function setupMocks(options: {
    processingMode: "SCAN_ONLY" | "IMPORT_AND_PARSE";
    purpose?:
      | "TEAM_APPLICATION_DIRECT"
      | "PROFILE_DIRECT"
      | "JOB_APPLICATION_DIRECT"
      | "PROFILE_IMPORT";
    scanOutcome?: "CLEAN" | "INFECTED";
    scannerError?: Error;
    magicBytes?: Buffer;
  }) {
    const assessment = {
      id: claim.id,
      attemptNumber: 1,
      candidateInitiated: false,
      startedAt: new Date("2026-08-01T04:00:00.000Z"),
      upload: {
        id: claim.uploadId,
        accountId: claim.accountId,
        status: "SCAN_QUEUED",
        actualBytes: 100,
        declaredBytes: 100,
        documentKind: "PDF",
        declaredMediaType: "application/pdf",
        expiresAt: new Date(Date.now() + 3600_000),
        purpose:
          options.purpose ??
          (options.processingMode === "IMPORT_AND_PARSE"
            ? "PROFILE_IMPORT"
            : "TEAM_APPLICATION_DIRECT"),
        processingMode: options.processingMode,
        policyVersion: "unified-cv-v1",
      },
      sourceArtifact: {
        id: "artifact-1",
        accountId: claim.accountId,
        kind: "SOURCE_DOCUMENT",
        storageLocator: "cv/test-artifact.enc",
        encryptionKeyVersion: 1,
        plaintextBytes: 100,
        ciphertextBytes: 128,
      },
    };

    vi.spyOn(prisma.cvScanAssessment, "findFirst").mockResolvedValue(
      assessment as any,
    );
    vi.spyOn(prisma.cvUpload, "updateMany").mockResolvedValue({ count: 1 });

    vi.spyOn(workerResources, "readCvWorkerArtifactBytes").mockResolvedValue({
      encryptionIv: Buffer.alloc(12, 0),
      authenticationTag: Buffer.alloc(16, 0),
      plaintextSha256: sampleSha256,
      sourceSha256: sampleSha256,
    });

    const magic = options.magicBytes ?? Buffer.from("%PDF-1.7\n");
    const mockReader = {
      verify: vi.fn().mockResolvedValue({
        plaintextBytes: 100,
        open: async function* () {
          yield magic;
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const mockStorage = {
      assertReady: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
    };

    const mockScanner = {
      scan: vi.fn().mockImplementation(async () => {
        if (options.scannerError) throw options.scannerError;
        return {
          outcome: options.scanOutcome ?? "CLEAN",
          engineVersion: "1.4.0",
        };
      }),
      assessmentMetadata: vi.fn().mockReturnValue({
        engineVersion: "1.4.0",
        signatureVersion: "27000",
        publishedAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
    };

    const mockWorkRepository = {
      assertStageResultCommitAllowed: vi.fn().mockResolvedValue(undefined),
    };

    return {
      processor: new ScanStageProcessor(
        {
          storage: mockStorage as any,
          reader: mockReader as any,
          scanner: mockScanner as any,
        },
        mockWorkRepository as any,
      ),
      mockScanner,
      mockReader,
    };
  }

  it("updates upload to SECURITY_CLEAN and does NOT create extraction when processingMode is SCAN_ONLY", async () => {
    const { processor } = setupMocks({ processingMode: "SCAN_ONLY" });

    let updatedScanAssessment: any = null;
    let updatedArtifact: any = null;
    let updatedUpload: any = null;
    let createdExtraction: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        return callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: claim.id }]),
          cvScanAssessment: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              updatedScanAssessment = data;
              return { id: claim.id };
            }),
          },
          cvStoredArtifact: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              updatedArtifact = data;
              return { id: "artifact-1" };
            }),
          },
          cvUpload: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              updatedUpload = data;
              return { id: claim.uploadId };
            }),
          },
          cvExtraction: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              createdExtraction = data;
              return { id: "extraction-1" };
            }),
          },
        });
      },
    );

    const outcome = await processor.process(claim, dummyContext);

    expect(outcome).toEqual({ status: "CLEAN" });
    expect(updatedScanAssessment?.status).toBe("CLEAN");
    expect(updatedScanAssessment?.engineName).toBe("clamav");
    expect(updatedArtifact?.status).toBe("AVAILABLE");
    expect(updatedArtifact?.deleteAfter).toBeNull();
    expect(updatedUpload?.status).toBe("SECURITY_CLEAN");
    expect(createdExtraction).toBeNull();
  });

  it("updates upload to EXTRACTION_QUEUED and enqueues extraction when processingMode is IMPORT_AND_PARSE", async () => {
    const { processor } = setupMocks({ processingMode: "IMPORT_AND_PARSE" });

    let updatedUpload: any = null;
    let createdExtraction: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        return callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: claim.id }]),
          cvScanAssessment: {
            update: vi.fn().mockResolvedValue({ id: claim.id }),
          },
          cvStoredArtifact: {
            update: vi.fn().mockResolvedValue({ id: "artifact-1" }),
          },
          cvUpload: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              updatedUpload = data;
              return { id: claim.uploadId };
            }),
          },
          cvExtraction: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              createdExtraction = data;
              return { id: "extraction-1" };
            }),
          },
        });
      },
    );

    const outcome = await processor.process(claim, dummyContext);

    expect(outcome).toEqual({ status: "CLEAN" });
    expect(updatedUpload?.status).toBe("EXTRACTION_QUEUED");
    expect(createdExtraction).not.toBeNull();
    expect(createdExtraction?.status).toBe("QUEUED");
  });

  it("handles INFECTED scan outcome by marking assessment INFECTED and artifact DELETE_PENDING", async () => {
    const { processor } = setupMocks({
      processingMode: "SCAN_ONLY",
      scanOutcome: "INFECTED",
    });

    let updatedScanAssessment: any = null;
    let artifactUpdateData: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        return callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: claim.id }]),
          cvScanAssessment: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              updatedScanAssessment = data;
              return { id: claim.id };
            }),
          },
          cvStoredArtifact: {
            updateMany: vi.fn().mockImplementation(async ({ data }: any) => {
              artifactUpdateData = data;
              return { count: 1 };
            }),
          },
          cvUpload: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        });
      },
    );

    const outcome = await processor.process(claim, dummyContext);

    expect(outcome).toEqual({
      status: "INFECTED",
      failureCode: "MALWARE_DETECTED",
    });
    expect(updatedScanAssessment?.status).toBe("INFECTED");
    expect(updatedScanAssessment?.failureCode).toBe("MALWARE_DETECTED");
    expect(artifactUpdateData?.status).toBe("DELETE_PENDING");
  });

  it("handles SCANNER_UNAVAILABLE error by recording failure on scan assessment and upload", async () => {
    const scannerError = Object.assign(new Error("Scanner unreachable"), {
      code: "ECONNREFUSED",
    });
    const { processor } = setupMocks({
      processingMode: "SCAN_ONLY",
      scannerError,
    });

    let assessmentUpdate: any = null;
    let uploadUpdate: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        return callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: claim.id }]),
          cvScanAssessment: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              assessmentUpdate = data;
              return { id: claim.id };
            }),
          },
          cvUpload: {
            updateMany: vi.fn().mockImplementation(async ({ data }: any) => {
              uploadUpdate = data;
              return { count: 1 };
            }),
          },
        });
      },
    );

    const outcome = await processor.process(claim, dummyContext);

    expect(outcome).toEqual({
      status: "INDETERMINATE",
      failureCode: "SCANNER_UNAVAILABLE",
    });
    expect(assessmentUpdate?.status).toBe("INDETERMINATE");
    expect(assessmentUpdate?.failureCode).toBe("SCANNER_UNAVAILABLE");
    expect(uploadUpdate?.status).toBe("SCAN_FAILED");
    expect(uploadUpdate?.failureCode).toBe("SCANNER_UNAVAILABLE");
  });

  it("handles SCANNER_DEFINITIONS_STALE error by recording failure on scan assessment", async () => {
    const scannerError = Object.assign(new Error("Stale"), {
      code: "CV_SCANNER_DEFINITIONS_STALE",
    });
    const { processor } = setupMocks({
      processingMode: "SCAN_ONLY",
      scannerError,
    });

    let assessmentUpdate: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        return callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: claim.id }]),
          cvScanAssessment: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              assessmentUpdate = data;
              return { id: claim.id };
            }),
          },
          cvUpload: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        });
      },
    );

    const outcome = await processor.process(claim, dummyContext);

    expect(outcome).toEqual({
      status: "INDETERMINATE",
      failureCode: "SCANNER_DEFINITIONS_STALE",
    });
    expect(assessmentUpdate?.status).toBe("INDETERMINATE");
    expect(assessmentUpdate?.failureCode).toBe("SCANNER_DEFINITIONS_STALE");
  });

  it("rejects corrupted magic bytes by setting UNSUPPORTED_DOCUMENT on assessment and artifact DELETE_PENDING", async () => {
    const { processor } = setupMocks({
      processingMode: "SCAN_ONLY",
      magicBytes: Buffer.from("NOT_A_PDF"),
    });

    let assessmentUpdate: any = null;
    let artifactUpdateData: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        return callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: claim.id }]),
          cvScanAssessment: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              assessmentUpdate = data;
              return { id: claim.id };
            }),
          },
          cvStoredArtifact: {
            updateMany: vi.fn().mockImplementation(async ({ data }: any) => {
              artifactUpdateData = data;
              return { count: 1 };
            }),
          },
          cvUpload: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        });
      },
    );

    const outcome = await processor.process(claim, dummyContext);

    expect(outcome).toEqual({
      status: "INDETERMINATE",
      failureCode: "UNSUPPORTED_DOCUMENT",
    });
    expect(assessmentUpdate?.status).toBe("INDETERMINATE");
    expect(assessmentUpdate?.failureCode).toBe("UNSUPPORTED_DOCUMENT");
    expect(artifactUpdateData?.status).toBe("DELETE_PENDING");
  });
});
