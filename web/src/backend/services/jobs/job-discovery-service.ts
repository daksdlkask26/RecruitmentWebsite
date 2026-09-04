import "server-only";

import { z } from "zod";
import type {
  PublicJobRepository,
  PublicJobRow,
} from "@/backend/repositories/jobs/prisma-public-job-repository";
import { decodeJobCursor, normalizeSearchText } from "./search-normalization";
import { JOB_SEARCH_CATALOG_VERSION } from "@/backend/services/search/catalogs/job-search-catalog";
import { jobSearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";
import { emitSearchResolutionMetric } from "@/backend/observability/search-resolution-metrics";
import {
  resolveSearchQuery,
  SEARCH_RESOLVER_VERSION,
} from "@/backend/services/search/search-query-resolver";
import { parseNaturalLanguageJobSearch } from "@/backend/services/search/natural-language-search-parser";
import { buildJobSearchRecovery } from "@/backend/services/search/job-search-recovery";
import {
  searchCatalogProvider,
  type SearchCatalogProvider,
} from "@/backend/services/search/catalogs/search-catalog-provider";
import type { SearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";
import {
  JobServiceError,
  type JobActor,
  type NormalizedJobSearch,
  type PublicJobState,
} from "./job-types";
import {
  jobSearchQuerySchema,
  type JobCard,
} from "@/shared/contracts/jobs/discovery";
import {
  computeDiscoveryJobs,
  computeRelatedJobs,
  type JobSimilarityInput,
} from "@/shared/utils/jobs/similarity";
import { GetProfileAggregateService } from "@/backend/services/profile/get-profile-aggregate";
import { normalizeSalaryAmount } from "@/shared/utils/jobs/job-display";
import { rankJobsForCandidate } from "./candidate-job-match";
import { jobReviewSnapshotSchema } from "@/shared/contracts/recruiter-job-posting";
import {
  MAX_APPLICATION_ATTEMPTS,
  MAX_APPLICATION_ATTEMPTS_MESSAGE,
} from "@/shared/contracts/jobs/actions";

const experienceYears: Record<string, number> = {
  ENTRY: 0,
  JUNIOR: 1,
  MID: 3,
  SENIOR: 5,
  LEAD: 6,
  MANAGER: 7,
};

function approvedSnapshot(row: PublicJobRow) {
  const parsed = jobReviewSnapshotSchema.safeParse(
    row.reviewAggregate?.approvedVersion?.snapshot,
  );
  return parsed.success ? parsed.data : null;
}

type CandidateSignal = JobSimilarityInput & { row: PublicJobRow };

function canonicalTaxonomyCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized === "other" ? "r29" : normalized;
}

function canonicalTaxonomyValue(value: string) {
  return canonicalTaxonomyCode(value) ?? value.trim().toLowerCase();
}

function taxonomySignals(
  row: PublicJobRow,
  snapshot: ReturnType<typeof approvedSnapshot>,
) {
  const signals = row as unknown as {
    categoryIds?: unknown;
    categoryFamily?: unknown;
    industryCode?: unknown;
    subIndustryCode?: unknown;
  };
  const directCategoryId = canonicalTaxonomyCode(signals.subIndustryCode);
  const directCategoryIds = directCategoryId ? [directCategoryId] : [];
  const snapshotCategoryIds =
    snapshot?.categoryIds.map(canonicalTaxonomyValue) ?? [];
  const projectedCategoryIds = Array.isArray(signals.categoryIds)
    ? signals.categoryIds
        .map((category) =>
          typeof category === "string" && category.trim()
            ? canonicalTaxonomyValue(category)
            : undefined,
        )
        .filter((category): category is string => Boolean(category))
    : [];
  const categoryIds = [
    ...new Set([
      ...directCategoryIds,
      ...snapshotCategoryIds,
      ...projectedCategoryIds,
    ]),
  ];
  const categoryFamily =
    canonicalTaxonomyCode(signals.industryCode) ??
    canonicalTaxonomyCode(snapshot?.industryCode) ??
    canonicalTaxonomyCode(snapshot?.categoryFamily) ??
    canonicalTaxonomyCode(signals.categoryFamily);
  return { categoryIds, categoryFamily };
}

function validationError(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "query";
    fieldErrors[key] = [
      ...new Set([...(fieldErrors[key] ?? []), issue.message]),
    ];
  }
  return new JobServiceError(400, {
    code: "JOB_SEARCH_INVALID",
    message: "Review the search criteria.",
    fieldErrors,
  });
}

export function parseJobSearchCriteria(
  raw: unknown,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
): NormalizedJobSearch {
  const parsed = jobSearchQuerySchema.parse(raw);
  const natural =
    parsed.searchMode === "SMART"
      ? parseNaturalLanguageJobSearch(parsed.q, catalogIndex)
      : parseNaturalLanguageJobSearch("", catalogIndex);
  const resolverQuery = natural.hasFilters ? natural.residualQuery : parsed.q;
  const resolved = resolveSearchQuery(
    resolverQuery,
    "JOBS",
    "en",
    parsed.searchMode,
    {
      allowOccupationExpansion: parsed.searchBy !== "COMPANY",
      catalogIndex,
    },
  );
  const structuredFilters = [
    ...natural.structuredFilters,
    ...(resolved.interpretation.matchedTitle
      ? [
          {
            id: `query:TITLE:${resolved.interpretation.matchedTitle.titleId}`,
            kind: "TITLE" as const,
            value: resolved.interpretation.matchedTitle.titleId,
            query: resolverQuery,
            labelVi: resolved.interpretation.matchedTitle.labelVi,
            labelEn: resolved.interpretation.matchedTitle.labelEn,
            source: "QUERY" as const,
          },
        ]
      : []),
    ...(resolved.interpretation.matchedOccupation
      ? [
          {
            id: `query:OCCUPATION:${resolved.interpretation.matchedOccupation.occupationId}`,
            kind: "OCCUPATION" as const,
            value: resolved.interpretation.matchedOccupation.occupationId,
            query: resolverQuery,
            labelVi: resolved.interpretation.matchedOccupation.labelVi,
            labelEn: resolved.interpretation.matchedOccupation.labelEn,
            source: "QUERY" as const,
          },
        ]
      : []),
  ].slice(0, 16);
  const searchInterpretation = {
    ...resolved.interpretation,
    originalQuery: parsed.q,
    normalizedQuery: normalizeSearchText(parsed.q),
    ...(structuredFilters.length ? { structuredFilters } : {}),
    ...(resolved.intent ? { searchIntent: resolved.intent } : {}),
  };
  return {
    rawQuery: parsed.q,
    normalizedQuery: normalizeSearchText(resolverQuery),
    searchVariants: resolved.variants,
    searchInterpretation,
    catalogIndex,
    ...(resolved.intent ? { searchIntent: resolved.intent } : {}),
    resolverVersion: resolved.resolverVersion,
    searchMode: parsed.searchMode,
    searchBy: parsed.searchBy,
    normalizedLocation: normalizeSearchText(
      parsed.location || natural.filters.location || "",
      160,
    ),
    normalizedDistricts: parsed.district.length
      ? parsed.district.map((district) => normalizeSearchText(district, 160))
      : natural.filters.district.map((district) =>
          normalizeSearchText(district, 160),
        ),
    categoryFamily: parsed.categoryFamily.map(canonicalTaxonomyValue),
    categoryIds: parsed.categoryId.map(canonicalTaxonomyValue),
    normalizedRoleTitles: parsed.categoryTitle.map((title) =>
      normalizeSearchText(title, 160),
    ),
    normalizedSkills: parsed.skills.length
      ? parsed.skills.map((skill) => normalizeSearchText(skill, 80))
      : natural.filters.skills.map((skill) => normalizeSearchText(skill, 80)),
    employmentType: parsed.employmentType.length
      ? parsed.employmentType
      : [...natural.filters.employmentType],
    experienceLevel: parsed.experienceLevel.length
      ? parsed.experienceLevel
      : [...natural.filters.experienceLevel],
    workArrangement: parsed.workArrangement.length
      ? parsed.workArrangement
      : [...natural.filters.workArrangement],
    careerPath: parsed.careerPath,
    salaryMin: parsed.salaryMin ?? natural.filters.salaryMin,
    salaryMax: parsed.salaryMax ?? natural.filters.salaryMax,
    salaryNegotiable: parsed.salaryNegotiable,
    salaryCurrency:
      parsed.salaryMin !== undefined || parsed.salaryMax !== undefined
        ? parsed.salaryCurrency
        : (natural.filters.salaryCurrency ?? parsed.salaryCurrency),
    salaryPeriod:
      parsed.salaryMin !== undefined || parsed.salaryMax !== undefined
        ? parsed.salaryPeriod
        : (natural.filters.salaryPeriod ?? parsed.salaryPeriod),
    postedWithinDays:
      parsed.postedWithinDays ?? natural.filters.postedWithinDays,
    sort: parsed.sort,
    cursor: parsed.cursor
      ? decodeJobCursor(parsed.cursor, parsed.sort)
      : undefined,
    page: parsed.page,
    limit: parsed.limit,
  };
}

function salary(row: PublicJobRow): JobCard["salary"] {
  if (
    row.salaryMin === null ||
    row.salaryMax === null ||
    row.salaryCurrency === null ||
    row.salaryPeriod === null
  )
    return null;
  return {
    minimum: normalizeSalaryAmount(Number(row.salaryMin)),
    maximum: normalizeSalaryAmount(Number(row.salaryMax)),
    currency: row.salaryCurrency,
    period: row.salaryPeriod,
    isNegotiable: false,
  };
}

function similarityInput(row: PublicJobRow): JobSimilarityInput {
  // The Prisma projection currently exposes normalized skill/location fields.
  // Keep the adapter tolerant of richer API/mock projections so categoryIds,
  // categoryFamily, skillTags, and location.city can participate whenever
  // those signals are available without weakening the repository contract.
  const signals = row as unknown as {
    categoryIds?: unknown;
    categoryFamily?: unknown;
    industryCode?: unknown;
    subIndustryCode?: unknown;
    skillTags?: unknown;
    location?: unknown;
  };
  const snapshot = approvedSnapshot(row);
  const skillTags = snapshot
    ? snapshot.skillTags
    : Array.isArray(signals.skillTags)
      ? signals.skillTags.filter(
          (skill): skill is string => typeof skill === "string",
        )
      : row.skills.map((skill) => skill.displayName);
  const location = snapshot
    ? snapshot.location.city
    : signals.location && typeof signals.location === "object"
      ? (signals.location as { city?: unknown }).city
      : signals.location;

  const { categoryIds, categoryFamily } = taxonomySignals(row, snapshot);

  return {
    id: row.id,
    title: row.title,
    companyId: row.companyId,
    industry: row.company.industry ?? undefined,
    status: row.status === "ACTIVE" ? "open" : row.status.toLowerCase(),
    categoryIds,
    categoryFamily,
    skillTags,
    city: typeof location === "string" ? location : row.location,
    salaryMin: row.salaryMin === null ? null : Number(row.salaryMin),
    salaryMax: row.salaryMax === null ? null : Number(row.salaryMax),
    experienceMinYears: experienceYears[row.experienceLevel] ?? null,
    postedAt: row.publishedAt?.toISOString(),
  };
}

function textBullets(value: string | null, maximum = 4) {
  return (value ?? "")
    .split(/\r?\n+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum);
}

function searchMatchReasons(
  row: PublicJobRow,
  criteria: NormalizedJobSearch,
): NonNullable<JobCard["matchReasons"]> {
  const title = normalizeSearchText(row.title, 200);
  const titleTokens = criteria.normalizedQuery
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const reasons: NonNullable<JobCard["matchReasons"]> = [];
  const add = (
    kind: NonNullable<JobCard["matchReasons"]>[number]["kind"],
    labelVi: string,
    labelEn: string,
  ) => {
    if (reasons.some((reason) => reason.kind === kind)) return;
    reasons.push({ kind, labelVi, labelEn });
  };
  if (
    criteria.searchIntent?.titleCandidates?.length ||
    (titleTokens.length && titleTokens.every((token) => title.includes(token)))
  )
    add("TITLE", "Khớp chức danh", "Title match");
  const inferredSkills = (criteria.searchIntent?.skills ?? []).flatMap(
    (skillId) =>
      criteria.catalogIndex?.skills
        .find((skill) => skill.skillId === skillId)
        ?.phrases.map((phrase) => normalizeSearchText(phrase, 80)) ?? [],
  );
  const requestedSkills = new Set([
    ...criteria.normalizedSkills,
    ...inferredSkills,
  ]);
  if (
    requestedSkills.size &&
    row.skills.some((skill) =>
      requestedSkills.has(normalizeSearchText(skill.displayName, 80)),
    )
  )
    add("SKILL", "Khớp kỹ năng", "Skill match");
  if (
    criteria.normalizedLocation &&
    normalizeSearchText(row.location, 160).includes(criteria.normalizedLocation)
  )
    add("LOCATION", "Khớp địa điểm", "Location match");
  if (criteria.experienceLevel.includes(row.experienceLevel))
    add("EXPERIENCE", "Khớp kinh nghiệm", "Experience match");
  if (criteria.workArrangement.includes(row.workArrangement))
    add(
      "WORK_ARRANGEMENT",
      "Khớp hình thức làm việc",
      "Work arrangement match",
    );
  return reasons.slice(0, 3);
}

function card(
  row: PublicJobRow,
  actor: JobActor,
  now: Date,
  matchScore?: number,
  searchCriteria?: NormalizedJobSearch,
): JobCard {
  const snapshot = approvedSnapshot(row);
  const authenticated = actor.kind === "user";
  const applicationCount = authenticated
    ? (row.applicationAttemptCounters?.[0]?.applicationCount ??
      Math.min(row.applications.length, 1))
    : 0;
  const applicationLimitReached =
    authenticated && applicationCount >= MAX_APPLICATION_ATTEMPTS;
  const urgent =
    row.applicationDeadline !== null &&
    row.applicationDeadline.getTime() - now.getTime() <= 14 * 86_400_000 &&
    row.applicationDeadline > now;
  const { categoryIds, categoryFamily } = taxonomySignals(row, snapshot);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    company: {
      ...row.company,
      size: row.company.size ?? undefined,
      industry: row.company.industry ?? undefined,
      address: row.company.address ?? undefined,
    },
    location: row.location,
    employmentType: row.employmentType,
    experienceLevel: row.experienceLevel,
    workArrangement: row.workArrangement,
    salary: snapshot
      ? { ...salary(row)!, isNegotiable: snapshot.salary.isNegotiable }
      : salary(row),
    summary: row.summary,
    education: row.education ?? undefined,
    numberOfHires: row.numberOfHires ?? undefined,
    age: row.age ?? undefined,
    skills: row.skills.map((skill) => skill.displayName),
    requirementHighlights: textBullets(row.requirements),
    benefitHighlights: textBullets(row.benefits),
    benefitItems:
      snapshot?.description.benefits ??
      textBullets(row.benefits).map((label) => ({
        icon: "spark",
        label,
      })),
    publishedAt: row.publishedAt!.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    applicationDeadline: row.applicationDeadline?.toISOString() ?? null,
    isUrgent: snapshot?.isUrgent ?? urgent,
    workOnSaturday: snapshot?.workOnSaturday ?? false,
    isVerified: true,
    categoryIds,
    categoryFamily,
    experienceMinYears:
      snapshot?.experience.minYears ??
      experienceYears[row.experienceLevel] ??
      undefined,
    matchScore,
    ...(searchCriteria
      ? { matchReasons: searchMatchReasons(row, searchCriteria) }
      : {}),
    actions: {
      authenticated,
      saved: row.savedBy.length > 0,
      applied: row.applications.length > 0,
      canSave: authenticated,
      canReport: authenticated,
      canApply: !applicationLimitReached,
      applicationCount: authenticated ? applicationCount : undefined,
      applicationLimitReached,
      applicationLimitMessage: applicationLimitReached
        ? MAX_APPLICATION_ATTEMPTS_MESSAGE
        : undefined,
    },
  };
}

export function projectPublicJobState(
  status: "ACTIVE" | "CLOSED" | "EXPIRED",
  applicationDeadline: Date | null,
  now: Date,
): PublicJobState {
  if (applicationDeadline && applicationDeadline <= now) return "EXPIRED";
  return status;
}

export class JobDiscoveryService {
  constructor(
    private readonly repository?: PublicJobRepository,
    private readonly profileService = new GetProfileAggregateService(),
    private readonly catalogProvider: SearchCatalogProvider =
      searchCatalogProvider,
  ) {}

  async search(raw: unknown, actor: JobActor, now = new Date()) {
    return this.searchScoped(raw, actor, now);
  }

  async searchScoped(
    raw: unknown,
    actor: JobActor,
    now = new Date(),
    scope: Readonly<{ companyId?: string }> = {},
  ) {
    const startedAt = performance.now();
    let criteria: NormalizedJobSearch;
    try {
      const catalogSnapshot = await this.catalogProvider.getActiveSnapshot();
      criteria = parseJobSearchCriteria(raw, catalogSnapshot.index);
    } catch (error) {
      if (error instanceof z.ZodError) throw validationError(error);
      if (error instanceof JobServiceError) throw error;
      throw new JobServiceError(400, {
        code: "JOB_SEARCH_INVALID",
        message: "Review the search criteria.",
      });
    }
    const repository =
      this.repository ??
      new (
        await import("@/backend/repositories/jobs/prisma-public-job-repository")
      ).PrismaPublicJobRepository();
    const repositoryCriteria = {
      ...criteria,
      ...(scope.companyId ? { companyId: scope.companyId } : {}),
      ...(criteria.normalizedRoleTitles?.length
        ? { normalizedRoleTitles: criteria.normalizedRoleTitles }
        : {}),
    };
    const result = await repository.search(
      repositoryCriteria,
      actor.kind === "user" ? actor.userId : null,
      now,
    );
    if (criteria.searchInterpretation) {
      emitSearchResolutionMetric({
        context: "JOBS",
        interpretation: criteria.searchInterpretation,
        variantCount: criteria.searchVariants?.length ?? 1,
        resultCount: result.total,
        candidateCount: result.candidateCount,
        projectionState: result.projectionState,
        candidateCapReached: result.candidateCapReached,
        durationMs: performance.now() - startedAt,
      });
    }
    const searchRecovery =
      result.total === 0
        ? buildJobSearchRecovery(criteria, criteria.catalogIndex)
        : undefined;
    return {
      items: result.rows.map((row) =>
        card(row, actor, now, undefined, criteria),
      ),
      total: result.total,
      nextCursor: result.nextCursor,
      page: criteria.page ?? 1,
      totalPages: Math.ceil(result.total / criteria.limit),
      searchMetadata: {
        resolverVersion: criteria.resolverVersion ?? SEARCH_RESOLVER_VERSION,
        catalogVersion:
          criteria.searchInterpretation?.catalogVersion ??
          criteria.catalogIndex?.version ??
          JOB_SEARCH_CATALOG_VERSION,
      },
      criteria: {
        q: criteria.rawQuery ?? criteria.normalizedQuery,
        searchMode: criteria.searchMode,
        searchBy: criteria.searchBy,
        location: criteria.normalizedLocation,
        district: criteria.normalizedDistricts,
        categoryFamily: criteria.categoryFamily,
        categoryId: criteria.categoryIds,
        categoryTitle: criteria.normalizedRoleTitles,
        employmentType: criteria.employmentType,
        experienceLevel: criteria.experienceLevel,
        workArrangement: criteria.workArrangement,
        skills: criteria.normalizedSkills,
        salaryMin: criteria.salaryMin,
        salaryMax: criteria.salaryMax,
        salaryCurrency: criteria.salaryCurrency,
        salaryPeriod: criteria.salaryPeriod,
        postedWithinDays: criteria.postedWithinDays,
        sort: criteria.sort,
        page: criteria.page ?? 1,
        limit: criteria.limit,
      },
      ...(criteria.searchInterpretation &&
      (criteria.searchMode === "LITERAL" ||
        criteria.searchInterpretation.reason !== "NONE" ||
        Boolean(criteria.searchInterpretation.correction) ||
        Boolean(criteria.searchInterpretation.structuredFilters?.length))
        ? { searchInterpretation: criteria.searchInterpretation }
        : {}),
      ...(searchRecovery?.actions.length ? { searchRecovery } : {}),
    };
  }

  /**
   * Returns every currently candidate-visible posting for a server-side
   * recommendation calculation. This deliberately has no page-size limit:
   * callers must rank the collection on the server and project only the
   * selected results to a page.
   */
  async listRecommendationCandidates(actor: JobActor, now = new Date()) {
    const repository =
      this.repository ??
      new (
        await import("@/backend/repositories/jobs/prisma-public-job-repository")
      ).PrismaPublicJobRepository();
    if (!repository.findPublicRecommendationCandidates) return [];
    const rows = await repository.findPublicRecommendationCandidates(
      actor.kind === "user" ? actor.userId : null,
      now,
    );
    return rows.map((row) => card(row, actor, now));
  }

  async detail(
    rawSlug: unknown,
    actor: JobActor,
    now = new Date(),
    canonicalOrigin = "http://localhost:3001",
  ) {
    const slug = z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .max(220)
      .parse(rawSlug);
    const repository =
      this.repository ??
      new (
        await import("@/backend/repositories/jobs/prisma-public-job-repository")
      ).PrismaPublicJobRepository();
    const row = await repository.findPublicBySlug(
      slug,
      actor.kind === "user" ? actor.userId : null,
      now,
    );
    if (!row) {
      throw new JobServiceError(404, {
        code: "JOB_UNAVAILABLE",
        message: "This job is not available.",
      });
    }
    const state = projectPublicJobState(
      row.status === "CLOSED"
        ? "CLOSED"
        : row.status === "EXPIRED"
          ? "EXPIRED"
          : "ACTIVE",
      row.applicationDeadline,
      now,
    );
    const summary = card(row, actor, now);
    const relatedCandidateRows = repository.findPublicRelatedCandidates
      ? await repository.findPublicRelatedCandidates(
          row.id,
          actor.kind === "user" ? actor.userId : null,
          now,
        )
      : [];
    const discoveryCandidateRows = repository.findPublicDiscoveryCandidates
      ? await repository.findPublicDiscoveryCandidates(
          row.id,
          actor.kind === "user" ? actor.userId : null,
          now,
        )
      : relatedCandidateRows;
    const candidateSignals: CandidateSignal[] = relatedCandidateRows.map(
      (candidate) => ({
        ...similarityInput(candidate),
        row: candidate,
      }),
    );
    const discoveryCandidateSignals: CandidateSignal[] =
      discoveryCandidateRows.map((candidate) => ({
        ...similarityInput(candidate),
        row: candidate,
      }));
    const currentSignals = similarityInput(row);
    const relatedJobs = computeRelatedJobs(
      currentSignals,
      candidateSignals,
      6,
    ).map(({ row: candidate, matchScore }) =>
      card(candidate, actor, now, matchScore),
    );
    const relatedJobIds = new Set(relatedJobs.map((item) => item.id));
    const discoveryRanked = computeDiscoveryJobs(
      currentSignals,
      discoveryCandidateSignals,
      relatedJobIds,
      5,
    );
    let recommendedJobs = discoveryRanked.map(
      ({ row: candidate, matchScore }) =>
        card(candidate, actor, now, matchScore),
    );
    if (actor.kind === "user") {
      try {
        const profile = await this.profileService.execute(actor.userId);
        const personalized = rankJobsForCandidate(
          profile,
          discoveryCandidateSignals.filter(
            (candidate) => !relatedJobIds.has(candidate.id),
          ),
          now,
          5,
        );
        if (personalized.length) {
          recommendedJobs = personalized.map(({ candidate, matchScore }) =>
            card(candidate.row, actor, now, matchScore),
          );
        }
      } catch {
        // A missing or temporarily unavailable profile should not break the
        // detail page; broad discovery recommendations remain available.
      }
    }

    return {
      ...summary,
      actions: {
        ...summary.actions,
        canApply:
          state === "ACTIVE" &&
          !summary.actions.applied &&
          summary.actions.canApply,
      },
      state,
      description:
        approvedSnapshot(row)?.description.overview ?? row.description,
      responsibilities:
        approvedSnapshot(row)?.description.responsibilities.join("\n") ??
        row.responsibilities,
      requirements:
        approvedSnapshot(row)?.description.requirements.join("\n") ??
        row.requirements,
      benefits:
        approvedSnapshot(row)
          ?.description.benefits.map((benefit) => benefit.label)
          .join("\n") ?? row.benefits,
      canonicalUrl: new URL("/jobs/" + row.slug, canonicalOrigin).toString(),
      relatedJobs,
      recommendedJobs,
    };
  }
}
