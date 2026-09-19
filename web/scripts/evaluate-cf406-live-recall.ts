import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

type CaseKind = "exact" | "normalized" | "broad" | "location" | "zero";
type RecallCase = {
  id: string;
  kind: CaseKind;
  query: string;
  expectedIds: string[];
  actualIds: string[];
  recall: number;
};

const now = new Date("2026-08-01T08:00:00.000Z");
const visitor = { kind: "visitor" } as const;
const reportStem =
  process.env.CF406_RECALL_REPORT_STEM ??
  "candidate-first/phase-4/evidence/cf406-recall";

function recall(expectedIds: readonly string[], actualIds: readonly string[]) {
  if (!expectedIds.length) return actualIds.length ? 0 : 1;
  const actual = new Set(actualIds);
  return expectedIds.filter((id) => actual.has(id)).length / expectedIds.length;
}

async function main() {
  loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  const { assertTestDatabaseEnvironment } =
    await import("../tests/helpers/test-database-guard");
  const { prisma } = await import("@/backend/database/prisma");
  const { JobDiscoveryService } =
    await import("@/backend/services/jobs/job-discovery-service");
  const { createJobBoardDatabaseFixture, deleteJobBoardDatabaseFixture } =
    await import("../tests/helpers/job-board-database-fixture");
  assertTestDatabaseEnvironment();
  const fixture = await createJobBoardDatabaseFixture("cf406-recall", now, {
    includeSearchRankingFixtures: true,
  });
  try {
    const service = new JobDiscoveryService();
    const cases: Array<
      Pick<RecallCase, "id" | "kind" | "query" | "expectedIds">
    > = [
      {
        id: "exact-vietnamese-title",
        kind: "exact",
        query: fixture.jobs.active.title,
        expectedIds: [fixture.jobs.active.id],
      },
      {
        id: "normalized-no-diacritics",
        kind: "normalized",
        query: "lap trinh vien TypeScript",
        expectedIds: [fixture.jobs.active.id],
      },
      {
        id: "broad-engineer",
        kind: "broad",
        query: "Engineer",
        expectedIds: [fixture.rankingJobs!.electronicsEngineer.id],
      },
      {
        id: "location",
        kind: "location",
        query: "Hồ Chí Minh",
        expectedIds: [
          fixture.jobs.active.id,
          fixture.rankingJobs!.seoSpecialist.id,
          fixture.rankingJobs!.seoExecutive.id,
          fixture.rankingJobs!.electronicsEngineer.id,
          fixture.rankingJobs!.pythonDeveloper.id,
        ],
      },
      {
        id: "zero-result",
        kind: "zero",
        query: "phase4-no-such-role-zzzz",
        expectedIds: [],
      },
    ];
    const results: RecallCase[] = [];
    for (const testCase of cases) {
      const response = await service.search(
        {
          ...(testCase.kind === "location"
            ? { location: testCase.query }
            : { q: testCase.query }),
          limit: 50,
          sort: "RELEVANCE",
        },
        visitor,
        now,
      );
      const actualIds = response.items.map((item) => item.id);
      results.push({
        ...testCase,
        actualIds,
        recall: recall(testCase.expectedIds, actualIds),
      });
    }
    const exactNormalized = results.filter(
      (result) => result.kind === "exact" || result.kind === "normalized",
    );
    const broad = results.filter((result) => result.kind === "broad");
    const passed = results.every((result) => result.recall === 1);
    const artifact = {
      schemaVersion: "cf406-live-recall.v1",
      generatedAt: new Date().toISOString(),
      source: "isolated-postgresql-job-board-fixture",
      databaseName: process.env.TEST_DATABASE_NAME ?? "UNAVAILABLE",
      fixture: {
        seedNamespace: fixture.suffix,
        jobCount:
          Object.keys(fixture.jobs).length +
          Object.keys(fixture.rankingJobs ?? {}).length,
      },
      cases: results,
      metrics: {
        exactNormalizedRecall: exactNormalized.every(
          (result) => result.recall === 1,
        )
          ? 1
          : 0,
        broadRecall: broad.length
          ? Math.min(...broad.map((result) => result.recall))
          : 1,
        zeroResultCorrect:
          results.find((result) => result.kind === "zero")?.recall === 1,
      },
      status: passed ? "PASS" : "FAIL",
      limitations: [
        "Expected IDs are declared by the task-owned fixture; no result count is used as recall.",
        "This is a deterministic isolated-catalog recall gate, not a production traffic sample.",
      ],
    };
    const currentOutputPath = resolve(
      process.cwd(),
      `../docs/audits/${reportStem}.json`,
    );
    await mkdir(dirname(currentOutputPath), { recursive: true });
    await writeFile(
      currentOutputPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    const markdown = [
      "# CF-406 live discovery recall",
      "",
      `- Status: **${artifact.status}**`,
      `- Generated: ${artifact.generatedAt}`,
      `- Fixture jobs: ${artifact.fixture.jobCount}`,
      `- Exact/normalized recall: ${artifact.metrics.exactNormalizedRecall * 100}%`,
      `- Broad recall: ${artifact.metrics.broadRecall * 100}%`,
      `- Zero-result correctness: ${artifact.metrics.zeroResultCorrect ? "PASS" : "FAIL"}`,
      "",
      "| Case | Kind | Expected | Actual | Recall |",
      "| --- | --- | --- | --- | ---: |",
      ...results.map(
        (result) =>
          `| ${result.id} | ${result.kind} | ${result.expectedIds.length} | ${result.actualIds.length} | ${result.recall * 100}% |`,
      ),
      "",
      ...artifact.limitations.map(
        (limitation) => `- Limitation: ${limitation}`,
      ),
      "",
    ].join("\n");
    await writeFile(
      resolve(process.cwd(), `../docs/audits/${reportStem}.md`),
      markdown,
      "utf8",
    );
    if (!passed) throw new Error("CF-406 live recall gate failed");
  } finally {
    await deleteJobBoardDatabaseFixture(fixture);
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
