import "server-only";

import { randomUUID } from "node:crypto";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import { AnalyticsAuthorization } from "@/backend/analytics/analytics-authorization";
import { PrismaAnalyticsRepository } from "@/backend/repositories/analytics/prisma-analytics-repository";
import { PrismaExportRequestRepository } from "@/backend/repositories/analytics/prisma-export-request-repository";
import { ANALYTICS_DEFINITION_VERSION } from "@/shared/contracts/analytics";
import { projectCandidateExportRow } from "./candidate-export-projection";
import { writeCandidateCsv } from "./csv-export-writer";
import { writeCandidateXlsx } from "./xlsx-export-writer";
import { exportConfiguration, exportMedia } from "./export-config";
import { exportArtifactStorage } from "./storage";
import { emitPlatformOperationalMetric } from "@/backend/observability/platform-operational-metrics";

function auditRetryAt(now: Date, attemptCount: number) {
  const delaySeconds = Math.min(3_600, 30 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + delaySeconds * 1_000);
}

export class CandidateExportWorker {
  constructor(
    private readonly requests = new PrismaExportRequestRepository(),
    private readonly analytics = new PrismaAnalyticsRepository(),
    private readonly storage = exportArtifactStorage(),
    private readonly authorization = new AnalyticsAuthorization(),
    private readonly audit = new PrismaAuditRepository(),
  ) {}

  async runOnce(workerId: string = randomUUID(), now = new Date()) {
    await this.reconcileAuditObligations(now, 25, workerId).catch(
      () => undefined,
    );
    const configuration = exportConfiguration();
    const leaseExpiresAt = new Date(
      now.getTime() + configuration.leaseSeconds * 1_000,
    );
    const request = await this.requests.claimNext(
      workerId,
      now,
      leaseExpiresAt,
    );
    if (!request) return false;
    let artifactLocator: string | null = null;
    let completionRecorded = false;
    try {
      const scope = await this.authorization.employerJob(
        request.requesterUserId,
        request.jobPostingId,
      );
      if (!scope || scope.companyId !== request.companyId) {
        throw new Error("TARGET_UNAVAILABLE");
      }
      const rows = [];
      let estimatedBytes = 0;
      let afterId: string | undefined;
      for (;;) {
        const batch = await this.analytics.listCandidateExportRows({
          jobPostingId: request.jobPostingId,
          dataCutoff: request.dataCutoff,
          afterId,
          limit: configuration.batchSize,
        });
        const projectedBatch = batch.map(projectCandidateExportRow);
        if (rows.length + projectedBatch.length > configuration.maxRows)
          throw new Error("EXPORT_ROW_LIMIT");
        estimatedBytes += Buffer.byteLength(JSON.stringify(projectedBatch));
        if (estimatedBytes > configuration.maxBytes)
          throw new Error("EXPORT_SIZE_LIMIT");
        rows.push(...projectedBatch);
        if (batch.length < configuration.batchSize) break;
        afterId = batch[batch.length - 1]?.id;
        if (!afterId) break;
      }
      const content =
        request.format === "CSV"
          ? writeCandidateCsv(rows)
          : await writeCandidateXlsx(rows, {
              Definition: ANALYTICS_DEFINITION_VERSION,
              DataCutoff: request.dataCutoff.toISOString(),
              "Score availability": "Blank score means unavailable at cutoff.",
            });
      const artifact = await this.storage.put(request.id, content);
      artifactLocator = artifact.locator;
      const media = exportMedia[request.format as "CSV" | "XLSX"];
      const fileName =
        "candidates-" +
        request.jobPostingId +
        "-" +
        request.id +
        "." +
        media.extension;
      const completion = await this.requests.succeed(request.id, {
        workerId,
        storageLocator: artifact.locator,
        fileName,
        mediaType: media.mediaType,
        byteCount: artifact.byteCount,
        checksum: artifact.checksum,
        rowCount: rows.length,
        completedAt: now,
        expiresAt: new Date(
          now.getTime() + configuration.expiresAfterHours * 60 * 60_000,
        ),
        auditObligation: {
          requesterUserId: request.requesterUserId,
          format: request.format,
          rowCount: rows.length,
          occurredAt: now,
        },
      });
      if (completion.count !== 1) {
        await this.storage.delete(artifact.locator).catch(() => undefined);
        artifactLocator = null;
        return true;
      }
      completionRecorded = true;
      emitPlatformOperationalMetric({
        event: "export.completed",
        value: 1,
        dimensions: { format: request.format },
      });
      // The DB row is now the owner of the artifact. Never delete it merely
      // because the separate audit sink is unavailable.
      artifactLocator = null;
      await this.requests.ensureAuditObligation(request.id, {
        requesterUserId: request.requesterUserId,
        format: request.format,
        rowCount: rows.length,
        occurredAt: now,
      });
      await this.reconcileAuditObligations(now, 25, workerId);
      return true;
    } catch (error) {
      if (completionRecorded) return true;
      if (artifactLocator)
        await this.storage.delete(artifactLocator).catch(() => undefined);
      const failureCode =
        error instanceof Error && /^[A-Z0-9_.-]+$/u.test(error.message)
          ? error.message
          : "EXPORT_GENERATION_FAILED";
      const retry = request.attemptCount < configuration.maxAttempts;
      await this.requests.fail(request.id, workerId, failureCode, now, retry);
      if (!retry) {
        await this.audit
          .appendIdempotent(`export-audit:${request.id}`, {
            occurredAt: now,
            actorType: "user",
            actorUserId: request.requesterUserId,
            actorSessionId: null,
            action: "analytics.export.failed",
            targetType: "export_request",
            targetId: request.id,
            result: "FAILURE",
            correlationId: request.id,
            context: { format: request.format, failureCode },
          })
          .catch(() => undefined);
      }
      return true;
    }
  }

  async reconcileAuditObligations(
    now = new Date(),
    take = 25,
    workerId: string = randomUUID(),
  ) {
    const configuration = exportConfiguration();
    const obligations = await this.requests.claimPendingAuditObligations(
      workerId,
      now,
      new Date(now.getTime() + configuration.leaseSeconds * 1_000),
      take,
    );
    let completed = 0;
    for (const obligation of obligations) {
      try {
        await this.audit.appendIdempotent(
          `export-audit:${obligation.exportRequestId}`,
          {
            occurredAt: obligation.occurredAt,
            actorType: "user",
            actorUserId: obligation.requesterUserId,
            actorSessionId: null,
            action: "analytics.export.succeeded",
            targetType: "export_request",
            targetId: obligation.exportRequestId,
            result: "SUCCESS",
            correlationId: obligation.exportRequestId,
            context: {
              format: obligation.format,
              count: obligation.rowCount,
            },
          },
        );
        const result = await this.requests.completeAuditObligation(
          obligation.id,
          workerId,
          now,
        );
        if (result.count === 1) completed += 1;
      } catch (error) {
        const failureCode =
          error instanceof Error && /^[A-Z0-9_.-]+$/u.test(error.message)
            ? error.message
            : "EXPORT_AUDIT_APPEND_FAILED";
        const retry = obligation.attemptCount < configuration.maxAttempts;
        emitPlatformOperationalMetric({
          event: retry ? "export.audit_retry" : "export.audit_dead_letter",
          value: 1,
          dimensions: { code: failureCode },
        });
        await this.requests
          .failAuditObligation(
            obligation.id,
            workerId,
            failureCode,
            now,
            retry,
            retry ? auditRetryAt(now, obligation.attemptCount) : now,
          )
          .catch(() => undefined);
      }
    }
    return { claimed: obligations.length, completed };
  }
}
