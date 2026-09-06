import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticPdf } from "../../../helpers/cv-document-buffers";

const mocks = vi.hoisted(() => ({
  prisma: {
    userAccount: { findUnique: vi.fn() },
    teamApplication: { findFirst: vi.fn(), findUnique: vi.fn() },
    candidateCv: { findFirst: vi.fn() },
    candidateCvArtifactPromotion: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  storage: { assertReady: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/cv/workers/cv-worker-resources", () => ({
  createCvWorkerStorage: () => mocks.storage,
}));
vi.mock("@/backend/notifications/notification-service", () => ({
  createInAppNotification: vi.fn(),
}));

import { prepareDirectApplicationCv } from "@/backend/services/jobs/prepare-direct-application-cv";
import { TeamApplicationService } from "@/backend/services/company-members/team-application-service";
import { runCandidateCvArtifactReconciliationCycle } from "@/backend/cv/candidate-cv-artifact-reconciliation-worker";

type Ledger = {
  id: string;
  state: string;
  deletedAt: Date | null;
  orphanDeleteAfter: Date;
  candidateUserId: string;
  targetId: string;
  storageKey: string;
  contentDigestSha256: string;
  byteSize: number;
  scope: string;
};
let ledger: Ledger;
const objects = new Set<string>();
const occurredAt = new Date("2026-09-06T00:00:00Z");
const recoveryAt = new Date("2026-09-08T00:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  objects.clear();
  mocks.prisma.userAccount.findUnique.mockResolvedValue({
    email: "candidate@example.test",
    state: "ACTIVE",
    candidateIdentity: {},
  });
  mocks.prisma.teamApplication.findFirst.mockResolvedValue(null);
  mocks.prisma.teamApplication.findUnique.mockResolvedValue(null);
  mocks.prisma.candidateCv.findFirst.mockResolvedValue(null);
  mocks.prisma.candidateCvArtifactPromotion.create.mockImplementation(
    async ({ data }) => {
      ledger = { ...data, deletedAt: null };
    },
  );
  mocks.prisma.candidateCvArtifactPromotion.updateMany.mockImplementation(
    async ({ where, data }) => {
      expect(where.id).toBe(ledger.id);
      Object.assign(ledger, data);
      return { count: 1 };
    },
  );
  // Apply the worker's actual eligibility query; a wrongly DELETED ledger
  // disappears here, reproducing the leak rather than forcing a scan result.
  mocks.prisma.candidateCvArtifactPromotion.findMany.mockImplementation(
    async ({ where }) =>
      where.state.in.includes(ledger.state) &&
      ledger.deletedAt === null &&
      ledger.orphanDeleteAfter <= where.orphanDeleteAfter.lte
        ? [ledger]
        : [],
  );
  mocks.storage.assertReady.mockResolvedValue(undefined);
  mocks.storage.put.mockImplementation(async ({ locator }) => {
    objects.add(locator);
    throw new Error("STORAGE_RESPONSE_LOST");
  });
  mocks.storage.delete.mockImplementation(async (locator) => {
    objects.delete(locator);
    return { deleted: true };
  });
});

describe("Team Application UNKNOWN storage recovery", () => {
  it.each([
    "absent",
    "matching",
    "digest-mismatch",
    "delete-error",
    "ledger-error",
  ])(
    "keeps a lost-write acknowledgement discoverable and recovers %s",
    async (recovery) => {
      const bytes = createSyntheticPdf("team storage outcome unknown");
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
      const cleanup = vi.fn(() => prepared.cleanup());
      if (recovery === "ledger-error") {
        mocks.prisma.candidateCvArtifactPromotion.updateMany.mockRejectedValueOnce(
          new Error("LEDGER_UNAVAILABLE"),
        );
      }
      await expect(
        new TeamApplicationService({} as never).submit(
          "candidate-1",
          "company-1",
          "HR_MANAGER",
          { ...prepared, cleanup },
          occurredAt,
        ),
      ).rejects.toThrow("STORAGE_RESPONSE_LOST");
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      await prepared.cleanup(); // Request-level cleanup is intentionally a no-op.
      expect(mocks.storage.delete).not.toHaveBeenCalled();
      expect(objects.has(prepared.storageKey)).toBe(true);
      expect(ledger.state).toBe(
        recovery === "ledger-error" ? "PROMOTED" : "DELETE_FAILED",
      );
      expect(ledger.deletedAt).toBeNull();

      if (recovery === "matching" || recovery === "digest-mismatch") {
        mocks.prisma.teamApplication.findUnique.mockResolvedValue({
          candidateUserId: ledger.candidateUserId,
          cvStorageKey: ledger.storageKey,
          cvByteSize: ledger.byteSize,
          cvChecksumSha256:
            recovery === "matching"
              ? ledger.contentDigestSha256
              : "f".repeat(64),
        });
      }
      if (recovery === "delete-error") {
        mocks.storage.delete.mockRejectedValueOnce(
          new Error("DELETE_RESPONSE_LOST"),
        );
      }
      const result =
        await runCandidateCvArtifactReconciliationCycle(recoveryAt);
      expect(result.scanned).toBe(1);
      expect(mocks.prisma.teamApplication.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ledger.targetId } }),
      );
      if (recovery === "matching") {
        expect(result).toEqual({
          scanned: 1,
          committed: 1,
          deleted: 0,
          failed: 0,
        });
        expect(ledger.state).toBe("COMMITTED");
        expect(mocks.storage.delete).not.toHaveBeenCalled();
        expect(objects.has(prepared.storageKey)).toBe(true);
      } else if (
        recovery === "digest-mismatch" ||
        recovery === "delete-error"
      ) {
        expect(result).toEqual({
          scanned: 1,
          committed: 0,
          deleted: 0,
          failed: 1,
        });
        expect(ledger.state).toBe("DELETE_FAILED");
        expect(ledger.deletedAt).toBeNull();
        expect(objects.has(prepared.storageKey)).toBe(true);
        if (recovery === "digest-mismatch")
          expect(mocks.storage.delete).not.toHaveBeenCalled();
      } else {
        expect(result).toEqual({
          scanned: 1,
          committed: 0,
          deleted: 1,
          failed: 0,
        });
        expect(ledger.state).toBe("DELETED");
        expect(ledger.deletedAt).toEqual(recoveryAt);
        expect(objects.has(prepared.storageKey)).toBe(false);
      }
    },
  );
});
