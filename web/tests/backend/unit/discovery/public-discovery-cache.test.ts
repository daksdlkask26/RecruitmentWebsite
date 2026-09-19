import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));

import {
  PUBLIC_DISCOVERY_TAGS,
  invalidatePublicCompany,
  invalidatePublicCompanySafety,
  invalidatePublicDiscoveryTags,
  invalidatePublicJob,
  invalidatePublicJobSafety,
  isPublicDiscoverySafetyFallbackActive,
  publicCompanyTags,
  publicJobTags,
  resetPublicDiscoverySafetyFallbackForTests,
} from "@/backend/services/discovery/public-discovery-cache";

describe("public discovery cache tags", () => {
  it("uses only public domain tags and never private identifiers", () => {
    const jobTags = publicJobTags("job-1");
    const companyTags = publicCompanyTags("company-1");

    expect(jobTags).toEqual([
      PUBLIC_DISCOVERY_TAGS.homeJobs,
      PUBLIC_DISCOVERY_TAGS.jobs,
      "public-job:job-1",
    ]);
    expect(companyTags).toContain("public-company:company-1");
    expect(companyTags).toContain("public-company-jobs:company-1");
    expect(
      [...jobTags, ...companyTags].every(
        (tag) => !/user|session|cv|csrf/iu.test(tag),
      ),
    ).toBe(true);
  });

  it("deduplicates tags and invalidates exact public domains", () => {
    invalidatePublicDiscoveryTags([
      "public-jobs",
      "public-jobs",
      "public-companies",
    ]);
    expect(mocks.revalidateTag).toHaveBeenNthCalledWith(
      1,
      "public-jobs",
      "max",
    );
    expect(mocks.revalidateTag).toHaveBeenNthCalledWith(
      2,
      "public-companies",
      "max",
    );

    mocks.revalidateTag.mockClear();
    invalidatePublicJob("job-2");
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(3);

    mocks.revalidateTag.mockClear();
    invalidatePublicCompany("company-2");
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(5);
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      "public-company:company-2",
      "max",
    );
  });

  it("does not fail a worker mutation without a Next request cache store", () => {
    resetPublicDiscoverySafetyFallbackForTests();
    mocks.revalidateTag.mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing");
    });

    expect(() => invalidatePublicJob("job-worker-1")).not.toThrow();
    expect(isPublicDiscoverySafetyFallbackActive()).toBe(false);
  });

  it("uses immediate expiry for safety mutations and fails closed when no store exists", () => {
    resetPublicDiscoverySafetyFallbackForTests();
    mocks.revalidateTag.mockClear();
    invalidatePublicCompanySafety("company-safety-1");
    expect(mocks.revalidateTag).toHaveBeenNthCalledWith(
      1,
      "public-home-companies",
      { expire: 0 },
    );
    expect(mocks.revalidateTag).toHaveBeenNthCalledWith(5, "public-home-jobs", {
      expire: 0,
    });

    mocks.revalidateTag.mockReset();
    mocks.revalidateTag.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing");
    });
    expect(() => invalidatePublicJobSafety("job-safety-1")).not.toThrow();
    expect(isPublicDiscoverySafetyFallbackActive()).toBe(true);
  });
});
