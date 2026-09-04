import "server-only";
import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import type { JobPostReviewState } from "@/shared/contracts/admin/job-post-review";
import type { AdminReviewCommand } from "@/shared/contracts/admin/job-post-review";
import type { JobReviewSnapshot } from "@/shared/contracts/recruiter-job-posting";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import { createInAppNotification } from "@/backend/notifications/notification-service";
import { projectJobReviewSnapshot } from "@/backend/jobs/review/job-post-publication-projector";
import { promoteWaitlistedApplicationsInTransaction } from "@/backend/services/jobs/application-stage-service";
import { reviewSearchTokens } from "@/backend/jobs/review/job-post-review-search";
import { appendJobPostingLifecycleFact } from "@/backend/repositories/analytics/prisma-analytics-repository";
import {
  rejectJobTaxonomyProposal,
  resolveApprovedJobTaxonomy,
} from "@/backend/services/jobs/job-taxonomy-service";
import type { TaxonomyResolution } from "@/backend/services/jobs/job-taxonomy-service";
import { buildJobSearchProfile } from "@/backend/services/search/job-search-profile";
import { upsertJobSearchProjection } from "@/backend/services/search/job-search-profile-projection";
import type { SearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";

type ReviewDb = typeof prisma | Prisma.TransactionClient;

const reviewDetailInclude = {
  aggregate: {
    include: {
      company: {
        select: {
          id: true,
          displayName: true,
          verificationState: true,
          verifiedAt: true,
          verificationInactiveAt: true,
        },
      },
      approvedVersion: { select: { id: true, snapshot: true } },
    },
  },
  submittedBy: { select: { id: true, name: true, state: true } },
  submittedMembership: { select: { id: true, status: true, role: true } },
  taxonomyProposal: {
    include: {
      industry: { select: { code: true, name: true } },
      resolvedSubIndustry: { select: { code: true, name: true } },
    },
  },
  history: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
  privateNotes: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.JobPostReviewVersionInclude;

export type JobPostReviewDetailRow = Prisma.JobPostReviewVersionGetPayload<{
  include: typeof reviewDetailInclude;
}>;

export class PrismaJobPostReviewRepository {
  constructor(private readonly db: ReviewDb = prisma) {}

  withTransaction(transaction: Prisma.TransactionClient) {
    return new PrismaJobPostReviewRepository(transaction);
  }

  findAggregateByJobId(jobId: string) {
    return this.db.jobPostReviewAggregate.findUnique({
      where: { jobId },
      include: {
        pendingVersion: true,
        approvedVersion: true,
        publicJobPosting: true,
      },
    });
  }

  findReviewDetail(reviewId: string): Promise<JobPostReviewDetailRow | null> {
    return this.db.jobPostReviewVersion.findUnique({
      where: { id: reviewId },
      include: reviewDetailInclude,
    });
  }

  findSubmissionReplay(actorUserId: string, idempotencyKey: string) {
    return this.db.jobPostReviewVersion.findUnique({
      where: {
        submittedByUserId_submissionIdempotencyKey: {
          submittedByUserId: actorUserId,
          submissionIdempotencyKey: idempotencyKey,
        },
      },
      include: { aggregate: true },
    });
  }

  listPending(input: {
    assignedAdminUserId?: string | null;
    take: number;
    cursorId?: string;
  }) {
    return this.db.jobPostReviewVersion.findMany({
      where: {
        state: "PENDING_REVIEW",
        aggregate: { softDeletedAt: null },
        ...(input.assignedAdminUserId === undefined
          ? {}
          : { assignedAdminUserId: input.assignedAdminUserId }),
      },
      include: {
        aggregate: {
          include: { company: { select: { id: true, displayName: true } } },
        },
      },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: input.take,
      ...(input.cursorId
        ? { cursor: { id: input.cursorId }, skip: 1 }
        : undefined),
    });
  }

  async listReviewQueue(input: {
    page: number;
    perPage: number;
    state?: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";
    q?: string;
    companyId?: string;
    assignedAdminUserId?: string | null;
    submittedBefore?: Date;
    sequence?: number;
    recordStatus?: "ACTIVE" | "DELETED" | "ALL";
  }) {
    const tokens = input.q ? reviewSearchTokens(input.q) : [];
    const companyNameTokens = input.q
      ? input.q.trim().split(/\s+/u).filter(Boolean).slice(0, 8)
      : [];
    const aggregateWhere: Prisma.JobPostReviewAggregateWhereInput = {
      ...(input.recordStatus === "DELETED"
        ? { softDeletedAt: { not: null } }
        : input.recordStatus === "ALL"
          ? {}
          : { softDeletedAt: null }),
      ...(input.companyId ? { companyId: input.companyId } : {}),
    };
    const where: Prisma.JobPostReviewVersionWhereInput = {
      ...(input.q
        ? {
            OR: [
              { id: input.q },
              { aggregate: { jobId: input.q } },
              { aggregate: { companyId: input.q } },
              ...(companyNameTokens.length
                ? [
                    {
                      AND: companyNameTokens.map((token) => ({
                        aggregate: {
                          company: {
                            displayName: {
                              contains: token,
                              mode: "insensitive" as const,
                            },
                          },
                        },
                      })),
                    },
                  ]
                : []),
              ...(tokens.length
                ? [
                    {
                      AND: tokens.map((token) => ({
                        normalizedTitleSearch: { contains: token },
                      })),
                    },
                  ]
                : []),
            ],
          }
        : {}),
      ...(input.state ? { state: input.state } : {}),
      aggregate: aggregateWhere,
      ...(input.assignedAdminUserId !== undefined
        ? { assignedAdminUserId: input.assignedAdminUserId }
        : {}),
      ...(input.submittedBefore
        ? { submittedAt: { lte: input.submittedBefore } }
        : {}),
      ...(input.sequence ? { sequence: input.sequence } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.jobPostReviewVersion.findMany({
        where,
        include: {
          aggregate: {
            include: { company: { select: { id: true, displayName: true } } },
          },
        },
        orderBy: [
          { assignedAdminUserId: { sort: "asc", nulls: "first" } },
          { submittedAt: "asc" },
          { id: "asc" },
        ],
        skip: (input.page - 1) * input.perPage,
        take: input.perPage,
      }),
      this.db.jobPostReviewVersion.count({ where }),
    ]);
    return { rows, total };
  }

  async createPendingVersion(input: {
    aggregateId: string;
    expectedAggregateVersion: number;
    reviewId: string;
    sequence: number;
    snapshot: Prisma.InputJsonValue;
    snapshotSchemaVersion: string;
    snapshotSha256: string;
    submittedByUserId: string;
    submittedMembershipId: string;
    submissionIdempotencyKey: string;
    submissionRequestHash: string;
    submittedAt: Date;
    assignedAdminUserId: string | null;
    correlationId: string;
    historyAction: "SUBMITTED" | "RESUBMITTED";
    normalizedTitleSearch: string;
  }) {
    const version = await this.db.jobPostReviewVersion.create({
      data: {
        id: input.reviewId,
        reviewAggregateId: input.aggregateId,
        sequence: input.sequence,
        snapshot: input.snapshot,
        normalizedTitleSearch: input.normalizedTitleSearch,
        snapshotSchemaVersion: input.snapshotSchemaVersion,
        snapshotSha256: input.snapshotSha256,
        submittedByUserId: input.submittedByUserId,
        submittedMembershipId: input.submittedMembershipId,
        submissionIdempotencyKey: input.submissionIdempotencyKey,
        submissionRequestHash: input.submissionRequestHash,
        submittedAt: input.submittedAt,
        assignedAdminUserId: input.assignedAdminUserId,
        assignedAt: input.assignedAdminUserId ? input.submittedAt : null,
      },
    });
    const aggregateUpdate = await this.db.jobPostReviewAggregate.updateMany({
      where: {
        id: input.aggregateId,
        version: input.expectedAggregateVersion,
        pendingVersionId: null,
      },
      data: {
        pendingVersionId: version.id,
        latestSequence: input.sequence,
        version: { increment: 1 },
      },
    });
    if (aggregateUpdate.count !== 1)
      throw new Error("JOB_POST_REVIEW_CONFLICT");
    await this.db.jobPostReviewHistory.create({
      data: {
        reviewVersionId: version.id,
        action: input.historyAction,
        actorUserId: input.submittedByUserId,
        resultingAssigneeUserId: input.assignedAdminUserId,
        resultingState: "PENDING_REVIEW",
        resultingAggregateVersion: input.expectedAggregateVersion + 1,
        correlationId: input.correlationId,
        occurredAt: input.submittedAt,
      },
    });
    return version;
  }

  async decidePending(input: {
    reviewId: string;
    aggregateId: string;
    expectedAggregateVersion: number;
    existingPublicJobPostingId: string | null;
    closedAt: Date | null;
    snapshot: JobReviewSnapshot;
    command: Extract<AdminReviewCommand, { command: "APPROVE" | "REJECT" }>;
    actorUserId: string;
    actorSessionId: string;
    submittedByUserId: string | null;
    notifySubmitter: boolean;
    correlationId: string;
    now: Date;
    catalogIndex?: SearchCatalogIndex;
  }) {
    const decisionState =
      input.command.command === "APPROVE" ? "APPROVED" : "REJECTED";
    let publicJobPostingId = input.existingPublicJobPostingId;
    let publishedAt: Date | null = null;
    let previousCapacity: number | null;

    let taxonomy: TaxonomyResolution | null = null;
    if (input.command.command === "APPROVE") {
      taxonomy = await resolveApprovedJobTaxonomy({
        db: this.db,
        reviewVersionId: input.reviewId,
        industryCode: input.snapshot.industryCode,
        industryName: input.snapshot.industry,
        subIndustryName: input.snapshot.subIndustry,
        subIndustryId: input.snapshot.subIndustryId,
        subIndustryCode: input.snapshot.subIndustryCode,
        adminUserId: input.actorUserId,
        now: input.now,
      });
    } else {
      await rejectJobTaxonomyProposal({
        db: this.db,
        reviewVersionId: input.reviewId,
        adminUserId: input.actorUserId,
        reason: input.command.publicExplanation,
        now: input.now,
      });
    }

    if (input.command.command === "APPROVE") {
      const projected = projectJobReviewSnapshot(input.snapshot);
      const { skills, ...jobData } = projected;
      const projectedJobData = {
        ...jobData,
        industryId: taxonomy?.industryId ?? null,
        subIndustryId: taxonomy?.subIndustryId ?? null,
        industryCode: taxonomy?.industryCode ?? input.snapshot.industryCode,
        subIndustryCode:
          taxonomy?.subIndustryCode ?? input.snapshot.subIndustryCode ?? null,
      };
      const previousPublicJob = publicJobPostingId
        ? await this.db.jobPosting.findUnique({
            where: { id: publicJobPostingId },
            select: { numberOfHires: true, status: true, version: true },
          })
        : null;
      previousCapacity = previousPublicJob?.numberOfHires ?? null;
      const slugOwner = await this.db.jobPosting.findUnique({
        where: { slug: projected.slug },
        select: {
          id: true,
          companyId: true,
          reviewAggregate: { select: { id: true } },
        },
      });
      if (
        (publicJobPostingId && slugOwner?.id !== publicJobPostingId) ||
        (!publicJobPostingId && slugOwner)
      )
        throw new Error("JOB_POST_PROJECTION_COLLISION");
      if (
        slugOwner &&
        (slugOwner.companyId !== projected.companyId ||
          slugOwner.reviewAggregate?.id !== input.aggregateId)
      )
        throw new Error("JOB_POST_PROJECTION_COLLISION");

      const publicJob = await this.db.jobPosting.upsert({
        where: { slug: projected.slug },
        create: {
          ...projectedJobData,
          status: input.closedAt ? "CLOSED" : "ACTIVE",
          approvedAt: input.now,
          publishedAt: input.now,
          closedAt: input.closedAt,
        },
        update: {
          ...projectedJobData,
          status: input.closedAt ? "CLOSED" : "ACTIVE",
          approvedAt: input.now,
          publishedAt: input.now,
          closedAt: input.closedAt,
          version: { increment: 1 },
        },
      });
      publicJobPostingId = publicJob.id;
      publishedAt = input.now;
      await appendJobPostingLifecycleFact(this.db, {
        jobPostingId: publicJob.id,
        companyId: publicJob.companyId,
        fromStatus: previousPublicJob?.status ?? null,
        toStatus: publicJob.status,
        effectiveAt: input.now,
        postingVersion: publicJob.version,
        actorUserId: input.actorUserId,
        correlationId: input.correlationId,
      });
      if (!previousPublicJob) {
        await new PrismaAuditRepository(this.db).append({
          occurredAt: input.now,
          actorType: "user",
          actorUserId: input.actorUserId,
          actorSessionId: input.actorSessionId,
          action: "job_posting.created",
          targetType: "job_posting",
          targetId: publicJob.id,
          result: "SUCCESS",
          correlationId: input.correlationId,
          context: { status: publicJob.status },
        });
      }
      if (input.closedAt === null) {
        await promoteWaitlistedApplicationsInTransaction({
          db: this.db,
          jobPostingId: publicJob.id,
          previousCapacity,
          newCapacity: projected.numberOfHires,
          correlationId: input.correlationId,
          now: input.now,
        });
      }
      await this.db.jobPostingSkill.deleteMany({
        where: { jobPostingId: publicJob.id },
      });
      for (const skill of skills) {
        const stored = await this.db.skill.upsert({
          where: { normalizedName: skill.normalizedName },
          create: {
            name: skill.displayName,
            normalizedName: skill.normalizedName,
          },
          update: {},
        });
        await this.db.jobPostingSkill.create({
          data: {
            jobPostingId: publicJob.id,
            skillId: stored.id,
            displayName: skill.displayName,
            required: skill.required,
            position: skill.position,
          },
        });
      }
      await upsertJobSearchProjection(
        this.db,
        publicJob.id,
        buildJobSearchProfile(
          {
            title: input.snapshot.title,
            industryCode: projectedJobData.industryCode,
            categoryIds: [projectedJobData.subIndustryCode],
            skills: input.snapshot.skillTags,
            description: [
              input.snapshot.description.overview,
              ...input.snapshot.description.responsibilities,
              ...input.snapshot.description.requirements,
            ],
          },
          {
            reviewed: true,
            ...(input.catalogIndex ? { index: input.catalogIndex } : {}),
          },
        ),
        {
          originalTitle: input.snapshot.title,
          industryCode: projectedJobData.industryCode,
          categoryIds: [projectedJobData.subIndustryCode],
          sampleJobId: publicJob.id,
        },
      );
    }

    const aggregate = await this.db.jobPostReviewAggregate.updateMany({
      where: {
        id: input.aggregateId,
        version: input.expectedAggregateVersion,
        pendingVersionId: input.reviewId,
      },
      data: {
        pendingVersionId: null,
        ...(decisionState === "APPROVED"
          ? { approvedVersionId: input.reviewId, publicJobPostingId }
          : {}),
        version: { increment: 1 },
      },
    });
    if (aggregate.count !== 1) throw new Error("STALE_CONFLICT");
    if (input.command.command === "APPROVE") {
      await this.db.jobPostRevisionRequest.updateMany({
        where: { aggregateId: input.aggregateId, state: "OPEN" },
        data: {
          state: "SATISFIED",
          satisfiedAt: input.now,
          submittedRevisionId: input.reviewId,
        },
      });
    }
    const decided = await this.db.jobPostReviewVersion.updateMany({
      where: {
        id: input.reviewId,
        state: "PENDING_REVIEW",
        assignedAdminUserId: input.actorUserId,
      },
      data: {
        state: decisionState,
        decidedByAdminUserId: input.actorUserId,
        decidedAt: input.now,
        publishedAt,
        decisionCorrelationId: input.correlationId,
        reasonCode:
          input.command.command === "REJECT" ? input.command.reasonCode : null,
        publicExplanation:
          input.command.command === "REJECT"
            ? input.command.publicExplanation
            : null,
      },
    });
    if (decided.count !== 1) throw new Error("STALE_CONFLICT");
    if (input.command.command === "REJECT" && input.command.privateNote) {
      await this.db.jobPostReviewPrivateNote.create({
        data: {
          reviewVersionId: input.reviewId,
          authorAdminUserId: input.actorUserId,
          normalizedText: input.command.privateNote,
          createdAt: input.now,
        },
      });
    }
    const resultingVersion = input.expectedAggregateVersion + 1;
    await this.db.jobPostReviewHistory.create({
      data: {
        reviewVersionId: input.reviewId,
        action: decisionState,
        actorUserId: input.actorUserId,
        priorState: "PENDING_REVIEW",
        resultingState: decisionState,
        priorAssigneeUserId: input.actorUserId,
        resultingAssigneeUserId: input.actorUserId,
        resultingAggregateVersion: resultingVersion,
        correlationId: input.correlationId,
        occurredAt: input.now,
      },
    });
    await new PrismaAuditRepository(this.db).append({
      occurredAt: input.now,
      actorType: "user",
      actorUserId: input.actorUserId,
      actorSessionId: input.actorSessionId,
      action:
        decisionState === "APPROVED"
          ? "job_post_review.approved"
          : "job_post_review.rejected",
      targetType: "job_post_review",
      targetId: input.reviewId,
      result: "SUCCESS",
      correlationId: input.correlationId,
      context: {
        priorState: "PENDING_REVIEW",
        resultingState: decisionState,
        targetVersion: resultingVersion,
        ...(input.command.command === "REJECT"
          ? { reasonCategory: input.command.reasonCode }
          : {}),
      },
    });
    if (input.notifySubmitter && input.submittedByUserId) {
      await createInAppNotification(this.db, {
        recipientUserId: input.submittedByUserId,
        kind:
          decisionState === "APPROVED"
            ? "JOB_POST_APPROVED"
            : "JOB_POST_REJECTED",
        deduplicationKey: `job-post-outcome:${input.reviewId}:${decisionState}`,
        correlationId: input.correlationId,
        occurredAt: input.now,
        contextType: "JOB_POST_REVIEW",
        contextId: input.reviewId,
        variables: { audience: "USER", state: decisionState },
      });
    }
    return {
      reviewId: input.reviewId,
      state: decisionState,
      assignedAdminUserId: input.actorUserId,
      version: resultingVersion,
      correlationId: input.correlationId,
      status: "SUCCESS" as const,
    };
  }

  async assignPending(input: {
    reviewId: string;
    expectedAssigneeUserId: string | null;
    targetAdminUserId: string;
    assignedAt: Date;
  }) {
    const result = await this.db.jobPostReviewVersion.updateMany({
      where: {
        id: input.reviewId,
        state: "PENDING_REVIEW",
        assignedAdminUserId: input.expectedAssigneeUserId,
      },
      data: {
        assignedAdminUserId: input.targetAdminUserId,
        assignedAt: input.assignedAt,
      },
    });
    if (result.count !== 1) throw new Error("JOB_POST_REVIEW_CONFLICT");
  }

  async assertState(reviewId: string, state: JobPostReviewState) {
    const row = await this.db.jobPostReviewVersion.findFirst({
      where: { id: reviewId, state },
      select: { id: true },
    });
    if (!row) throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
  }
}
