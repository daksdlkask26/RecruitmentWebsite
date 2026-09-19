import { describe, expect, it, vi } from "vitest";
import {
  getHomePageContext,
  type HomeContextDependencies,
} from "@/backend/services/home/get-home-page-context";
import {
  candidateProfile,
  homeCareerPaths,
  insufficientCandidateProfile,
  jobCard,
} from "../../../helpers/home/home-fixtures";

function candidateDeps(): HomeContextDependencies {
  return {
    requestHeaders: async () => new Headers(),
    session: async () => ({ userId: "candidate-1", sessionId: "session-1" }),
    searchJobs: async () => [jobCard()],
    careerPaths: async () => homeCareerPaths,
    listCompanies: async () => [],
    account: async () => ({ name: "An", image: null, language: "EN" }),
    profile: async () => candidateProfile(),
    recruiterStatus: async () => ({
      state: "NEVER_APPLIED",
      destinationKind: "EMPLOYER_VERIFICATION",
      href: "/dashboard/employer-verification",
      observedAt: "2026-08-12T00:00:00.000Z",
    }),
    proof: () => "proof",
    now: () => new Date("2026-08-12T00:00:00.000Z"),
  };
}

describe("Home Smart Match composition", () => {
  it("ranks every available job using genuine candidate fit data", async () => {
    const deps = candidateDeps();
    deps.searchJobs = async () => [
      jobCard(),
      jobCard({
        id: "job-2",
        slug: "rust-role",
        title: "Rust Developer",
        location: "Da Nang",
        skills: ["Rust"],
      }),
    ];
    const model = await getHomePageContext(deps);
    expect(model.smartMatch.kind).toBe("personal");
    expect(model.jobs.items).toHaveLength(2);
    expect(model.jobs.items.every((job) => job.matchScore !== undefined)).toBe(
      true,
    );
    expect(model.jobs.items[0]?.matchScore).toBeGreaterThanOrEqual(
      model.jobs.items[1]?.matchScore ?? 0,
    );
    expect(model.smartMatch).toMatchObject({
      jobSlug: model.jobs.items[0]?.slug,
      score: model.jobs.items[0]?.matchScore,
    });
    expect(
      model.smartMatch.kind === "personal" && model.smartMatch.matchBreakdown,
    ).toEqual(model.jobs.items[0]?.matchBreakdown);
  });

  it("selects the top six matches from the complete candidate job pool", async () => {
    const deps = candidateDeps();
    const unrelatedJobs = Array.from({ length: 8 }, (_, index) =>
      jobCard({
        id: `unrelated-${index}`,
        slug: `unrelated-${index}`,
        title: `Unrelated ${index}`,
        location: "Da Nang",
        skills: ["Rust"],
      }),
    );
    const bestJob = jobCard({
      id: "best-job",
      slug: "best-job",
      title: "TypeScript Developer",
      skills: ["TypeScript"],
    });
    deps.searchJobs = async () => [unrelatedJobs[0]!];
    deps.recommendationJobs = async () => [...unrelatedJobs, bestJob];

    const model = await getHomePageContext(deps);

    expect(model.jobs.items).toHaveLength(6);
    expect(model.jobs.items[0]?.slug).toBe("best-job");
  });

  it("uses a completed CV Match Check score for the same job", async () => {
    const deps = candidateDeps();
    const checkedJob = jobCard({
      id: "checked-job",
      slug: "checked-job",
      title: "Digital Marketing Manager",
      location: "Da Nang",
      skills: ["Marketing"],
    });
    deps.searchJobs = async () => [jobCard(), checkedJob];
    deps.recommendationJobs = async () => [jobCard(), checkedJob];
    deps.privateMatchScores = async () => [
      {
        jobId: "checked-job",
        score: 96,
        completeness: "AVAILABLE",
        presentationState: "AVAILABLE",
        scoreEligible: true,
        checkId: "pmc_checked-job",
        cvVersion: 2,
        jdVersion: 3,
      },
    ];

    const model = await getHomePageContext(deps);

    expect(model.jobs.items[0]).toMatchObject({
      slug: "checked-job",
      matchScore: 96,
      matchSource: "cv",
    });
    expect(model.jobs.items[0]?.matchBreakdown).toBeUndefined();
    expect(model.jobs.items[0]?.cvMatch).toEqual({
      checkId: "pmc_checked-job",
      cvVersion: 2,
      jdVersion: 3,
      completeness: "AVAILABLE",
      presentationState: "AVAILABLE",
      scoreEligible: true,
    });
    expect(model.smartMatch).toMatchObject({
      kind: "personal",
      jobSlug: "checked-job",
      score: 96,
      scoreSource: "cv",
    });
  });
  it("falls back to illustration when profile signals or computation are unavailable", async () => {
    const insufficient = candidateDeps();
    insufficient.profile = async () => insufficientCandidateProfile();
    expect((await getHomePageContext(insufficient)).smartMatch.kind).toBe(
      "illustrative",
    );
    const unavailable = candidateDeps();
    unavailable.profile = vi.fn().mockRejectedValue(new Error("unavailable"));
    const model = await getHomePageContext(unavailable);
    expect(model.smartMatch.kind).toBe("illustrative");
    expect(model.jobs.items.every((job) => job.matchScore === undefined)).toBe(
      true,
    );
  });
});
