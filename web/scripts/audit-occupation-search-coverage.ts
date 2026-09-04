import { config } from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

import { normalizeSearchText } from "../src/backend/services/jobs/search-normalization";
import {
  auditOccupationSearchCoverage,
  intentionalOtherOccupationTitleReasons,
} from "../src/backend/services/search/catalogs/occupation-search-coverage";
import { jobSearchCatalog } from "../src/backend/services/search/catalogs/job-search-catalog";

type RawJob = Record<string, unknown>;

async function readStaticJobCatalogue() {
  const directory = resolve(process.cwd(), "data", "jobs");
  const fileNames = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const documents = await Promise.all(
    fileNames.map(async (name) => {
      const value: unknown = JSON.parse(
        await readFile(resolve(directory, name), "utf8"),
      );
      return Array.isArray(value) ? value : [];
    }),
  );
  return documents.flat() as RawJob[];
}

function asText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function categoryIdsFrom(value: RawJob) {
  const direct = Array.isArray(value.categoryIds) ? value.categoryIds : [];
  return [...direct, value.subIndustryCode, value.subIndustryId].filter(
    (entry): entry is string =>
      typeof entry === "string" && Boolean(entry.trim()),
  );
}

function skillsFrom(value: RawJob) {
  const direct = Array.isArray(value.skillTags) ? value.skillTags : [];
  return direct.filter(
    (entry): entry is string =>
      typeof entry === "string" && Boolean(entry.trim()),
  );
}

function coverageInput(
  value: RawJob,
  source: string,
  candidateVisible: boolean,
) {
  const title = asText(value.title) ?? "";
  const titleKey = normalizeSearchText(title);
  const industryCode = asText(value.industryCode) ?? asText(value.industryId);
  const isOtherIndustry = [industryCode, asText(value.categoryFamily)]
    .map((entry) => entry?.trim().toLowerCase())
    .includes("r29");
  return {
    jobId: asText(value.id),
    title,
    industryCode,
    categoryFamily: asText(value.categoryFamily),
    categoryIds: categoryIdsFrom(value),
    skills: skillsFrom(value),
    status: asText(value.status),
    source,
    candidateVisible,
    intentionalOther:
      isOtherIndustry || titleKey in intentionalOtherOccupationTitleReasons,
    intentionalOtherReason:
      intentionalOtherOccupationTitleReasons[titleKey] ??
      (isOtherIndustry
        ? "The active job data classifies this title as Other."
        : null),
  } as const;
}

function jsonCandidateVisible(value: RawJob, now: Date) {
  const status = asText(value.status)?.toLowerCase();
  if (!status || !["open", "closing_soon", "active"].includes(status)) {
    return false;
  }
  const deadline = asText(value.applyDeadline);
  return !deadline || new Date(deadline).getTime() > now.getTime();
}

function argumentValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function numberArgument(name: string, fallback: number) {
  const raw = argumentValue(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid --${name}; expected a non-negative integer.`);
  }
  return value;
}

function reportView(
  report: ReturnType<typeof auditOccupationSearchCoverage>,
  verbose: boolean,
  errorSampleLimit: number,
) {
  return {
    totalJobs: report.totalJobs,
    uniqueTitles: report.uniqueTitles,
    verifiedTitles: report.verifiedTitles,
    autoMappedTitles: report.autoMappedTitles,
    ambiguousTitlesCount: report.ambiguousTitlesCount,
    unmappedTitlesCount: report.unmappedTitlesCount,
    intentionalOtherTitlesCount: report.intentionalOtherTitlesCount,
    invalidTitles: report.invalidTitles,
    candidateVisibleJobs: report.candidateVisibleJobs,
    candidateVisibleComplete: report.candidateVisibleComplete,
    complete: report.complete,
    errors: report.errors.slice(0, errorSampleLimit),
    ...(verbose
      ? {
          titleStatuses: report.titleStatuses,
          facetConflicts: report.facetConflicts,
          duplicateAliases: report.duplicateAliases,
          ambiguousTitles: report.ambiguousTitles,
          categoryMismatches: report.categoryMismatches,
          unmapped: report.unmapped,
        }
      : {}),
  };
}

function titleKey(value: string) {
  return normalizeSearchText(value, 160).replace(/\s+/gu, "");
}

function uniqueTitles(values: readonly string[]) {
  return [
    ...new Map(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => [titleKey(value), value] as const),
    ).values(),
  ];
}

function bilingualTitleCoverage(
  titlesBySource: Readonly<Record<string, readonly string[]>> = {},
  errorSampleLimit = 20,
) {
  const definitions = jobSearchCatalog.titleDefinitions ?? [];
  const definitionKeys = new Set(
    definitions.map((definition) => titleKey(definition.canonical.en)),
  );
  const observedTitles = uniqueTitles(Object.values(titlesBySource).flat());
  const missingTitles = observedTitles.filter(
    (title) => !definitionKeys.has(titleKey(title)),
  );
  const statuses = [
    "HUMAN_VERIFIED",
    "AUTO_HIGH_CONFIDENCE",
    "REQUIRES_REVIEW",
    "INTENTIONAL_UNTRANSLATED",
    "AMBIGUOUS",
    "UNMAPPED",
  ] as const;
  const byStatus = Object.fromEntries(
    statuses.map((status) => [
      status,
      definitions.filter(
        (definition) => definition.translationStatus === status,
      ).length,
    ]),
  ) as Record<(typeof statuses)[number], number>;
  const fallbackOccupationLabelTitles = definitions.filter((definition) => {
    if (!definition.occupationId) return false;
    const occupation = jobSearchCatalog.occupations.find(
      (candidate) => candidate.occupationId === definition.occupationId,
    );
    return Boolean(
      occupation &&
      titleKey(definition.canonical.vi) === titleKey(occupation.labels.vi) &&
      titleKey(definition.canonical.en) !== titleKey(occupation.labels.en),
    );
  });
  const reviewRequiredTitles = definitions
    .filter((definition) => definition.translationStatus !== "HUMAN_VERIFIED")
    .map((definition) => ({
      title: definition.canonical.en,
      titleId: definition.titleId,
      status: definition.translationStatus,
      reason: definition.reviewReason,
    }));
  const sourceCoverage = Object.fromEntries(
    Object.entries(titlesBySource).map(([source, titles]) => {
      const sourceTitles = uniqueTitles(titles);
      const sourceMissingTitles = sourceTitles.filter(
        (title) => !definitionKeys.has(titleKey(title)),
      );
      return [
        source,
        {
          observedTitles: sourceTitles.length,
          missingTitlesCount: sourceMissingTitles.length,
          missingTitles: sourceMissingTitles.slice(0, errorSampleLimit),
          complete: sourceMissingTitles.length === 0,
        },
      ];
    }),
  );
  return {
    totalTitles: definitions.length,
    observedTitles: observedTitles.length,
    missingTitlesCount: missingTitles.length,
    missingTitles: missingTitles.slice(0, errorSampleLimit),
    sourceCoverage,
    ...byStatus,
    humanVerified: byStatus.HUMAN_VERIFIED,
    autoHighConfidence: byStatus.AUTO_HIGH_CONFIDENCE,
    requiresReview: byStatus.REQUIRES_REVIEW,
    intentionalUntranslated: byStatus.INTENTIONAL_UNTRANSLATED,
    ambiguous: byStatus.AMBIGUOUS,
    unmapped: byStatus.UNMAPPED,
    fallbackOccupationLabel: fallbackOccupationLabelTitles.length,
    fallbackOccupationLabelTitles: fallbackOccupationLabelTitles
      .slice(0, errorSampleLimit)
      .map((definition) => definition.canonical.en),
    reviewRequiredTitles: reviewRequiredTitles.slice(0, errorSampleLimit),
    complete:
      definitions.length > 0 &&
      byStatus.AMBIGUOUS === 0 &&
      byStatus.UNMAPPED === 0 &&
      fallbackOccupationLabelTitles.length === 0 &&
      missingTitles.length === 0,
  };
}

function snapshotToCoverageInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as RawJob;
  const title = asText(snapshot.title) ?? "";
  const industryCode =
    asText(snapshot.industryCode) ?? asText(snapshot.categoryFamily);
  return coverageInput(
    {
      id: null,
      title,
      industryCode,
      categoryFamily: asText(snapshot.categoryFamily),
      categoryIds: snapshot.categoryIds,
      subIndustryCode: snapshot.subIndustryCode,
      subIndustryId: snapshot.subIndustryId,
      skillTags: snapshot.skillTags,
      status: "APPROVED",
    },
    "APPROVED_SNAPSHOT",
    true,
  );
}

async function tableAvailable(
  prisma: typeof import("../src/backend/database/prisma").prisma,
) {
  const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
    SELECT to_regclass('public."JobSearchProjection"')::text AS "tableName"
  `;
  return Boolean(rows[0]?.tableName);
}

const reviewRequiredStatuses = new Set([
  "REQUIRES_REVIEW",
  "AMBIGUOUS",
  "UNMAPPED",
]);

async function searchMappingReviewCoverage(
  prisma: typeof import("../src/backend/database/prisma").prisma,
) {
  const active = await prisma.searchCatalogVersion.findFirst({
    where: { isActive: true, status: "PUBLISHED" },
    select: { id: true, version: true },
  });
  if (!active) {
    return {
      catalogVersion: null,
      requiredTitles: 0,
      pendingReviewItems: 0,
      missingTitleIds: [],
      duplicatePendingTitleIds: [],
      invalidOpenKeys: 0,
      complete: false,
    };
  }

  const [titles, reviews] = await Promise.all([
    prisma.searchJobTitle.findMany({
      where: { catalogVersionId: active.id },
      select: {
        titleId: true,
        canonicalEn: true,
        translationStatus: true,
      },
    }),
    prisma.searchMappingReview.findMany({
      where: { catalogVersionId: active.id, status: "PENDING" },
      select: {
        id: true,
        openKey: true,
        suggestedTitleId: true,
        originalTitle: true,
      },
    }),
  ]);

  const pendingByTitleId = new Map<string, string[]>();
  const pendingByNormalizedTitle = new Map<string, string[]>();
  for (const review of reviews) {
    if (review.suggestedTitleId) {
      const ids = pendingByTitleId.get(review.suggestedTitleId) ?? [];
      ids.push(review.id);
      pendingByTitleId.set(review.suggestedTitleId, ids);
    }
    const normalized = titleKey(review.originalTitle);
    const ids = pendingByNormalizedTitle.get(normalized) ?? [];
    ids.push(review.id);
    pendingByNormalizedTitle.set(normalized, ids);
  }

  const required = titles.filter((title) =>
    reviewRequiredStatuses.has(String(title.translationStatus)),
  );
  const missingTitleIds = required
    .filter((title) => {
      const direct = pendingByTitleId.get(title.titleId);
      const fallback = pendingByNormalizedTitle.get(
        titleKey(title.canonicalEn),
      );
      return !(direct?.length || fallback?.length);
    })
    .map((title) => title.titleId)
    .sort();
  const duplicatePendingTitleIds = required
    .filter((title) => {
      const direct = pendingByTitleId.get(title.titleId) ?? [];
      return direct.length > 1;
    })
    .map((title) => title.titleId)
    .sort();
  const invalidOpenKeys = reviews.filter(
    (review) => !review.openKey || review.openKey.length > 240,
  ).length;

  return {
    catalogVersion: active.version,
    requiredTitles: required.length,
    pendingReviewItems: reviews.length,
    missingTitleIds,
    duplicatePendingTitleIds,
    invalidOpenKeys,
    complete:
      missingTitleIds.length === 0 &&
      duplicatePendingTitleIds.length === 0 &&
      invalidOpenKeys === 0,
  };
}

async function main() {
  const catalogOnly = process.argv.includes("--catalog-only");
  const databaseOnly = process.argv.includes("--database-only");
  const summaryOnly = process.argv.includes("--summary");
  const verbose = process.argv.includes("--verbose");
  const errorSampleLimit = numberArgument("limit-error-samples", 20);
  const now = new Date();
  const staticCatalogue = !databaseOnly ? await readStaticJobCatalogue() : [];
  const staticInputs = staticCatalogue.map((value) =>
    coverageInput(value, "JSON_CATALOGUE", jsonCandidateVisible(value, now)),
  );
  const staticReport = !databaseOnly
    ? reportView(
        auditOccupationSearchCoverage(staticInputs),
        verbose,
        errorSampleLimit,
      )
    : null;

  if (catalogOnly) {
    const bilingualCoverage = bilingualTitleCoverage(
      {
        JSON_CATALOGUE: staticCatalogue.map(
          (value) => asText(value.title) ?? "",
        ),
      },
      errorSampleLimit,
    );
    const result = {
      generatedAt: now.toISOString(),
      sourceReports: { staticCatalogue: staticReport },
      bilingualTitleCoverage: bilingualCoverage,
      complete: Boolean(staticReport?.complete) && bilingualCoverage.complete,
    };
    console.log(
      JSON.stringify(
        summaryOnly ? { ...result, sourceReports: undefined } : result,
        null,
        2,
      ),
    );
    if (!result.complete) process.exitCode = 2;
    return;
  }

  const [{ prisma }, { candidateVisibleJobWhere }] = await Promise.all([
    import("../src/backend/database/prisma"),
    import("../src/backend/repositories/jobs/candidate-visible-job-policy"),
  ]);
  const rows = await prisma.jobPosting.findMany({
    where: candidateVisibleJobWhere(now),
    select: {
      id: true,
      title: true,
      industryCode: true,
      industryId: true,
      subIndustryCode: true,
      subIndustryId: true,
      status: true,
      skills: { select: { displayName: true } },
    },
  });
  const databaseInputs = rows.map((row) =>
    coverageInput(
      {
        id: row.id,
        title: row.title,
        industryCode: row.industryCode,
        industryId: row.industryId,
        subIndustryCode: row.subIndustryCode,
        subIndustryId: row.subIndustryId,
        skillTags: row.skills.map((skill) => skill.displayName),
        status: String(row.status),
      },
      "DATABASE_CANDIDATE_VISIBLE",
      true,
    ),
  );
  const databaseReport = reportView(
    auditOccupationSearchCoverage(databaseInputs),
    verbose,
    errorSampleLimit,
  );

  const approvedSnapshots = await prisma.jobPostReviewVersion.findMany({
    where: { state: "APPROVED" },
    select: { snapshot: true },
  });
  const snapshotInputs = approvedSnapshots.flatMap((row) => {
    const input = snapshotToCoverageInput(row.snapshot);
    return input ? [input] : [];
  });
  const approvedSnapshotReport = reportView(
    auditOccupationSearchCoverage(snapshotInputs),
    verbose,
    errorSampleLimit,
  );

  const projectionAvailable = await tableAvailable(prisma);
  const projectionRows =
    projectionAvailable && rows.length
      ? await prisma.jobSearchProjection.findMany({
          where: { jobPostingId: { in: rows.map((row) => row.id) } },
          select: {
            jobPostingId: true,
            titleIds: true,
            catalogVersion: true,
            profileSource: true,
            translationStatus: true,
            mappingSource: true,
          },
        })
      : [];
  const projectionIds = new Set(projectionRows.map((row) => row.jobPostingId));
  const staleProfiles = projectionRows.filter(
    (row) => row.catalogVersion !== jobSearchCatalog.version,
  ).length;
  const missingProfiles = rows.length - projectionIds.size;
  const profileCoverage = {
    projectionAvailable,
    candidateVisibleJobs: rows.length,
    profiles: projectionRows.length,
    missingProfiles,
    staleProfiles,
    profilesWithoutTitleIdentity: projectionRows.filter(
      (row) => row.titleIds.length === 0,
    ).length,
    byTranslationStatus: Object.fromEntries(
      [...new Set(projectionRows.map((row) => row.translationStatus))].map(
        (status) => [
          status,
          projectionRows.filter((row) => row.translationStatus === status)
            .length,
        ],
      ),
    ),
    byMappingSource: Object.fromEntries(
      [...new Set(projectionRows.map((row) => row.mappingSource))].map(
        (source) => [
          source,
          projectionRows.filter((row) => row.mappingSource === source).length,
        ],
      ),
    ),
    bySource: Object.fromEntries(
      [...new Set(projectionRows.map((row) => row.profileSource))].map(
        (source) => [
          source,
          projectionRows.filter((row) => row.profileSource === source).length,
        ],
      ),
    ),
    complete:
      projectionAvailable && missingProfiles === 0 && staleProfiles === 0,
  };
  const mappingReviewCoverage = await searchMappingReviewCoverage(prisma);
  const bilingualCoverage = bilingualTitleCoverage(
    {
      ...(staticCatalogue.length
        ? {
            JSON_CATALOGUE: staticCatalogue.map(
              (value) => asText(value.title) ?? "",
            ),
          }
        : {}),
      DATABASE_CANDIDATE_VISIBLE: rows.map((row) => row.title),
      APPROVED_SNAPSHOT: snapshotInputs.map((input) => input.title),
    },
    errorSampleLimit,
  );
  const result = {
    generatedAt: now.toISOString(),
    catalogVersion: jobSearchCatalog.version,
    totalJobs: rows.length,
    uniqueTitles: databaseReport.uniqueTitles,
    candidateVisibleJobs: rows.length,
    candidateVisibleComplete: databaseReport.complete,
    sourceReports: {
      ...(staticReport ? { staticCatalogue: staticReport } : {}),
      databaseCandidateVisible: databaseReport,
      approvedSnapshots: approvedSnapshotReport,
    },
    bilingualTitleCoverage: bilingualCoverage,
    searchProfileCoverage: profileCoverage,
    searchMappingReviewCoverage: mappingReviewCoverage,
    complete:
      databaseReport.complete &&
      approvedSnapshotReport.complete &&
      bilingualCoverage.complete &&
      profileCoverage.complete &&
      mappingReviewCoverage.complete,
  };
  const output = summaryOnly
    ? {
        generatedAt: result.generatedAt,
        catalogVersion: result.catalogVersion,
        totalJobs: result.totalJobs,
        uniqueTitles: result.uniqueTitles,
        candidateVisibleJobs: result.candidateVisibleJobs,
        sourceCompleteness: Object.fromEntries(
          Object.entries(result.sourceReports).map(([source, report]) => [
            source,
            report.complete,
          ]),
        ),
        bilingualTitleCoverage: result.bilingualTitleCoverage,
        searchProfileCoverage: result.searchProfileCoverage,
        searchMappingReviewCoverage: result.searchMappingReviewCoverage,
        complete: result.complete,
      }
    : result;
  console.log(JSON.stringify(output, null, 2));
  if (!result.complete) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
