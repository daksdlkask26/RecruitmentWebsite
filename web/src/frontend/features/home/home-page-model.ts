import type { RecruiterHeaderStatus } from "@/shared/contracts/recruiter-header-status";
import {
  careerPathSlugs,
  type CareerPathSlug,
} from "@/shared/contracts/jobs/career-paths";

export type HomeLocale = "vi" | "en";

export type HomeRecovery =
  | { kind: "reloadHome" }
  | { kind: "scoped"; source: "jobs" | "companies" };

export type HomeSectionState<T> =
  | { status: "ready"; items: readonly T[] }
  | { status: "loading"; items: readonly T[] }
  | { status: "empty"; items: readonly T[] }
  | { status: "error"; items: readonly T[]; recovery: HomeRecovery };

export type HomeViewer =
  | { kind: "guest" }
  | {
      kind: "candidate";
      displayName: string;
      avatarUrl: string | null;
      csrfProof: string;
      recruiterStatus: RecruiterHeaderStatus | null;
    }
  | {
      kind: "employer";
      displayName: string;
      avatarUrl: string | null;
      csrfProof: string;
      recruiterStatus: RecruiterHeaderStatus;
    };

export type HomeJobMatchBreakdown = Readonly<{
  roleAndSkills: number;
  preferences: number;
  experience: number;
  unmatched: number;
}>;

export type HomeMatchSource = "cv" | "profile";

export type HomeMatchFallbackReason =
  | "profileSignals"
  | "noOpportunities"
  | "unavailable";

export type HomeCvMatchReference = Readonly<{
  checkId: string;
  cvVersion: number;
  jdVersion: number;
  completeness: "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE";
  presentationState: "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE";
  scoreEligible: boolean;
}>;

export type HomeJobSalary = Readonly<{
  minimum: number;
  maximum: number;
  currency: string;
  period: "HOUR" | "MONTH" | "YEAR";
  isNegotiable?: boolean;
}>;

export type HomeJob = Readonly<{
  id: string;
  slug: string;
  title: string;
  companyName: string;
  companySlug: string;
  companyLogoUrl: string | null;
  companyDescription: string | null;
  location: string;
  workArrangement: "ONSITE" | "HYBRID" | "REMOTE";
  employmentType: string;
  skills: readonly string[];
  matchScore?: number;
  matchSource?: HomeMatchSource;
  matchBreakdown?: HomeJobMatchBreakdown;
  cvMatch?: HomeCvMatchReference;
  salary: HomeJobSalary | null;
  publishedAt: string;
  saved: boolean;
  canSave: boolean;
}>;

/**
 * The cacheable Home projection. It intentionally has no viewer, session,
 * action, match, or CSRF fields; request-private overlays are merged only in
 * the server composition boundary.
 */
export type HomePublicJob = Omit<
  HomeJob,
  | "saved"
  | "canSave"
  | "matchScore"
  | "matchSource"
  | "matchBreakdown"
  | "cvMatch"
>;

export type EmployerSpotlight = Readonly<{
  slug: string;
  name: string;
  logoUrl: string | null;
  publicSummary?: string;
  publicLocation?: string;
  industry?: string;
  size?: string;
  openPositionCount?: number;
  destination: { kind: "displayOnly" };
}>;

export type SmartMatchInsight =
  | Readonly<{
      kind: "personal";
      jobSlug: string;
      jobTitle: string;
      score: number | null;
      presentationState: "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE";
      scoreEligible: boolean;
      quality: "meaningful" | "limited";
      scoreSource: HomeMatchSource;
      matchBreakdown?: HomeJobMatchBreakdown;
      matchingSkills: readonly string[];
      improvementAreas: readonly string[];
      limitations: readonly ("profileSignals" | "estimate")[];
      completeness: "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE";
      cvMatch?: HomeCvMatchReference;
    }>
  | Readonly<{
      kind: "illustrative";
      reason?: HomeMatchFallbackReason;
    }>;

export type HomeCareerPath = Readonly<{
  slug: CareerPathSlug;
  openJobCount: number | null;
}>;

export type HomePageModel = Readonly<{
  viewer: HomeViewer;
  initialLocale: HomeLocale;
  careerPaths: readonly HomeCareerPath[];
  jobs: HomeSectionState<HomeJob>;
  spotlights: HomeSectionState<EmployerSpotlight>;
  companyCount: number | null;
  smartMatch: SmartMatchInsight;
}>;

export type HomePublicSnapshot = Readonly<{
  careerPaths: readonly HomeCareerPath[];
  jobs: HomeSectionState<HomePublicJob>;
  spotlights: HomeSectionState<EmployerSpotlight>;
  companyCount: number | null;
}>;

function hasOnlyKeys(value: object, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validScore(score: number) {
  return Number.isInteger(score) && score >= 0 && score <= 100;
}

function validCompleteness(
  value: unknown,
): value is "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE" {
  return (
    value === "AVAILABLE" || value === "INCOMPLETE" || value === "UNAVAILABLE"
  );
}

function validPresentation(
  value: unknown,
): value is "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE" {
  return validCompleteness(value);
}

function validBreakdown(breakdown: HomeJobMatchBreakdown) {
  const values = Object.values(breakdown);
  return (
    values.length === 4 &&
    values.every(validScore) &&
    values.reduce((total, value) => total + value, 0) === 100
  );
}

function validCareerPaths(paths: readonly HomeCareerPath[]) {
  return (
    paths.length === careerPathSlugs.length &&
    new Set(paths.map((path) => path.slug)).size === careerPathSlugs.length &&
    careerPathSlugs.every((slug) =>
      paths.some(
        (path) =>
          path.slug === slug &&
          (path.openJobCount === null ||
            (Number.isInteger(path.openJobCount) && path.openJobCount >= 0)),
      ),
    )
  );
}

export function validateHomePageModel(model: HomePageModel) {
  if (model.jobs.items.length > 6 || model.spotlights.items.length > 6)
    throw new Error("HOME_SECTION_LIMIT");
  if (
    model.companyCount !== null &&
    (!Number.isInteger(model.companyCount) || model.companyCount < 0)
  )
    throw new Error("HOME_COMPANY_COUNT_INVALID");
  if (!validCareerPaths(model.careerPaths))
    throw new Error("HOME_CAREER_PATHS_INVALID");
  const viewerKeys =
    model.viewer.kind === "guest"
      ? ["kind"]
      : ["kind", "displayName", "avatarUrl", "csrfProof", "recruiterStatus"];
  if (!hasOnlyKeys(model.viewer, viewerKeys))
    throw new Error("HOME_VIEWER_PRIVATE_FIELD");
  if (model.smartMatch.kind === "personal" && model.viewer.kind !== "candidate")
    throw new Error("HOME_PERSONAL_MATCH_AUTHORITY");
  if (model.smartMatch.kind === "personal") {
    const personal = model.smartMatch;
    if (!validPresentation(personal.presentationState))
      throw new Error("HOME_MATCH_PRESENTATION_INVALID");
    if (personal.scoreEligible !== (personal.presentationState === "AVAILABLE"))
      throw new Error("HOME_MATCH_SCORE_ELIGIBILITY");
    if (
      personal.scoreEligible &&
      (personal.score === null || !validScore(personal.score))
    )
      throw new Error("HOME_MATCH_SCORE_INVALID");
    if (!personal.scoreEligible && personal.score !== null)
      throw new Error("HOME_MATCH_SCORE_LEAK");
  }
  if (
    model.smartMatch.kind !== "personal" &&
    model.jobs.items.some(
      (job) => job.matchScore !== undefined || job.matchBreakdown !== undefined,
    )
  )
    throw new Error("HOME_JOB_SCORE_AUTHORITY");
  if (model.smartMatch.kind === "personal") {
    const personal = model.smartMatch;
    if (
      model.jobs.items.some((job) => {
        if (job.matchSource === undefined) return true;
        if (job.matchSource === "profile")
          return (
            job.matchScore === undefined ||
            !validScore(job.matchScore) ||
            !job.matchBreakdown ||
            !validBreakdown(job.matchBreakdown) ||
            job.cvMatch !== undefined
          );
        return (
          job.cvMatch === undefined ||
          job.matchBreakdown !== undefined ||
          (job.matchScore !== undefined && !validScore(job.matchScore)) ||
          (job.cvMatch !== undefined &&
            (!job.cvMatch.checkId ||
              job.cvMatch.cvVersion < 1 ||
              job.cvMatch.jdVersion < 1 ||
              !validCompleteness(job.cvMatch.completeness) ||
              !validPresentation(job.cvMatch.presentationState) ||
              job.cvMatch.scoreEligible !==
                (job.cvMatch.presentationState === "AVAILABLE") ||
              (job.cvMatch.scoreEligible && job.matchScore === undefined) ||
              (!job.cvMatch.scoreEligible && job.matchScore !== undefined)))
        );
      }) ||
      !model.jobs.items.some(
        (job) =>
          job.slug === personal.jobSlug &&
          (personal.score === null
            ? job.matchScore === undefined
            : job.matchScore === personal.score) &&
          job.matchSource === personal.scoreSource &&
          (personal.scoreSource !== "profile" ||
            JSON.stringify(job.matchBreakdown) ===
              JSON.stringify(personal.matchBreakdown)),
      )
    )
      throw new Error("HOME_JOB_SCORE_ASSOCIATION");
    if (!validCompleteness(personal.completeness))
      throw new Error("HOME_MATCH_COMPLETENESS_INVALID");
    if (
      personal.scoreSource === "cv" &&
      personal.cvMatch?.completeness !== personal.completeness
    )
      throw new Error("HOME_MATCH_COMPLETENESS_MISMATCH");
    if (
      personal.scoreSource === "cv" &&
      personal.cvMatch?.presentationState !== personal.presentationState
    )
      throw new Error("HOME_MATCH_PRESENTATION_MISMATCH");
  }
  if (
    model.spotlights.items.some(
      (company) =>
        company.destination.kind !== "displayOnly" ||
        !hasOnlyKeys(company, [
          "slug",
          "name",
          "logoUrl",
          "publicSummary",
          "publicLocation",
          "industry",
          "size",
          "openPositionCount",
          "destination",
        ]) ||
        !hasOnlyKeys(company.destination, ["kind"]),
    )
  )
    throw new Error("HOME_COMPANY_DESTINATION");
  for (const [source, state] of [
    ["jobs", model.jobs],
    ["companies", model.spotlights],
  ] as const) {
    if (
      state.status === "error" &&
      state.recovery.kind === "scoped" &&
      state.recovery.source !== source
    )
      throw new Error("HOME_RECOVERY_SCOPE");
    if (state.status !== "error" && "recovery" in state)
      throw new Error("HOME_RECOVERY_STATE");
  }
  return model;
}
