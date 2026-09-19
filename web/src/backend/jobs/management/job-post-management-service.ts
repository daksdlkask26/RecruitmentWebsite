import "server-only";
import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import {
  PrismaAdminCommandRepository,
  AdminCommandConflict,
} from "@/backend/repositories/admin/prisma-admin-command-repository";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import { createInAppNotification } from "@/backend/notifications/notification-service";
import {
  findManagedJobPostDetail,
  findManagedJobPostForCommand,
  listManagedJobPosts,
  reserveManagedJobFeaturePlacement,
  syncManagedJobPublicProjection,
} from "@/backend/repositories/jobs/prisma-job-post-management-repository";
import type { AdminAuthority } from "@/backend/security/admin-request-boundary";
import {
  jobManagementCommandSchema,
  jobManagementListQuerySchema,
} from "@/shared/contracts/admin/job-post-management";
import type { JobManagementCommand } from "@/shared/contracts/admin/job-post-management";
import { assertJobPostManagementTransition } from "./job-post-management-policy";
import { emitJobPostManagementOperation } from "./job-post-management-operations";
import {
  invalidatePublicCompanySafety,
  invalidatePublicJobSafety,
} from "@/backend/services/discovery/public-discovery-cache";

function stateOf(row: {
  visibilityState: string;
  applicationState: string;
  softDeletedAt: Date | null;
}) {
  return {
    visibility: row.visibilityState,
    applicationState: row.applicationState,
    softDeleted: Boolean(row.softDeletedAt),
  };
}

type JobPostManagementScope =
  | "JOB_POST_MODERATE"
  | "JOB_POST_FEATURE"
  | "JOB_POST_ENFORCE";

const jobPostManagementScope: Record<
  JobManagementCommand["command"],
  JobPostManagementScope
> = {
  HIDE: "JOB_POST_MODERATE",
  RESTORE: "JOB_POST_MODERATE",
  CLOSE_APPLICATIONS: "JOB_POST_MODERATE",
  REOPEN_APPLICATIONS: "JOB_POST_MODERATE",
  ARCHIVE: "JOB_POST_MODERATE",
  SOFT_DELETE: "JOB_POST_ENFORCE",
  REQUEST_CHANGES: "JOB_POST_MODERATE",
  FEATURE: "JOB_POST_FEATURE",
  AMEND_FEATURE: "JOB_POST_FEATURE",
  UNFEATURE: "JOB_POST_FEATURE",
  ENFORCE: "JOB_POST_ENFORCE",
};

type AdminDb = typeof prisma | Prisma.TransactionClient;

export class JobPostManagementService {
  /** An active, current-session grant with the required job scope authorizes an operation. */
  async assertActiveGrant(
    authority: AdminAuthority,
    scope: JobPostManagementScope = "JOB_POST_MODERATE",
    tx: AdminDb = prisma,
  ) {
    const grant = await tx.platformAdministratorGrant.findFirst({
      where: {
        id: authority.grantId,
        userId: authority.userId,
        state: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        user: { state: "ACTIVE", deletedAt: null },
        sessionPolicy: {
          is: { designatedSessionId: authority.sessionId },
        },
        scopes: { some: { scope } },
      },
      select: { id: true },
    });
    if (!grant) throw new Error("ACTION_BLOCKED");
  }

  async list(authority: AdminAuthority, query: unknown) {
    await this.assertActiveGrant(authority);
    const input = jobManagementListQuerySchema.parse(query);
    return listManagedJobPosts(input);
  }

  async detail(authority: AdminAuthority, jobId: string) {
    await this.assertActiveGrant(authority);
    const row = await findManagedJobPostDetail(jobId);
    if (!row) throw new Error("TARGET_UNAVAILABLE");
    return row;
  }

  async command(
    authority: AdminAuthority,
    jobId: string,
    raw: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const command = jobManagementCommandSchema.parse(raw);
    const scope = jobPostManagementScope[command.command];
    await this.assertActiveGrant(authority, scope);
    const startedAt = Date.now();
    try {
      const result = await new PrismaAdminCommandRepository().execute(
        {
          actorUserId: authority.userId,
          actorSessionId: authority.sessionId,
          grantId: authority.grantId,
          commandKind: `JOB_POST_MANAGEMENT_${command.command}`,
          targetReference: jobId,
          idempotencyKey,
          normalizedBody: { jobId, expectedVersion, command },
        },
        async (tx, correlationId) => {
          await this.assertActiveGrant(authority, scope, tx);
          const row = await findManagedJobPostForCommand(tx, jobId);
          if (!row || !row.publicJobPosting || !row.approvedVersionId)
            throw new Error("TARGET_UNAVAILABLE");
          if (row.version !== expectedVersion)
            throw new AdminCommandConflict("STALE_CONFLICT", row.version);
          assertJobPostManagementTransition(
            command,
            {
              visibility: row.visibilityState,
              applicationState: row.applicationState,
              softDeleted: Boolean(row.softDeletedAt),
              applicationDeadline: row.publicJobPosting.applicationDeadline,
            },
            new Date(),
          );
          const prior = stateOf(row);
          let visibility = row.visibilityState;
          let applicationState = row.applicationState;
          const now = new Date();
          const reason = "reason" in command ? command.reason : null;
          const data: Prisma.JobPostReviewAggregateUpdateManyMutationInput = {
            version: { increment: 1 },
            operationalVersion: { increment: 1 },
          };
          if (command.command === "HIDE") {
            visibility = "HIDDEN";
            Object.assign(data, {
              visibilityState: visibility,
              hiddenAt: now,
              hiddenByUserId: authority.userId,
              hiddenReason: reason,
            });
          }
          if (command.command === "RESTORE") {
            visibility = "PUBLISHED";
            Object.assign(data, {
              visibilityState: visibility,
              hiddenAt: null,
              hiddenByUserId: null,
              hiddenReason: null,
              archivedAt: null,
              archivedByUserId: null,
            });
          }
          if (command.command === "CLOSE_APPLICATIONS") {
            applicationState = "CLOSED";
            Object.assign(data, {
              applicationState,
              applicationClosedAt: now,
              applicationClosedByUserId: authority.userId,
            });
          }
          if (command.command === "REOPEN_APPLICATIONS") {
            applicationState = "OPEN";
            Object.assign(data, {
              applicationState,
              applicationClosedAt: null,
              applicationClosedByUserId: null,
            });
          }
          if (command.command === "ARCHIVE") {
            visibility = "ARCHIVED";
            applicationState = "CLOSED";
            Object.assign(data, {
              visibilityState: visibility,
              applicationState,
              archivedAt: now,
              archivedByUserId: authority.userId,
            });
          }
          if (
            command.command === "SOFT_DELETE" ||
            (command.command === "ENFORCE" &&
              command.type === "SOFT_DELETE_JOB")
          ) {
            visibility = "HIDDEN";
            applicationState = "CLOSED";
            Object.assign(data, {
              visibilityState: visibility,
              applicationState,
              softDeletedAt: now,
              softDeletedByUserId: authority.userId,
              softDeleteReason: reason,
            });
          }
          if (
            command.command === "REQUEST_CHANGES" &&
            command.hideImmediately
          ) {
            visibility = "HIDDEN";
            Object.assign(data, {
              visibilityState: visibility,
              hiddenAt: now,
              hiddenByUserId: authority.userId,
              hiddenReason: command.publicExplanation,
            });
          }
          if (command.command === "ENFORCE" && command.type === "HIDE_JOB") {
            visibility = "HIDDEN";
            Object.assign(data, {
              visibilityState: visibility,
              hiddenAt: now,
              hiddenByUserId: authority.userId,
              hiddenReason: reason,
            });
          }
          if (
            command.command === "ENFORCE" &&
            command.type === "CLOSE_APPLICATIONS"
          ) {
            applicationState = "CLOSED";
            Object.assign(data, {
              applicationState,
              applicationClosedAt: now,
              applicationClosedByUserId: authority.userId,
            });
          }
          if (
            command.command === "ENFORCE" &&
            command.type === "REQUEST_CHANGES"
          ) {
            visibility = "HIDDEN";
            Object.assign(data, {
              visibilityState: visibility,
              hiddenAt: now,
              hiddenByUserId: authority.userId,
              hiddenReason: command.publicExplanation,
            });
          }
          const changed = await tx.jobPostReviewAggregate.updateMany({
            where: { id: row.id, version: expectedVersion },
            data,
          });
          if (changed.count !== 1)
            throw new AdminCommandConflict("STALE_CONFLICT");
          if (
            command.command === "REQUEST_CHANGES" ||
            (command.command === "ENFORCE" &&
              command.type === "REQUEST_CHANGES")
          ) {
            const existingCorrection = await tx.jobPostRevisionRequest.count({
              where: { aggregateId: row.id, state: "OPEN" },
            });
            if (existingCorrection) throw new Error("CORRECTION_REQUEST_OPEN");
            await tx.jobPostRevisionRequest.create({
              data: {
                aggregateId: row.id,
                liveVersionId: row.approvedVersionId,
                requestedByAdminUserId: authority.userId,
                publicExplanation:
                  command.command === "REQUEST_CHANGES"
                    ? command.publicExplanation
                    : command.publicExplanation!,
                hideImmediately:
                  command.command === "REQUEST_CHANGES"
                    ? command.hideImmediately
                    : true,
              },
            });
          }
          if (
            command.command === "FEATURE" ||
            command.command === "AMEND_FEATURE"
          ) {
            if (
              command.endsAt <= command.startsAt ||
              visibility !== "PUBLISHED" ||
              applicationState !== "OPEN"
            )
              throw new Error("VALIDATION_FAILED");
            await reserveManagedJobFeaturePlacement(tx, {
              aggregateId: row.id,
              ...(command.command === "AMEND_FEATURE"
                ? { featureId: command.featureId }
                : {}),
              placement: command.placement,
              startsAt: command.startsAt,
              endsAt: command.endsAt,
              priority: command.priority,
              reason: command.reason,
              createdByAdminUserId: authority.userId,
              now,
            });
          }
          if (command.command === "UNFEATURE")
            await tx.jobPostFeaturedPlacement.updateMany({
              where: {
                id: command.featureId,
                aggregateId: row.id,
                state: { in: ["SCHEDULED", "ACTIVE"] },
              },
              data: {
                state: "CANCELLED",
                cancelledAt: now,
                cancelledByAdminUserId: authority.userId,
                version: { increment: 1 },
              },
            });
          if (command.command === "ENFORCE") {
            const reports = await tx.moderationReport.findMany({
              where: {
                id: { in: command.reportIds },
                jobReference: jobId,
                state: "PENDING_REVIEW",
              },
              select: {
                id: true,
                version: true,
                state: true,
                companyReference: true,
              },
            });
            if (reports.length !== command.reportIds.length)
              throw new Error("REPORT_TARGET_UNAVAILABLE");
            const action = await tx.jobPostEnforcementAction.create({
              data: {
                correlationId,
                type: command.type,
                actorAdminUserId: authority.userId,
                actorSessionId: authority.sessionId,
                reason: command.reason,
                publicExplanation: command.publicExplanation,
              },
            });
            await tx.jobPostEnforcementTarget.create({
              data: {
                enforcementActionId: action.id,
                aggregateId: row.id,
                targetType: "JOB",
                targetReference: jobId,
                priorState: prior,
                resultingState: { visibility, applicationState },
              },
            });
            if (command.type === "SUSPEND_COMPANY") {
              const company = await tx.company.findUnique({
                where: { id: row.companyId },
                select: { verificationState: true, verifiedAt: true },
              });
              if (!company) throw new Error("TARGET_UNAVAILABLE");
              await tx.company.update({
                where: { id: row.companyId },
                data: {
                  verificationState: "INACTIVE",
                  verificationInactiveAt: now,
                  verifiedAt: null,
                },
              });
              await tx.jobPostEnforcementTarget.create({
                data: {
                  enforcementActionId: action.id,
                  targetType: "COMPANY",
                  targetReference: row.companyId,
                  priorState: {
                    verificationState: company.verificationState,
                    verifiedAt: company.verifiedAt?.toISOString() ?? null,
                  },
                  resultingState: { verificationState: "INACTIVE" },
                },
              });
            }
            if (command.type === "SUSPEND_RECRUITER") {
              const recruiterId = row.approvedVersion?.submittedByUserId;
              if (!recruiterId) throw new Error("TARGET_UNAVAILABLE");
              const suspended = await tx.companyMembership.updateMany({
                where: {
                  companyId: row.companyId,
                  userId: recruiterId,
                  status: "ACTIVE",
                },
                data: { status: "SUSPENDED", stateChangedAt: now },
              });
              if (suspended.count !== 1) throw new Error("TARGET_UNAVAILABLE");
              await tx.jobPostEnforcementTarget.create({
                data: {
                  enforcementActionId: action.id,
                  targetType: "RECRUITER",
                  targetReference: recruiterId,
                  priorState: { membershipState: "ACTIVE" },
                  resultingState: { membershipState: "SUSPENDED" },
                },
              });
            }
            await tx.moderationReportEnforcementLink.createMany({
              data: reports.map((report) => ({
                moderationReportId: report.id,
                enforcementActionId: action.id,
              })),
            });
            for (const report of reports) {
              await tx.moderationReport.update({
                where: { id: report.id },
                data: {
                  state: "RESOLVED",
                  terminalAt: now,
                  unresolvedKey: null,
                  version: { increment: 1 },
                },
              });
              await tx.moderationReportHistory.create({
                data: {
                  reportId: report.id,
                  actorAdminUserId: authority.userId,
                  action: "enforced",
                  priorState: report.state,
                  resultingState: "RESOLVED",
                  resultingVersion: report.version + 1,
                  enforcementCorrelationId: correlationId,
                  occurredAt: now,
                },
              });
            }
          }
          await syncManagedJobPublicProjection(tx, {
            publicJobPostingId: row.publicJobPosting.id,
            visibility,
            applicationState,
            now,
            actorUserId: authority.userId,
            correlationId,
          });
          const version = expectedVersion + 1;
          await tx.jobPostOperationalHistory.create({
            data: {
              aggregateId: row.id,
              action: command.command,
              actorUserId: authority.userId,
              correlationId,
              priorState: prior,
              resultingState: { visibility, applicationState },
              reason:
                command.command === "REQUEST_CHANGES"
                  ? command.publicExplanation
                  : command.command === "ENFORCE" &&
                      command.type === "REQUEST_CHANGES"
                    ? command.publicExplanation
                    : reason,
              version,
              occurredAt: now,
            },
          });
          const auditAction = {
            HIDE: "job_post_management.hide",
            RESTORE: "job_post_management.restore",
            CLOSE_APPLICATIONS: "job_post_management.close_applications",
            REOPEN_APPLICATIONS: "job_post_management.reopen_applications",
            ARCHIVE: "job_post_management.archive",
            SOFT_DELETE: "job_post_management.soft_delete",
            REQUEST_CHANGES: "job_post_management.request_changes",
            FEATURE: "job_post_management.feature",
            AMEND_FEATURE: "job_post_management.feature",
            UNFEATURE: "job_post_management.unfeature",
            ENFORCE: "job_post_management.enforce",
          } as const;
          await new PrismaAuditRepository(tx).append({
            occurredAt: now,
            actorType: "user",
            actorUserId: authority.userId,
            actorSessionId: authority.sessionId,
            action: auditAction[command.command],
            targetType: "job_posting",
            targetId: jobId,
            result: "SUCCESS",
            correlationId,
            context: {
              targetVersion: version,
              priorState: JSON.stringify(prior),
              resultingState: JSON.stringify({ visibility, applicationState }),
              visibility,
              applicationState,
            },
          });
          if (
            command.command === "SOFT_DELETE" ||
            (command.command === "ENFORCE" &&
              command.type === "SOFT_DELETE_JOB")
          ) {
            await new PrismaAuditRepository(tx).append({
              occurredAt: now,
              actorType: "user",
              actorUserId: authority.userId,
              actorSessionId: authority.sessionId,
              action: "job_posting.deleted",
              targetType: "job_posting",
              targetId: row.publicJobPosting.id,
              result: "SUCCESS",
              correlationId,
              context: {
                reasonCategory: reason ?? undefined,
                status: "REMOVED",
              },
            });
          }
          if (
            (command.command === "REQUEST_CHANGES" ||
              (command.command === "ENFORCE" &&
                command.type === "REQUEST_CHANGES")) &&
            row.approvedVersion?.submittedByUserId
          ) {
            await createInAppNotification(tx, {
              recipientUserId: row.approvedVersion.submittedByUserId,
              kind: "JOB_POST_CHANGES_REQUESTED",
              deduplicationKey: `job-post-correction:${row.id}:${version}`,
              correlationId,
              occurredAt: now,
              contextType: "JOB_POST_REVIEW",
              contextId: row.approvedVersionId,
              variables: {
                audience: "USER",
                recipientRole: "RECRUITER",
                state: "CHANGES_REQUESTED",
              },
            });
          }
          return {
            jobId,
            companyId: row.companyId,
            version,
            visibility,
            applicationState,
            status: "SUCCESS" as const,
          };
        },
      );
      invalidatePublicJobSafety(jobId);
      invalidatePublicCompanySafety(result.companyId);
      emitJobPostManagementOperation({
        operation: command.command.toLowerCase(),
        outcome: "success",
        correlationId: idempotencyKey,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      emitJobPostManagementOperation({
        operation: command.command.toLowerCase(),
        outcome: "failure",
        correlationId: idempotencyKey,
        durationMs: Date.now() - startedAt,
        affectedCount: 0,
      });
      throw error;
    }
  }
}
