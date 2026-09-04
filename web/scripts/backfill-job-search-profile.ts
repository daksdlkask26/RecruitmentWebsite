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

async function main() {
  const { prisma } = await import("../src/backend/database/prisma");
  const { candidateVisibleJobWhere } =
    await import("../src/backend/repositories/jobs/candidate-visible-job-policy");
  const { buildJobSearchProfile } =
    await import("../src/backend/services/search/job-search-profile");
  const {
    jobSearchProjectionData,
    jobSearchProjectionNeedsRefresh,
    upsertJobSearchProjection,
  } =
    await import("../src/backend/services/search/job-search-profile-projection");
  const { searchCatalogProvider } =
    await import("../src/backend/services/search/catalogs/search-catalog-provider");
  try {
    if (!(await projectionTableAvailable(prisma))) {
      throw new Error(
        "JOB_SEARCH_PROJECTION_MIGRATION_REQUIRED: deploy migration 082_job_search_projection before running this backfill.",
      );
    }

    const catalogSnapshot = await searchCatalogProvider.getActiveSnapshot();
    if (catalogSnapshot.source !== "DATABASE") {
      throw new Error(
        "SEARCH_CATALOG_RUNTIME_FALLBACK: backfill requires an active database catalog.",
      );
    }
    const catalogIndex = catalogSnapshot.index;
    const dryRun = hasFlag("dry-run") || !hasFlag("apply");
    const batchSize = numericOption("batch-size", DEFAULT_BATCH_SIZE);
    const limit = stringOption("limit")
      ? numericOption("limit", DEFAULT_BATCH_SIZE)
      : Number.POSITIVE_INFINITY;
    let cursor = stringOption("after-id") ?? stringOption("resume-from");
    let inspected = 0;
    let refreshed = 0;
    let stale = 0;
    let failed = 0;
    let unmapped = 0;
    let ambiguous = 0;
    let requiresReview = 0;
    const changedIds: string[] = [];
    const now = new Date();

    for (;;) {
      const remaining = limit - inspected;
      if (remaining <= 0) break;
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
          normalizedTitle: true,
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
        take: Math.min(batchSize, remaining),
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
        if (profile.translationStatus === "UNMAPPED") unmapped += 1;
        if (profile.translationStatus === "AMBIGUOUS") ambiguous += 1;
        if (profile.translationStatus === "REQUIRES_REVIEW")
          requiresReview += 1;
        if (row.searchProjection?.catalogVersion !== next.catalogVersion) {
          stale += 1;
        }
        if (!jobSearchProjectionNeedsRefresh(row.searchProjection, next)) {
          cursor = row.id;
          continue;
        }
        refreshed += 1;
        if (hasFlag("include-ids") && changedIds.length < 100) {
          changedIds.push(row.id);
        }
        if (!dryRun) {
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
          event: "job_search_profile_backfill_progress",
          mode: dryRun ? "dry-run" : "apply",
          inspected,
          refreshed,
          stale,
          failed,
          unmapped,
          ambiguous,
          requiresReview,
          cursor,
        }),
      );
      if (rows.length < Math.min(batchSize, remaining)) break;
    }

    console.log(
      JSON.stringify({
        event: "job_search_profile_backfill_complete",
        mode: dryRun ? "dry-run" : "apply",
        catalogVersion: catalogIndex.version,
        inspected,
        refreshed,
        stale,
        failed,
        unmapped,
        ambiguous,
        requiresReview,
        policyFailures: unmapped + ambiguous,
        ...(hasFlag("include-ids") ? { changedIds } : {}),
      }),
    );
    if (failed || unmapped || ambiguous) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
