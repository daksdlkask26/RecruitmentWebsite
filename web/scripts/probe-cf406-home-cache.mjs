import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const reportPath = resolve(
  process.cwd(),
  "../docs/audits/candidate-first/phase-4/evidence/cf406-cache.json",
);
const authoritativeCf403Path = resolve(
  process.cwd(),
  "../docs/audits/candidate-first/phase-4/evidence/cf403-authoritative-invalidation.json",
);

function instrumentPrototype(prototype, scope, calls) {
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor || typeof descriptor.value !== "function") continue;
    const original = descriptor.value;
    Object.defineProperty(prototype, name, {
      ...descriptor,
      value: function instrumentedPublicRepositoryMethod(...args) {
        calls.push({ scope, method: name });
        return original.apply(this, args);
      },
    });
  }
}

function publicCallCount(calls) {
  return calls.length;
}

function publicProjection(model) {
  return JSON.stringify({
    jobs: model.jobs,
    spotlights: model.spotlights,
    companyCount: model.companyCount,
    careerPaths: model.careerPaths,
  });
}

async function main() {
  const { assertTestDatabaseEnvironment } =
    await import("../tests/helpers/test-database-guard.ts");
  assertTestDatabaseEnvironment();
  const { prisma } = await import("../src/backend/database/prisma.ts");
  const { getHomePageContext } =
    await import("../src/backend/services/home/get-home-page-context.ts");
  const { PrismaPublicJobRepository } =
    await import("../src/backend/repositories/jobs/prisma-public-job-repository.ts");
  const { PrismaHomePublicCompanyRepository } =
    await import("../src/backend/repositories/home/prisma-home-public-company-repository.ts");
  const { createJobBoardDatabaseFixture, deleteJobBoardDatabaseFixture } =
    await import("../tests/helpers/job-board-database-fixture.ts");

  const calls = [];
  instrumentPrototype(
    PrismaPublicJobRepository.prototype,
    "PrismaPublicJobRepository",
    calls,
  );
  instrumentPrototype(
    PrismaHomePublicCompanyRepository.prototype,
    "PrismaHomePublicCompanyRepository",
    calls,
  );

  const fixture = await createJobBoardDatabaseFixture(
    "cf406-cache-final",
    new Date(Date.now() - 24 * 60 * 60_000),
  );
  try {
    const invoke = async () => {
      const startedAt = performance.now();
      const before = calls.length;
      const model = await getHomePageContext({
        requestHeaders: async () => new Headers(),
        session: async () => null,
      });
      const afterCalls = calls.slice(before);
      return {
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        publicRepositoryCalls: publicCallCount(afterCalls),
        publicRepositoryMethods: afterCalls,
        projection: publicProjection(model),
      };
    };

    calls.length = 0;
    const cold = await invoke();
    const warmReads = [];
    for (let index = 0; index < 20; index += 1) {
      warmReads.push(await invoke());
    }
    const warmHits = warmReads.filter(
      (read) => read.publicRepositoryCalls === 0,
    );
    const trueHitNonZeroCalls = warmHits.filter(
      (read) => read.publicRepositoryCalls !== 0,
    ).length;
    const warmProjectionStable = warmReads.every(
      (read) => read.projection === cold.projection,
    );
    const warmHitRate = warmReads.length
      ? warmHits.length / warmReads.length
      : 0;

    const authoritativeCf403 = JSON.parse(
      await readFile(authoritativeCf403Path, "utf8"),
    );
    const firstReadResults = authoritativeCf403.results.filter(
      (result) => result.firstReadAfterCommit,
    );
    const firstReadAfterMutation =
      authoritativeCf403.schemaVersion ===
        "candidate-first-cf403-authoritative-final-v2" &&
      authoritativeCf403.method?.proofQuality ===
        "independent-authoritative-route-and-worker" &&
      authoritativeCf403.generatedAt &&
      firstReadResults.length > 0 &&
      firstReadResults.every((result) => result.status === "PASS") &&
      Object.values(authoritativeCf403.assessment).every(
        (status) => status === "PASS",
      )
        ? "PASS"
        : "UNVERIFIED";

    const assessment = {
      warmHitRate: warmHitRate >= 0.9 ? "PASS" : "FAIL",
      zeroPublicRepositoryCallsOnTrueHit:
        trueHitNonZeroCalls === 0 ? "PASS" : "FAIL",
      warmProjectionStable: warmProjectionStable ? "PASS" : "FAIL",
      firstReadAfterMutation,
    };
    const artifact = {
      schemaVersion: "candidate-first-cf406-home-cache-final-v2",
      generatedAt: new Date().toISOString(),
      command:
        "node --conditions=react-server --import tsx scripts/probe-cf406-home-cache.mjs",
      environment: {
        runtime:
          "source-final Home composer in an isolated production-configured Node process",
        database: process.env.TEST_DATABASE_NAME,
        databaseIsolation: "task-owned isolated PostgreSQL database",
        cacheKey: "nextgen-careers-home-public-snapshot-v3:<watermark>",
        warmSamples: warmReads.length,
        publicRepositoryInstrumentation:
          "wrapping the real public repository prototypes; no repository or mutation mock",
        authoritativeMutationEvidence:
          "docs/audits/candidate-first/phase-4/evidence/cf403-authoritative-invalidation.json",
      },
      measurements: {
        cold,
        warmReads,
        warmHits: warmHits.length,
        warmHitRate,
        trueHitNonZeroCalls,
      },
      assessment,
      limitations: [
        "The warm-hit probe invokes the production Home composer directly so repository calls can be observed at the real class boundary; mutation-to-read timing is accepted only from the v2 independent authoritative CF-403 proof.",
        "A true hit is defined as the source-final cached public snapshot returning the same projection with zero calls to either public repository prototype.",
      ],
    };
    await mkdir(
      resolve(process.cwd(), "../docs/audits/candidate-first/phase-4/evidence"),
      { recursive: true },
    );
    await writeFile(
      reportPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      reportPath.replace(/\.json$/u, ".md"),
      [
        "# CF-406 Home cache final verification",
        "",
        `- Generated: ${artifact.generatedAt}`,
        `- Database: ${artifact.environment.database}`,
        `- Warm samples: ${warmReads.length}`,
        `- Warm-hit rate: **${(warmHitRate * 100).toFixed(1)}%**`,
        `- Zero public repository calls on true hit: **${assessment.zeroPublicRepositoryCallsOnTrueHit}**`,
        `- First read after authoritative safety mutation: **${firstReadAfterMutation}**`,
        "",
        ...artifact.limitations.map(
          (limitation) => `- Limitation: ${limitation}`,
        ),
        "",
      ].join("\n"),
      "utf8",
    );
    if (Object.values(assessment).some((status) => status !== "PASS")) {
      throw new Error("CF-406 home cache gate failed");
    }
  } finally {
    await deleteJobBoardDatabaseFixture(fixture);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
