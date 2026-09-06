import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/backend/database/prisma";
import { FilesystemPrivateCvStorage } from "@/backend/cv/storage/filesystem";
import { prepareDirectApplicationCv } from "@/backend/services/jobs/prepare-direct-application-cv";
import { TeamApplicationService } from "@/backend/services/company-members/team-application-service";
import { runCandidateCvArtifactReconciliationCycle } from "@/backend/cv/candidate-cv-artifact-reconciliation-worker";
import {
  createProfileDatabaseAccount,
  deleteProfileDatabaseAccounts,
} from "../../../helpers/profile-database-fixture";
import { createSyntheticPdf } from "../../../helpers/cv-document-buffers";

let userId: string | undefined;
let locator: string | undefined;
afterEach(async () => {
  if (locator) {
    const storage = new FilesystemPrivateCvStorage({
      root: process.env.CV_STORAGE_LOCAL_ROOT!,
    });
    await storage.assertReady();
    await storage.delete(locator);
  }
  if (userId) {
    await prisma.candidateCvArtifactPromotion.deleteMany({
      where: { candidateUserId: userId },
    });
    await deleteProfileDatabaseAccounts([userId]);
  }
});

it("reconciles the durable Team ledger after a real filesystem write loses its response", async () => {
  const account = await createProfileDatabaseAccount("team-unknown");
  userId = account.userId;
  const originalPut = FilesystemPrivateCvStorage.prototype.put;
  vi.spyOn(FilesystemPrivateCvStorage.prototype, "put").mockImplementationOnce(
    async function (this: FilesystemPrivateCvStorage, input) {
      await originalPut.call(this, input);
      throw new Error("STORAGE_RESPONSE_LOST");
    },
  );
  const bytes = createSyntheticPdf("durable team storage recovery");
  const prepared = await prepareDirectApplicationCv(
    {
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      byteSize: bytes.length,
      source: (async function* () {
        yield bytes;
      })(),
    },
    { deferStorage: true },
  );
  locator = prepared.storageKey;
  const now = new Date();
  await expect(
    new TeamApplicationService().submit(
      userId,
      "unused-company-before-transaction",
      "HR_MANAGER",
      prepared,
      now,
    ),
  ).rejects.toThrow("STORAGE_RESPONSE_LOST");
  await prepared.cleanup();
  const path = join(process.env.CV_STORAGE_LOCAL_ROOT!, locator);
  expect(await readFile(path)).toEqual(Buffer.from(bytes));
  const staged = await prisma.candidateCvArtifactPromotion.findFirstOrThrow({
    where: { candidateUserId: userId },
  });
  expect(staged).toMatchObject({
    state: "DELETE_FAILED",
    deletedAt: null,
    storageKey: locator,
    contentDigestSha256: prepared.checksumSha256,
    lastSafeFailureCode: "CANDIDATE_CV_ARTIFACT_STORAGE_WRITE_UNKNOWN",
  });
  expect(
    await prisma.teamApplication.count({ where: { candidateUserId: userId } }),
  ).toBe(0);
  await runCandidateCvArtifactReconciliationCycle(
    new Date(now.getTime() + 2 * 86400_000),
  );
  expect(
    await prisma.candidateCvArtifactPromotion.findUniqueOrThrow({
      where: { id: staged.id },
    }),
  ).toMatchObject({ state: "DELETED", deletedAt: expect.any(Date) });
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});
