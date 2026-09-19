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
  seedPhase5BrowserPrivateMatches,
  seedPhase5LongCopyReport,
  setPhase5CandidateProfileEmpty,
} = await import("./phase5-private-match-browser-fixture.ts");

let result;
try {
  if (command === "seed") {
    const activeJob = await prisma.jobPosting.findUniqueOrThrow({
      where: { id: payload.input.activeJob.id },
      select: {
        id: true,
        slug: true,
        title: true,
        version: true,
        updatedAt: true,
        location: true,
        employmentType: true,
        workArrangement: true,
      },
    });
    const input = {
      ...payload.input,
      now: new Date(payload.input.now),
      activeJob,
    };
    result = {
      matchIds: await seedPhase5BrowserPrivateMatches(input),
      longCopyCheckId: await seedPhase5LongCopyReport(input),
    };
  } else if (command === "profile-empty" || command === "profile-restore") {
    await setPhase5CandidateProfileEmpty(
      payload.candidateUserId,
      command === "profile-empty",
    );
    result = { updated: true };
  } else if (command === "cleanup") {
    await prisma.privateCvMatchCheck.updateMany({
      where: { candidateUserId: payload.candidateUserId },
      data: {
        state: "QUEUED",
        currentAttemptId: null,
        inaccessibleAt: null,
        deletedAt: null,
        deleteAfter: null,
      },
    });
    result = {
      deleted: (
        await prisma.privateCvMatchCheck.deleteMany({
          where: { candidateUserId: payload.candidateUserId },
        })
      ).count,
    };
  } else if (command === "expire-apply-job") {
    result = {
      updated: (
        await prisma.jobPosting.updateMany({
          where: { id: payload.jobId },
          data: {
            status: "ACTIVE",
            closedAt: null,
            applicationDeadline: new Date(Date.now() - 60_000),
          },
        })
      ).count,
    };
  } else {
    throw new Error(`Unsupported Phase 5 browser control command: ${command}`);
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
