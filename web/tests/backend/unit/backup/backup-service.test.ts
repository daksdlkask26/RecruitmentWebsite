import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    backupConfiguration: { findUnique: vi.fn() },
    backupRun: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  createPostgresBackup: vi.fn(),
  uploadEncryptedBackup: vi.fn(),
  deleteUploadedBackup: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/backup/postgres-backup", () => ({
  createPostgresBackup: mocks.createPostgresBackup,
}));
vi.mock("@/backend/backup/google-drive-backup", () => ({
  uploadEncryptedBackup: mocks.uploadEncryptedBackup,
  deleteUploadedBackup: mocks.deleteUploadedBackup,
}));

import { BackupService } from "@/backend/backup/backup-service";

const now = new Date("2026-09-21T02:00:00.000Z");

function leasedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "backup-1",
    requestedById: "admin-1",
    requestedAt: new Date("2026-09-21T00:00:00.000Z"),
    status: "LEASED" as const,
    leaseExpiresAt: new Date("2026-09-21T01:00:00.000Z"),
    leaseEpoch: 3,
    attemptCount: 1,
    ...overrides,
  };
}

describe("backup lease fencing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.prisma.backupConfiguration.findUnique.mockReset();
    mocks.prisma.backupRun.findFirst.mockReset();
    mocks.prisma.backupRun.updateMany.mockReset();
    mocks.createPostgresBackup.mockReset();
    mocks.uploadEncryptedBackup.mockReset();
    mocks.deleteUploadedBackup.mockReset();
    mocks.prisma.backupConfiguration.findUnique.mockResolvedValue({
      id: "platform",
      enabled: false,
      intervalSeconds: 60,
      version: 0,
      updatedAt: now,
    });
    mocks.createPostgresBackup.mockResolvedValue(Buffer.from("dump"));
    mocks.uploadEncryptedBackup.mockResolvedValue({
      driveFileId: "file-1",
      driveFolderId: "folder-1",
      checksum: "checksum-1",
      byteCount: 4,
    });
    mocks.deleteUploadedBackup.mockResolvedValue(undefined);
  });

  it("reclaims an expired lease and fences completion by owner and epoch", async () => {
    mocks.prisma.backupRun.findFirst.mockResolvedValue(leasedRun());
    mocks.prisma.backupRun.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await new BackupService().runDue(now);

    expect(result).toMatchObject({
      ready: true,
      processed: true,
      fenced: false,
    });
    expect(mocks.prisma.backupRun.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: "backup-1",
          leaseEpoch: 3,
          OR: expect.arrayContaining([
            { status: "LEASED", leaseExpiresAt: { lt: now } },
          ]),
        }),
        data: expect.objectContaining({
          leaseEpoch: { increment: 1 },
          attemptCount: { increment: 1 },
        }),
      }),
    );
    expect(mocks.prisma.backupRun.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          status: "LEASED",
          leaseEpoch: 4,
          leaseOwner: expect.any(String),
        }),
      }),
    );
  });

  it("does not publish a late completion after the lease was reclaimed", async () => {
    mocks.prisma.backupRun.findFirst.mockResolvedValue(leasedRun());
    mocks.prisma.backupRun.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(new BackupService().runDue(now)).resolves.toMatchObject({
      ready: false,
      processed: true,
      fenced: true,
    });
    expect(mocks.prisma.backupRun.updateMany).toHaveBeenCalledTimes(3);
    expect(mocks.deleteUploadedBackup).toHaveBeenCalledWith({
      driveFileId: "file-1",
      driveFolderId: "folder-1",
    });
  });

  it("uses one total deadline that cannot outlive the lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.createPostgresBackup.mockImplementation(async () => {
      vi.setSystemTime(8 * 60_000);
      return Buffer.from("dump");
    });
    mocks.prisma.backupRun.findFirst.mockResolvedValue(leasedRun());
    mocks.prisma.backupRun.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(new BackupService().runDue(now)).resolves.toMatchObject({
      ready: false,
      processed: true,
    });
    expect(mocks.createPostgresBackup).toHaveBeenCalledWith({
      timeoutMs: 8 * 60_000,
    });
    expect(mocks.uploadEncryptedBackup).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("records an exhausted expired lease and releases the active slot", async () => {
    mocks.prisma.backupRun.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.prisma.backupRun.findFirst.mockResolvedValue(null);

    await expect(new BackupService().runDue(now)).resolves.toMatchObject({
      ready: true,
      processed: false,
    });
    expect(mocks.prisma.backupRun.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: "LEASED",
          leaseExpiresAt: { lt: now },
          attemptCount: { gte: 3 },
        }),
        data: expect.objectContaining({
          status: "FAILED",
          activeKey: null,
          leaseOwner: null,
          failureCode: "BACKUP_RETRY_EXHAUSTED",
        }),
      }),
    );
  });
});
