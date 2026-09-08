import { describe, expect, it, vi } from "vitest";
import {
  archiveCandidateCv,
  ensureCandidateCvLibrary,
  renameCandidateCv,
} from "@/backend/services/profile/candidate-cv-library";

describe("candidate CV library", () => {
  it("decodes confirmed import checksums selected through the PrismaPg-safe query", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: "upload-openai-raw-1",
        declaredMediaType: "application/pdf",
        actualBytes: 2048,
        sourceSha256Hex: "ab".repeat(32),
        confirmedAt: new Date("2026-08-07T00:00:00.000Z"),
        displayFilenameCiphertext: null,
      },
    ]);
    const db = {
      $queryRaw: queryRaw,
      candidateCv: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert,
      },
    } as never;

    await ensureCandidateCvLibrary("user-1", db);

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          id: "candidate-cv-upload-openai-raw-1",
          checksumSha256: "ab".repeat(32),
        }),
      }),
    );
  });

  it("projects confirmed deterministic and OpenAI imports into retained CV options", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const candidateFindMany = vi.fn().mockResolvedValue([]);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "upload-openai-1",
        declaredMediaType: "application/pdf",
        actualBytes: 2048,
        sourceSha256: Uint8Array.from({ length: 32 }, (_, index) => index),
        confirmedAt: new Date("2026-08-07T00:00:00.000Z"),
      },
    ]);
    const db = {
      cvUpload: { findMany },
      candidateCv: { findMany: candidateFindMany, upsert },
    } as never;

    await ensureCandidateCvLibrary("user-1", db);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: "user-1",
          parserClass: {
            in: ["DETERMINISTIC_INTERNAL", "EXTERNAL_OPENAI"],
          },
          status: "CONFIRMED",
        }),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "candidate-cv-upload-openai-1" },
        create: expect.objectContaining({
          id: "candidate-cv-upload-openai-1",
          candidateUserId: "user-1",
          displayName: "candidate-cv.pdf",
          fileName: "candidate-cv.pdf",
          confirmedAt: new Date("2026-08-07T00:00:00.000Z"),
        }),
      }),
    );
  });

  it("updates the stable upload-derived row when its storage key is stale", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      cvUpload: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "upload-1",
            declaredMediaType: "application/pdf",
            actualBytes: 10,
            sourceSha256: new Uint8Array(32),
            confirmedAt: new Date("2026-08-07T00:00:00.000Z"),
            displayFilenameCiphertext: null,
          },
        ]),
      },
      candidateCv: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "candidate-cv-upload-1",
            candidateUserId: "user-1",
            storageKey: "stale-key",
            displayName: "Imported CV",
          },
        ]),
        upsert,
      },
    } as never;

    await ensureCandidateCvLibrary("user-1", db);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "candidate-cv-upload-1" },
        update: expect.objectContaining({
          storageKey: "candidate-cv-upload-1",
        }),
      }),
    );
  });

  it("does not preserve a legacy materialized plaintext locator", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const materialized = "A".repeat(43);
    const db = {
      cvUpload: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "upload-1",
            declaredMediaType: "application/pdf",
            actualBytes: 10,
            sourceSha256: new Uint8Array(32),
            confirmedAt: new Date("2026-08-07T00:00:00.000Z"),
            displayFilenameCiphertext: null,
          },
        ]),
      },
      candidateCv: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "candidate-cv-upload-1",
            candidateUserId: "user-1",
            storageKey: materialized,
            displayName: "Imported CV",
          },
        ]),
        upsert,
      },
    } as never;

    await ensureCandidateCvLibrary("user-1", db);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          storageKey: "candidate-cv-upload-1",
        }),
      }),
    );
  });

  it("preserves a user filename after upload metadata is scrubbed", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      cvUpload: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "upload-1",
            declaredMediaType: "application/pdf",
            actualBytes: 10,
            sourceSha256: new Uint8Array(32),
            confirmedAt: new Date("2026-08-07T00:00:00.000Z"),
            displayFilenameCiphertext: null,
          },
        ]),
      },
      candidateCv: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "candidate-cv-upload-1",
            candidateUserId: "user-1",
            storageKey: "candidate-cv-upload-1",
            displayName: "cv-02_LE_THI_HOA.pdf",
            fileName: "cv-02_LE_THI_HOA.pdf",
          },
        ]),
        upsert,
      },
    } as never;

    await ensureCandidateCvLibrary("user-1", db);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          fileName: "cv-02_LE_THI_HOA.pdf",
        }),
      }),
    );
  });

  it("renames the display label and archives without touching the storage metadata", async () => {
    const confirmedAt = new Date("2026-08-07T00:00:00.000Z");
    const archivedAt = new Date("2026-08-07T01:00:00.000Z");
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: "candidate-cv-1",
        displayName: "resume.pdf",
        fileName: "imported-cv-upload-1.pdf",
        mimeType: "application/pdf",
        byteSize: 2048,
        version: 1,
        confirmedAt,
      })
      .mockResolvedValueOnce({ id: "candidate-cv-1" });
    const update = vi
      .fn()
      .mockResolvedValueOnce({
        id: "candidate-cv-1",
        displayName: "Tuấn CV - Community Manager",
        fileName: "imported-cv-upload-1.pdf",
        mimeType: "application/pdf",
        byteSize: 2048,
        version: 1,
        confirmedAt,
      })
      .mockResolvedValueOnce({ id: "candidate-cv-1", archivedAt });
    const db = { candidateCv: { findFirst, update } } as never;

    const renamed = await renameCandidateCv(
      "user-1",
      "candidate-cv-1",
      { displayName: "Tuấn CV - Community Manager" },
      db,
    );
    expect(renamed.displayName).toBe("Tuấn CV - Community Manager");
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "candidate-cv-1" },
      data: {
        displayName: "Tuấn CV - Community Manager",
        fileName: expect.stringMatching(/\.pdf$/u),
      },
    });

    const deleted = await archiveCandidateCv("user-1", "candidate-cv-1", db);
    expect(deleted).toEqual({
      id: "candidate-cv-1",
      archivedAt: archivedAt.toISOString(),
    });
    expect(update.mock.calls[1]?.[0]).toMatchObject({
      data: { archivedAt: expect.any(Date) },
    });
  });
});
