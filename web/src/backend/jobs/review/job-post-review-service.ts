import "server-only";
import { PrismaJobPostReviewRepository } from "@/backend/repositories/jobs/prisma-job-post-review-repository";
import { prisma } from "@/backend/database/prisma";
import { randomUUID } from "node:crypto";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import {
  AdminCommandDenied,
  AdminCommandConflict,
  PrismaAdminCommandRepository,
} from "@/backend/repositories/admin/prisma-admin-command-repository";
import type { AdminAuthority } from "@/backend/security/admin-request-boundary";
import {
  adminReviewCommandResultSchema,
  jobPostReviewDetailSchema,
  jobPostReviewListQuerySchema,
  jobPostReviewQueuePageSchema,
  type AdminReviewCommand,
} from "@/shared/contracts/admin/job-post-review";
import { jobReviewSnapshotSchema } from "@/shared/contracts/recruiter-job-posting";
import {
  JobPostDecisionPolicyError,
  validateJobPostDecision,
} from "./job-post-review-policy";
import { projectJobReviewSnapshot } from "./job-post-publication-projector";
import { emitJobPostReviewOperation } from "./job-post-review-operations";
import { appendJobPostingLifecycleFact } from "@/backend/repositories/analytics/prisma-analytics-repository";
import { publishApprovedJobToCatalogue } from "@/backend/services/jobs/publish-approved-job-to-catalogue";
import { syncManagedJobPublicProjection } from "@/backend/repositories/jobs/prisma-job-post-management-repository";
import { searchCatalogProvider } from "@/backend/services/search/catalogs/search-catalog-provider";
import {
  invalidatePublicCompany,
  invalidatePublicJob,
  invalidatePublicCompanySafety,
  invalidatePublicJobSafety,
} from "@/backend/services/discovery/public-discovery-cache";

/**
 * Application boundary for the review lifecycle. User-story orchestration is
 * added here so Route Handlers never depend on Prisma or JSON persistence.
 */
export class JobPostReviewService {
  constructor(
    readonly reviews: PrismaJobPostReviewRepository = new PrismaJobPostReviewRepository(),
  ) {}

  private async assertCurrentGrant(
    authority: AdminAuthority,
    now = new Date(),
  ) {
    const grant = await prisma.platformAdministratorGrant.findFirst({
      where: {
        id: authority.grantId,
        userId: authority.userId,
        state: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (!grant) throw new Error("TARGET_UNAVAILABLE");
  }

  async list(authority: AdminAuthority, query: unknown) {
    const startedAt = performance.now();
    const input = jobPostReviewListQuerySchema.parse(query);
    const calculatedAt = new Date();
    await this.assertCurrentGrant(authority, calculatedAt);
    const result = await this.reviews.listReviewQueue({
      page: input.page,
      perPage: input.perPage,
      state: input.state,
      q: input.q,
      companyId: input.companyId,
      assignedAdminUserId:
        input.assignment === "UNASSIGNED"
          ? null
          : input.assignment === "MINE"
            ? authority.userId
            : undefined,
      submittedBefore:
        input.minimumAgeHours === undefined
          ? undefined
          : new Date(
              calculatedAt.getTime() - input.minimumAgeHours * 60 * 60_000,
            ),
      sequence: input.sequence,
      recordStatus: input.recordStatus ?? "ACTIVE",
    });
    emitJobPostReviewOperation({
      operation: "queue_read",
      outcome: "success",
      correlationId: randomUUID(),
      durationMs: performance.now() - startedAt,
      queueAgeSeconds: result.rows.reduce(
        (maximum, row) =>
          Math.max(
            maximum,
            Math.max(
              0,
              Math.floor(
                (calculatedAt.getTime() - row.submittedAt.getTime()) / 1_000,
              ),
            ),
          ),
        0,
      ),
    });
    return jobPostReviewQueuePageSchema.parse({
      total: result.total,
      calculatedAt: calculatedAt.toISOString(),
      data: result.rows.map((row) => {
        const snapshot = jobReviewSnapshotSchema.safeParse(row.snapshot);
        return {
          id: row.id,
          jobId: row.aggregate.jobId,
          jobTitle: snapshot.success
            ? snapshot.data.title
            : "Unavailable job content",
          companyId: row.aggregate.company.id,
          companyDisplayName: row.aggregate.company.displayName,
          sequence: row.sequence,
          state: row.state,
          assignment: row.assignedAdminUserId,
          submittedAt: row.submittedAt.toISOString(),
          ageSeconds: Math.max(
            0,
            Math.floor(
              (calculatedAt.getTime() - row.submittedAt.getTime()) / 1_000,
            ),
          ),
          version: row.aggregate.version,
          recordStatus: row.aggregate.softDeletedAt ? "DELETED" : "ACTIVE",
          deletedAt: row.aggregate.softDeletedAt?.toISOString() ?? null,
          integrityState: snapshot.success ? "VALID" : "BLOCKED",
        };
      }),
    });
  }

  async detail(authority: AdminAuthority, reviewId: string) {
    await this.assertCurrentGrant(authority);
    const row = await this.reviews.findReviewDetail(reviewId);
    if (!row) throw new Error("TARGET_UNAVAILABLE");
    const snapshot = jobReviewSnapshotSchema.safeParse(row.snapshot);
    if (!snapshot.success) {
      emitJobPostReviewOperation({
        operation: "integrity_block",
        outcome: "denied",
        correlationId: randomUUID(),
        durationMs: 0,
        code: "CONTENT_INTEGRITY_BLOCKED",
        version: row.aggregate.version,
      });
      throw new Error("TARGET_UNAVAILABLE");
    }
    const membershipActive = row.submittedMembership?.status === "ACTIVE";
    const accountActive = row.submittedBy?.state === "ACTIVE";
    const companyActive =
      row.aggregate.company.verificationState === "ACTIVE" &&
      row.aggregate.company.verifiedAt !== null &&
      row.aggregate.company.verificationInactiveAt === null;
    return jobPostReviewDetailSchema.parse({
      id: row.id,
      jobId: row.aggregate.jobId,
      companyId: row.aggregate.companyId,
      sequence: row.sequence,
      state: row.state,
      assignment: row.assignedAdminUserId,
      submittedAt: row.submittedAt.toISOString(),
      ageSeconds: Math.max(
        0,
        Math.floor((Date.now() - row.submittedAt.getTime()) / 1_000),
      ),
      version: row.aggregate.version,
      recordStatus: row.aggregate.softDeletedAt ? "DELETED" : "ACTIVE",
      deletedAt: row.aggregate.softDeletedAt?.toISOString() ?? null,
      integrityState: "VALID",
      snapshot: snapshot.data,
      snapshotSchemaVersion: row.snapshotSchemaVersion,
      snapshotSha256: row.snapshotSha256,
      taxonomyProposal: row.taxonomyProposal
        ? {
            id: row.taxonomyProposal.id,
            proposedName: row.taxonomyProposal.proposedName,
            description: row.taxonomyProposal.description,
            status: row.taxonomyProposal.status,
            industryCode: row.taxonomyProposal.industry.code,
            industryName: row.taxonomyProposal.industry.name,
            resolvedSubIndustryCode:
              row.taxonomyProposal.resolvedSubIndustry?.code ?? null,
            resolvedSubIndustryName:
              row.taxonomyProposal.resolvedSubIndustry?.name ?? null,
            createdAt: row.taxonomyProposal.createdAt.toISOString(),
            reviewedAt: row.taxonomyProposal.reviewedAt?.toISOString() ?? null,
          }
        : null,
      company: {
        id: row.aggregate.company.id,
        displayName: row.aggregate.company.displayName,
        verificationState: row.aggregate.company.verificationState,
        active: companyActive,
        protectedVerificationHref: `/#/verification-requests?filter=${encodeURIComponent(JSON.stringify({ targetCompanyId: row.aggregate.company.id }))}`,
      },
      submitter: {
        accountId: row.submittedBy?.id ?? "imported-baseline",
        displayName: row.submittedBy?.name ?? "Imported baseline",
        membershipState: row.submittedMembership?.status ?? "IMPORTED",
        currentlyEligible: membershipActive && accountActive && companyActive,
      },
      priorApprovedSnapshot:
        row.aggregate.approvedVersion?.id === row.id
          ? null
          : (row.aggregate.approvedVersion?.snapshot ?? null),
      decision: row.decidedAt
        ? {
            adminUserId: row.decidedByAdminUserId,
            decidedAt: row.decidedAt.toISOString(),
            publishedAt: row.publishedAt?.toISOString() ?? null,
            reasonCode: row.reasonCode,
            publicExplanation: row.publicExplanation,
          }
        : null,
      history: row.history.map((item) => ({
        id: item.id,
        action: item.action,
        resultingState: item.resultingState,
        resultingVersion: item.resultingAggregateVersion,
        occurredAt: item.occurredAt.toISOString(),
      })),
      privateNotes: row.privateNotes.map((note) => ({
        id: note.id,
        authorAdminUserId: note.authorAdminUserId,
        normalizedText: note.normalizedText,
        createdAt: note.createdAt.toISOString(),
      })),
    });
  }

  async assign(input: {
    authority: AdminAuthority;
    reviewId: string;
    command: Extract<AdminReviewCommand, { command: "CLAIM" | "REASSIGN" }>;
    expectedVersion: number;
    idempotencyKey: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.assertCurrentGrant(input.authority, now);
    return new PrismaAdminCommandRepository().execute(
      {
        actorUserId: input.authority.userId,
        actorSessionId: input.authority.sessionId,
        grantId: input.authority.grantId,
        commandKind: `JOB_POST_REVIEW_${input.command.command}`,
        targetReference: input.reviewId,
        idempotencyKey: input.idempotencyKey,
        normalizedBody: {
          reviewId: input.reviewId,
          expectedVersion: input.expectedVersion,
          ...input.command,
        },
      },
      async (transaction, correlationId) => {
        const currentGrant =
          await transaction.platformAdministratorGrant.findFirst({
            where: {
              id: input.authority.grantId,
              userId: input.authority.userId,
              state: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              user: { state: "ACTIVE", deletedAt: null },
              sessionPolicy: {
                is: { designatedSessionId: input.authority.sessionId },
              },
            },
            select: { id: true },
          });
        if (!currentGrant) throw new Error("TARGET_UNAVAILABLE");
        const row = await transaction.jobPostReviewVersion.findUnique({
          where: { id: input.reviewId },
          include: { aggregate: true },
        });
        if (!row || row.state !== "PENDING_REVIEW")
          throw new Error("TARGET_UNAVAILABLE");
        if (row.aggregate.version !== input.expectedVersion)
          throw new AdminCommandConflict(
            "STALE_CONFLICT",
            row.aggregate.version,
          );
        let targetAdminUserId = input.authority.userId;
        if (input.command.command === "REASSIGN")
          targetAdminUserId = input.command.targetAdminUserId;
        const target = await transaction.platformAdministratorGrant.findFirst({
          where: {
            userId: targetAdminUserId,
            state: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            user: { state: "ACTIVE", deletedAt: null },
          },
          select: { userId: true },
        });
        if (!target) throw new Error("TARGET_UNAVAILABLE");
        if (
          row.assignedAdminUserId &&
          row.assignedAdminUserId !== input.authority.userId
        ) {
          const incumbent =
            await transaction.platformAdministratorGrant.findFirst({
              where: {
                userId: row.assignedAdminUserId,
                state: "ACTIVE",
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                user: { state: "ACTIVE", deletedAt: null },
              },
              select: { id: true },
            });
          if (incumbent) throw new Error("ACTION_BLOCKED");
        }
        if (
          input.command.command === "CLAIM" &&
          row.assignedAdminUserId === input.authority.userId
        )
          throw new Error("ACTION_BLOCKED");
        if (
          input.command.command === "REASSIGN" &&
          row.assignedAdminUserId !== input.authority.userId &&
          row.assignedAdminUserId === null
        )
          throw new Error("ACTION_BLOCKED");
        const updatedAggregate =
          await transaction.jobPostReviewAggregate.updateMany({
            where: {
              id: row.aggregate.id,
              version: input.expectedVersion,
              pendingVersionId: row.id,
            },
            data: { version: { increment: 1 } },
          });
        if (updatedAggregate.count !== 1)
          throw new AdminCommandConflict("STALE_CONFLICT");
        await transaction.jobPostReviewVersion.update({
          where: { id: row.id },
          data: { assignedAdminUserId: targetAdminUserId, assignedAt: now },
        });
        const resultingVersion = input.expectedVersion + 1;
        const action =
          input.command.command === "CLAIM" ? "CLAIMED" : "REASSIGNED";
        await transaction.jobPostReviewHistory.create({
          data: {
            reviewVersionId: row.id,
            action,
            actorUserId: input.authority.userId,
            priorState: row.state,
            resultingState: row.state,
            priorAssigneeUserId: row.assignedAdminUserId,
            resultingAssigneeUserId: targetAdminUserId,
            resultingAggregateVersion: resultingVersion,
            correlationId,
            occurredAt: now,
          },
        });
        if (input.command.command === "REASSIGN" && input.command.privateNote) {
          await transaction.jobPostReviewPrivateNote.create({
            data: {
              reviewVersionId: row.id,
              authorAdminUserId: input.authority.userId,
              normalizedText: input.command.privateNote,
              createdAt: now,
            },
          });
        }
        await new PrismaAuditRepository(transaction).append({
          occurredAt: now,
          actorType: "user",
          actorUserId: input.authority.userId,
          actorSessionId: input.authority.sessionId,
          action:
            input.command.command === "CLAIM"
              ? "job_post_review.claimed"
              : "job_post_review.reassigned",
          targetType: "job_post_review",
          targetId: row.id,
          result: "SUCCESS",
          correlationId,
          context: {
            priorState: row.state,
            resultingState: row.state,
            targetVersion: resultingVersion,
          },
        });
        return adminReviewCommandResultSchema.parse({
          reviewId: row.id,
          state: row.state,
          assignedAdminUserId: targetAdminUserId,
          version: resultingVersion,
          correlationId,
        });
      },
    );
  }

  async decide(input: {
    authority: AdminAuthority;
    reviewId: string;
    command: Extract<AdminReviewCommand, { command: "APPROVE" | "REJECT" }>;
    expectedVersion: number;
    idempotencyKey: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const startedAt = performance.now();
    const catalogSnapshot = await searchCatalogProvider.getActiveSnapshot();
    const result = await new PrismaAdminCommandRepository().execute(
      {
        actorUserId: input.authority.userId,
        actorSessionId: input.authority.sessionId,
        grantId: input.authority.grantId,
        commandKind: `JOB_POST_REVIEW_${input.command.command}`,
        targetReference: input.reviewId,
        idempotencyKey: input.idempotencyKey,
        normalizedBody: {
          reviewId: input.reviewId,
          expectedVersion: input.expectedVersion,
          ...input.command,
        },
      },
      async (transaction, correlationId) => {
        const [currentGrant, row] = await Promise.all([
          transaction.platformAdministratorGrant.findFirst({
            where: {
              id: input.authority.grantId,
              userId: input.authority.userId,
              state: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              user: { state: "ACTIVE", deletedAt: null },
              sessionPolicy: {
                is: { designatedSessionId: input.authority.sessionId },
              },
            },
            select: { id: true },
          }),
          transaction.jobPostReviewVersion.findUnique({
            where: { id: input.reviewId },
            include: {
              aggregate: { include: { company: true } },
              submittedBy: {
                select: { id: true, state: true, deletedAt: true },
              },
              submittedMembership: true,
            },
          }),
        ]);
        if (!row) throw new Error("TARGET_UNAVAILABLE");
        const companyEligible =
          row.aggregate.company.verificationState === "ACTIVE" &&
          row.aggregate.company.verifiedAt !== null &&
          row.aggregate.company.verificationInactiveAt === null;
        const submitterEligible = Boolean(
          row.submittedBy &&
          row.submittedBy.state === "ACTIVE" &&
          row.submittedBy.deletedAt === null &&
          row.submittedMembership &&
          row.submittedMembership.status === "ACTIVE" &&
          row.submittedMembership.companyId === row.aggregate.companyId &&
          row.submittedMembership.userId === row.submittedBy.id,
        );
        let snapshot;
        try {
          snapshot = validateJobPostDecision({
            decision: input.command.command,
            reviewState: row.state,
            assignedAdminUserId: row.assignedAdminUserId,
            actorUserId: input.authority.userId,
            administratorEligible: Boolean(currentGrant),
            companyEligible,
            submitterEligible,
            currentAggregateVersion: row.aggregate.version,
            expectedAggregateVersion: input.expectedVersion,
            snapshot: row.snapshot,
            storedSnapshotSha256: row.snapshotSha256,
            now,
          }).snapshot;
          if (input.command.command === "APPROVE")
            projectJobReviewSnapshot(snapshot);
        } catch (error) {
          const code =
            error instanceof JobPostDecisionPolicyError
              ? error.code
              : "CONTENT_INTEGRITY_BLOCKED";
          await new PrismaAuditRepository(transaction).append({
            occurredAt: now,
            actorType: "user",
            actorUserId: input.authority.userId,
            actorSessionId: input.authority.sessionId,
            action: "job_post_review.approval_blocked",
            targetType: "job_post_review",
            targetId: row.id,
            result: "DENIED",
            correlationId,
            context: {
              priorState: row.state,
              resultingState: row.state,
              targetVersion: row.aggregate.version,
              failureCode: code,
            },
          });
          emitJobPostReviewOperation({
            operation:
              code === "STALE_CONFLICT"
                ? "stale_conflict"
                : code === "CONTENT_INTEGRITY_BLOCKED"
                  ? "integrity_block"
                  : "decision",
            outcome: "denied",
            correlationId,
            durationMs: performance.now() - startedAt,
            code,
            version: row.aggregate.version,
          });
          throw new AdminCommandDenied({
            reviewId: row.id,
            state: row.state,
            assignedAdminUserId: row.assignedAdminUserId,
            version: row.aggregate.version,
            correlationId,
            status: "ACTION_BLOCKED",
            code,
          });
        }
        const decided = await new PrismaJobPostReviewRepository(
          transaction,
        ).decidePending({
          reviewId: row.id,
          aggregateId: row.aggregate.id,
          expectedAggregateVersion: input.expectedVersion,
          existingPublicJobPostingId: row.aggregate.publicJobPostingId,
          closedAt: row.aggregate.closedAt,
          snapshot,
          command: input.command,
          actorUserId: input.authority.userId,
          actorSessionId: input.authority.sessionId,
          submittedByUserId: row.submittedByUserId,
          notifySubmitter: submitterEligible,
          correlationId,
          now,
          catalogIndex: catalogSnapshot.index,
        });
        emitJobPostReviewOperation({
          operation: "decision",
          outcome: "success",
          correlationId,
          durationMs: performance.now() - startedAt,
          version: decided.version,
        });
        return adminReviewCommandResultSchema.parse(decided);
      },
    );
    const parsed = adminReviewCommandResultSchema.parse(result);
    if (input.command.command === "APPROVE" && parsed.state === "APPROVED") {
      // PostgreSQL is the review/publication source of truth. The JSON
      // catalogue is a compatibility/search projection and must only receive
      // the snapshot after the approval transaction has committed.
      const approvedVersion = await prisma.jobPostReviewVersion.findUnique({
        where: { id: input.reviewId },
        select: {
          snapshot: true,
          aggregate: {
            select: {
              closedAt: true,
              publicJobPosting: {
                select: {
                  id: true,
                  companyId: true,
                  industryId: true,
                  subIndustryId: true,
                  industryCode: true,
                  subIndustryCode: true,
                  industry: { select: { name: true } },
                  subIndustry: { select: { name: true } },
                },
              },
            },
          },
        },
      });
      if (approvedVersion) {
        // The taxonomy mutation committed with the approval transaction.
        // Clear its read cache only now, so a concurrent reader cannot refill
        // it with the pre-approval active-value set.
        await import("@/backend/services/jobs/job-taxonomy-service")
          .then(({ invalidateJobTaxonomyCache }) =>
            invalidateJobTaxonomyCache(),
          )
          .catch(() => undefined);
        await import("@/backend/services/jobs/job-search-taxonomy")
          .then(({ invalidateJobSearchTaxonomyCache }) =>
            invalidateJobSearchTaxonomyCache(),
          )
          .catch(() => undefined);
        try {
          await publishApprovedJobToCatalogue({
            snapshot: approvedVersion.snapshot,
            now,
            status: approvedVersion.aggregate.closedAt ? "closed" : "active",
            taxonomy: approvedVersion.aggregate.publicJobPosting
              ? {
                  industryId:
                    approvedVersion.aggregate.publicJobPosting.industryId,
                  subIndustryId:
                    approvedVersion.aggregate.publicJobPosting.subIndustryId,
                  industryCode:
                    approvedVersion.aggregate.publicJobPosting.industryCode,
                  subIndustryCode:
                    approvedVersion.aggregate.publicJobPosting.subIndustryCode,
                  industryName:
                    approvedVersion.aggregate.publicJobPosting.industry?.name ??
                    null,
                  subIndustryName:
                    approvedVersion.aggregate.publicJobPosting.subIndustry
                      ?.name ?? null,
                }
              : null,
          });
          // Avoid serving the pre-approval projection to a recruiter who is
          // already watching the management screen.
          await import("@/backend/services/jobs/recruiter-job-posting-data")
            .then(({ invalidateRecruiterJobCatalogueCache }) =>
              invalidateRecruiterJobCatalogueCache(),
            )
            .catch(() => undefined);
          await import("@/backend/services/jobs/job-workspace-data")
            .then(({ invalidateJobWorkspaceCatalogueCache }) =>
              invalidateJobWorkspaceCatalogueCache(),
            )
            .catch(() => undefined);
        } catch (error) {
          // Approval is already committed in PostgreSQL. Keep that decision
          // durable and log a retryable projection failure instead of telling
          // the admin that a successful approval failed mid-request.
          console.error("[job-catalogue] approval projection failed", error);
        }
      }
    }
    const visibility = await prisma.jobPostReviewVersion.findUnique({
      where: { id: input.reviewId },
      select: {
        aggregate: {
          select: {
            companyId: true,
            publicJobPostingId: true,
          },
        },
      },
    });
    if (visibility?.aggregate.publicJobPostingId) {
      invalidatePublicJob(visibility.aggregate.publicJobPostingId);
      invalidatePublicCompany(visibility.aggregate.companyId);
    }
    return parsed;
  }
}

export async function closeManagedJobPost(input: {
  jobId: string;
  companyId: string;
  actorUserId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const result = await prisma.$transaction(async (transaction) => {
    const aggregate = await transaction.jobPostReviewAggregate.findUnique({
      where: { jobId: input.jobId },
    });
    if (!aggregate) return false;
    if (aggregate.companyId !== input.companyId)
      throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
    if (aggregate.closedAt) return true;
    const correlationId = randomUUID();
    const closed = await transaction.jobPostReviewAggregate.update({
      where: { id: aggregate.id, version: aggregate.version },
      data: {
        closedAt: now,
        closedByUserId: input.actorUserId,
        version: { increment: 1 },
      },
    });
    if (aggregate.publicJobPostingId) {
      const currentPublicJob = await transaction.jobPosting.findUniqueOrThrow({
        where: { id: aggregate.publicJobPostingId },
        select: { status: true },
      });
      const closedPublicJob = await transaction.jobPosting.update({
        where: { id: aggregate.publicJobPostingId },
        data: { status: "CLOSED", closedAt: now, version: { increment: 1 } },
      });
      await appendJobPostingLifecycleFact(transaction, {
        jobPostingId: closedPublicJob.id,
        companyId: aggregate.companyId,
        fromStatus: currentPublicJob.status,
        toStatus: closedPublicJob.status,
        effectiveAt: now,
        postingVersion: closedPublicJob.version,
        actorUserId: input.actorUserId,
        correlationId,
      });
    }
    const reviewVersionId =
      aggregate.pendingVersionId ?? aggregate.approvedVersionId;
    if (reviewVersionId) {
      const review = await transaction.jobPostReviewVersion.findUniqueOrThrow({
        where: { id: reviewVersionId },
        select: { state: true, assignedAdminUserId: true },
      });
      await transaction.jobPostReviewHistory.create({
        data: {
          reviewVersionId,
          action: "CLOSED",
          actorUserId: input.actorUserId,
          priorState: review.state,
          resultingState: review.state,
          priorAssigneeUserId: review.assignedAdminUserId,
          resultingAssigneeUserId: review.assignedAdminUserId,
          resultingAggregateVersion: closed.version,
          correlationId,
          occurredAt: now,
        },
      });
    }
    await new PrismaAuditRepository(transaction).append({
      occurredAt: now,
      actorType: "user",
      actorUserId: input.actorUserId,
      actorSessionId: null,
      action: "job_post_review.closed",
      targetType: "job_post_review",
      targetId: reviewVersionId ?? aggregate.id,
      result: "SUCCESS",
      correlationId,
      context: { resultingState: "CLOSED", targetVersion: closed.version },
    });
    return true;
  });
  if (result) {
    invalidatePublicJobSafety(input.jobId);
    invalidatePublicCompanySafety(input.companyId);
  }
  return result;
}

export async function reopenManagedJobPost(input: {
  jobId: string;
  companyId: string;
  actorUserId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const result = await prisma.$transaction(async (transaction) => {
    const aggregate = await transaction.jobPostReviewAggregate.findUnique({
      where: { jobId: input.jobId },
    });
    if (!aggregate) return false;
    if (aggregate.companyId !== input.companyId)
      throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
    if (!aggregate.closedAt) return true;

    const correlationId = randomUUID();
    const reopened = await transaction.jobPostReviewAggregate.update({
      where: { id: aggregate.id, version: aggregate.version },
      data: {
        closedAt: null,
        closedByUserId: null,
        version: { increment: 1 },
      },
    });
    if (aggregate.publicJobPostingId) {
      const currentPublicJob = await transaction.jobPosting.findUniqueOrThrow({
        where: { id: aggregate.publicJobPostingId },
        select: { status: true },
      });
      const reopenedPublicJob = await transaction.jobPosting.update({
        where: { id: aggregate.publicJobPostingId },
        data: { status: "ACTIVE", closedAt: null, version: { increment: 1 } },
      });
      await appendJobPostingLifecycleFact(transaction, {
        jobPostingId: reopenedPublicJob.id,
        companyId: aggregate.companyId,
        fromStatus: currentPublicJob.status,
        toStatus: reopenedPublicJob.status,
        effectiveAt: now,
        postingVersion: reopenedPublicJob.version,
        actorUserId: input.actorUserId,
        correlationId,
      });
    }

    const reviewVersionId =
      aggregate.pendingVersionId ?? aggregate.approvedVersionId;
    if (reviewVersionId) {
      const review = await transaction.jobPostReviewVersion.findUniqueOrThrow({
        where: { id: reviewVersionId },
        select: { state: true, assignedAdminUserId: true },
      });
      await transaction.jobPostReviewHistory.create({
        data: {
          reviewVersionId,
          action: "REOPENED",
          actorUserId: input.actorUserId,
          priorState: review.state,
          resultingState: review.state,
          priorAssigneeUserId: review.assignedAdminUserId,
          resultingAssigneeUserId: review.assignedAdminUserId,
          resultingAggregateVersion: reopened.version,
          correlationId,
          occurredAt: now,
        },
      });
    }
    await new PrismaAuditRepository(transaction).append({
      occurredAt: now,
      actorType: "user",
      actorUserId: input.actorUserId,
      actorSessionId: null,
      action: "job_post_review.reopened",
      targetType: "job_post_review",
      targetId: reviewVersionId ?? aggregate.id,
      result: "SUCCESS",
      correlationId,
      context: { resultingState: "ACTIVE", targetVersion: reopened.version },
    });
    return true;
  });
  if (result) {
    invalidatePublicJobSafety(input.jobId);
    invalidatePublicCompanySafety(input.companyId);
  }
  return result;
}

/**
 * Ends a recruiter submission without treating it as an administrator
 * rejection. The immutable version and its audit trail remain available, but
 * it immediately leaves every pending-review queue.
 */
export async function withdrawManagedJobPostReview(input: {
  jobId: string;
  companyId: string;
  actorUserId: string;
  actorSessionId?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const aggregate = await transaction.jobPostReviewAggregate.findUnique({
      where: { jobId: input.jobId },
      include: { pendingVersion: true },
    });
    const review = aggregate?.pendingVersion;
    if (
      !aggregate ||
      aggregate.companyId !== input.companyId ||
      aggregate.softDeletedAt ||
      !review
    ) {
      throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
    }
    if (review.state !== "PENDING_REVIEW")
      throw new Error("JOB_POST_REVIEW_CONFLICT");

    const correlationId = randomUUID();
    const aggregateUpdate = await transaction.jobPostReviewAggregate.updateMany(
      {
        where: {
          id: aggregate.id,
          version: aggregate.version,
          pendingVersionId: review.id,
        },
        data: { pendingVersionId: null, version: { increment: 1 } },
      },
    );
    if (aggregateUpdate.count !== 1)
      throw new Error("JOB_POST_REVIEW_CONFLICT");

    const reviewUpdate = await transaction.jobPostReviewVersion.updateMany({
      where: { id: review.id, state: "PENDING_REVIEW" },
      data: {
        state: "WITHDRAWN",
        assignedAdminUserId: null,
        assignedAt: null,
        decidedAt: now,
      },
    });
    if (reviewUpdate.count !== 1) throw new Error("JOB_POST_REVIEW_CONFLICT");

    await transaction.jobPostReviewHistory.create({
      data: {
        reviewVersionId: review.id,
        action: "WITHDRAWN",
        actorUserId: input.actorUserId,
        priorState: "PENDING_REVIEW",
        resultingState: "WITHDRAWN",
        priorAssigneeUserId: review.assignedAdminUserId,
        resultingAssigneeUserId: null,
        resultingAggregateVersion: aggregate.version + 1,
        correlationId,
        occurredAt: now,
      },
    });
    await new PrismaAuditRepository(transaction).append({
      occurredAt: now,
      actorType: "user",
      actorUserId: input.actorUserId,
      actorSessionId: input.actorSessionId ?? null,
      action: "job_post_review.withdrawn",
      targetType: "job_post_review",
      targetId: review.id,
      result: "SUCCESS",
      correlationId,
      context: {
        priorState: "PENDING_REVIEW",
        resultingState: "WITHDRAWN",
        targetVersion: aggregate.version + 1,
      },
    });
    return {
      reviewId: review.id,
      sequence: review.sequence,
      snapshot: jobReviewSnapshotSchema.parse(review.snapshot),
      submittedAt: review.submittedAt,
      aggregateVersion: aggregate.version + 1,
    };
  });
}

/**
 * Recruiter deletion is deliberately a soft delete for managed jobs. Public
 * visibility and applications are closed while relational history and
 * applications remain intact.
 */
export async function softDeleteManagedJobPost(input: {
  jobId: string;
  companyId: string;
  actorUserId: string;
  actorSessionId?: string | null;
  reason?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const result = await prisma.$transaction(async (transaction) => {
    const aggregate = await transaction.jobPostReviewAggregate.findUnique({
      where: { jobId: input.jobId },
    });
    if (!aggregate) return false;
    if (aggregate.companyId !== input.companyId)
      throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
    if (aggregate.pendingVersionId) throw new Error("JOB_POST_REVIEW_CONFLICT");
    if (aggregate.softDeletedAt) return true;

    const correlationId = randomUUID();
    const reason = input.reason ?? "Deleted by recruiter";
    const changed = await transaction.jobPostReviewAggregate.updateMany({
      where: { id: aggregate.id, version: aggregate.version },
      data: {
        visibilityState: "HIDDEN",
        applicationState: "CLOSED",
        applicationClosedAt: now,
        applicationClosedByUserId: input.actorUserId,
        softDeletedAt: now,
        softDeletedByUserId: input.actorUserId,
        softDeleteReason: reason,
        version: { increment: 1 },
        operationalVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new Error("JOB_POST_REVIEW_CONFLICT");

    if (aggregate.publicJobPostingId) {
      await syncManagedJobPublicProjection(transaction, {
        publicJobPostingId: aggregate.publicJobPostingId,
        visibility: "HIDDEN",
        applicationState: "CLOSED",
        now,
        actorUserId: input.actorUserId,
        correlationId,
      });
    }
    await transaction.jobPostOperationalHistory.create({
      data: {
        aggregateId: aggregate.id,
        action: "RECRUITER_SOFT_DELETE",
        actorUserId: input.actorUserId,
        correlationId,
        priorState: {
          visibility: aggregate.visibilityState,
          applicationState: aggregate.applicationState,
          softDeleted: false,
        },
        resultingState: {
          visibility: "HIDDEN",
          applicationState: "CLOSED",
          softDeleted: true,
        },
        reason,
        version: aggregate.version + 1,
        occurredAt: now,
      },
    });
    await new PrismaAuditRepository(transaction).append({
      occurredAt: now,
      actorType: "user",
      actorUserId: input.actorUserId,
      actorSessionId: input.actorSessionId ?? null,
      action: "job_posting.deleted",
      targetType: "job_posting",
      targetId: aggregate.publicJobPostingId ?? aggregate.id,
      result: "SUCCESS",
      correlationId,
      context: { reasonCategory: reason, status: "REMOVED" },
    });
    return true;
  });
  if (result) {
    invalidatePublicJobSafety(input.jobId);
    invalidatePublicCompanySafety(input.companyId);
  }
  return result;
}
