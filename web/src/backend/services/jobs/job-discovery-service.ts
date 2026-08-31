import "server-only";

import { z } from "zod";
import type {
  PublicJobRepository,
  PublicJobRow,
} from "@/backend/repositories/jobs/prisma-public-job-repository";
import { decodeJobCursor, normalizeSearchText } from "./search-normalization";
import { resolveSearchQuery } from "@/backend/services/search/search-query-resolver";
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

export function parseJobSearchCriteria(raw: unknown): NormalizedJobSearch {
  const parsed = jobSearchQuerySchema.parse(raw);
  const resolved = resolveSearchQuery(parsed.q, "JOBS");
  return {
    normalizedQuery: normalizeSearchText(parsed.q),
    searchVariants: resolved.variants,
    searchInterpretation: resolved.interpretation,
    resolverVersion: resolved.resolverVersion,
    searchBy: parsed.searchBy,
    normalizedLocation: normalizeSearchText(parsed.location, 160),
    normalizedDistricts: parsed.district.map((district) =>
      normalizeSearchText(district, 160),
    ),
    categoryFamily: parsed.categoryFamily.map(canonicalTaxonomyValue),
    categoryIds: parsed.categoryId.map(canonicalTaxonomyValue),
    normalizedRoleTitles: parsed.categoryTitle.map((title) =>
      normalizeSearchText(title, 160),
    ),
    normalizedSkills: parsed.skills.map((skill) =>
      normalizeSearchText(skill, 80),
    ),
    employmentType: parsed.employmentType,
    experienceLevel: parsed.experienceLevel,
    workArrangement: parsed.workArrangement,
    careerPath: parsed.careerPath,
    salaryMin: parsed.salaryMin,
    salaryMax: parsed.salaryMax,
    salaryNegotiable: parsed.salaryNegotiable,
    salaryCurrency: parsed.salaryCurrency,
    salaryPeriod: parsed.salaryPeriod,
    postedWithinDays: parsed.postedWithinDays,
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
function card(
  row: PublicJobRow,
  actor: JobActor,
  now: Date,
  matchScore?: number,
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
    let criteria: NormalizedJobSearch;
    try {
      criteria = parseJobSearchCriteria(raw);
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
    return {
      items: result.rows.map((row) => card(row, actor, now)),
      total: result.total,
      nextCursor: result.nextCursor,
      page: criteria.page ?? 1,
      totalPages: Math.ceil(result.total / criteria.limit),
      criteria: {
        q: criteria.normalizedQuery,
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
      ...(criteria.searchInterpretation?.usedFallback
        ? { searchInterpretation: criteria.searchInterpretation }
        : {}),
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
