import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { createPostgresBackup } from "./postgres-backup";
import {
  deleteUploadedBackup,
  uploadEncryptedBackup,
} from "./google-drive-backup";
import { emitPlatformOperationalMetric } from "@/backend/observability/platform-operational-metrics";

const CONFIG_ID = "platform";
const BACKUP_LEASE_MS = 10 * 60_000;
const BACKUP_MAX_ATTEMPTS = 3;
// Dump and upload share one budget that is shorter than the lease.
const BACKUP_TOTAL_TIMEOUT_MS = 8 * 60_000;

export class BackupService {
  async settings() {
    return (
      (await prisma.backupConfiguration.findUnique({
        where: { id: CONFIG_ID },
      })) ?? {
        id: CONFIG_ID,
        enabled: false,
        intervalSeconds: 60,
        version: 0,
        updatedAt: null,
      }
    );
  }
  async update(input: {
    enabled: boolean;
    intervalSeconds: number;
    actorId: string;
  }) {
    if (
      !Number.isInteger(input.intervalSeconds) ||
      input.intervalSeconds < 10 ||
      input.intervalSeconds > 86_400
    )
      throw new Error("BACKUP_INTERVAL_INVALID");
    return prisma.backupConfiguration.upsert({
      where: { id: CONFIG_ID },
      create: {
        id: CONFIG_ID,
        enabled: input.enabled,
        intervalSeconds: input.intervalSeconds,
        updatedByAdminId: input.actorId,
      },
      update: {
        enabled: input.enabled,
        intervalSeconds: input.intervalSeconds,
        updatedByAdminId: input.actorId,
        version: { increment: 1 },
      },
    });
  }
  async request(
    trigger: "MANUAL" | "SCHEDULED",
    actorId?: string,
    idempotencyKey?: string,
  ) {
    if (actorId && idempotencyKey) {
      const existing = await prisma.backupRun.findUnique({
        where: {
          requestedById_idempotencyKey: {
            requestedById: actorId,
            idempotencyKey,
          },
        },
      });
      if (existing) return existing;
    }
    try {
      return await prisma.backupRun.create({
        data: {
          trigger,
          requestedById: actorId,
          idempotencyKey,
          activeKey: "platform",
        },
      });
    } catch {
      const active = await prisma.backupRun.findFirst({
        where: { activeKey: "platform" },
      });
      if (active) return active;
      throw new Error("BACKUP_REQUEST_FAILED");
    }
  }
  async history() {
    return prisma.backupRun.findMany({
      orderBy: { requestedAt: "desc" },
      take: 20,
    });
  }
  async runDue(now = new Date()) {
    const settings = await this.settings();
    if (settings.enabled) {
      const last = await prisma.backupRun.findFirst({
        orderBy: { requestedAt: "desc" },
      });
      if (
        !last ||
        now.getTime() - last.requestedAt.getTime() >=
          settings.intervalSeconds * 1000
      )
        await this.request("SCHEDULED");
    }
    const exhausted = await prisma.backupRun.updateMany({
      where: {
        status: "LEASED",
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: BACKUP_MAX_ATTEMPTS },
      },
      data: {
        status: "FAILED",
        activeKey: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        failureCode: "BACKUP_RETRY_EXHAUSTED",
        completedAt: now,
      },
    });
    if (exhausted.count > 0) {
      emitPlatformOperationalMetric({
        event: "backup.failed",
        value: exhausted.count,
        dimensions: { code: "BACKUP_RETRY_EXHAUSTED" },
      });
    }
    const run = await prisma.backupRun.findFirst({
      where: {
        OR: [
          { status: "QUEUED" },
          { status: "LEASED", leaseExpiresAt: { lt: now } },
        ],
        attemptCount: { lt: BACKUP_MAX_ATTEMPTS },
      },
      orderBy: { requestedAt: "asc" },
    });
    if (!run) return { ready: true, processed: false };
    if (run.status === "LEASED") {
      emitPlatformOperationalMetric({
        event: "backup.lease_reclaimed",
        value: 1,
        dimensions: { attempt: String(run.attemptCount + 1) },
      });
    }
    const owner = randomUUID();
    const leaseEpoch = run.leaseEpoch + 1;
    const claimed = await prisma.backupRun.updateMany({
      where: {
        id: run.id,
        leaseEpoch: run.leaseEpoch,
        OR: [
          { status: "QUEUED" },
          { status: "LEASED", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "LEASED",
        leaseOwner: owner,
        leaseEpoch: { increment: 1 },
        leaseExpiresAt: new Date(now.getTime() + BACKUP_LEASE_MS),
        startedAt: now,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return { ready: true, processed: false };
    let uploaded: Awaited<ReturnType<typeof uploadEncryptedBackup>> | null =
      null;
    const operationDeadline = Date.now() + BACKUP_TOTAL_TIMEOUT_MS;
    const remainingOperationMs = () => {
      const remaining = operationDeadline - Date.now();
      if (remaining <= 0) throw new Error("BACKUP_OPERATION_TIMEOUT");
      return remaining;
    };
    try {
      const content = await createPostgresBackup({
        timeoutMs: remainingOperationMs(),
      });
      const stamp = now
        .toISOString()
        .slice(0, 19)
        .replace("T", "-")
        .replaceAll(":", "-");
      const folderName = `${stamp}-${run.requestedById ?? "system"}`;
      const name = "postgresql.dump.enc";
      uploaded = await uploadEncryptedBackup({
        name,
        folderName,
        content,
        timeoutMs: remainingOperationMs(),
      });
      const completed = await prisma.backupRun.updateMany({
        where: {
          id: run.id,
          status: "LEASED",
          leaseOwner: owner,
          leaseEpoch,
        },
        data: {
          status: "SUCCEEDED",
          activeKey: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          fileName: name,
          ...uploaded,
          completedAt: new Date(),
        },
      });
      if (completed.count !== 1) {
        emitPlatformOperationalMetric({
          event: "backup.fenced_completion",
          value: 1,
          dimensions: { outcome: "lease_lost" },
        });
        await deleteUploadedBackup({
          driveFileId: uploaded.driveFileId,
          driveFolderId: uploaded.driveFolderId,
        }).catch(() => undefined);
      }
      return {
        ready: completed.count === 1,
        processed: true,
        fenced: completed.count !== 1,
      };
    } catch (error) {
      emitPlatformOperationalMetric({
        event: "backup.failed",
        value: 1,
        dimensions: {
          code:
            error instanceof Error && /^[A-Z0-9_.-]+$/u.test(error.message)
              ? error.message
              : "BACKUP_FAILED",
        },
      });
      if (uploaded) {
        await deleteUploadedBackup({
          driveFileId: uploaded.driveFileId,
          driveFolderId: uploaded.driveFolderId,
        }).catch(() => undefined);
      }
      const retry = run.attemptCount + 1 < BACKUP_MAX_ATTEMPTS;
      await prisma.backupRun.updateMany({
        where: {
          id: run.id,
          status: "LEASED",
          leaseOwner: owner,
          leaseEpoch,
        },
        data: {
          status: retry ? "QUEUED" : "FAILED",
          activeKey: retry ? "platform" : null,
          leaseOwner: null,
          leaseExpiresAt: null,
          failureCode:
            error instanceof Error
              ? error.message.slice(0, 80)
              : "BACKUP_FAILED",
          completedAt: retry ? null : new Date(),
        },
      });
      return { ready: false, processed: true };
    }
  }
}
