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
  } else if (command === "create-deletion-receipt") {
    const fixture = payload?.fixture;
    if (!fixture) throw new Error("create-deletion-receipt requires fixture");
    const requestId = `cf107-receipt-${fixture.suffix}`;
    const requestedAt = new Date("2026-09-09T00:00:00.000Z");
    await prisma.companyDeletionRequest.create({
      data: {
        id: requestId,
        companyId: fixture.company.id,
        requestedByUserId: fixture.employerUserId,
        state: "COMPLETED",
        holdState: "CLEAR",
        purgeState: "COMPLETE",
        requestedAt,
        retentionEligibleAt: requestedAt,
        holdEvaluatedAt: requestedAt,
        physicalPurgeStartedAt: requestedAt,
        completedAt: new Date(requestedAt.getTime() + 1_000),
        manifestEntries: {
          create: {
            identityKey: `database:COMPANY:${fixture.company.id}`,
            resourceKind: "DATABASE_RECORD",
            resourceType: "COMPANY",
            recordId: fixture.company.id,
            state: "DELETED",
            outcomeCode: "DATABASE_RECORD_DELETED",
            attemptCount: 1,
            lastAttemptAt: requestedAt,
            deletedAt: requestedAt,
          },
        },
      },
    });
    result = { requestId };
  } else if (command === "seed-timeline") {
    if (!payload?.applicationId) {
      throw new Error("seed-timeline requires applicationId");
    }
    const application = await prisma.jobApplication.findUniqueOrThrow({
      where: { id: payload.applicationId },
      select: { id: true, stage: true, stageVersion: true },
    });
    const marker = await prisma.applicationStageEvent.findFirst({
      where: {
        applicationId: application.id,
        id: { startsWith: `stage-e2e-timeline-${application.id}-` },
      },
      select: { toStage: true },
    });
    if (marker) {
      result = { applicationId: application.id, finalStage: marker.toStage };
    } else {
      const transitions = [
        {
          stage: "VIEWED",
          kind: "UNDER_REVIEW",
          publicStage: "UNDER_REVIEW",
          publicOutcome: null,
          title: "Application viewed",
          message: "The hiring team opened the application.",
        },
        {
          stage: "SHORTLISTED",
          kind: "UNDER_REVIEW",
          publicStage: "UNDER_REVIEW",
          publicOutcome: null,
          title: "Application shortlisted",
          message: "The application moved to the next review step.",
        },
        {
          stage: "INTERVIEWING",
          kind: "INTERVIEW",
          publicStage: "INTERVIEW",
          publicOutcome: null,
          title: "Interview stage reached",
          message: "The application reached the interview stage.",
        },
        {
          stage: "REJECTED",
          kind: "OUTCOME",
          publicStage: "OUTCOME",
          publicOutcome: "REJECTED",
          title: "Application rejected",
          message: "The hiring team completed its decision.",
        },
      ];
      let fromStage = application.stage;
      let version = application.stageVersion;
      const stageEvents = [];
      const publicUpdates = [];
      for (const [index, transition] of transitions.entries()) {
        version += 1;
        const occurredAt = new Date(
          Date.parse("2026-09-10T10:00:00.000Z") + (index + 1) * 60_000,
        );
        const eventId = `stage-e2e-timeline-${application.id}-${version}`;
        stageEvents.push({
          id: eventId,
          applicationId: application.id,
          fromStage,
          toStage: transition.stage,
          actorUserId: null,
          actorType: "RECRUITER",
          candidateVisibleReason: transition.message,
          candidateVisible: true,
          occurredAt,
          applicationVersion: version,
          idempotencyKey: `e2e-timeline-${application.id}-${version}`,
        });
        publicUpdates.push({
          id: `public-e2e-timeline-${application.id}-${version}`,
          applicationId: application.id,
          kind: transition.kind,
          publicStage: transition.publicStage,
          publicOutcome: transition.publicOutcome,
          title: transition.title,
          effectiveAt: occurredAt,
          deduplicationKey: `e2e-timeline-public-${application.id}-${version}`,
          sourceEventReference: eventId,
        });
        fromStage = transition.stage;
      }
      await prisma.applicationStageEvent.createMany({ data: stageEvents });
      await prisma.applicationPublicUpdate.createMany({ data: publicUpdates });
      await prisma.jobApplication.update({
        where: { id: application.id },
        data: {
          stage: "REJECTED",
          stageVersion: version,
          lastStageChangedAt: stageEvents.at(-1).occurredAt,
        },
      });
      result = { applicationId: application.id, finalStage: "REJECTED" };
    }
  } else if (command === "read-job") {
    if (!payload?.jobId) throw new Error("read-job requires jobId");
    result = await prisma.jobPosting.findUniqueOrThrow({
      where: { id: payload.jobId },
      select: { title: true, location: true, status: true, removedAt: true },
    });
  } else if (command === "update-job") {
    if (!payload?.jobId || !payload?.data) {
      throw new Error("update-job requires jobId and data");
    }
    const updateData = { ...payload.data };
    if (typeof updateData.removedAt === "string") {
      updateData.removedAt = new Date(updateData.removedAt);
    }
    result = await prisma.jobPosting.update({
      where: { id: payload.jobId },
      data: updateData,
      select: { title: true, location: true, status: true, removedAt: true },
    });
  } else if (command === "expire-application-document") {
    if (!payload?.applicationId) {
      throw new Error("expire-application-document requires applicationId");
    }
    const kind = payload.kind === "cover-letter" ? "COVER_LETTER" : "CV";
    const mode = payload.mode === "deleted" ? "deleted" : "expired";
    const updated = await prisma.applicationDocument.updateMany({
      where: {
        jobApplicationId: payload.applicationId,
        kind,
        committedAt: { not: null },
      },
      data:
        mode === "deleted"
          ? { deletedAt: new Date("2020-01-01T00:00:00.000Z") }
          : { ordinaryAccessDeniedAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    if (updated.count !== 1) {
      throw new Error("expire-application-document target unavailable");
    }
    result = { updated: true };
  } else if (command === "delete") {
    const fixture = payload?.fixture;
    if (!fixture) throw new Error("delete requires fixture");

    await prisma.companyDeletionRequest.deleteMany({
      where: {
        requestedByUserId: {
          in: [fixture.candidateUserId, fixture.employerUserId],
        },
      },
    });

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
