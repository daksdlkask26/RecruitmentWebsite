import "server-only";

import { prisma } from "@/backend/database/prisma";
import { analyticsConfiguration } from "@/backend/analytics/analytics-config";
import type { Prisma } from "@/backend/generated/prisma/client";

type Database = typeof prisma | Prisma.TransactionClient;

export class PrismaExportRequestRepository {
  constructor(private readonly db: Database = prisma) {}

  findByIdempotency(requesterUserId: string, idempotencyKey: string) {
    return this.db.exportRequest.findUnique({
      where: {
        requesterUserId_idempotencyKey: { requesterUserId, idempotencyKey },
      },
    });
  }

  create(input: {
    requesterUserId: string;
    companyId: string;
    jobPostingId: string;
    format: "CSV" | "XLSX";
    dataCutoff: Date;
    timeZone: string;
    definitionVersion: string;
    idempotencyKey: string;
    requestedAt: Date;
  }) {
    return this.db.exportRequest.create({
      data: {
        requesterUserId: input.requesterUserId,
        companyId: input.companyId,
        jobPostingId: input.jobPostingId,
        format: input.format,
        filters: {} as Prisma.InputJsonObject,
        dataCutoff: input.dataCutoff,
        timeZone: input.timeZone,
        definitionVersion: input.definitionVersion,
        idempotencyKey: input.idempotencyKey,
        requestedAt: input.requestedAt,
      },
    });
  }

  findScoped(requesterUserId: string, jobPostingId: string, exportId: string) {
    return this.db.exportRequest.findFirst({
      where: { id: exportId, requesterUserId, jobPostingId },
    });
  }

  async claimNext(workerId: string, now: Date, leaseExpiresAt: Date) {
    const maxAttempts = analyticsConfiguration().exportMaxAttempts;
    const maybeDatabase = this.db as typeof prisma;
    if (
      typeof (maybeDatabase as { $transaction?: unknown }).$transaction ===
      "function"
    ) {
      const database = maybeDatabase;
      return database.$transaction(async (tx: Prisma.TransactionClient) => {
        const candidates = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "ExportRequest" WHERE "attemptCount" < $1 AND ("status" = $2 OR ("status" = $3 AND "leaseExpiresAt" < $4)) ORDER BY "requestedAt" ASC, "id" ASC FOR UPDATE SKIP LOCKED LIMIT 1',
          maxAttempts,
          "QUEUED",
          "LEASED",
          now,
        );
        const candidateId = candidates[0]?.id;
        if (!candidateId) return null;
        await tx.exportRequest.update({
          where: { id: candidateId },
          data: {
            status: "LEASED",
            leaseOwner: workerId,
            leaseExpiresAt,
            startedAt: now,
            attemptCount: { increment: 1 },
            version: { increment: 1 },
          },
        });
        return tx.exportRequest.findUnique({ where: { id: candidateId } });
      });
    }
    const client = this.db as Database;
    const candidate = await client.exportRequest.findFirst({
      where: {
        attemptCount: { lt: maxAttempts },
        OR: [
          { status: "QUEUED" },
          { status: "LEASED", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return null;
    const changed = await client.exportRequest.updateMany({
      where: {
        id: candidate.id,
        version: candidate.version,
        OR: [
          { status: "QUEUED" },
          { status: "LEASED", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "LEASED",
        leaseOwner: workerId,
        leaseExpiresAt,
        startedAt: candidate.startedAt ?? now,
        attemptCount: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) return null;
    return client.exportRequest.findUnique({ where: { id: candidate.id } });
  }

  async succeed(
    exportId: string,
    input: {
      workerId: string;
      storageLocator: string;
      fileName: string;
      mediaType: string;
      byteCount: number;
      checksum: string;
      rowCount: number;
      completedAt: Date;
      expiresAt: Date;
      auditObligation: {
        requesterUserId: string;
        format: "CSV" | "XLSX";
        rowCount: number;
        occurredAt: Date;
      };
    },
  ) {
    const complete = async (db: Database): Promise<{ count: number }> => {
      const result = await db.exportRequest.updateMany({
        where: {
          id: exportId,
          status: "LEASED",
          leaseOwner: input.workerId,
        },
        data: {
          status: "SUCCEEDED",
          storageLocator: input.storageLocator,
          fileName: input.fileName,
          mediaType: input.mediaType,
          byteCount: input.byteCount,
          checksum: input.checksum,
          rowCount: input.rowCount,
          completedAt: input.completedAt,
          expiresAt: input.expiresAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) return result;
      await db.exportAuditObligation.upsert({
        where: { exportRequestId: exportId },
        create: {
          exportRequestId: exportId,
          requesterUserId: input.auditObligation.requesterUserId,
          format: input.auditObligation.format,
          rowCount: input.auditObligation.rowCount,
          occurredAt: input.auditObligation.occurredAt,
        },
        update: {
          requesterUserId: input.auditObligation.requesterUserId,
          format: input.auditObligation.format,
          rowCount: input.auditObligation.rowCount,
          occurredAt: input.auditObligation.occurredAt,
        },
      });
      return result;
    };

    const transaction = (this.db as typeof prisma).$transaction;
    if (typeof transaction === "function") {
      return (await transaction.call(this.db, complete)) as { count: number };
    }
    return complete(this.db);
  }

  ensureAuditObligation(
    exportRequestId: string,
    input: {
      requesterUserId: string;
      format: "CSV" | "XLSX";
      rowCount: number;
      occurredAt: Date;
    },
  ) {
    return this.db.exportAuditObligation.upsert({
      where: { exportRequestId },
      create: {
        exportRequestId,
        requesterUserId: input.requesterUserId,
        format: input.format,
        rowCount: input.rowCount,
        occurredAt: input.occurredAt,
      },
      update: {
        requesterUserId: input.requesterUserId,
        format: input.format,
        rowCount: input.rowCount,
        occurredAt: input.occurredAt,
      },
    });
  }

  async claimPendingAuditObligations(
    workerId: string,
    now: Date,
    leaseExpiresAt: Date,
    take = 25,
  ) {
    const maxAttempts = analyticsConfiguration().exportMaxAttempts;
    const select = {
      id: true,
      exportRequestId: true,
      requesterUserId: true,
      format: true,
      rowCount: true,
      occurredAt: true,
      attemptCount: true,
    } as const;
    const maybeDatabase = this.db as typeof prisma;
    if (typeof maybeDatabase.$transaction === "function") {
      return maybeDatabase.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const candidates = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            'SELECT "id" FROM "ExportAuditObligation" WHERE "attemptCount" < $1 AND (("state" = $2 AND "nextAttemptAt" <= $3) OR ("state" = $4 AND "leaseExpiresAt" < $3)) ORDER BY "nextAttemptAt" ASC, "occurredAt" ASC, "id" ASC FOR UPDATE SKIP LOCKED LIMIT $5',
            maxAttempts,
            "PENDING",
            now,
            "LEASED",
            take,
          );
          const ids = candidates.map(({ id }) => id);
          if (ids.length === 0) return [];
          await tx.exportAuditObligation.updateMany({
            where: { id: { in: ids } },
            data: {
              state: "LEASED",
              leaseOwner: workerId,
              leaseExpiresAt,
              attemptCount: { increment: 1 },
            },
          });
          return tx.exportAuditObligation.findMany({
            where: { id: { in: ids }, state: "LEASED", leaseOwner: workerId },
            orderBy: [
              { nextAttemptAt: "asc" },
              { occurredAt: "asc" },
              { id: "asc" },
            ],
            select,
          });
        },
      );
    }

    const candidates = await this.db.exportAuditObligation.findMany({
      where: {
        attemptCount: { lt: maxAttempts },
        OR: [
          { state: "PENDING", nextAttemptAt: { lte: now } },
          { state: "LEASED", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
      take,
      select: { id: true },
    });
    const claimed = [];
    for (const candidate of candidates) {
      const changed = await this.db.exportAuditObligation.updateMany({
        where: {
          id: candidate.id,
          attemptCount: { lt: maxAttempts },
          OR: [
            { state: "PENDING", nextAttemptAt: { lte: now } },
            { state: "LEASED", leaseExpiresAt: { lt: now } },
          ],
        },
        data: {
          state: "LEASED",
          leaseOwner: workerId,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
        },
      });
      if (changed.count !== 1) continue;
      const obligation = await this.db.exportAuditObligation.findFirst({
        where: { id: candidate.id, state: "LEASED", leaseOwner: workerId },
        select,
      });
      if (obligation) claimed.push(obligation);
    }
    return claimed;
  }

  completeAuditObligation(
    obligationId: string,
    workerId: string,
    completedAt: Date,
  ) {
    return this.db.exportAuditObligation.updateMany({
      where: { id: obligationId, state: "LEASED", leaseOwner: workerId },
      data: {
        state: "COMPLETED",
        completedAt,
        lastFailureCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  failAuditObligation(
    obligationId: string,
    workerId: string,
    failureCode: string,
    now: Date,
    retry: boolean,
    nextAttemptAt: Date,
  ) {
    return this.db.exportAuditObligation.updateMany({
      where: { id: obligationId, state: "LEASED", leaseOwner: workerId },
      data: {
        state: retry ? "PENDING" : "DEAD_LETTER",
        nextAttemptAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastFailureCode: failureCode,
        updatedAt: now,
      },
    });
  }

  fail(
    exportId: string,
    workerId: string,
    failureCode: string,
    now: Date,
    retry: boolean,
  ) {
    return this.db.exportRequest.updateMany({
      where: { id: exportId, status: "LEASED", leaseOwner: workerId },
      data: {
        status: retry ? "QUEUED" : "FAILED",
        failureCode,
        completedAt: retry ? null : now,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
  }

  expire(exportId: string, now: Date) {
    return this.db.exportRequest.updateMany({
      where: {
        id: exportId,
        status: "SUCCEEDED",
        expiresAt: { lte: now },
      },
      data: {
        status: "EXPIRED",
        inaccessibleAt: now,
        version: { increment: 1 },
      },
    });
  }

  findExpired(now: Date, take = 100) {
    return this.db.exportRequest.findMany({
      where: {
        status: "SUCCEEDED",
        expiresAt: { lte: now },
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take,
    });
  }

  markDeleted(exportId: string, now: Date) {
    return this.db.exportRequest.updateMany({
      where: { id: exportId, status: "EXPIRED" },
      data: {
        status: "DELETED",
        deletedAt: now,
        storageLocator: null,
        version: { increment: 1 },
      },
    });
  }
}
