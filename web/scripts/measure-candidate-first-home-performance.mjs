import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/backend/generated/prisma/client.ts";

const envFile = process.env.CF004_ENV_FILE
  ? resolve(process.cwd(), process.env.CF004_ENV_FILE)
  : resolve(process.cwd(), ".env.local");
loadEnvironment({ path: envFile, quiet: true });

const { assertTestDatabaseEnvironment } =
  await import("../tests/helpers/test-database-guard.ts");
assertTestDatabaseEnvironment();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.parseInt(process.env.CF004_POOL_MAX ?? "10", 10),
  application_name: "candidate-first-cf004-home",
});
const originalConnect = pool.connect.bind(pool);
const poolWaits = [];
pool.connect = (...args) => {
  const startedAt = performance.now();
  // pg-pool exposes both a Promise overload and a callback overload. Prisma
  // uses `pool.query`, which internally takes the callback path; preserving
  // both signatures keeps the probe observational and avoids changing pool
  // semantics while recording checkout wait.
  if (typeof args[0] === "function") {
    const callback = args[0];
    return originalConnect((error, client, release) => {
      if (!error) poolWaits.push(performance.now() - startedAt);
      callback(error, client, release);
    });
  }
  return originalConnect(...args).then((client) => {
    poolWaits.push(performance.now() - startedAt);
    return client;
  });
};

const queryEvents = [];
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: [{ emit: "event", level: "query" }],
  transactionOptions: { maxWait: 5_000, timeout: 15_000 },
});
prisma.$on("query", (event) => {
  queryEvents.push({
    durationMs: event.duration,
    classification: classifyQuery(event.query),
  });
});
globalThis.prisma = prisma;

const { createJobBoardDatabaseFixture, deleteJobBoardDatabaseFixture } =
  await import("../tests/helpers/job-board-database-fixture.ts");
const { getHomePageContext } =
  await import("../src/backend/services/home/get-home-page-context.ts");

const sampleCount = Number.parseInt(process.env.CF004_SAMPLES ?? "20", 10);
const concurrentWidth = Number.parseInt(
  process.env.CF004_CONCURRENCY ?? "10",
  10,
);
const jobsToSeed = Number.parseInt(process.env.CF004_JOBS ?? "1000", 10);
const phase = process.env.CF004_PHASE ?? "post-change";
const now = new Date();
const reportPath = resolve(
  process.cwd(),
  "..",
  process.env.CF004_REPORT_FILE ??
    "docs/audits/candidate-first/phase-4/evidence/cf401-performance-current.json",
);
const markdownPath = reportPath.replace(/\.json$/u, ".md");
const databaseName = (() => {
  try {
    return decodeURIComponent(
      new URL(process.env.DATABASE_URL ?? "").pathname.slice(1),
    );
  } catch {
    return "unknown-test-database";
  }
})();
const fixture = await createJobBoardDatabaseFixture(
  `cf004-home-${Date.now()}`,
  now,
);
const jobPrefix = `cf004-home-job-${fixture.suffix}-`;

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

function stats(values) {
  return {
    samples: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max(...values, 0),
  };
}

function classifyQuery(query) {
  if (
    /PrivateCvMatch|privateCvMatch|SavedJob|JobApplication|CandidateProfile|Session|UserAccount|Recruiter/iu.test(
      query ?? "",
    )
  ) {
    return "private";
  }
  if (/JobPosting|JobSearchProjection|Company|company/iu.test(query ?? "")) {
    return "public";
  }
  return "shared";
}

function modelBytes(model) {
  return Buffer.byteLength(JSON.stringify(model), "utf8");
}

function queryClassCounts(events) {
  return events.reduce(
    (counts, event) => {
      counts[event.classification] = (counts[event.classification] ?? 0) + 1;
      return counts;
    },
    { public: 0, private: 0, shared: 0 },
  );
}

async function homeFor(role) {
  const session =
    role === "guest"
      ? null
      : {
          userId:
            role === "candidate" ? fixture.userIds[0] : fixture.userIds[1],
          sessionId: `cf004-session-${role}-${fixture.suffix}`,
        };
  return getHomePageContext({
    requestHeaders: async () => new Headers(),
    session: async () => session,
    proof: () => "cf004-test-proof",
  });
}

async function measureSequential(role) {
  // Keep the first request separate so a warm cache hit cannot hide miss/cold
  // latency. The harness runs against one isolated test process/database.
  queryEvents.length = 0;
  poolWaits.length = 0;
  const firstStartedAt = performance.now();
  const firstModel = await homeFor(role);
  const firstEvents = [...queryEvents];
  const firstRead = {
    latencyMs: performance.now() - firstStartedAt,
    queryCount: firstEvents.length,
    queryClasses: queryClassCounts(firstEvents),
    poolWaitMs: poolWaits.reduce((total, wait) => total + wait, 0),
    modelBytes: modelBytes(firstModel),
  };

  // Warm the route and prepared statements, then reset evidence counters.
  await homeFor(role);
  queryEvents.length = 0;
  poolWaits.length = 0;
  const latencies = [];
  const queryCounts = [];
  const queryDurations = [];
  const waits = [];
  const payloadBytes = [];
  const queryClasses = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const beforeQueries = queryEvents.length;
    const beforeWaits = poolWaits.length;
    const startedAt = performance.now();
    const model = await homeFor(role);
    const events = queryEvents.slice(beforeQueries);
    latencies.push(performance.now() - startedAt);
    queryCounts.push(events.length);
    queryDurations.push(
      events.reduce((total, event) => total + event.durationMs, 0),
    );
    waits.push(
      poolWaits.slice(beforeWaits).reduce((total, wait) => total + wait, 0),
    );
    payloadBytes.push(modelBytes(model));
    queryClasses.push(queryClassCounts(events));
  }
  const cacheHits = queryCounts.filter((count) => count === 0).length;
  return {
    firstRead,
    latency: stats(latencies),
    queryCount: stats(queryCounts),
    queryDuration: stats(queryDurations),
    poolWaitMs: stats(waits),
    payloadBytes: stats(payloadBytes),
    cacheHits,
    cacheHitRate: latencies.length ? cacheHits / latencies.length : 0,
    queryClasses: queryClasses.reduce(
      (total, current) => ({
        public: total.public + current.public,
        private: total.private + current.private,
        shared: total.shared + current.shared,
      }),
      { public: 0, private: 0, shared: 0 },
    ),
    errors: 0,
  };
}

async function measureConcurrent(role) {
  await homeFor(role);
  queryEvents.length = 0;
  poolWaits.length = 0;
  const latencies = [];
  const waitingCounts = [];
  const errors = [];
  const payloadBytes = [];
  const queryClasses = [];
  for (
    let round = 0;
    round < Math.max(3, Math.ceil(sampleCount / 2));
    round += 1
  ) {
    const beforeQueries = queryEvents.length;
    let peakWaiting = pool.waitingCount;
    const sampler = setInterval(() => {
      peakWaiting = Math.max(peakWaiting, pool.waitingCount);
    }, 1);
    const startedAt = performance.now();
    const results = await Promise.allSettled(
      Array.from({ length: concurrentWidth }, () => homeFor(role)),
    );
    clearInterval(sampler);
    latencies.push(performance.now() - startedAt);
    waitingCounts.push(peakWaiting);
    errors.push(...results.filter((result) => result.status === "rejected"));
    for (const result of results) {
      if (result.status === "fulfilled")
        payloadBytes.push(modelBytes(result.value));
    }
    queryClasses.push(queryClassCounts(queryEvents.slice(beforeQueries)));
  }
  return {
    width: concurrentWidth,
    batchLatency: stats(latencies),
    peakPoolWaiting: stats(waitingCounts),
    poolWaitMs: stats(poolWaits),
    payloadBytes: stats(payloadBytes),
    queryClasses: queryClasses.reduce(
      (total, current) => ({
        public: total.public + current.public,
        private: total.private + current.private,
        shared: total.shared + current.shared,
      }),
      { public: 0, private: 0, shared: 0 },
    ),
    queryEvents: queryEvents.length,
    errorCount: errors.length,
  };
}

const jobs = Array.from({ length: jobsToSeed }, (_, index) => ({
  id: `${jobPrefix}${String(index).padStart(4, "0")}`,
  companyId: fixture.company.id,
  slug: `${jobPrefix}${String(index).padStart(4, "0")}`,
  title: `TypeScript Platform Engineer ${index + 1}`,
  normalizedTitle: `typescript platform engineer ${index + 1}`,
  summary: "Build accessible recruitment products.",
  description: "Create production-grade web experiences.",
  responsibilities: "Design, implement, test, and review.",
  requirements: "Strong TypeScript fundamentals.",
  benefits: "Flexible work and a learning budget.",
  location: index % 2 ? "Da Nang" : "Ho Chi Minh",
  normalizedLocation: index % 2 ? "da nang" : "ho chi minh",
  employmentType: "FULL_TIME",
  experienceLevel: "MID",
  workArrangement: index % 3 ? "HYBRID" : "REMOTE",
  searchDocumentNormalized: `typescript platform engineer ${index + 1} smarthire`,
  status: "ACTIVE",
  approvedAt: new Date(now.getTime() - 86_400_000),
  publishedAt: new Date(now.getTime() - 3_600_000),
  applicationDeadline: new Date(now.getTime() + 30 * 86_400_000),
  version: 1,
}));
await prisma.jobPosting.createMany({ data: jobs });
const publicJobCount = await prisma.jobPosting.count({
  where: {
    companyId: fixture.company.id,
    status: "ACTIVE",
    approvedAt: { not: null },
    publishedAt: { not: null, lte: now },
    applicationDeadline: { gt: now },
  },
});

const explainPath = resolve(
  process.cwd(),
  "..",
  "docs/audits/candidate-first/phase-4/evidence/cf406-query-plans.json",
);
const explainPlans = {};
async function captureExplain(name, sql, values = []) {
  const result = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    values,
  );
  explainPlans[name] = result.rows[0]?.["QUERY PLAN"] ?? [];
}

const candidateVisibleJobSql = `
  j."status" = 'ACTIVE'::"JobPostingStatus"
  AND j."approvedAt" IS NOT NULL
  AND j."publishedAt" IS NOT NULL AND j."publishedAt" <= $1
  AND (j."applicationDeadline" IS NULL OR j."applicationDeadline" > $1)
  AND c."verifiedAt" IS NOT NULL
  AND c."verificationState" = 'ACTIVE'::"CompanyVerificationState"
  AND c."verificationInactiveAt" IS NULL
  AND c."moderationState" = 'ACTIVE'::"CompanyModerationState"
`;
await captureExplain(
  "home-jobs",
  `SELECT j."id" FROM "JobPosting" j JOIN "Company" c ON c."id" = j."companyId" WHERE ${candidateVisibleJobSql} ORDER BY j."publishedAt" DESC, j."id" ASC LIMIT 6`,
  [now],
);
await captureExplain(
  "home-job-count",
  `SELECT COUNT(*)::int FROM "JobPosting" j JOIN "Company" c ON c."id" = j."companyId" WHERE ${candidateVisibleJobSql}`,
  [now],
);
await captureExplain(
  "company-list",
  `SELECT c."id" FROM "Company" c WHERE c."verifiedAt" IS NOT NULL AND c."verificationState" = 'ACTIVE'::"CompanyVerificationState" AND c."verificationInactiveAt" IS NULL AND c."moderationState" = 'ACTIVE'::"CompanyModerationState" AND EXISTS (SELECT 1 FROM "JobPosting" j WHERE j."companyId" = c."id" AND ${candidateVisibleJobSql}) ORDER BY c."verifiedAt" DESC, c."id" ASC LIMIT 6`,
  [now],
);
await captureExplain(
  "company-job-count",
  `SELECT COUNT(*)::int FROM "JobPosting" j JOIN "Company" c ON c."id" = j."companyId" WHERE ${candidateVisibleJobSql} AND c."id" = $2`,
  [now, fixture.company.id],
);
await captureExplain(
  "exact-job-detail",
  `SELECT j."id" FROM "JobPosting" j JOIN "Company" c ON c."id" = j."companyId" WHERE ${candidateVisibleJobSql} AND j."id" = $2`,
  [now, jobs[0].id],
);
await captureExplain(
  "broad-search",
  `SELECT j."id" FROM "JobPosting" j JOIN "Company" c ON c."id" = j."companyId" WHERE ${candidateVisibleJobSql} AND j."searchDocumentNormalized" LIKE $2 ORDER BY j."publishedAt" DESC, j."id" ASC LIMIT 50`,
  [now, "%typescript%"],
);
await captureExplain(
  "normalized-short-token-search",
  `SELECT j."id" FROM "JobPosting" j JOIN "Company" c ON c."id" = j."companyId" WHERE ${candidateVisibleJobSql} AND j."normalizedTitle" LIKE $2 ORDER BY j."publishedAt" DESC, j."id" ASC LIMIT 50`,
  [now, "%type%"],
);
await captureExplain(
  "filtered-search",
  `SELECT j."id" FROM "JobPosting" j JOIN "Company" c ON c."id" = j."companyId" WHERE ${candidateVisibleJobSql} AND j."workArrangement" = 'REMOTE'::"WorkArrangement" ORDER BY j."publishedAt" DESC, j."id" ASC LIMIT 50`,
  [now],
);

const roles = {};
for (const role of ["guest", "candidate", "employer"]) {
  roles[role] = {
    sequential: await measureSequential(role),
    concurrent: await measureConcurrent(role),
  };
}

const result = {
  schemaVersion: "candidate-first-cf004-home-performance-v2",
  phase,
  generatedAt: new Date().toISOString(),
  commit: process.env.CF004_COMMIT ?? "unknown",
  command:
    "npm run phase4:home:measure (CF004_ENV_FILE, CF004_JOBS, CF004_SAMPLES, CF004_CONCURRENCY)",
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: cpus().length,
    database: databaseName,
    poolMax: pool.options.max,
    sampleCount,
    concurrentWidth,
  },
  seed: {
    namespace: fixture.suffix,
    companyId: fixture.company.id,
    createdJobs: jobsToSeed,
    activePublicJobsInNamespace: publicJobCount,
    cleanup: "deleteJobBoardDatabaseFixture plus namespace job delete",
  },
  roles,
  explain: {
    artifact:
      "docs/audits/candidate-first/phase-4/evidence/cf406-query-plans.json",
    plans: explainPlans,
  },
  cache: {
    publicSnapshot:
      "unstable_cache revalidate=30 tagged public-home-jobs/public-home-companies",
    hitDefinition: "sequential sample with zero database query events",
    warmedUnchangedPublicSnapshotHitRate: roles.guest.sequential.cacheHitRate,
  },
  comparison:
    phase === "pre-change"
      ? {
          status: "BASELINE",
          sourceCommit: process.env.CF004_COMMIT ?? "unknown",
          sourcePath:
            "task-owned baseline copy created from the starting commit; no shared worktree reset",
        }
      : {
          preChange: {
            status: "UNVERIFIED",
            reason:
              "The pre-change artifact is retained separately; compare the same-run seed/configuration before declaring a regression budget PASS.",
            artifact:
              "docs/audits/candidate-first/phase-4/evidence/cf401-performance-baseline.json",
          },
        },
  limitations: [
    "Pool wait is measured at the pg.Pool checkout boundary with an isolated test pool.",
    "Browser navigation timing is recorded separately by the Home Playwright performance spec.",
    "No shared or production database was mutated.",
  ],
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(
  explainPath,
  `${JSON.stringify(
    {
      schemaVersion: "candidate-first-cf406-query-plans-v1",
      generatedAt: result.generatedAt,
      commit: result.commit,
      database: result.environment.database,
      seed: result.seed,
      plans: explainPlans,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
const markdown = [
  "# CF-401 Home performance (current run)",
  "",
  `- Generated: ${result.generatedAt}`,
  `- Phase: ${result.phase}`,
  `- Commit: ${result.commit}`,
  `- Database: ${result.environment.database} (isolated test endpoint)`,
  `- Seed: ${result.seed.createdJobs} jobs; namespace ${result.seed.namespace}`,
  `- Samples: ${sampleCount} sequential; concurrency ${concurrentWidth}`,
  "",
  "## Measurements",
  "",
  "| Role | First p95 (ms) | Warm p95 (ms) | Warm query p95 | Warm payload p95 (bytes) | Cache hit rate | Errors |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...Object.entries(roles).map(
    ([role, value]) =>
      `| ${role} | ${value.sequential.firstRead.latencyMs.toFixed(1)} | ${value.sequential.latency.p95Ms.toFixed(1)} | ${value.sequential.queryCount.p95Ms.toFixed(0)} | ${value.sequential.payloadBytes.p95Ms.toFixed(0)} | ${(value.sequential.cacheHitRate * 100).toFixed(1)}% | ${value.sequential.errors + value.concurrent.errorCount} |`,
  ),
  "",
  "## Evidence boundary",
  "",
  `This artifact is a current ${result.phase} service measurement. The direct service harness invokes the Home composition outside a Next request store, so its zero cache-hit rate is not production cache evidence; the real production runtime cache probe is docs/audits/candidate-first/phase-4/evidence/cf406-cache.json. Query plans are captured in docs/audits/candidate-first/phase-4/evidence/cf406-query-plans.json. Production-browser transfer and live job-ID recall comparisons are recorded separately.`,
  "",
].join("\n");
await writeFile(markdownPath, markdown, "utf8");
console.log(JSON.stringify(result, null, 2));

await prisma.jobPosting.deleteMany({
  where: { id: { startsWith: jobPrefix } },
});
await deleteJobBoardDatabaseFixture(fixture);
await prisma.$disconnect();
await pool.end();
