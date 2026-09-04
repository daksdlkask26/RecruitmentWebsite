import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSearchQuery } from "@/backend/services/search/search-query-resolver";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

describe.skipIf(!databaseAvailable)("PostgreSQL public job search", () => {
  let fixture: Awaited<
    ReturnType<
      typeof import("../../../helpers/job-board-database-fixture").createJobBoardDatabaseFixture
    >
  >;
  let repository: InstanceType<
    typeof import("@/backend/repositories/jobs/prisma-public-job-repository").PrismaPublicJobRepository
  >;
  let rankingFixture: typeof fixture;

  beforeAll(async () => {
    const helpers = await import("../../../helpers/job-board-database-fixture");
    const repositoryModule =
      await import("@/backend/repositories/jobs/prisma-public-job-repository");
    // Keep this fixture at the front of NEWEST even when a developer database
    // already contains the large synthetic performance corpus.
    fixture = await helpers.createJobBoardDatabaseFixture(
      "search",
      new Date("2099-08-01T08:00:00.000Z"),
    );
    rankingFixture = await helpers.createJobBoardDatabaseFixture(
      "search-ranking",
      fixture.now,
      { includeSearchRankingFixtures: true },
    );
    repository = new repositoryModule.PrismaPublicJobRepository();
  });

  afterAll(async () => {
    const helpers = await import("../../../helpers/job-board-database-fixture");
    if (fixture) await helpers.deleteJobBoardDatabaseFixture(fixture);
    if (rankingFixture)
      await helpers.deleteJobBoardDatabaseFixture(rankingFixture);
  });

  it("returns only active approved in-window postings", async () => {
    const result = await repository.search(
      {
        normalizedQuery: "",
        normalizedLocation: "",
        normalizedSkills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "NEWEST",
        limit: 20,
      },
      null,
      fixture.now,
    );
    const fixtureRows = result.rows.filter(
      (row) => row.companyId === fixture.company.id,
    );
    expect(fixtureRows.map((row) => row.id).sort()).toEqual(
      [fixture.jobs.active.id, fixture.jobs.activeSecond.id].sort(),
    );
  });

  it("exposes every candidate-visible posting to server-side recommendations", async () => {
    const rows = await repository.findPublicRecommendationCandidates(
      fixture.userIds[0]!,
      fixture.now,
    );
    const fixtureRows = rows.filter(
      (row) => row.companyId === fixture.company.id,
    );

    expect(fixtureRows.map((row) => row.id).sort()).toEqual(
      [fixture.jobs.active.id, fixture.jobs.activeSecond.id].sort(),
    );
  });

  it("matches Vietnamese text without case or diacritics and applies filters", async () => {
    const result = await repository.search(
      {
        normalizedQuery: "lap trinh vien",
        normalizedLocation: "ho chi minh",
        normalizedSkills: ["typescript"],
        employmentType: ["FULL_TIME"],
        experienceLevel: ["MID"],
        workArrangement: ["HYBRID"],
        salaryMin: 30_000_000,
        salaryMax: 50_000_000,
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "RELEVANCE",
        limit: 20,
      },
      fixture.userIds[0]!,
      fixture.now,
    );
    const fixtureRows = result.rows.filter(
      (row) => row.companyId === fixture.company.id,
    );
    expect(fixtureRows).toHaveLength(1);
    expect(fixtureRows[0]?.id).toBe(fixture.jobs.active.id);
    expect(fixtureRows[0]?.title).toBe("Lập trình viên TypeScript");
  });

  it("searches skills and accent-insensitive company names from the free-text field", async () => {
    const skillResult = await repository.search(
      {
        normalizedQuery: "typescript",
        searchBy: "BOTH",
        normalizedLocation: "",
        normalizedSkills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "NEWEST",
        limit: 20,
      },
      null,
      fixture.now,
    );
    expect(
      skillResult.rows.filter((row) => row.companyId === fixture.company.id),
    ).toHaveLength(2);

    const companyResult = await repository.search(
      {
        normalizedQuery: "cong ty smarthire",
        searchBy: "COMPANY",
        normalizedLocation: "",
        normalizedSkills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "NEWEST",
        limit: 20,
      },
      null,
      fixture.now,
    );
    expect(
      companyResult.rows.filter((row) => row.companyId === fixture.company.id),
    ).toHaveLength(2);
  });

  it("keeps an exact title identity above the broader occupation branch", async () => {
    const resolved = resolveSearchQuery("SEO Specialist", "JOBS", "en");
    const result = await repository.search(
      {
        normalizedQuery: resolved.normalizedQuery,
        searchVariants: resolved.variants,
        searchIntent: resolved.intent,
        searchBy: "BOTH",
        normalizedLocation: "",
        normalizedSkills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "RELEVANCE",
        limit: 20,
      },
      null,
      rankingFixture.now,
    );
    const rankingRows = result.rows.filter(
      (row) => row.companyId === rankingFixture.company.id,
    );

    expect(rankingRows[0]?.title).toBe("SEO Specialist");
    expect(rankingRows.map((row) => row.title)).not.toContain(
      "Electronics Engineer",
    );
  });

  it("keeps nonsense queries empty and paginates deterministic pages", async () => {
    const nonsense = await repository.search(
      {
        normalizedQuery: "qwertyuiop",
        normalizedLocation: "",
        normalizedSkills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "RELEVANCE",
        limit: 20,
      },
      null,
      fixture.now,
    );
    expect(
      nonsense.rows.filter((row) => row.companyId === fixture.company.id),
    ).toHaveLength(0);

    const pageInput = {
      normalizedQuery: "typescript",
      companyId: fixture.company.id,
      normalizedLocation: "",
      normalizedSkills: [],
      employmentType: [],
      experienceLevel: [],
      workArrangement: [],
      salaryCurrency: "VND" as const,
      salaryPeriod: "MONTH" as const,
      sort: "NEWEST" as const,
      limit: 1,
    };
    const pageOne = await repository.search(
      { ...pageInput, page: 1 },
      null,
      fixture.now,
    );
    const pageTwo = await repository.search(
      { ...pageInput, page: 2 },
      null,
      fixture.now,
    );
    const pageThree = await repository.search(
      { ...pageInput, page: 3 },
      null,
      fixture.now,
    );
    const fixtureIds = [pageOne, pageTwo, pageThree].flatMap((page) =>
      page.rows
        .filter((row) => row.companyId === fixture.company.id)
        .map((row) => row.id),
    );
    expect(fixtureIds).toHaveLength(2);
    expect(new Set(fixtureIds).size).toBe(fixtureIds.length);
    expect(new Set(fixtureIds)).toEqual(
      new Set([fixture.jobs.active.id, fixture.jobs.activeSecond.id]),
    );
    expect(fixtureIds).toEqual([
      fixture.jobs.activeSecond.id,
      fixture.jobs.active.id,
    ]);
  });

  it("matches location terms regardless of the order entered by the visitor", async () => {
    const result = await repository.search(
      {
        normalizedQuery: "",
        normalizedLocation: "minh chi ho",
        normalizedSkills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "NEWEST",
        limit: 20,
      },
      null,
      fixture.now,
    );
    const fixtureRows = result.rows.filter(
      (row) => row.companyId === fixture.company.id,
    );
    expect(fixtureRows.map((row) => row.id)).toEqual([fixture.jobs.active.id]);
  });

  it("matches the denormalized shared taxonomy fields on a public job", async () => {
    const result = await repository.search(
      {
        normalizedQuery: "",
        normalizedLocation: "",
        normalizedSkills: [],
        categoryFamily: ["r03"],
        categoryIds: ["r03-software-development"],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "NEWEST",
        limit: 20,
      },
      null,
      fixture.now,
    );
    const fixtureRows = result.rows.filter(
      (row) => row.companyId === fixture.company.id,
    );
    expect(fixtureRows.map((row) => row.id).sort()).toEqual(
      [fixture.jobs.active.id, fixture.jobs.activeSecond.id].sort(),
    );
  });

  it("ranks SEO Specialist ahead of SEO Executive and excludes electronics from the SEO result set", async () => {
    const resolved = resolveSearchQuery("chuyên viên SEO", "JOBS", "vi");
    const result = await repository.search(
      {
        normalizedQuery: resolved.normalizedQuery,
        searchVariants: resolved.variants,
        searchIntent: resolved.intent,
        searchBy: "BOTH",
        normalizedLocation: "",
        normalizedSkills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "RELEVANCE",
        limit: 20,
      },
      null,
      rankingFixture.now,
    );
    const rankingRows = result.rows.filter(
      (row) => row.companyId === rankingFixture.company.id,
    );

    expect(rankingRows.map((row) => row.title)).toEqual([
      "SEO Specialist",
      "SEO Executive",
    ]);
    expect(rankingRows.slice(0, 3).map((row) => row.title)).not.toContain(
      "Electronics Engineer",
    );
  });

  it("keeps a corrected Python skill as an AND signal for an occupation query", async () => {
    const resolved = resolveSearchQuery("lập trình viên pyhton", "JOBS", "vi");
    const result = await repository.search(
      {
        normalizedQuery: resolved.normalizedQuery,
        searchVariants: resolved.variants,
        searchIntent: resolved.intent,
        searchBy: "BOTH",
        normalizedLocation: "",
        normalizedSkills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
        salaryCurrency: "VND",
        salaryPeriod: "MONTH",
        sort: "RELEVANCE",
        limit: 20,
      },
      null,
      rankingFixture.now,
    );
    const rankingRows = result.rows.filter(
      (row) => row.companyId === rankingFixture.company.id,
    );

    expect(rankingRows.map((row) => row.title)).toEqual(["Python Developer"]);
    expect(resolved.intent?.skills).toContain("skill-python");
  });
});
