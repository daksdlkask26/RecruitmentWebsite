import "server-only";

import { cpus } from "node:os";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/backend/generated/prisma/client.ts";

const envFile = process.env.CF004_ENV_FILE
  ? resolve(process.cwd(), process.env.CF004_ENV_FILE)
  : resolve(process.cwd(), ".env.local");
loadEnvironment({ path: envFile, quiet: true });

const { assertTestDatabaseEnvironment } = await import(
  "../tests/helpers/test-database-guard.ts"
);
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
  queryEvents.push({ durationMs: event.duration });
});
globalThis.prisma = prisma;

const { createJobBoardDatabaseFixture, deleteJobBoardDatabaseFixture } =
  await import("../tests/helpers/job-board-database-fixture.ts");
const { getHomePageContext } = await import(
  "../src/backend/services/home/get-home-page-context.ts"
);

const sampleCount = Number.parseInt(process.env.CF004_SAMPLES ?? "20", 10);
const concurrentWidth = Number.parseInt(
  process.env.CF004_CONCURRENCY ?? "10",
  10,
);
const jobsToSeed = Number.parseInt(process.env.CF004_JOBS ?? "1000", 10);
const now = new Date();
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

async function homeFor(role) {
  const session =
    role === "guest"
      ? null
      : {
          userId:
            role === "candidate"
              ? fixture.userIds[0]
              : fixture.userIds[1],
          sessionId: `cf004-session-${role}-${fixture.suffix}`,
        };
  return getHomePageContext({
    requestHeaders: async () => new Headers(),
    session: async () => session,
    proof: () => "cf004-test-proof",
  });
}

async function measureSequential(role) {
  // Warm the route and prepared statements, then reset evidence counters.
  await homeFor(role);
  await homeFor(role);
  queryEvents.length = 0;
  poolWaits.length = 0;
  const latencies = [];
  const queryCounts = [];
  const queryDurations = [];
  const waits = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const beforeQueries = queryEvents.length;
    const beforeWaits = poolWaits.length;
    const startedAt = performance.now();
    await homeFor(role);
    latencies.push(performance.now() - startedAt);
    queryCounts.push(queryEvents.length - beforeQueries);
    queryDurations.push(
      queryEvents
        .slice(beforeQueries)
        .reduce((total, event) => total + event.durationMs, 0),
    );
    waits.push(
      poolWaits
        .slice(beforeWaits)
        .reduce((total, wait) => total + wait, 0),
    );
  }
  return {
    latency: stats(latencies),
    queryCount: stats(queryCounts),
    queryDuration: stats(queryDurations),
    poolWaitMs: stats(waits),
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
  for (let round = 0; round < Math.max(3, Math.ceil(sampleCount / 2)); round += 1) {
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
  }
  return {
    width: concurrentWidth,
    batchLatency: stats(latencies),
    peakPoolWaiting: stats(waitingCounts),
    poolWaitMs: stats(poolWaits),
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

const roles = {};
for (const role of ["guest", "candidate", "employer"]) {
  roles[role] = {
    sequential: await measureSequential(role),
    concurrent: await measureConcurrent(role),
  };
}

const result = {
  schemaVersion: "candidate-first-cf004-home-performance-v1",
  generatedAt: new Date().toISOString(),
  commit: process.env.CF004_COMMIT ?? "unknown",
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: cpus().length,
    database: "smarthire_candidate_first_test",
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
  limitations: [
    "Pool wait is measured at the pg.Pool checkout boundary with an isolated test pool.",
    "Browser navigation timing is recorded separately by the Home Playwright performance spec.",
    "No shared or production database was mutated.",
  ],
};
console.log(JSON.stringify(result, null, 2));

await prisma.jobPosting.deleteMany({ where: { id: { startsWith: jobPrefix } } });
await deleteJobBoardDatabaseFixture(fixture);
await prisma.$disconnect();
await pool.end();
