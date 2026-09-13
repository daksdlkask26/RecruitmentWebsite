import { expect, it, vi } from "vitest";
import { Prisma } from "@/backend/generated/prisma/client";

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

function serializableRunner(
  repository: PrismaJobApplicationRepository,
): (operation: (transaction: never) => Promise<unknown>) => Promise<unknown> {
  return (
    repository as unknown as {
      submitSerializable: (
        operation: (transaction: never) => Promise<unknown>,
      ) => Promise<unknown>;
    }
  ).submitSerializable.bind(repository);
}

function serializationConflict() {
  return new Prisma.PrismaClientKnownRequestError("serialization conflict", {
    code: "P2034",
    clientVersion: "7.9.0",
  });
}

it("retries only bounded serializable conflicts and reruns the transaction callback", async () => {
  const transaction = vi
    .fn()
    .mockRejectedValueOnce(serializationConflict())
    .mockRejectedValueOnce(serializationConflict())
    .mockImplementationOnce(
      async (operation: (transaction: never) => Promise<unknown>) =>
        operation({} as never),
    );
  const repository = new PrismaJobApplicationRepository({
    $transaction: transaction,
  } as never);
  const operation = vi.fn().mockResolvedValue("committed");

  await expect(serializableRunner(repository)(operation)).resolves.toBe(
    "committed",
  );
  expect(transaction).toHaveBeenCalledTimes(3);
  expect(operation).toHaveBeenCalledOnce();
});

it("does not retry a non-serializable database error", async () => {
  const error = new Prisma.PrismaClientKnownRequestError("constraint", {
    code: "P2000",
    clientVersion: "7.9.0",
  });
  const transaction = vi.fn().mockRejectedValue(error);
  const repository = new PrismaJobApplicationRepository({
    $transaction: transaction,
  } as never);

  await expect(
    serializableRunner(repository)(vi.fn().mockResolvedValue("unused")),
  ).rejects.toBe(error);
  expect(transaction).toHaveBeenCalledOnce();
});

it("stops after three serializable conflicts without an unbounded retry", async () => {
  const error = serializationConflict();
  const transaction = vi.fn().mockRejectedValue(error);
  const repository = new PrismaJobApplicationRepository({
    $transaction: transaction,
  } as never);

  await expect(
    serializableRunner(repository)(vi.fn().mockResolvedValue("unused")),
  ).rejects.toBe(error);
  expect(transaction).toHaveBeenCalledTimes(3);
});
