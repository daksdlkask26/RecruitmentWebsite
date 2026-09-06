import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const [command, encoded = "bnVsbA"] = process.argv.slice(2);
const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
const { assertTestDatabaseEnvironment } =
  await import("./test-database-guard.ts");
assertTestDatabaseEnvironment();

const { prisma } = await import("../../src/backend/database/prisma.ts");
const {
  createCandidateFirstDatabaseFixture,
  deleteCandidateFirstDatabaseFixture,
} = await import("./candidate-first-database-fixture.ts");

let result;
try {
  if (command === "create") {
    const fixtureNow = payload?.now ? new Date(payload.now) : undefined;
    result = await createCandidateFirstDatabaseFixture(
      payload?.label ?? "smoke",
      fixtureNow,
    );
  } else if (command === "delete") {
    const fixture = payload?.fixture;
    if (!fixture) throw new Error("delete requires fixture");

    // Physical CV/application files are owned by this fixture. Delete them
    // before mutable database rows; immutable audit events stay retained.
    const artifacts = await prisma.cvStoredArtifact.findMany({
      where: { accountId: fixture.candidateUserId },
      select: { storageLocator: true },
    });
    const candidateCvs = await prisma.candidateCv.findMany({
      where: { candidateUserId: fixture.candidateUserId },
      select: { storageKey: true },
    });
    const applicationDocuments = await prisma.applicationDocument.findMany({
      where: { application: { candidateUserId: fixture.candidateUserId } },
      select: { storageKeyEncrypted: true },
    });
    const applicationPromotions =
      await prisma.applicationArtifactPromotion.findMany({
        where: { candidateUserId: fixture.candidateUserId },
        select: { storageKeyEncrypted: true },
      });
    let storageDeleted = 0;
    let storageCleanupError;
    try {
      const { createCvWorkerStorage } =
        await import("../../src/backend/cv/workers/cv-worker-resources.ts");
      const storage = createCvWorkerStorage();
      await storage.assertReady();
      const locators = [
        ...artifacts.map((item) => item.storageLocator),
        ...candidateCvs.map((item) => item.storageKey),
        ...applicationDocuments.map((item) => item.storageKeyEncrypted),
        ...applicationPromotions.map((item) => item.storageKeyEncrypted),
      ].filter((locator) => !locator.startsWith("fixtures/"));
      const outcomes = await Promise.allSettled(
        [...new Set(locators)].map((locator) => storage.delete(locator)),
      );
      const rejected = outcomes.find(
        (outcome) => outcome.status === "rejected",
      );
      if (rejected?.status === "rejected") {
        storageCleanupError =
          rejected.reason instanceof Error
            ? rejected.reason.message
            : String(rejected.reason);
      }
      storageDeleted = outcomes.filter(
        (outcome) =>
          outcome.status === "fulfilled" && outcome.value.deleted === true,
      ).length;
    } catch (error) {
      // Database cleanup remains useful when the optional local storage
      // adapter is unavailable; return the failure code for evidence.
      storageCleanupError =
        error instanceof Error ? error.message : String(error);
    }
    await deleteCandidateFirstDatabaseFixture(fixture);
    result = {
      deleted: true,
      storageDeleted,
      ...(storageCleanupError ? { storageCleanupError } : {}),
    };
  } else {
    throw new Error(
      `Unsupported Candidate-first E2E control command: ${command}`,
    );
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
