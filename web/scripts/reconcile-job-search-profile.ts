import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

type PrismaDatabase = typeof import("../src/backend/database/prisma").prisma;

const DEFAULT_BATCH_SIZE = 250;

function numericOption(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const inlineValue = process.argv.find((argument) =>
    argument.startsWith(prefix),
  );
  const optionIndex = process.argv.indexOf(`--${name}`);
  const value = inlineValue
    ? inlineValue.slice(prefix.length)
    : optionIndex >= 0
      ? process.argv[optionIndex + 1]
      : undefined;
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --${name}; expected a positive integer.`);
  }
  return parsed;
}

function stringOption(name: string) {
  const prefix = `--${name}=`;
  const inlineValue = process.argv.find((argument) =>
    argument.startsWith(prefix),
  );
  if (inlineValue) return inlineValue.slice(prefix.length).trim();
  const optionIndex = process.argv.indexOf(`--${name}`);
  return optionIndex >= 0 ? process.argv[optionIndex + 1]?.trim() : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

async function projectionTableAvailable(prisma: PrismaDatabase) {
  const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
    SELECT to_regclass('public."JobSearchProjection"')::text AS "tableName"
  `;
  return Boolean(rows[0]?.tableName);
}

async function orphanedProjectionIds(
  prisma: PrismaDatabase,
  includeIds: boolean,
) {
  const rows = await prisma.$queryRaw<
    Array<{ count: number; jobPostingId?: string }>
  >`
    SELECT COUNT(*)::int AS count
    FROM "JobSearchProjection" p
    LEFT JOIN "JobPosting" j ON j."id" = p."jobPostingId"
    WHERE j."id" IS NULL
  `;
  const count = Number(rows[0]?.count ?? 0);
  if (!includeIds || count === 0) return { count, ids: [] as string[] };
  const samples = await prisma.$queryRaw<Array<{ jobPostingId: string }>>`
    SELECT p."jobPostingId"
    FROM "JobSearchProjection" p
    LEFT JOIN "JobPosting" j ON j."id" = p."jobPostingId"
    WHERE j."id" IS NULL
    ORDER BY p."jobPostingId" ASC
    LIMIT 100
  `;
  return { count, ids: samples.map((row) => row.jobPostingId) };
}

async function main() {
  const { prisma } = await import("../src/backend/database/prisma");
  const { candidateVisibleJobWhere } =
    await import("../src/backend/repositories/jobs/candidate-visible-job-policy");
  const { buildJobSearchProfile } =
    await import("../src/backend/services/search/job-search-profile");
  const {
    ensureSearchMappingReview,
    jobSearchProjectionData,
    jobSearchProjectionNeedsRefresh,
    searchMappingReviewOpenKey,
    searchMappingReviewRequiredStatuses,
    upsertJobSearchProjection,
  } =
    await import("../src/backend/services/search/job-search-profile-projection");
  const { searchCatalogProvider } =
    await import("../src/backend/services/search/catalogs/search-catalog-provider");
  let reconciliationRunId: string | undefined;
  let reconciliationRunCompleted = false;
  try {
    if (!(await projectionTableAvailable(prisma))) {
      throw new Error(
        "JOB_SEARCH_PROJECTION_MIGRATION_REQUIRED: deploy migration 083_search_projection_title_identity before running reconciliation.",
      );
    }

    const catalogSnapshot = await searchCatalogProvider.getActiveSnapshot();
    if (catalogSnapshot.source !== "DATABASE") {
      throw new Error(
        "SEARCH_CATALOG_RUNTIME_FALLBACK: reconciliation requires an active database catalog.",
      );
    }
    const catalogIndex = catalogSnapshot.index;
    const apply = hasFlag("apply");
    const dryRun = !apply;
    const batchSize = numericOption("batch-size", DEFAULT_BATCH_SIZE);
    const limit = stringOption("limit")
      ? numericOption("limit", DEFAULT_BATCH_SIZE)
      : Number.POSITIVE_INFINITY;
    let cursor = stringOption("after-id") ?? stringOption("resume-from");
    let inspected = 0;
    let missing = 0;
    let stale = 0;
    let inconsistent = 0;
    let refreshed = 0;
    let failed = 0;
    let unmapped = 0;
    let ambiguous = 0;
    let requiresReview = 0;
    const missingReviewKeys = new Set<string>();
    const duplicateReviewKeys = new Set<string>();
    let invalidReferences = 0;
    let fakeHumanVerified = 0;
    const changedIds: string[] = [];
    const now = new Date();
    const catalogVersionRow = await prisma.searchCatalogVersion.findUnique({
      where: { version: catalogIndex.version },
      select: { id: true },
    });
    if (!catalogVersionRow) {
      throw new Error(
        `SEARCH_CATALOG_VERSION_UNAVAILABLE: ${catalogIndex.version}`,
      );
    }
    const run = await prisma.searchProjectionReconciliationRun.create({
      data: {
        catalogVersionId: catalogVersionRow.id,
        mode: dryRun ? "DRY_RUN" : "APPLY",
      },
      select: { id: true },
    });
    reconciliationRunId = run.id;
    const reviewRows = await prisma.searchMappingReview.findMany({
      where: { catalogVersionId: catalogVersionRow.id },
      select: { id: true, openKey: true, status: true },
    });
    const reviewsByOpenKey = new Map<
      string,
      Array<{ id: string; status: string }>
    >();
    for (const review of reviewRows) {
      if (!review.openKey) continue;
      const values = reviewsByOpenKey.get(review.openKey) ?? [];
      values.push({ id: review.id, status: review.status });
      reviewsByOpenKey.set(review.openKey, values);
    }
    const catalogTitles = await prisma.searchJobTitle.findMany({
      where: { catalogVersionId: catalogVersionRow.id },
      select: {
        titleId: true,
        translationStatus: true,
        mappingSource: true,
        mappingConfidence: true,
      },
    });
    fakeHumanVerified = catalogTitles.filter(
      (title) =>
        title.translationStatus === "HUMAN_VERIFIED" &&
        (title.mappingSource !== "MANUAL_REVIEW" ||
          title.mappingConfidence < 1),
    ).length;

    for (;;) {
      const remaining = limit - inspected;
      if (remaining <= 0) break;
      const take = Math.min(batchSize, remaining);
      const rows = await prisma.jobPosting.findMany({
        where: {
          ...candidateVisibleJobWhere(now),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: {
          id: true,
          title: true,
          industryCode: true,
          industryId: true,
          subIndustryCode: true,
          subIndustryId: true,
          skills: {
            select: { displayName: true },
            orderBy: { position: "asc" },
          },
          searchProjection: {
            select: {
              titleIds: true,
              occupationIds: true,
              facetIds: true,
              canonicalTitleVi: true,
              canonicalTitleEn: true,
              normalizedTitle: true,
              normalizedAliases: true,
              normalizedSkills: true,
              profileSource: true,
              profileConfidence: true,
              translationStatus: true,
              mappingSource: true,
              mappingConfidence: true,
              catalogVersion: true,
            },
          },
        },
        orderBy: { id: "asc" },
        take,
      });
      if (!rows.length) break;

      for (const row of rows) {
        inspected += 1;
        const profile = buildJobSearchProfile(
          {
            title: row.title,
            industryCode: row.industryCode ?? row.industryId,
            categoryIds: [row.subIndustryCode, row.subIndustryId],
            skills: row.skills.map((skill) => skill.displayName),
          },
          { index: catalogIndex },
        );
        const next = jobSearchProjectionData(row.id, profile);
        if (!row.searchProjection) missing += 1;
        else if (row.searchProjection.catalogVersion !== next.catalogVersion)
          stale += 1;
        else if (jobSearchProjectionNeedsRefresh(row.searchProjection, next))
          inconsistent += 1;

        if (profile.translationStatus === "UNMAPPED") unmapped += 1;
        if (profile.translationStatus === "AMBIGUOUS") ambiguous += 1;
        if (profile.translationStatus === "REQUIRES_REVIEW")
          requiresReview += 1;

        const referencesValid =
          profile.titleIds.every((titleId) =>
            Boolean(catalogIndex.titleById(titleId)),
          ) &&
          profile.occupationIds.every((occupationId) =>
            Boolean(catalogIndex.occupationById(occupationId)),
          ) &&
          profile.facetIds.every((facetId) =>
            Boolean(catalogIndex.facetById(facetId)),
          );
        if (!referencesValid) invalidReferences += 1;
        if (
          searchMappingReviewRequiredStatuses.has(profile.translationStatus)
        ) {
          const reviewKey = searchMappingReviewOpenKey(profile, {
            originalTitle: row.title,
            industryCode: row.industryCode ?? row.industryId,
            categoryIds: [row.subIndustryCode, row.subIndustryId],
            sampleJobId: row.id,
          });
          const matchingReviews = reviewsByOpenKey.get(reviewKey) ?? [];
          if (!matchingReviews.length) missingReviewKeys.add(reviewKey);
          if (matchingReviews.length > 1) duplicateReviewKeys.add(reviewKey);
          if (apply && !matchingReviews.length) {
            try {
              await ensureSearchMappingReview(prisma, row.id, profile, {
                originalTitle: row.title,
                industryCode: row.industryCode ?? row.industryId,
                categoryIds: [row.subIndustryCode, row.subIndustryId],
                sampleJobId: row.id,
              });
              reviewsByOpenKey.set(reviewKey, [
                { id: `created:${row.id}`, status: "PENDING" },
              ]);
              missingReviewKeys.delete(reviewKey);
            } catch (error) {
              failed += 1;
              console.error(`Failed review ${row.id}:`, error);
            }
          }
        }

        if (!jobSearchProjectionNeedsRefresh(row.searchProjection, next)) {
          cursor = row.id;
          continue;
        }
        refreshed += 1;
        if (hasFlag("include-ids") && changedIds.length < 100) {
          changedIds.push(row.id);
        }
        if (apply) {
          try {
            await upsertJobSearchProjection(prisma, row.id, profile, {
              originalTitle: row.title,
              industryCode: row.industryCode ?? row.industryId,
              categoryIds: [row.subIndustryCode, row.subIndustryId],
              sampleJobId: row.id,
            });
          } catch (error) {
            failed += 1;
            console.error(`Failed ${row.id}:`, error);
          }
        }
        cursor = row.id;
      }

      console.log(
        JSON.stringify({
          event: "job_search_profile_reconciliation_progress",
          mode: dryRun ? "dry-run" : "apply",
          inspected,
          missing,
          stale,
          inconsistent,
          refreshed,
          failed,
          unmapped,
          ambiguous,
          requiresReview,
          missingReviews: missingReviewKeys.size,
          duplicateReviews: duplicateReviewKeys.size,
          invalidReferences,
          fakeHumanVerified,
          cursor,
        }),
      );
      if (rows.length < take) break;
    }

    const orphaned = await orphanedProjectionIds(
      prisma,
      hasFlag("include-ids"),
    );
    const policyFailures =
      failed +
      unmapped +
      ambiguous +
      orphaned.count +
      missingReviewKeys.size +
      duplicateReviewKeys.size +
      invalidReferences +
      fakeHumanVerified +
      (dryRun ? missing + stale + inconsistent : 0);
    console.log(
      JSON.stringify({
        event: "job_search_profile_reconciliation_complete",
        mode: dryRun ? "dry-run" : "apply",
        catalogVersion: catalogIndex.version,
        inspected,
        missing,
        stale,
        inconsistent,
        refreshed,
        failed,
        unmapped,
        ambiguous,
        requiresReview,
        missingReviews: missingReviewKeys.size,
        duplicateReviews: duplicateReviewKeys.size,
        invalidReferences,
        fakeHumanVerified,
        orphaned: orphaned.count,
        policyFailures,
        ...(hasFlag("include-ids")
          ? { changedIds, orphanedIds: orphaned.ids }
          : {}),
      }),
    );
    if (reconciliationRunId && catalogVersionRow) {
      await prisma.searchProjectionReconciliationRun.update({
        where: { id: reconciliationRunId },
        data: {
          status: policyFailures ? "FAILED" : "SUCCEEDED",
          inspected,
          refreshed,
          missing,
          stale,
          inconsistent,
          unmapped,
          ambiguous,
          requiresReview,
          ...(missingReviewKeys.size ||
          duplicateReviewKeys.size ||
          invalidReferences ||
          fakeHumanVerified
            ? {
                errorMessage: [
                  missingReviewKeys.size
                    ? `Missing mapping reviews: ${missingReviewKeys.size}`
                    : null,
                  duplicateReviewKeys.size
                    ? `Duplicate mapping reviews: ${duplicateReviewKeys.size}`
                    : null,
                  invalidReferences
                    ? `Invalid references: ${invalidReferences}`
                    : null,
                  fakeHumanVerified
                    ? `Fake human provenance: ${fakeHumanVerified}`
                    : null,
                ]
                  .filter((value): value is string => Boolean(value))
                  .join("; ")
                  .slice(0, 2000),
              }
            : {}),
          orphaned: orphaned.count,
          policyFailures,
          cursor,
          completedAt: new Date(),
        },
      });
      reconciliationRunCompleted = true;
    }
    if (policyFailures) process.exitCode = 2;
  } finally {
    if (reconciliationRunId && !reconciliationRunCompleted) {
      await prisma.searchProjectionReconciliationRun
        .update({
          where: { id: reconciliationRunId },
          data: {
            status: "FAILED",
            errorMessage: "Reconciliation process ended before completion.",
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
