import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, verifyDatabaseConnectivity } from "@/backend/database/prisma";
import {
  purgeCompanyDeletionRequest,
  runCompanyDeletionManifestReconciliation,
} from "@/backend/services/jobs/company-deletion-manifest-service";
import { acquireCompanyDeletionObjectLock } from "@/backend/services/jobs/company-deletion-object-lock";
import { resumeBlockedRecruiterCompanyDeletion } from "@/backend/services/jobs/recruiter-job-posting-data";
import type { ApplicationDocumentStoragePort } from "@/backend/applications/storage/application-document-storage";
import {
  createJobBoardDatabaseFixture,
  deleteJobBoardDatabaseFixture,
} from "../../../helpers/job-board-database-fixture";

const runId = randomUUID();
const requestId = `cf107-request-${runId}`;
const entryId = `cf107-entry-${runId}`;
const objectKey = `cf107-object-${runId}`;
const now = new Date("2026-09-09T00:00:00.000Z");

const storage: ApplicationDocumentStoragePort = {
  assertReady: async () => undefined,
  put: async () => ({
    locator: objectKey as never,
    bytes: 1,
    storagePurposeVersion: "application-document-v1",
  }),
  open: async function* () {
    yield new Uint8Array();
  },
  delete: async () => ({ deleted: true }),
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  await verifyDatabaseConnectivity();
  await prisma.companyDeletionRequest.create({
    data: {
      id: requestId,
      companyId: `cf107-company-${runId}`,
      requestedByUserId: `cf107-user-${runId}`,
      state: "PURGING",
      holdState: "CLEAR",
      purgeState: "PENDING",
      requestedAt: now,
      retentionEligibleAt: now,
      physicalPurgeStartedAt: now,
    },
  });
  await prisma.companyDeletionManifestEntry.create({
    data: {
      id: entryId,
      requestId,
      identityKey: `object:${objectKey}`,
      resourceKind: "OBJECT",
      resourceType: "APPLICATION_DOCUMENT_OBJECT",
      objectKeyEncrypted: objectKey,
      objectVersion: "application-document-v1",
    },
  });
});

afterAll(async () => {
  await prisma.companyDeletionManifestEntry.deleteMany({
    where: { requestId },
  });
  await prisma.companyDeletionRequest.deleteMany({
    where: { id: requestId },
  });
  await prisma.$disconnect();
});

describe("CF-107 durable deletion manifest PostgreSQL contract", () => {
  it("persists object deletion outcome and completion receipt", async () => {
    const result = await purgeCompanyDeletionRequest(requestId, {
      now,
      storage,
    });

    expect(result).toMatchObject({
      status: "COMPLETED",
      deletedObjects: 1,
    });
    await expect(
      prisma.companyDeletionManifestEntry.findUniqueOrThrow({
        where: { id: entryId },
      }),
    ).resolves.toMatchObject({
      state: "DELETED",
      outcomeCode: "OBJECT_DELETED",
      objectKeyEncrypted: objectKey,
      objectVersion: "application-document-v1",
    });
    await expect(
      prisma.companyDeletionRequest.findUniqueOrThrow({
        where: { id: requestId },
      }),
    ).resolves.toMatchObject({
      state: "COMPLETED",
      purgeState: "COMPLETE",
    });
  });

  it("blocks a company purge while an active job report requires retention", async () => {
    const fixture = await createJobBoardDatabaseFixture("cf107-report");
    const reportRequestId = `cf107-report-request-${runId}`;
    const reportEntryId = `cf107-report-entry-${runId}`;
    const reportObjectKey = `cf107-report-object-${runId}`;
    let deleteCalls = 0;

    try {
      await prisma.companyDeletionRequest.create({
        data: {
          id: reportRequestId,
          companyId: fixture.company.id,
          requestedByUserId: fixture.userIds[0],
          state: "PURGING",
          holdState: "CLEAR",
          purgeState: "PENDING",
          requestedAt: fixture.now,
          retentionEligibleAt: fixture.now,
          physicalPurgeStartedAt: fixture.now,
        },
      });
      await prisma.companyDeletionManifestEntry.createMany({
        data: [
          {
            id: reportEntryId,
            requestId: reportRequestId,
            identityKey: `database:job:${fixture.jobs.active.id}`,
            resourceKind: "DATABASE_RECORD",
            resourceType: "JOB_POSTING",
            recordId: fixture.jobs.active.id,
          },
          {
            id: `${reportEntryId}-object`,
            requestId: reportRequestId,
            identityKey: `object:${reportObjectKey}`,
            resourceKind: "OBJECT",
            resourceType: "APPLICATION_DOCUMENT_OBJECT",
            objectKeyEncrypted: reportObjectKey,
            objectVersion: "application-document-v1",
          },
        ],
      });
      await prisma.jobReport.create({
        data: {
          id: `cf107-report-${runId}`,
          reporterUserId: fixture.userIds[1],
          jobPostingId: fixture.jobs.active.id,
          reason: "OTHER",
          unresolvedKey: `cf107-report-key-${runId}`,
          status: "PENDING_REVIEW",
        },
      });

      const result = await purgeCompanyDeletionRequest(reportRequestId, {
        now: fixture.now,
        storage: {
          ...storage,
          delete: async () => {
            deleteCalls += 1;
            return { deleted: true };
          },
        },
      });

      expect(result).toMatchObject({
        status: "BLOCKED_BY_LEGAL_HOLD",
      });
      expect(deleteCalls).toBe(0);
      await expect(
        prisma.companyDeletionManifestEntry.count({
          where: {
            requestId: reportRequestId,
            state: "BLOCKED_BY_LEGAL_HOLD",
          },
        }),
      ).resolves.toBe(2);
      await expect(
        prisma.companyDeletionRequest.findUniqueOrThrow({
          where: { id: reportRequestId },
        }),
      ).resolves.toMatchObject({
        state: "BLOCKED_BY_LEGAL_HOLD",
        purgeState: "BLOCKED",
        lastFailureCode: "JOB_REPORT_ACTIVE",
      });
    } finally {
      await prisma.jobReport.deleteMany({
        where: { unresolvedKey: `cf107-report-key-${runId}` },
      });
      await prisma.companyDeletionManifestEntry.deleteMany({
        where: { requestId: reportRequestId },
      });
      await prisma.companyDeletionRequest.deleteMany({
        where: { id: reportRequestId },
      });
      await deleteJobBoardDatabaseFixture(fixture);
    }
  });

  it("releases an expired hold and converges concurrent retries on one durable request", async () => {
    const fixture = await createJobBoardDatabaseFixture("cf107-hold-release");
    const blockedRequestId = `cf107-hold-request-${runId}`;
    const holdId = `cf107-hold-${runId}`;
    const holdEnd = new Date(fixture.now.getTime() + 86_400_000);

    try {
      await prisma.companyMembership.create({
        data: {
          companyId: fixture.company.id,
          userId: fixture.userIds[0],
          role: "OWNER",
          priorApprovedRole: "OWNER",
          status: "ACTIVE",
        },
      });
      await prisma.activityLegalHold.create({
        data: {
          id: holdId,
          scopeType: "TARGET",
          scopeReference: `company:${fixture.company.id}`,
          reasonCategory: "LEGAL_RETENTION",
          authorizedByAdminUserId: fixture.userIds[1],
          startsAt: new Date(fixture.now.getTime() - 60_000),
          endsAt: holdEnd,
          correlationId: `cf107-hold-correlation-${runId}`,
        },
      });
      await prisma.companyDeletionRequest.create({
        data: {
          id: blockedRequestId,
          companyId: fixture.company.id,
          requestedByUserId: fixture.userIds[0],
          state: "BLOCKED_BY_LEGAL_HOLD",
          holdState: "ACTIVE",
          purgeState: "BLOCKED",
          requestedAt: fixture.now,
          retentionEligibleAt: fixture.now,
          holdEvaluatedAt: fixture.now,
          lastFailureCode: "ACTIVITY_LEGAL_HOLD_ACTIVE",
        },
      });
      await prisma.companyDeletionManifestEntry.createMany({
        data: [
          {
            requestId: blockedRequestId,
            identityKey: `database:COMPANY:${fixture.company.id}`,
            resourceKind: "DATABASE_RECORD",
            resourceType: "COMPANY",
            recordId: fixture.company.id,
            state: "BLOCKED_BY_LEGAL_HOLD",
            outcomeCode: "ACTIVITY_LEGAL_HOLD_ACTIVE",
          },
          {
            requestId: blockedRequestId,
            identityKey: `database:JOB_POSTING:${fixture.jobs.active.id}`,
            resourceKind: "DATABASE_RECORD",
            resourceType: "JOB_POSTING",
            recordId: fixture.jobs.active.id,
            state: "BLOCKED_BY_LEGAL_HOLD",
            outcomeCode: "ACTIVITY_LEGAL_HOLD_ACTIVE",
          },
        ],
      });

      await expect(
        resumeBlockedRecruiterCompanyDeletion(blockedRequestId, fixture.now),
      ).resolves.toMatchObject({ status: "BLOCKED_BY_LEGAL_HOLD" });
      await expect(
        prisma.company.findUnique({ where: { id: fixture.company.id } }),
      ).resolves.not.toBeNull();

      const releasedAt = new Date(fixture.now.getTime() + 1_000);
      await prisma.activityLegalHold.update({
        where: { id: holdId },
        data: { releasedAt },
      });
      const results = await Promise.all([
        resumeBlockedRecruiterCompanyDeletion(blockedRequestId, releasedAt),
        resumeBlockedRecruiterCompanyDeletion(blockedRequestId, releasedAt),
      ]);

      expect(results.every((result) => result.status === "COMPLETED")).toBe(
        true,
      );
      await expect(
        prisma.company.findUnique({ where: { id: fixture.company.id } }),
      ).resolves.toBeNull();
      await expect(
        prisma.companyDeletionRequest.findUniqueOrThrow({
          where: { id: blockedRequestId },
        }),
      ).resolves.toMatchObject({
        state: "COMPLETED",
        holdState: "RELEASED",
        purgeState: "COMPLETE",
      });
      await expect(
        prisma.companyDeletionManifestEntry.count({
          where: {
            requestId: blockedRequestId,
            resourceKind: "DATABASE_RECORD",
            state: "DELETED",
          },
        }),
      ).resolves.toBeGreaterThanOrEqual(2);
      await expect(
        prisma.auditEvent.count({
          where: {
            targetId: fixture.company.id,
            action: {
              in: [
                "company.deletion.retention_released",
                "company.deleted",
              ],
            },
          },
        }),
      ).resolves.toBe(2);
    } finally {
      await prisma.activityLegalHold.deleteMany({ where: { id: holdId } });
      await prisma.companyDeletionManifestEntry.deleteMany({
        where: { requestId: blockedRequestId },
      });
      await prisma.companyDeletionRequest.deleteMany({
        where: { id: blockedRequestId },
      });
      await deleteJobBoardDatabaseFixture(fixture);
    }
  });

  it("reconciles a blocked request after its pending report is resolved", async () => {
    const fixture = await createJobBoardDatabaseFixture("cf107-report-release");
    const blockedRequestId = `cf107-report-release-request-${runId}`;
    const reportId = `cf107-report-release-${runId}`;

    try {
      await prisma.companyMembership.create({
        data: {
          companyId: fixture.company.id,
          userId: fixture.userIds[0],
          role: "OWNER",
          priorApprovedRole: "OWNER",
          status: "ACTIVE",
        },
      });
      await prisma.jobReport.create({
        data: {
          id: reportId,
          reporterUserId: fixture.userIds[1],
          jobPostingId: fixture.jobs.active.id,
          reason: "OTHER",
          unresolvedKey: `cf107-report-release-key-${runId}`,
          status: "PENDING_REVIEW",
        },
      });
      await prisma.companyDeletionRequest.create({
        data: {
          id: blockedRequestId,
          companyId: fixture.company.id,
          requestedByUserId: fixture.userIds[0],
          state: "BLOCKED_BY_LEGAL_HOLD",
          holdState: "ACTIVE",
          purgeState: "BLOCKED",
          requestedAt: fixture.now,
          retentionEligibleAt: fixture.now,
          holdEvaluatedAt: fixture.now,
          lastFailureCode: "JOB_REPORT_ACTIVE",
        },
      });
      await prisma.companyDeletionManifestEntry.create({
        data: {
          requestId: blockedRequestId,
          identityKey: `database:JOB_POSTING:${fixture.jobs.active.id}`,
          resourceKind: "DATABASE_RECORD",
          resourceType: "JOB_POSTING",
          recordId: fixture.jobs.active.id,
          state: "BLOCKED_BY_LEGAL_HOLD",
          outcomeCode: "JOB_REPORT_ACTIVE",
        },
      });

      await expect(
        runCompanyDeletionManifestReconciliation(
          fixture.now,
          50,
          resumeBlockedRecruiterCompanyDeletion,
        ),
      ).resolves.toMatchObject({ blocked: 1, completed: 0 });

      await prisma.jobReport.update({
        where: { id: reportId },
        data: {
          status: "RESOLVED",
          unresolvedKey: null,
          resolvedAt: new Date(fixture.now.getTime() + 500),
        },
      });
      await expect(
        runCompanyDeletionManifestReconciliation(
          new Date(fixture.now.getTime() + 1_000),
          50,
          resumeBlockedRecruiterCompanyDeletion,
        ),
      ).resolves.toMatchObject({ blocked: 0, completed: 1 });
      await expect(
        prisma.companyDeletionRequest.findUniqueOrThrow({
          where: { id: blockedRequestId },
        }),
      ).resolves.toMatchObject({
        state: "COMPLETED",
        holdState: "RELEASED",
      });
    } finally {
      await prisma.jobReport.deleteMany({ where: { id: reportId } });
      await prisma.companyDeletionManifestEntry.deleteMany({
        where: { requestId: blockedRequestId },
      });
      await prisma.companyDeletionRequest.deleteMany({
        where: { id: blockedRequestId },
      });
      await deleteJobBoardDatabaseFixture(fixture);
    }
  });

  it("rechecks references after an atomic lock and never deletes a concurrently referenced object", async () => {
    const fixture = await createJobBoardDatabaseFixture("cf107-race");
    const raceRequestId = `cf107-race-request-${runId}`;
    const raceEntryId = `cf107-race-entry-${runId}`;
    const raceObjectKey = `cf107-race-object-${runId}`;
    const writerLocked = deferred();
    const releaseWriter = deferred();
    let writerPromise: Promise<unknown> | undefined;
    let deleteCalls = 0;

    try {
      await prisma.companyDeletionRequest.create({
        data: {
          id: raceRequestId,
          companyId: fixture.company.id,
          requestedByUserId: fixture.userIds[0],
          state: "PURGING",
          holdState: "CLEAR",
          purgeState: "PENDING",
          requestedAt: fixture.now,
          retentionEligibleAt: fixture.now,
          physicalPurgeStartedAt: fixture.now,
        },
      });
      await prisma.companyDeletionManifestEntry.create({
        data: {
          id: raceEntryId,
          requestId: raceRequestId,
          identityKey: `object:${raceObjectKey}`,
          resourceKind: "OBJECT",
          resourceType: "APPLICATION_DOCUMENT_OBJECT",
          objectKeyEncrypted: raceObjectKey,
          objectVersion: "application-document-v1",
        },
      });

      writerPromise = prisma.$transaction(async (transaction) => {
        await acquireCompanyDeletionObjectLock(transaction, raceObjectKey);
        writerLocked.resolve();
        await releaseWriter.promise;
        await transaction.applicationArtifactPromotion.create({
          data: {
            id: `cf107-promotion-${runId}`,
            candidateUserId: fixture.userIds[0],
            jobPostingId: fixture.jobs.active.id,
            kind: "CV",
            storagePurposeVersion: "application-document-v1",
            storageKeyEncrypted: raceObjectKey,
            contentDigestSha256: "a".repeat(64),
            state: "PROMOTED",
            orphanDeleteAfter: new Date(fixture.now.getTime() + 86_400_000),
          },
        });
      });
      await writerLocked.promise;

      const purgePromise = purgeCompanyDeletionRequest(raceRequestId, {
        now: fixture.now,
        storage: {
          ...storage,
          delete: async () => {
            deleteCalls += 1;
            return { deleted: true };
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(deleteCalls).toBe(0);

      releaseWriter.resolve();
      await writerPromise;
      const result = await purgePromise;

      expect(result).toMatchObject({
        status: "RETRY_REQUIRED",
        conflictingObjects: 1,
      });
      expect(deleteCalls).toBe(0);
      await expect(
        prisma.applicationArtifactPromotion.findUniqueOrThrow({
          where: { id: `cf107-promotion-${runId}` },
        }),
      ).resolves.toMatchObject({
        storageKeyEncrypted: raceObjectKey,
        state: "PROMOTED",
      });
      await expect(
        prisma.companyDeletionManifestEntry.findUniqueOrThrow({
          where: { id: raceEntryId },
        }),
      ).resolves.toMatchObject({
        state: "CONFLICT",
        outcomeCode: "OBJECT_REUSED_AFTER_REQUEST",
      });
    } finally {
      releaseWriter.resolve();
      await writerPromise?.catch(() => undefined);
      await prisma.applicationArtifactPromotion.deleteMany({
        where: { id: `cf107-promotion-${runId}` },
      });
      await prisma.companyDeletionManifestEntry.deleteMany({
        where: { requestId: raceRequestId },
      });
      await prisma.companyDeletionRequest.deleteMany({
        where: { id: raceRequestId },
      });
      await deleteJobBoardDatabaseFixture(fixture);
    }
  });
});
