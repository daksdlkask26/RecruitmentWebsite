import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/backend/database/prisma";
import { FilesystemExportArtifactStorage } from "@/backend/exports/storage/filesystem";
import { PrismaExportRequestRepository } from "@/backend/repositories/analytics/prisma-export-request-repository";
import {
  createJobBoardDatabaseFixture,
  deleteJobBoardDatabaseFixture,
} from "../../../helpers/job-board-database-fixture";
import { assertTestDatabaseEnvironment } from "../../../helpers/test-database-guard";

// Start after PostgreSQL's server-side `now()` defaults so the harness can
// claim rows created during this invocation without mutating the clock rules.
const now = new Date(Date.now() + 60_000);
const repository = new PrismaExportRequestRepository();
let storage!: FilesystemExportArtifactStorage;
let exportRoot = "";
const artifactLocators: string[] = [];
const requestIds: string[] = [];
const backupRunIds: string[] = [];
let fixture: Awaited<ReturnType<typeof createJobBoardDatabaseFixture>>;

async function createCompletedExport(label: string) {
  const requesterUserId = fixture.userIds[0]!;
  const request = await repository.create({
    requesterUserId,
    companyId: fixture.company.id,
    jobPostingId: fixture.jobs.active.id,
    format: "CSV",
    dataCutoff: now,
    timeZone: "Asia/Bangkok",
    definitionVersion: "phase8-test-v1",
    idempotencyKey: `phase8-recovery-${label}`,
    requestedAt: now,
  });
  requestIds.push(request.id);
  const workerId = `phase8-export-worker-${label}`;
  const leased = await repository.claimNext(
    workerId,
    now,
    new Date(now.getTime() + 60_000),
  );
  expect(leased?.id).toBe(request.id);

  const content = Buffer.from(`candidate-export-${label}`, "utf8");
  const artifact = await storage.put(request.id, content);
  artifactLocators.push(artifact.locator);
  const completed = await repository.succeed(request.id, {
    workerId,
    storageLocator: artifact.locator,
    fileName: `candidates-${label}.csv`,
    mediaType: "text/csv; charset=utf-8",
    byteCount: artifact.byteCount,
    checksum: artifact.checksum,
    rowCount: 1,
    completedAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    auditObligation: {
      requesterUserId,
      format: "CSV",
      rowCount: 1,
      occurredAt: now,
    },
  });
  expect(completed.count).toBe(1);
  return { requestId: request.id, content };
}

beforeAll(async () => {
  assertTestDatabaseEnvironment();
  exportRoot = await mkdtemp(join(tmpdir(), "phase8-export-recovery-"));
  process.env.ANALYTICS_EXPORT_STORAGE_ROOT = exportRoot;
  process.env.ANALYTICS_EXPORT_ENCRYPTION_KEY ??= Buffer.alloc(32, 17).toString(
    "base64",
  );
  storage = new FilesystemExportArtifactStorage();
  fixture = await createJobBoardDatabaseFixture("phase8-recovery", now);
});

afterAll(async () => {
  if (storage) {
    for (const locator of artifactLocators) {
      await storage.delete(locator).catch(() => undefined);
    }
  }
  if (requestIds.length) {
    await prisma.exportAuditObligation.deleteMany({
      where: { exportRequestId: { in: requestIds } },
    });
    await prisma.exportRequest.deleteMany({ where: { id: { in: requestIds } } });
  }
  if (backupRunIds.length) {
    await prisma.backupRun.deleteMany({ where: { id: { in: backupRunIds } } });
  }
  if (fixture) await deleteJobBoardDatabaseFixture(fixture);
  if (exportRoot) await rm(exportRoot, { recursive: true, force: true });
  delete process.env.ANALYTICS_EXPORT_STORAGE_ROOT;
  delete process.env.ANALYTICS_EXPORT_ENCRYPTION_KEY;
  await prisma.$disconnect();
});

describe("Phase 8 export recovery with isolated PostgreSQL and filesystem", () => {
  it("keeps a completed artifact through audit outage and completes the retry", async () => {
    const { requestId, content } = await createCompletedExport("audit-outage");
    const failedAuditOwner = "phase8-audit-failed-owner";
    const claimed = await repository.claimPendingAuditObligations(
      failedAuditOwner,
      now,
      new Date(now.getTime() + 60_000),
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.exportRequestId).toBe(requestId);

    await repository.failAuditObligation(
      claimed[0]!.id,
      failedAuditOwner,
      "AUDIT_DB_UNAVAILABLE",
      now,
      true,
      new Date(now.getTime() + 30_000),
    );
    await expect(
      prisma.exportRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(
      prisma.exportAuditObligation.findUniqueOrThrow({
        where: { exportRequestId: requestId },
      }),
    ).resolves.toMatchObject({
      state: "PENDING",
      lastFailureCode: "AUDIT_DB_UNAVAILABLE",
      attemptCount: 1,
    });
    await expect(storage.get(artifactLocators.at(-1)!)).resolves.toEqual(content);

    const retryOwner = "phase8-audit-retry-owner";
    const retry = await repository.claimPendingAuditObligations(
      retryOwner,
      new Date(now.getTime() + 30_001),
      new Date(now.getTime() + 90_001),
    );
    expect(retry).toHaveLength(1);
    expect(
      await repository.completeAuditObligation(
        retry[0]!.id,
        retryOwner,
        new Date(now.getTime() + 30_001),
      ),
    ).toMatchObject({ count: 1 });
    await expect(
      prisma.exportAuditObligation.findUniqueOrThrow({
        where: { exportRequestId: requestId },
      }),
    ).resolves.toMatchObject({ state: "COMPLETED", attemptCount: 2 });
    await expect(storage.get(artifactLocators.at(-1)!)).resolves.toEqual(content);
  });

  it("fences a stale audit owner when two workers claim the same obligation", async () => {
    const { requestId } = await createCompletedExport("claim-race");
    const [first, second] = await Promise.all([
      repository.claimPendingAuditObligations(
        "phase8-race-owner-a",
        now,
        new Date(now.getTime() + 60_000),
      ),
      repository.claimPendingAuditObligations(
        "phase8-race-owner-b",
        now,
        new Date(now.getTime() + 60_000),
      ),
    ]);
    const claimed = [...first, ...second];
    expect(claimed).toHaveLength(1);
    const obligation = claimed[0]!;
    const winner = first.length ? "phase8-race-owner-a" : "phase8-race-owner-b";
    const stale = await repository.completeAuditObligation(
      obligation.id,
      "phase8-stale-owner",
      now,
    );
    expect(stale.count).toBe(0);
    expect(
      await repository.completeAuditObligation(obligation.id, winner, now),
    ).toMatchObject({ count: 1 });
    await expect(
      prisma.exportAuditObligation.findUniqueOrThrow({
        where: { exportRequestId: requestId },
      }),
    ).resolves.toMatchObject({ state: "COMPLETED" });
  });

  it("moves an audit obligation through bounded retries to dead letter", async () => {
    const { requestId } = await createCompletedExport("dead-letter");
    let attemptAt = now;
    for (const attempt of [1, 2, 3]) {
      const owner = `phase8-dead-letter-owner-${attempt}`;
      const claimed = await repository.claimPendingAuditObligations(
        owner,
        attemptAt,
        new Date(attemptAt.getTime() + 60_000),
      );
      expect(claimed).toHaveLength(1);
      const retry = attempt < 3;
      const nextAttemptAt = new Date(attemptAt.getTime() + 30_000);
      await repository.failAuditObligation(
        claimed[0]!.id,
        owner,
        "AUDIT_DB_UNAVAILABLE",
        attemptAt,
        retry,
        nextAttemptAt,
      );
      if (retry) attemptAt = new Date(nextAttemptAt.getTime() + 1);
    }
    await expect(
      prisma.exportAuditObligation.findUniqueOrThrow({
        where: { exportRequestId: requestId },
      }),
    ).resolves.toMatchObject({
      state: "DEAD_LETTER",
      attemptCount: 3,
      lastFailureCode: "AUDIT_DB_UNAVAILABLE",
    });
  });

  it("fences a stale backup publication after a real database lease reclaim", async () => {
    const id = `phase8-backup-${randomUUID()}`;
    const activeKey = `phase8-backup-active-${randomUUID()}`;
    const oldOwner = "phase8-backup-old-owner";
    const newOwner = "phase8-backup-new-owner";
    backupRunIds.push(id);
    await prisma.backupRun.create({
      data: {
        id,
        trigger: "MANUAL",
        status: "LEASED",
        activeKey,
        leaseOwner: oldOwner,
        leaseEpoch: 4,
        attemptCount: 1,
        leaseExpiresAt: new Date(now.getTime() - 1_000),
        requestedAt: new Date(now.getTime() - 120_000),
      },
    });

    const reclaimed = await prisma.backupRun.updateMany({
      where: {
        id,
        status: "LEASED",
        leaseEpoch: 4,
        leaseExpiresAt: { lt: now },
      },
      data: {
        leaseOwner: newOwner,
        leaseEpoch: { increment: 1 },
        attemptCount: { increment: 1 },
        leaseExpiresAt: new Date(now.getTime() + 600_000),
      },
    });
    expect(reclaimed.count).toBe(1);

    const stalePublication = await prisma.backupRun.updateMany({
      where: {
        id,
        status: "LEASED",
        leaseOwner: oldOwner,
        leaseEpoch: 4,
      },
      data: {
        status: "SUCCEEDED",
        driveFileId: "stale-file-must-not-publish",
        completedAt: now,
      },
    });
    expect(stalePublication.count).toBe(0);
    await expect(
      prisma.backupRun.findUniqueOrThrow({ where: { id } }),
    ).resolves.toMatchObject({
      status: "LEASED",
      leaseOwner: newOwner,
      leaseEpoch: 5,
      attemptCount: 2,
      driveFileId: null,
    });
  });
});
