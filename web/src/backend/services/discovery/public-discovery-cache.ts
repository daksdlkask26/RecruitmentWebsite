import "server-only";

import { revalidateTag } from "next/cache";

export const PUBLIC_DISCOVERY_TAGS = {
  homeJobs: "public-home-jobs",
  homeCompanies: "public-home-companies",
  jobs: "public-jobs",
  companies: "public-companies",
} as const;

function isNextRequestCacheContextUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    /static generation store (?:is )?missing/iu.test(error.message)
  );
}

export type PublicDiscoveryInvalidationMode = "ordinary" | "safety";

// A worker can commit a safety-sensitive mutation outside a Next request
// context. In that case there is no request-scoped cache store to expire. We
// fail closed for the public Home projection until the process is restarted,
// rather than continuing to serve a potentially stale cached snapshot.
let publicDiscoverySafetyFallbackActive = false;

export function isPublicDiscoverySafetyFallbackActive(): boolean {
  return publicDiscoverySafetyFallbackActive;
}

/** Test-only reset for isolated unit suites. */
export function resetPublicDiscoverySafetyFallbackForTests(): void {
  publicDiscoverySafetyFallbackActive = false;
}

export function publicJobTags(jobId: string) {
  return [
    PUBLIC_DISCOVERY_TAGS.homeJobs,
    PUBLIC_DISCOVERY_TAGS.jobs,
    `public-job:${jobId}`,
  ] as const;
}

export function publicCompanyTags(companyId: string) {
  return [
    PUBLIC_DISCOVERY_TAGS.homeCompanies,
    PUBLIC_DISCOVERY_TAGS.companies,
    `public-company:${companyId}`,
    `public-company-jobs:${companyId}`,
    PUBLIC_DISCOVERY_TAGS.homeJobs,
  ] as const;
}

/**
 * Invalidate only public discovery projections, after the owning transaction
 * has committed. No user/session/CV/application identifier is ever accepted
 * as a cache key or tag.
 */
export function invalidatePublicDiscoveryTags(
  tags: readonly string[],
  options: { mode?: PublicDiscoveryInvalidationMode } = {},
): void {
  const mode = options.mode ?? "ordinary";
  for (const tag of new Set(tags)) {
    try {
      if (mode === "safety") revalidateTag(tag, { expire: 0 });
      else revalidateTag(tag, "max");
    } catch (error) {
      if (!isNextRequestCacheContextUnavailable(error)) throw error;
      if (mode === "safety") {
        publicDiscoverySafetyFallbackActive = true;
        continue;
      }
    }
  }
}

export function invalidatePublicJob(jobId: string): void {
  invalidatePublicDiscoveryTags(publicJobTags(jobId));
}

export function invalidatePublicJobSafety(jobId: string): void {
  invalidatePublicDiscoveryTags(publicJobTags(jobId), { mode: "safety" });
}

export function invalidatePublicCompany(companyId: string): void {
  invalidatePublicDiscoveryTags(publicCompanyTags(companyId));
}

export function invalidatePublicCompanySafety(companyId: string): void {
  invalidatePublicDiscoveryTags(publicCompanyTags(companyId), {
    mode: "safety",
  });
}

export function invalidatePublicHome(): void {
  invalidatePublicDiscoveryTags([
    PUBLIC_DISCOVERY_TAGS.homeJobs,
    PUBLIC_DISCOVERY_TAGS.homeCompanies,
  ]);
}

export function invalidatePublicHomeSafety(): void {
  invalidatePublicDiscoveryTags(
    [PUBLIC_DISCOVERY_TAGS.homeJobs, PUBLIC_DISCOVERY_TAGS.homeCompanies],
    { mode: "safety" },
  );
}
