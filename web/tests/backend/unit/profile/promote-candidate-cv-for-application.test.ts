import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCvWorkerStorage: vi.fn(),
  createCvWorkerCryptor: vi.fn(),
  createCvWorkerIntegrityReader: vi.fn(),
}));

vi.mock("@/backend/cv/workers/cv-worker-resources", () => mocks);

import { promoteCandidateCvForApplication } from "@/backend/services/profile/promote-candidate-cv-for-application";

function destination() {
  return {
    assertReady: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue({
      locator: "application-cv-locator",
      bytes: 64,
      storagePurposeVersion: "application-document-v1",
    }),
    open: vi.fn(),
    delete: vi.fn(),
  };
}

function sourceCv(id = "candidate-cv-upload-1") {
  return {
    id,
    candidateUserId: "candidate-1",
    byteSize: 64,
    checksumSha256: "a".repeat(64),
  };
}

describe("promoteCandidateCvForApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies the encrypted import artifact before promoting it", async () => {
    const target = destination();
    const sourceStorage = {
      assertReady: vi.fn().mockResolvedValue(undefined),
    };
    const verified = {
      plaintextBytes: 64,
      open: vi.fn(() =>
        (async function* () {
          yield new Uint8Array(64);
        })(),
      ),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const reader = {
      verify: vi.fn().mockResolvedValue(verified),
    };
    mocks.createCvWorkerStorage.mockReturnValue(sourceStorage);
    mocks.createCvWorkerCryptor.mockReturnValue("cryptor");
    mocks.createCvWorkerIntegrityReader.mockReturnValue(reader);
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "artifact-1",
          storageLocator: "cv-source-locator",
          encryptionKeyVersion: 1,
          encryptionIvHex: "11".repeat(12),
          authenticationTagHex: "22".repeat(16),
          plaintextBytes: 64,
          ciphertextBytes: 96,
          plaintextSha256Hex: "a".repeat(64),
        },
      ]),
    };

    const result = await promoteCandidateCvForApplication(
      sourceCv(),
      target as never,
      db as never,
    );

    expect(result).toMatchObject({ destination: target });
    expect(reader.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        locator: "cv-source-locator",
        ciphertextBytes: 96,
        plaintextBytes: 64,
        context: expect.objectContaining({
          accountId: "candidate-1",
          uploadId: "upload-1",
          artifactId: "artifact-1",
        }),
      }),
    );
    expect(target.assertReady).toHaveBeenCalledOnce();
    expect(target.put).toHaveBeenCalledWith({
      expectedBytes: 64,
      source: expect.anything(),
    });
    expect(verified.dispose).toHaveBeenCalledOnce();
  });

  it("reuses a committed application document when no import artifact is available", async () => {
    const target = destination();
    target.open.mockReturnValue(
      (async function* () {
        yield new Uint8Array(64);
      })(),
    );
    const db = {
      $queryRaw: vi.fn(),
      applicationDocument: {
        findFirst: vi.fn().mockResolvedValue({
          storageKeyEncrypted: "existing-application-locator",
          byteLength: 64,
        }),
      },
    };

    const result = await promoteCandidateCvForApplication(
      sourceCv("legacy-cv-1"),
      target as never,
      db as never,
    );

    expect(result).toMatchObject({ destination: target });
    expect(db.applicationDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceCandidateCvId: "legacy-cv-1",
          contentDigestHmac: "a".repeat(64),
          byteLength: 64,
        }),
      }),
    );
    expect(target.open).toHaveBeenCalledWith(
      "existing-application-locator",
      64,
    );
    expect(target.put).toHaveBeenCalledOnce();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
