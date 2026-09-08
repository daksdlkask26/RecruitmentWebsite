import { expect, it, vi } from "vitest";

vi.mock("@/backend/services/profile/candidate-cv-library", () => ({
  ensureCandidateCvLibrary: vi.fn().mockResolvedValue(undefined),
}));

import { PrismaJobApplicationRepository } from "@/backend/repositories/jobs/prisma-job-application-repository";

it("rejects the legacy direct-CV repository contract before storage or transaction work", async () => {
  const transaction = vi.fn();
  const repository = new PrismaJobApplicationRepository({
    $transaction: transaction,
  } as never);
  const directCv = {
    id: "legacy-direct-cv",
    displayName: "resume.pdf",
    fileName: "resume.pdf",
    mimeType: "application/pdf",
    byteSize: 64,
    storageKey: "plaintext-locator",
    checksumSha256: "a".repeat(64),
    ensureStored: vi.fn(),
    cleanup: vi.fn(),
    claimOwnership: vi.fn(),
    preserveOnUnknown: vi.fn(),
  };

  await expect(
    repository.submit({
      candidateUserId: "candidate-1",
      directCv,
    } as never),
  ).rejects.toMatchObject({ code: "APPLICATION_CV_INELIGIBLE" });

  expect(transaction).not.toHaveBeenCalled();
  expect(directCv.ensureStored).not.toHaveBeenCalled();
  expect(directCv.claimOwnership).not.toHaveBeenCalled();
});
