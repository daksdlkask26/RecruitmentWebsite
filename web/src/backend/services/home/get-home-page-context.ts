import "server-only";

import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { requireSession } from "@/backend/auth/session/require-session";
import { prisma } from "@/backend/database/prisma";
import { csrfProof } from "@/backend/security/csrf/csrf-proof";
import { JobDiscoveryService } from "@/backend/services/jobs/job-discovery-service";
import {
  hasCandidateJobSignals,
  rankJobsForCandidate,
} from "@/backend/services/jobs/candidate-job-match";
import { careerPathSlugs } from "@/shared/contracts/jobs/career-paths";
import { GetProfileAggregateService } from "@/backend/services/profile/get-profile-aggregate";
import {
  listPrivateMatchHomeScores,
  type PrivateMatchHomeScore,
} from "@/backend/private-cv-match/private-cv-match-service";
import { getRecruiterHeaderStatusService } from "@/backend/recruiter-header/recruiter-header-status-service-factory";
import {
  PrismaHomePublicCompanyRepository,
  type HomePublicCompanyRow,
} from "@/backend/repositories/home/prisma-home-public-company-repository";
import { PrismaPublicJobRepository } from "@/backend/repositories/jobs/prisma-public-job-repository";
import {
  isPublicDiscoverySafetyFallbackActive,
  PUBLIC_DISCOVERY_TAGS,
} from "@/backend/services/discovery/public-discovery-cache";
import { readPublicDiscoveryWatermark } from "@/backend/services/discovery/public-discovery-watermark";
import { illustrativeSmartMatch } from "@/frontend/features/home/home-display-data";
import type {
  EmployerSpotlight,
  HomeCareerPath,
  HomeJob,
  HomePublicJob,
  HomePublicSnapshot,
  HomeJobMatchBreakdown,
  HomeCvMatchReference,
  HomeMatchFallbackReason,
  HomeMatchSource,
  HomePageModel,
  HomeSectionState,
  SmartMatchInsight,
} from "@/frontend/features/home/home-page-model";
import type { CandidateProfileContract } from "@/shared/contracts/account/profile";
import type { JobCard } from "@/shared/contracts/jobs/discovery";
import type { RecruiterHeaderStatus } from "@/shared/contracts/recruiter-header-status";

type CurrentSession = { userId: string; sessionId: string } | null;
type AccountProjection = {
  name: string;
  image: string | null;
  language: string | null;
} | null;

const homeTrendingJobLimit = 6;
const meaningfulMatchMinimumScore = 50;
const homePublicSnapshotMaxAgeMs = 30_000;
const homePublicSnapshotRefreshDelayMs = 5_000;

type HomePublicSnapshotCacheEntry = Readonly<{
  watermark: string;
  snapshot: HomePublicSnapshot;
  refreshAt: number;
}>;

let homePublicSnapshotCache: HomePublicSnapshotCacheEntry | null = null;
let homePublicSnapshotPromise: Promise<HomePublicSnapshotCacheEntry> | null =
  null;
let homePublicSnapshotPromiseWatermark: string | null = null;
let homePublicSnapshotRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export type HomeContextDependencies = {
  requestHeaders: () => Promise<Headers>;
  session: (requestHeaders: Headers) => Promise<CurrentSession>;
  searchJobs: (
    actor:
      | { kind: "visitor" }
      | { kind: "user"; userId: string; sessionId: string },
  ) => Promise<readonly JobCard[]>;
  recommendationJobs?: (
    actor:
      | { kind: "visitor" }
      | { kind: "user"; userId: string; sessionId: string },
  ) => Promise<readonly JobCard[]>;
  privateMatchScores?: (
    userId: string,
    now: Date,
  ) => Promise<readonly PrivateMatchHomeScore[]>;
  careerPaths?: (
    actor:
      | { kind: "visitor" }
      | { kind: "user"; userId: string; sessionId: string },
  ) => Promise<readonly HomeCareerPath[]>;
  listCompanies: (now: Date) => Promise<readonly HomePublicCompanyRow[]>;
  countCompanies?: (now: Date) => Promise<number>;
  account: (userId: string) => Promise<AccountProjection>;
  profile: (userId: string) => Promise<CandidateProfileContract>;
  recruiterStatus: (userId: string) => Promise<RecruiterHeaderStatus>;
  proof: (sessionId: string) => string;
  now: () => Date;
};

const defaultDependencies = (): HomeContextDependencies => ({
  requestHeaders: headers,
  session: requireSession,
  searchJobs: async (actor) =>
    (
      await new JobDiscoveryService().search(
        { limit: homeTrendingJobLimit, sort: "NEWEST" },
        actor,
      )
    ).items,
  recommendationJobs: (actor) =>
    new JobDiscoveryService().listRecommendationCandidates(actor),
  privateMatchScores: listPrivateMatchHomeScores,
  careerPaths: async (actor) => {
    const repository = new PrismaPublicJobRepository();
    if (repository.countCareerPathJobs) {
      return repository.countCareerPathJobs(new Date());
    }
    const service = new JobDiscoveryService(repository);
    return Promise.all(
      careerPathSlugs.map(async (slug) => {
        const result = await service.search(
          { careerPath: slug, limit: 1, sort: "NEWEST" },
          actor,
        );
        return { slug, openJobCount: result.total };
      }),
    );
  },
  listCompanies: (now) => new PrismaHomePublicCompanyRepository().list(now, 5),
  countCompanies: (now) => new PrismaHomePublicCompanyRepository().count(now),
  account: async (userId) => {
    const account = await prisma.userAccount.findUnique({
      where: { id: userId },
      select: {
        name: true,
        image: true,
        preferences: { select: { language: true } },
      },
    });
    return account
      ? {
          name: account.name,
          image: account.image,
          language: account.preferences?.language ?? null,
        }
      : null;
  },
  profile: (userId) => new GetProfileAggregateService().execute(userId),
  recruiterStatus: (userId) =>
    getRecruiterHeaderStatusService().resolveForUser(userId),
  proof: csrfProof,
  now: () => new Date(),
});

/**
 * Read only the visitor-safe Home projection. This function intentionally has
 * no request headers, session, account, Profile, CSRF, or Candidate actor in
 * its inputs. The default route wraps it in Next's tagged server cache; tests
 * can inject a loader without touching the cache.
 */
export async function getHomePublicSnapshot(
  dependencies: Pick<
    HomeContextDependencies,
    "searchJobs" | "careerPaths" | "listCompanies" | "countCompanies"
  >,
  now: Date,
): Promise<HomePublicSnapshot> {
  const [jobResult, companyResult, companyCountResult, careerPathResult] =
    await Promise.allSettled([
      dependencies.searchJobs({ kind: "visitor" }),
      dependencies.listCompanies(now),
      dependencies.countCompanies
        ? dependencies.countCompanies(now)
        : Promise.resolve(null),
      dependencies.careerPaths
        ? dependencies.careerPaths({ kind: "visitor" })
        : Promise.resolve(unavailableCareerPaths()),
    ]);
  const jobs: HomePublicSnapshot["jobs"] =
    jobResult.status === "fulfilled"
      ? section(
          jobResult.value
            .slice(0, homeTrendingJobLimit)
            .map((job) => projectPublicJob(job)),
        )
      : {
          status: "error",
          items: [],
          recovery: { kind: "reloadHome" },
        };
  const spotlights: HomePublicSnapshot["spotlights"] =
    companyResult.status === "fulfilled"
      ? section(companyResult.value.map(companyProjection))
      : { status: "error", items: [], recovery: { kind: "reloadHome" } };
  return {
    jobs,
    spotlights,
    companyCount:
      companyCountResult.status === "fulfilled"
        ? companyCountResult.value
        : null,
    careerPaths:
      careerPathResult.status === "fulfilled"
        ? careerPathResult.value
        : unavailableCareerPaths(),
  };
}

async function loadDefaultHomePublicSnapshot(
  fallbackNow: Date,
): Promise<HomePublicSnapshot> {
  const watermark = await readPublicDiscoveryWatermark();
  if (!watermark) {
    // A missing/unavailable watermark is a cache safety failure. Read the
    // authoritative projection directly instead of reusing an old key.
    return getHomePublicSnapshot(defaultDependencies(), fallbackNow);
  }

  if (
    homePublicSnapshotCache &&
    homePublicSnapshotCache.watermark === watermark
  ) {
    if (homePublicSnapshotCache.refreshAt > Date.now()) {
      return homePublicSnapshotCache.snapshot;
    }
    // Natural TTL expiry is safe to refresh in the background because the
    // durable watermark has not changed. A mutation changes the watermark
    // and therefore takes the synchronous branch below.
    scheduleHomePublicSnapshotRefresh(watermark, fallbackNow);
    return homePublicSnapshotCache.snapshot;
  }

  if (homePublicSnapshotRefreshTimer) {
    clearTimeout(homePublicSnapshotRefreshTimer);
    homePublicSnapshotRefreshTimer = null;
  }
  const refreshed = await refreshDefaultHomePublicSnapshot(
    watermark,
    fallbackNow,
  );
  return refreshed.snapshot;
}

function scheduleHomePublicSnapshotRefresh(
  watermark: string,
  fallbackNow: Date,
) {
  if (homePublicSnapshotRefreshTimer || homePublicSnapshotPromise) return;
  homePublicSnapshotRefreshTimer = setTimeout(() => {
    homePublicSnapshotRefreshTimer = null;
    void refreshDefaultHomePublicSnapshot(watermark, fallbackNow).catch(
      () => undefined,
    );
  }, homePublicSnapshotRefreshDelayMs);
  homePublicSnapshotRefreshTimer.unref?.();
}

async function refreshDefaultHomePublicSnapshot(
  watermark: string,
  fallbackNow: Date,
): Promise<HomePublicSnapshotCacheEntry> {
  if (
    !homePublicSnapshotPromise ||
    homePublicSnapshotPromiseWatermark !== watermark
  ) {
    homePublicSnapshotPromiseWatermark = watermark;
    homePublicSnapshotPromise = (async () => {
      let snapshot: HomePublicSnapshot;
      try {
        const cached = unstable_cache(
          async () => {
            const dependencies = defaultDependencies();
            return getHomePublicSnapshot(dependencies, new Date());
          },
          ["nextgen-careers-home-public-snapshot-v3", watermark],
          {
            revalidate: homePublicSnapshotMaxAgeMs / 1_000,
            tags: [
              PUBLIC_DISCOVERY_TAGS.homeJobs,
              PUBLIC_DISCOVERY_TAGS.homeCompanies,
            ],
          },
        );
        snapshot = await cached();
      } catch {
        // Next's cache store is not available in some standalone execution
        // contexts. Fail closed to an authoritative read.
        snapshot = await getHomePublicSnapshot(
          defaultDependencies(),
          fallbackNow,
        );
      }
      return {
        watermark,
        snapshot,
        refreshAt: Date.now() + homePublicSnapshotMaxAgeMs,
      };
    })();
  }

  const activePromise = homePublicSnapshotPromise;
  if (!activePromise) throw new Error("HOME_PUBLIC_REFRESH_NOT_STARTED");
  try {
    const refreshed = await activePromise;
    if (homePublicSnapshotPromise === activePromise) {
      homePublicSnapshotCache = refreshed;
      homePublicSnapshotPromise = null;
      homePublicSnapshotPromiseWatermark = null;
    }
    return refreshed;
  } catch (error) {
    if (homePublicSnapshotPromise === activePromise) {
      homePublicSnapshotPromise = null;
      homePublicSnapshotPromiseWatermark = null;
    }
    throw error;
  }
}

function section<T>(items: readonly T[]): HomeSectionState<T> {
  return items.length ? { status: "ready", items } : { status: "empty", items };
}

const unavailableCareerPaths = (): readonly HomeCareerPath[] =>
  careerPathSlugs.map((slug) => ({ slug, openJobCount: null }));

function projectJob(
  job: JobCard,
  match?: {
    score: number | null;
    source: HomeMatchSource;
    breakdown?: HomeJobMatchBreakdown;
    cvMatch?: HomeCvMatchReference;
  },
): HomeJob {
  return {
    id: job.id,
    slug: job.slug,
    title: job.title,
    companyName: job.company.displayName,
    companySlug: job.company.slug,
    companyLogoUrl: job.company.logoUrl,
    companyDescription: job.company.publicDescription,
    location: job.location,
    workArrangement: job.workArrangement,
    employmentType: job.employmentType,
    skills: job.skills.slice(0, 5),
    ...(match?.score !== null && match?.score !== undefined
      ? { matchScore: match.score }
      : {}),
    ...(match ? { matchSource: match.source } : {}),
    ...(match?.breakdown ? { matchBreakdown: match.breakdown } : {}),
    ...(match?.cvMatch ? { cvMatch: match.cvMatch } : {}),
    salary: job.salary,
    publishedAt: job.publishedAt,
    saved: job.actions.saved,
    canSave: job.actions.canSave,
  };
}

function projectPublicJob(job: JobCard): HomePublicJob {
  return {
    id: job.id,
    slug: job.slug,
    title: job.title,
    companyName: job.company.displayName,
    companySlug: job.company.slug,
    companyLogoUrl: job.company.logoUrl,
    companyDescription: job.company.publicDescription,
    location: job.location,
    workArrangement: job.workArrangement,
    employmentType: job.employmentType,
    skills: job.skills.slice(0, 5),
    salary: job.salary,
    publishedAt: job.publishedAt,
  };
}

function hydratePublicJob(
  job: HomePublicJob,
  overlay?: Pick<HomeJob, "saved" | "canSave">,
): HomeJob {
  return {
    ...job,
    saved: overlay?.saved ?? false,
    canSave: overlay?.canSave ?? false,
  };
}

function publicSnapshotJobs(
  snapshot: HomePublicSnapshot,
  overlays: readonly JobCard[] = [],
): HomeSectionState<HomeJob> {
  if (snapshot.jobs.status === "error") {
    return {
      status: "error",
      items: [],
      recovery: { kind: "reloadHome" },
    };
  }
  const byId = new Map(overlays.map((job) => [job.id, job]));
  return {
    status: snapshot.jobs.status,
    items: snapshot.jobs.items.map((job) => {
      const overlay = byId.get(job.id);
      return hydratePublicJob(job, overlay?.actions);
    }),
  };
}

function companyProjection(row: HomePublicCompanyRow): EmployerSpotlight {
  return {
    slug: row.slug,
    name: row.displayName,
    logoUrl: row.logoUrl,
    ...(row.publicDescription ? { publicSummary: row.publicDescription } : {}),
    ...(row.publicLocation ? { publicLocation: row.publicLocation } : {}),
    ...(row.industry ? { industry: row.industry } : {}),
    ...(row.size ? { size: row.size } : {}),
    openPositionCount: row.openPositionCount,
    destination: { kind: "displayOnly" },
  };
}

const experienceMinimum: Record<JobCard["experienceLevel"], number> = {
  ENTRY: 0,
  JUNIOR: 1,
  MID: 3,
  SENIOR: 5,
  LEAD: 6,
  MANAGER: 7,
};

function matchCandidate(job: JobCard) {
  return {
    id: job.id,
    status: "open",
    title: job.title,
    categoryIds: job.categoryIds ? [...job.categoryIds] : undefined,
    categoryFamily: job.categoryFamily,
    skillTags: [...job.skills],
    city: job.location,
    salaryMin: job.salary?.minimum,
    salaryMax: job.salary?.maximum,
    experienceMinYears: experienceMinimum[job.experienceLevel],
    education: job.education,
    postedAt: job.publishedAt,
    job,
  };
}

type HomeRecommendationMatch = Readonly<{
  candidate: ReturnType<typeof matchCandidate>;
  score: number | null;
  source: HomeMatchSource;
  breakdown?: HomeJobMatchBreakdown;
  cvMatch?: HomeCvMatchReference;
  matchingSkills: readonly string[];
  improvementAreas: readonly string[];
}>;

function personalMatch(
  profile: CandidateProfileContract,
  jobs: readonly JobCard[],
  now: Date,
  privateScores: readonly PrivateMatchHomeScore[],
): {
  insight: Extract<SmartMatchInsight, { kind: "personal" }>;
  ranked: readonly HomeRecommendationMatch[];
} | null {
  const candidates = jobs.map(matchCandidate);
  const profileMatches = rankJobsForCandidate(profile, candidates, now);
  const profileByJobId = new Map(
    profileMatches.map((match) => [match.candidate.id, match]),
  );
  const privateScoreByJobId = new Map(
    privateScores.map((score) => [score.jobId, score]),
  );
  const ranked = candidates
    .flatMap((candidate): HomeRecommendationMatch[] => {
      const cvScore = privateScoreByJobId.get(candidate.id);
      if (cvScore !== undefined) {
        const profileMatch = profileByJobId.get(candidate.id);
        const cvMatch =
          cvScore.checkId !== undefined &&
          cvScore.cvVersion !== undefined &&
          cvScore.jdVersion !== undefined
            ? {
                checkId: cvScore.checkId,
                cvVersion: cvScore.cvVersion,
                jdVersion: cvScore.jdVersion,
                completeness: cvScore.completeness,
                presentationState: cvScore.presentationState,
                scoreEligible: cvScore.scoreEligible,
              }
            : undefined;
        return [
          {
            candidate,
            score: cvScore.score,
            source: "cv",
            ...(cvMatch ? { cvMatch } : {}),
            matchingSkills: profileMatch?.matchingSkills ?? [],
            improvementAreas: profileMatch?.improvementAreas ?? [],
          },
        ];
      }
      const profileMatch = profileByJobId.get(candidate.id);
      return profileMatch
        ? [
            {
              candidate,
              score: profileMatch.matchScore,
              source: "profile",
              ...(profileMatch.matchBreakdown
                ? { breakdown: profileMatch.matchBreakdown }
                : {}),
              matchingSkills: profileMatch.matchingSkills,
              improvementAreas: profileMatch.improvementAreas,
            },
          ]
        : [];
    })
    .sort((left, right) => {
      const rightScore = right.score ?? -1;
      const leftScore = left.score ?? -1;
      if (rightScore !== leftScore) return rightScore - leftScore;
      if (left.source !== right.source) return left.source === "cv" ? -1 : 1;
      return (right.candidate.postedAt ?? "").localeCompare(
        left.candidate.postedAt ?? "",
      );
    })
    .slice(0, homeTrendingJobLimit);
  const best = ranked[0];
  if (!best) return null;
  return {
    insight: {
      kind: "personal",
      jobSlug: best.candidate.job.slug,
      jobTitle: best.candidate.job.title,
      score: best.score,
      presentationState:
        best.source === "cv"
          ? (privateScoreByJobId.get(best.candidate.id)?.presentationState ??
            "UNAVAILABLE")
          : "AVAILABLE",
      scoreEligible:
        best.source === "cv"
          ? (privateScoreByJobId.get(best.candidate.id)?.scoreEligible ?? false)
          : true,
      quality:
        best.score !== null &&
        best.score >= meaningfulMatchMinimumScore &&
        (best.source === "cv" || best.matchingSkills.length > 0)
          ? "meaningful"
          : "limited",
      scoreSource: best.source,
      ...(best.breakdown ? { matchBreakdown: best.breakdown } : {}),
      completeness:
        best.source === "cv"
          ? (privateScoreByJobId.get(best.candidate.id)?.completeness ??
            "UNAVAILABLE")
          : "AVAILABLE",
      ...(best.cvMatch ? { cvMatch: best.cvMatch } : {}),
      matchingSkills: best.matchingSkills,
      improvementAreas: best.improvementAreas,
      limitations:
        best.source === "profile" ? ["profileSignals", "estimate"] : [],
    },
    ranked,
  };
}

export async function getHomePageContext(
  overrides: Partial<HomeContextDependencies> = {},
): Promise<HomePageModel> {
  const defaults = defaultDependencies();
  const dependencies = {
    ...defaults,
    ...overrides,
    recommendationJobs:
      overrides.recommendationJobs ??
      (overrides.searchJobs
        ? overrides.searchJobs
        : defaults.recommendationJobs),
    privateMatchScores:
      overrides.privateMatchScores ??
      (overrides.searchJobs ? async () => [] : defaults.privateMatchScores),
    countCompanies:
      overrides.countCompanies ??
      (overrides.listCompanies ? undefined : defaults.countCompanies),
  };
  const now = dependencies.now();
  const publicDependencyOverride = [
    "searchJobs",
    "careerPaths",
    "listCompanies",
    "countCompanies",
  ].some((key) => key in overrides);
  const publicSnapshot =
    !publicDependencyOverride && !isPublicDiscoverySafetyFallbackActive()
      ? await loadDefaultHomePublicSnapshot(now)
      : await getHomePublicSnapshot(dependencies, now);
  const requestHeaders = await dependencies.requestHeaders();
  const current = await dependencies.session(requestHeaders).catch(() => null);
  const actor = current
    ? ({
        kind: "user",
        userId: current.userId,
        sessionId: current.sessionId,
      } as const)
    : ({ kind: "visitor" } as const);

  const publicJobs = publicSnapshotJobs(publicSnapshot);

  if (!current) {
    return {
      viewer: { kind: "guest" },
      initialLocale: "vi",
      careerPaths: publicSnapshot.careerPaths,
      jobs: publicJobs,
      spotlights: publicSnapshot.spotlights,
      companyCount: publicSnapshot.companyCount,
      smartMatch: illustrativeSmartMatch(),
    };
  }

  const [accountResult, recruiterResult, profileResult] =
    await Promise.allSettled([
      dependencies.account(current.userId),
      dependencies.recruiterStatus(current.userId),
      dependencies.profile(current.userId),
    ]);
  const account =
    accountResult.status === "fulfilled" ? accountResult.value : null;
  if (!account) {
    return {
      viewer: { kind: "guest" },
      initialLocale: "vi",
      careerPaths: publicSnapshot.careerPaths,
      jobs: publicJobs,
      spotlights: publicSnapshot.spotlights,
      companyCount: publicSnapshot.companyCount,
      smartMatch: illustrativeSmartMatch(),
    };
  }

  const recruiterStatus =
    recruiterResult.status === "fulfilled" ? recruiterResult.value : null;
  const employer = recruiterStatus?.state === "APPROVED";
  const profile =
    profileResult.status === "fulfilled" ? profileResult.value : null;
  const profileHasSignals = profile ? hasCandidateJobSignals(profile) : false;
  const [privateOverlayJobs, recommendationCandidates, privateScores] =
    await Promise.all([
      dependencies.searchJobs(actor).catch(() => []),
      !employer && profile
        ? dependencies.recommendationJobs!(actor).catch(() => [])
        : Promise.resolve([] as readonly JobCard[]),
      !employer && profile
        ? dependencies.privateMatchScores!(current.userId, now).catch(() => [])
        : Promise.resolve([] as readonly PrivateMatchHomeScore[]),
    ]);
  const recommendation =
    profile && recommendationCandidates.length
      ? personalMatch(profile, recommendationCandidates, now, privateScores)
      : null;
  const matchFallbackReason: HomeMatchFallbackReason | undefined =
    !employer && !profile
      ? "unavailable"
      : !employer && !profileHasSignals
        ? "profileSignals"
        : !employer && recommendationCandidates.length === 0
          ? "noOpportunities"
          : !employer && !recommendation
            ? "unavailable"
            : undefined;
  const jobs =
    publicSnapshot.jobs.status === "error"
      ? publicJobs
      : recommendation
        ? section(
            recommendation.ranked.map((match) =>
              projectJob(match.candidate.job, {
                score: match.score,
                source: match.source,
                ...(match.breakdown ? { breakdown: match.breakdown } : {}),
                ...(match.cvMatch ? { cvMatch: match.cvMatch } : {}),
              }),
            ),
          )
        : section(
            publicSnapshot.jobs.items.map((job) =>
              hydratePublicJob(
                job,
                privateOverlayJobs.find((overlay) => overlay.id === job.id)
                  ?.actions,
              ),
            ),
          );
  const base = {
    displayName: account.name.trim(),
    avatarUrl: account.image,
    csrfProof: dependencies.proof(current.sessionId),
    recruiterStatus,
  };

  return {
    viewer:
      employer && recruiterStatus
        ? { kind: "employer", ...base, recruiterStatus }
        : { kind: "candidate", ...base },
    initialLocale: account.language === "VI" ? "vi" : "en",
    careerPaths: publicSnapshot.careerPaths,
    jobs,
    spotlights: publicSnapshot.spotlights,
    companyCount: publicSnapshot.companyCount,
    smartMatch:
      recommendation?.insight ??
      (matchFallbackReason
        ? { kind: "illustrative", reason: matchFallbackReason }
        : illustrativeSmartMatch()),
  };
}
