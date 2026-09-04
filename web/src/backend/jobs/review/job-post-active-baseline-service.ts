import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import type { JobCatalogItem } from "@/shared/contracts/jobs/catalog";
import {
  JOB_REVIEW_SNAPSHOT_SCHEMA_VERSION,
  jobReviewSnapshotFromCatalog,
  jobReviewSnapshotSha256,
} from "./job-post-review-policy";
import { projectJobReviewSnapshot } from "./job-post-publication-projector";
import { normalizedReviewTitleSearch } from "./job-post-review-search";
import { appendJobPostingLifecycleFact } from "@/backend/repositories/analytics/prisma-analytics-repository";
import { buildJobSearchProfile } from "@/backend/services/search/job-search-profile";
import { upsertJobSearchProjection } from "@/backend/services/search/job-search-profile-projection";
import { searchCatalogProvider } from "@/backend/services/search/catalogs/search-catalog-provider";
import type { SearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";

export async function adoptActiveJobBaseline(input: {
  job: JobCatalogItem;
  authoritativeCompanyId: string;
  actorUserId: string;
  now?: Date;
  catalogIndex?: SearchCatalogIndex;
}) {
  const now = input.now ?? new Date();
  const catalogIndex =
    input.catalogIndex ??
    (await searchCatalogProvider.getActiveSnapshot()).index;
  const snapshot = jobReviewSnapshotFromCatalog(
    input.job,
    input.authoritativeCompanyId,
    catalogIndex,
  );
  const projected = projectJobReviewSnapshot(snapshot);
  const snapshotSha256 = jobReviewSnapshotSha256(snapshot);
  const correlationId = randomUUID();

  return prisma.$transaction(async (transaction) => {
    const existingAggregate =
      await transaction.jobPostReviewAggregate.findUnique({
        where: { jobId: input.job.id },
      });
    if (existingAggregate) {
      if (existingAggregate.companyId !== input.authoritativeCompanyId)
        throw new Error("JOB_POST_REVIEW_INTEGRITY");
      return existingAggregate;
    }

    const existingProjection = await transaction.jobPosting.findUnique({
      where: { slug: projected.slug },
      include: { skills: { orderBy: { position: "asc" } } },
    });
    if (
      existingProjection &&
      (existingProjection.companyId !== input.authoritativeCompanyId ||
        existingProjection.title !== projected.title ||
        existingProjection.summary !== projected.summary ||
        existingProjection.description !== projected.description)
    )
      throw new Error("JOB_POST_REVIEW_INTEGRITY");

    const publicationTime = existingProjection?.publishedAt ?? now;
    const publicJob = existingProjection
      ? existingProjection
      : await transaction.jobPosting.create({
          data: {
            ...projected,
            skills: undefined,
            status: "ACTIVE",
            approvedAt: publicationTime,
            publishedAt: publicationTime,
          },
        });
    await appendJobPostingLifecycleFact(transaction, {
      jobPostingId: publicJob.id,
      companyId: publicJob.companyId,
      fromStatus: null,
      toStatus: publicJob.status,
      effectiveAt: publicationTime,
      postingVersion: publicJob.version,
      actorUserId: input.actorUserId,
      correlationId,
    });
    if (!existingProjection) {
      for (const skill of projected.skills) {
        const stored = await transaction.skill.upsert({
          where: { normalizedName: skill.normalizedName },
          create: {
            name: skill.displayName,
            normalizedName: skill.normalizedName,
          },
          update: {},
        });
        await transaction.jobPostingSkill.create({
          data: {
            jobPostingId: publicJob.id,
            skillId: stored.id,
            displayName: skill.displayName,
            required: skill.required,
            position: skill.position,
          },
        });
      }
    }

    await upsertJobSearchProjection(
      transaction,
      publicJob.id,
      snapshot.searchProfile ??
        buildJobSearchProfile(
          {
            title: snapshot.title,
            industryCode: snapshot.industryCode,
            categoryIds: snapshot.categoryIds,
            skills: snapshot.skillTags,
            description: [
              snapshot.description.overview,
              ...snapshot.description.responsibilities,
              ...snapshot.description.requirements,
            ],
          },
          { index: catalogIndex },
        ),
      {
        originalTitle: snapshot.title,
        industryCode: snapshot.industryCode,
        categoryIds: snapshot.categoryIds,
        sampleJobId: publicJob.id,
      },
    );

    const aggregate = await transaction.jobPostReviewAggregate.create({
      data: {
        jobId: input.job.id,
        companyId: input.authoritativeCompanyId,
        latestSequence: 1,
        publicJobPostingId: publicJob.id,
        adoptedAt: now,
      },
    });
    const version = await transaction.jobPostReviewVersion.create({
      data: {
        reviewAggregateId: aggregate.id,
        sequence: 1,
        snapshot,
        normalizedTitleSearch: normalizedReviewTitleSearch(snapshot.title),
        snapshotSchemaVersion: JOB_REVIEW_SNAPSHOT_SCHEMA_VERSION,
        snapshotSha256,
        state: "APPROVED",
        submittedAt: now,
        decidedAt: now,
        publishedAt: publicationTime,
        decisionCorrelationId: correlationId,
        importedBaseline: true,
      },
    });
    const adopted = await transaction.jobPostReviewAggregate.update({
      where: { id: aggregate.id },
      data: { approvedVersionId: version.id, version: { increment: 1 } },
    });
    await transaction.jobPostReviewHistory.create({
      data: {
        reviewVersionId: version.id,
        action: "LEGACY_BASELINE_IMPORTED",
        actorUserId: input.actorUserId,
        resultingState: "APPROVED",
        resultingAggregateVersion: adopted.version,
        correlationId,
        occurredAt: now,
      },
    });
    return adopted;
  });
}
