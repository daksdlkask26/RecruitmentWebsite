import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticPdf } from "../../../helpers/cv-document-buffers";

const { storage } = vi.hoisted(() => ({
  storage: {
    assertReady: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/backend/cv/workers/cv-worker-resources", () => ({
  createCvWorkerStorage: () => storage,
}));

describe("prepareDirectApplicationCv ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.assertReady.mockResolvedValue(undefined);
    storage.delete.mockResolvedValue(undefined);
    storage.put.mockImplementation(
      async ({ expectedBytes, locator }: { expectedBytes: number; locator?: string }) => ({
        locator: locator ?? "temporary-cv-locator",
        bytes: expectedBytes,
      }),
    );
  });

  it("claims ownership after commit and makes later request cleanup a no-op", async () => {
    const { prepareDirectApplicationCv } =
      await import("@/backend/services/jobs/prepare-direct-application-cv");
    const bytes = createSyntheticPdf("ownership boundary");
    const prepared = await prepareDirectApplicationCv({
      fileName: "ownership.pdf",
      mimeType: "application/pdf",
      byteSize: bytes.byteLength,
      source: (async function* () {
        yield bytes;
      })(),
    });

    prepared.claimOwnership();
    await Promise.all([prepared.cleanup(), prepared.cleanup()]);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("deletes a temporary artifact at most once across concurrent cleanup calls", async () => {
    const { prepareDirectApplicationCv } =
      await import("@/backend/services/jobs/prepare-direct-application-cv");
    const bytes = createSyntheticPdf("temporary cleanup");
    const prepared = await prepareDirectApplicationCv({
      fileName: "temporary.pdf",
      mimeType: "application/pdf",
      byteSize: bytes.byteLength,
      source: (async function* () {
        yield bytes;
      })(),
    });

    await Promise.all([
      prepared.cleanup(),
      prepared.cleanup(),
      prepared.cleanup(),
    ]);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith("temporary-cv-locator");
  });

  it("allows cleanup to retry after a storage deletion failure", async () => {
    const { prepareDirectApplicationCv } =
      await import("@/backend/services/jobs/prepare-direct-application-cv");
    const bytes = createSyntheticPdf("retry cleanup");
    const prepared = await prepareDirectApplicationCv({
      fileName: "retry.pdf",
      mimeType: "application/pdf",
      byteSize: bytes.byteLength,
      source: (async function* () {
        yield bytes;
      })(),
    });
    storage.delete
      .mockRejectedValueOnce(new Error("STORAGE_DELETE_FAILED"))
      .mockResolvedValueOnce(undefined);

    await expect(prepared.cleanup()).rejects.toThrow("STORAGE_DELETE_FAILED");
    await expect(prepared.cleanup()).resolves.toBeUndefined();
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it("reserves a deterministic locator and defers the object write", async () => {
    const { prepareDirectApplicationCv } =
      await import("@/backend/services/jobs/prepare-direct-application-cv");
    const bytes = createSyntheticPdf("deferred storage");
    const prepared = await prepareDirectApplicationCv(
      {
        fileName: "deferred.pdf",
        mimeType: "application/pdf",
        byteSize: bytes.byteLength,
        source: (async function* () {
          yield bytes;
        })(),
      },
      { deferStorage: true },
    );

    expect(storage.put).not.toHaveBeenCalled();
    const reservedLocator = prepared.storageKey;
    expect(prepared.ensureStored).toBeTypeOf("function");
    await prepared.ensureStored!();
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({ locator: reservedLocator }),
    );
    expect(prepared.storageKey).toBe(reservedLocator);
  });

  it("keeps an ambiguous deferred write for reconciliation", async () => {
    const { prepareDirectApplicationCv } =
      await import("@/backend/services/jobs/prepare-direct-application-cv");
    const bytes = createSyntheticPdf("ambiguous deferred storage");
    storage.put.mockRejectedValueOnce(new Error("STORAGE_RESPONSE_LOST"));
    const prepared = await prepareDirectApplicationCv(
      {
        fileName: "ambiguous.pdf",
        mimeType: "application/pdf",
        byteSize: bytes.byteLength,
        source: (async function* () {
          yield bytes;
        })(),
      },
      { deferStorage: true },
    );

    expect(prepared.ensureStored).toBeTypeOf("function");
    await expect(prepared.ensureStored!()).rejects.toThrow(
      "STORAGE_RESPONSE_LOST",
    );
    await expect(prepared.cleanup()).resolves.toBeUndefined();
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
