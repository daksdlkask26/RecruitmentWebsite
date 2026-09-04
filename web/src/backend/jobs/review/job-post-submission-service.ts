import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import { PrismaJobPostReviewRepository } from "@/backend/repositories/jobs/prisma-job-post-review-repository";
import { notifyActionableAdministrators } from "@/backend/notifications/admin-notification-fanout";
import { adoptActiveJobBaseline } from "./job-post-active-baseline-service";
import {
  invalidateRecruiterJobCatalogueCache,
  readRecruiterJobReviewSource,
  readRecruiterJobReviewSourceFromPayload,
} from "@/backend/services/jobs/recruiter-job-posting-data";
import {
  JOB_REVIEW_SNAPSHOT_SCHEMA_VERSION,
  jobReviewSnapshotFromCatalog,
  jobReviewSnapshotSha256,
} from "./job-post-review-policy";
import { projectJobReviewSnapshot } from "./job-post-publication-projector";
import { normalizedReviewTitleSearch } from "./job-post-review-search";
import { JobPostReviewError } from "./job-post-review-errors";
import { leastLoadedReviewAdministrator } from "./job-post-review-assignment";
import { createPendingJobTaxonomyProposal } from "@/backend/services/jobs/job-taxonomy-service";
import { searchCatalogProvider } from "@/backend/services/search/catalogs/search-catalog-provider";

const requestHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class JobPostSubmissionService {
  async submit(input: {
    actorUserId: string;
    actorSessionId: string;
    jobId: string;
    expectedWorkingUpdatedAt: string;
    expectedCatalogueUpdatedAt?: string;
    idempotencyKey: string;
    job?: unknown;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const source = await (
      input.job
        ? readRecruiterJobReviewSourceFromPayload(
            input.actorUserId,
            input.job,
            input.idempotencyKey,
          )
        : readRecruiterJobReviewSource(input.actorUserId, input.jobId)
    ).catch(() => {
      throw new JobPostReviewError(
        "JOB_POST_REVIEW_UNAVAILABLE",
        "Review unavailable.",
      );
    });
    const { job, membership, existingJob } = source;
    if (
      input.job &&
      input.jobId !== "new-job" &&
      existingJob?.id !== input.jobId
    )
      throw new JobPostReviewError(
        "JOB_POST_REVIEW_CONFLICT",
        "The working job changed. Reload and try again.",
      );
    if (
      input.job &&
      existingJob &&
      input.expectedCatalogueUpdatedAt &&
      existingJob.updatedAt !== input.expectedCatalogueUpdatedAt
    )
      throw new JobPostReviewError(
        "JOB_POST_REVIEW_CONFLICT",
        "The working job changed. Reload and try again.",
      );
    const jobId = job.id;
    if (job.updatedAt !== input.expectedWorkingUpdatedAt)
      throw new JobPostReviewError(
        "JOB_POST_REVIEW_CONFLICT",
        "The working job changed. Reload and try again.",
      );
    if (job.status !== "draft" && job.status !== "rejected")
      throw new JobPostReviewError(
        "JOB_POST_REVIEW_CONFLICT",
        "The job cannot be submitted in its current state.",
      );

    // The old flow first changed an active catalogue row to draft and adopted
    // its PostgreSQL baseline. Preserve that lifecycle fact even though the
    // new fast path skips the pre-review catalogue write entirely.
    const catalogSnapshot = await searchCatalogProvider.getActiveSnapshot();
    if (existingJob?.status === "active") {
      await adoptActiveJobBaseline({
        job: existingJob,
        authoritativeCompanyId: membership.companyId,
        actorUserId: input.actorUserId,
        now,
        catalogIndex: catalogSnapshot.index,
      });
    }

    const snapshot = jobReviewSnapshotFromCatalog(
      job,
      membership.companyId,
      catalogSnapshot.index,
    );
    try {
      projectJobReviewSnapshot(snapshot);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "UNPUBLISHABLE_JOB_MAPPING" ||
          error.message === "UNPUBLISHABLE_JOB_CONTENT")
      ) {
        throw new JobPostReviewError(
          "JOB_POST_REVIEW_VALIDATION",
          error.message === "UNPUBLISHABLE_JOB_CONTENT"
            ? "Add at least one responsibility and requirement, and keep the published text within its limits before submitting."
            : "Choose a supported experience level, employment type, work arrangement, and salary period before submitting.",
        );
      }
      throw error;
    }
    const snapshotSha256 = jobReviewSnapshotSha256(snapshot);
    const submissionRequestHash = requestHash(
      JSON.stringify({
        jobId,
        expectedWorkingUpdatedAt: input.expectedWorkingUpdatedAt,
        snapshotSha256,
      }),
    );
    const correlationId = randomUUID();

    const result = await prisma.$transaction(async (transaction) => {
      const reviews = new PrismaJobPostReviewRepository(transaction);
      const replay = await reviews.findSubmissionReplay(
        input.actorUserId,
        input.idempotencyKey,
      );
      if (replay) {
        if (
          replay.submissionRequestHash !== submissionRequestHash ||
          replay.aggregate.jobId !== jobId
        )
          throw new JobPostReviewError(
            "JOB_POST_REVIEW_CONFLICT",
            "Idempotency key already belongs to another request.",
          );
        return {
          reviewId: replay.id,
          jobId: replay.aggregate.jobId,
          sequence: replay.sequence,
          state: replay.state,
          readOnly: replay.state === "PENDING_REVIEW",
          submittedAt: replay.submittedAt.toISOString(),
          version: replay.aggregate.version,
        };
      }

      const eligible = await transaction.companyMembership.findFirst({
        where: {
          id: membership.id,
          userId: input.actorUserId,
          companyId: membership.companyId,
          status: "ACTIVE",
          user: { state: "ACTIVE", deletedAt: null },
          company: {
            verificationState: "ACTIVE",
            verifiedAt: { not: null },
            verificationInactiveAt: null,
          },
        },
        select: { id: true },
      });
      if (!eligible)
        throw new JobPostReviewError(
          "JOB_POST_REVIEW_UNAVAILABLE",
          "Review unavailable.",
        );

      let aggregate = await transaction.jobPostReviewAggregate.findUnique({
        where: { jobId },
      });
      let sequence: number;
      if (!aggregate) {
        aggregate = await transaction.jobPostReviewAggregate.create({
          data: {
            jobId,
            companyId: membership.companyId,
            latestSequence: 1,
            adoptedAt: now,
          },
        });
        sequence = 1;
      } else {
        if (
          aggregate.companyId !== membership.companyId ||
          aggregate.pendingVersionId
        )
          throw new JobPostReviewError(
            "JOB_POST_REVIEW_CONFLICT",
            "A review is already pending.",
            aggregate.version,
          );
        sequence = aggregate.latestSequence + 1;
      }

      const reviewId = randomUUID();
      const assignedAdminUserId = await leastLoadedReviewAdministrator(
        transaction,
        now,
      );
      await reviews.createPendingVersion({
        aggregateId: aggregate.id,
        expectedAggregateVersion: aggregate.version,
        reviewId,
        sequence,
        snapshot,
        normalizedTitleSearch: normalizedReviewTitleSearch(snapshot.title),
        snapshotSchemaVersion: JOB_REVIEW_SNAPSHOT_SCHEMA_VERSION,
        snapshotSha256,
        submittedByUserId: input.actorUserId,
        submittedMembershipId: membership.id,
        submissionIdempotencyKey: input.idempotencyKey,
        submissionRequestHash,
        submittedAt: now,
        assignedAdminUserId,
        correlationId,
        historyAction: sequence === 1 ? "SUBMITTED" : "RESUBMITTED",
      });
      // A custom sub-industry is deliberately held with this immutable review
      // version. It becomes a platform-wide option only if this exact version
      // is approved by an administrator.
      await createPendingJobTaxonomyProposal({
        db: transaction,
        reviewVersionId: reviewId,
        companyId: membership.companyId,
        requestedByUserId: input.actorUserId,
        industryCode: snapshot.industryCode,
        industryName: snapshot.industry,
        subIndustryName: snapshot.subIndustry,
        subIndustryId: snapshot.subIndustryId,
        subIndustryCode: snapshot.subIndustryCode,
        description: snapshot.subIndustryProposalNote,
        now,
      });
      await new PrismaAuditRepository(transaction).append({
        occurredAt: now,
        actorType: "user",
        actorUserId: input.actorUserId,
        actorSessionId: input.actorSessionId,
        action: "job_post_review.submitted",
        targetType: "job_post_review",
        targetId: reviewId,
        result: "SUCCESS",
        correlationId,
        context: {
          resultingState: "PENDING_REVIEW",
          eligible: assignedAdminUserId !== null,
          targetVersion: aggregate.version + 1,
        },
      });
      await notifyActionableAdministrators(transaction, {
        kind: "JOB_POST_REVIEW_REQUESTED_ADMIN",
        eventKey: reviewId,
        correlationId,
        occurredAt: now,
        contextType: "JOB_POST_REVIEW",
        contextId: reviewId,
        preferredRecipientUserId: assignedAdminUserId,
        state: "PENDING_REVIEW",
      });
      return {
        reviewId,
        jobId,
        sequence,
        state: "PENDING_REVIEW" as const,
        readOnly: true,
        submittedAt: now.toISOString(),
        version: aggregate.version + 1,
      };
    });
    // The recruiter flow persists the working draft before reaching this
    // command. Once submission commits, force the next read to project the
    // aggregate's pendingVersionId as pending_approval. Assignment changes,
    // including losing the final administrator, never affect that status.
    invalidateRecruiterJobCatalogueCache();
    return result;
  }
}
