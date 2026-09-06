import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/backend/generated/prisma/client";

const storage = vi.hoisted(() => ({
  assertReady: vi.fn(),
  put: vi.fn(),
  open: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/backend/applications/storage/factory", () => ({
  createApplicationDocumentStorage: () => storage,
}));

vi.mock("@/backend/services/profile/candidate-cv-library", () => ({
  ensureCandidateCvLibrary: vi.fn().mockResolvedValue(undefined),
}));

import { ApplicationDraftService } from "@/backend/candidate-applications/application-draft-service";

const now = new Date("2026-08-18T08:00:00.000Z");
const validPdfBytes = new TextEncoder().encode("%PDF-1.7\n");

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    candidateUserId: "candidate-1",
    jobPostingId: "job-1",
    revision: 1,
    personalInfoDraft: {},
    selectedCv: null,
    coverLetterDraft: null,
    messageDraft: null,
    confirmationAccepted: false,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    ...overrides,
  };
}

describe("ApplicationDraftService cover-letter persistence", () => {
  it("does not delete a file after its draft row was committed", async () => {
    storage.assertReady.mockResolvedValue(undefined);
    storage.put.mockResolvedValue({
      locator: "new-cover-letter-locator",
      bytes: validPdfBytes.byteLength,
      storagePurposeVersion: "application-document-v1",
    });
    storage.delete.mockResolvedValue({ deleted: true });

    let storedCoverLetterDraft: unknown = null;
    const db = {
      candidateApplicationDraft: {
        findFirst: vi.fn().mockResolvedValue(draftRow()),
        updateMany: vi.fn().mockImplementation(async (input) => {
          storedCoverLetterDraft = input.data.coverLetterDraft;
          return { count: 1 };
        }),
        findUnique: vi.fn().mockImplementation(async () =>
          draftRow({
            revision: 2,
            personalInfoDraft: {},
            coverLetterDraft: storedCoverLetterDraft,
          }),
        ),
      },
      jobApplication: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      new ApplicationDraftService(db as never).attachCoverLetter(
        { userId: "candidate-1", sessionId: "session-1" },
        "draft-1",
        1,
        new File([validPdfBytes], "cover.pdf", {
          type: "application/pdf",
        }),
        now,
      ),
    ).rejects.toThrow();

    expect(storedCoverLetterDraft).toMatchObject({
      kind: "FILE",
      file: { storageKey: "new-cover-letter-locator" },
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("returns the winning draft when concurrent page requests race to create it", async () => {
    const concurrent = draftRow({
      personalInfoDraft: {
        fullName: "Candidate One",
        email: "candidate@example.test",
        phone: "0900000000",
        currentLocation: "Ho Chi Minh City",
        linkedInPortfolio: null,
        cvSource: null,
      },
    });
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    const db = {
      $transaction: vi.fn(async (callback) => callback(db)),
      jobPosting: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-1" }),
      },
      candidateIdentity: {
        findFirst: vi.fn().mockResolvedValue({
          user: { name: "Candidate One", email: "candidate@example.test" },
          profile: null,
        }),
      },
      jobApplication: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      candidateCv: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      candidateApplicationDraft: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(concurrent),
        create: vi.fn().mockRejectedValue(duplicate),
      },
    };

    await expect(
      new ApplicationDraftService(db as never).getOrCreate(
        { userId: "candidate-1", sessionId: "session-1" },
        "job-1",
        now,
      ),
    ).resolves.toMatchObject({ draftId: "draft-1", jobId: "job-1" });

    expect(db.candidateApplicationDraft.create).toHaveBeenCalledOnce();
    expect(db.candidateApplicationDraft.findUnique).toHaveBeenCalledTimes(2);
  });
});
