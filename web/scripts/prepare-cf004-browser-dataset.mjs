import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const { assertTestDatabaseEnvironment } = await import(
  "../tests/helpers/test-database-guard.ts",
);
assertTestDatabaseEnvironment();

const { prisma } = await import("../src/backend/database/prisma.ts");
const {
  createJobBoardDatabaseFixture,
  deleteJobBoardDatabaseFixture,
} = await import("../tests/helpers/job-board-database-fixture.ts");

const [command, artifactArgument] = process.argv.slice(2);
const artifactPath = resolve(
  process.cwd(),
  artifactArgument ?? "../docs/audits/2026-09-06-cf004-browser-seed.json",
);

try {
  if (command === "create") {
    const now = new Date();
    const fixture = await createJobBoardDatabaseFixture(
      `cf004-browser-${Date.now()}`,
      now,
    );
    const prefix = `cf004-browser-job-${fixture.suffix}-`;
    const jobs = Array.from({ length: 1_000 }, (_, index) => {
      const key = `${prefix}${String(index).padStart(4, "0")}`;
      return {
        id: key,
        companyId: fixture.company.id,
        slug: key,
        title: `TypeScript Platform Engineer ${index + 1}`,
        normalizedTitle: `typescript platform engineer ${index + 1}`,
        summary: "Build accessible recruitment products.",
        description: "Create production-grade web experiences.",
        responsibilities: "Design, implement, test, and review.",
        requirements: "Strong TypeScript fundamentals.",
        benefits: "Flexible work and a learning budget.",
        location: index % 2 ? "Đà Nẵng" : "Hồ Chí Minh",
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
      };
    });
    const created = await prisma.jobPosting.createMany({ data: jobs });
    const activePublicJobs = await prisma.jobPosting.count({
      where: {
        status: "ACTIVE",
        approvedAt: { not: null },
        publishedAt: { not: null, lte: now },
        OR: [
          { applicationDeadline: null },
          { applicationDeadline: { gt: now } },
        ],
        company: { verifiedAt: { not: null } },
      },
    });
    const result = {
      schemaVersion: "candidate-first-cf004-browser-dataset-v1",
      generatedAt: new Date().toISOString(),
      database: new URL(process.env.DATABASE_URL).pathname.slice(1),
      fixture,
      namespace: { jobPrefix: prefix, createdJobs: created.count },
      activePublicJobs,
      cleanup: `node scripts/prepare-cf004-browser-dataset.mjs delete ${artifactArgument ?? "../docs/audits/2026-09-06-cf004-browser-seed.json"}`,
    };
    await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === "delete") {
    const result = JSON.parse(await readFile(artifactPath, "utf8"));
    const jobPrefix = result.namespace?.jobPrefix;
    if (!jobPrefix || !result.fixture) throw new Error("CF004_DATASET_ARTIFACT_INVALID");
    const deletedJobs = await prisma.jobPosting.deleteMany({
      where: { id: { startsWith: jobPrefix } },
    });
    await deleteJobBoardDatabaseFixture(result.fixture);
    process.stdout.write(
      `${JSON.stringify({ deleted: true, deletedJobs: deletedJobs.count })}\n`,
    );
  } else {
    throw new Error("usage: prepare-cf004-browser-dataset.mjs create|delete [artifact]");
  }
} finally {
  await prisma.$disconnect();
}
