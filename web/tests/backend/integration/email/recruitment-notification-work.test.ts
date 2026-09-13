import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/backend/database/prisma";
import { EmailDeliveryError } from "@/backend/email/email-service";
import { DueOutboxProcessor } from "@/backend/email/workers/due-outbox-processor";
import { RecruitmentNotificationWorkProcessor } from "@/backend/email/workers/recruitment-notification-work";
import { PrismaJobApplicationRepository } from "@/backend/repositories/jobs/prisma-job-application-repository";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import { createJobBoardDatabaseFixture } from "../../../helpers/job-board-database-fixture";
import { deleteJobBoardDatabaseFixture } from "../../../helpers/job-board-database-fixture";
import { seedCleanJobApplicationCv } from "../../../helpers/job-application-cv-fixture";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const execFile = promisify(execFileCallback);

async function runRecruitmentMigrationVerification(...args: string[]) {
  try {
    const result = await execFile(
      process.execPath,
      ["scripts/verify-recruitment-notification-migration.mjs", ...args],
      { cwd: process.cwd(), env: process.env },
    );
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof result.code === "number" ? result.code : 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
}

describe.skipIf(!databaseAvailable)("recruitment notification delivery", () => {
  let fixture: Awaited<ReturnType<typeof createJobBoardDatabaseFixture>>;
  let secureCv: Awaited<ReturnType<typeof seedCleanJobApplicationCv>>;
  let applicationId: string;

  beforeAll(async () => {
    fixture = await createJobBoardDatabaseFixture("recruitment-notification");
    secureCv = await seedCleanJobApplicationCv({
      candidateUserId: fixture.userIds[0]!,
      now: fixture.now,
      label: "recruitment-notification",
    });
    await prisma.companyMembership.create({
      data: {
        companyId: fixture.company.id,
        userId: fixture.userIds[1]!,
        role: "RECRUITER",
        priorApprovedRole: "RECRUITER",
      },
    });
    const result = await new PrismaJobApplicationRepository().submit({
      candidateUserId: fixture.userIds[0]!,
      sessionId: "recruitment-notification-session",
      jobId: fixture.jobs.active.id,
      idempotencyKey: "recruitment-notification-application-key",
      submissionBindingDigest: "a".repeat(64),
      command: {
        cvId: secureCv.candidateCvId,
        answers: fixture.jobs.active.questions.map((question) => ({
          questionId: question.id,
          value: question.kind === "BOOLEAN" ? true : "Five years",
        })),
        coverLetter: null,
        consentVersion: "2026-08-01",
        consentAccepted: true,
      },
      activeConsentVersion: "2026-08-01",
      occurredAt: fixture.now,
      correlationId: "recruitment-notification-correlation",
    });
    applicationId = result.application.applicationId;
  });

  afterAll(async () => {
    if (secureCv) {
      const storage = createCvWorkerStorage();
      await storage.assertReady();
      await storage.delete(secureCv.storageLocator);
    }
    if (fixture) await deleteJobBoardDatabaseFixture(fixture);
  });

  it("claims a work item once and creates one idempotent email intent", async () => {
    const work = await prisma.recruitmentNotificationWork.findFirstOrThrow({
      where: { applicationId, kind: "APPLICATION_SUBMITTED" },
    });
    const [claimedA, claimedB] = await Promise.all([
      new RecruitmentNotificationWorkProcessor(
        undefined,
        undefined,
        "recruitment-a",
        1,
      ).pollOnce(),
      new RecruitmentNotificationWorkProcessor(
        undefined,
        undefined,
        "recruitment-b",
        1,
      ).pollOnce(),
    ]);
    expect(claimedA + claimedB).toBe(1);
    expect(
      await prisma.recruitmentNotificationWork.findUniqueOrThrow({
        where: { id: work.id },
        select: { status: true, leaseOwner: true, leaseExpiresAt: true },
      }),
    ).toEqual({ status: "SENT", leaseOwner: null, leaseExpiresAt: null });
    expect(
      await prisma.emailOutbox.count({
        where: {
          idempotencyKey: `recruitment:${work.id}:${fixture.userIds[0]}`,
        },
      }),
    ).toBe(1);
    const secondPass = await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-restart",
      1,
    ).pollOnce();
    expect(secondPass).toBe(0);
  });

  it("keeps the committed application when provider delivery is retryable", async () => {
    const work = await prisma.recruitmentNotificationWork.findFirstOrThrow({
      where: { applicationId, kind: "APPLICATION_SUBMITTED" },
    });
    const outbox = await prisma.emailOutbox.findFirstOrThrow({
      where: { idempotencyKey: `recruitment:${work.id}:${fixture.userIds[0]}` },
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new EmailDeliveryError("SMTP_CONNECTION_TIMEOUT", true),
      )
      .mockResolvedValueOnce({ providerMessageId: "recruitment-provider-1" });
    await new DueOutboxProcessor(
      undefined,
      { send },
      "email-recruitment-failure",
      1,
    ).pollOnce();
    expect(
      await prisma.jobApplication.findUniqueOrThrow({
        where: { id: applicationId },
        select: { stage: true },
      }),
    ).toEqual({ stage: "APPLIED" });
    expect(
      await prisma.recruitmentNotificationWork.findUniqueOrThrow({
        where: { id: work.id },
        select: { status: true },
      }),
    ).toEqual({ status: "SENT" });
    expect(
      await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: { status: true, safeErrorCode: true, attempts: true },
      }),
    ).toEqual({
      status: "RETRYABLE",
      safeErrorCode: "SMTP_CONNECTION_TIMEOUT",
      attempts: 1,
    });

    await prisma.emailOutbox.update({
      where: { id: outbox.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await new DueOutboxProcessor(
      undefined,
      { send },
      "email-recruitment-retry",
      1,
    ).pollOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: { status: true, providerMessageId: true },
      }),
    ).toEqual({ status: "SENT", providerMessageId: "recruitment-provider-1" });
  });

  it("delivers exactly once to an active authorized company member", async () => {
    const companyWork = await prisma.recruitmentNotificationWork.create({
      data: {
        applicationId,
        audience: "COMPANY",
        kind: "APPLICATION_RECEIVED",
        targetReference: fixture.company.id,
        payloadRef: { v: 1, event: "APPLICATION_RECEIVED" },
        idempotencyKey: "recruitment-notification-company-positive-work",
      },
    });
    await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-company-positive-handoff",
      1,
    ).pollOnce();
    const outbox = await prisma.emailOutbox.findFirstOrThrow({
      where: {
        idempotencyKey: { startsWith: `recruitment:${companyWork.id}:` },
      },
    });
    const member = await prisma.userAccount.findUniqueOrThrow({
      where: { id: fixture.userIds[1]! },
      select: { email: true },
    });
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "recruitment-company-provider-1",
    });

    await new DueOutboxProcessor(
      undefined,
      { send },
      "email-recruitment-company-positive",
      1,
    ).pollOnce();
    await new DueOutboxProcessor(
      undefined,
      { send },
      "email-recruitment-company-positive-restart",
      1,
    ).pollOnce();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "RECRUITMENT_NOTIFICATION",
        recipient: member.email,
        idempotencyKey: `recruitment:${companyWork.id}:${fixture.userIds[1]}`,
      }),
    );
    expect(
      await prisma.emailOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
        select: { status: true, providerMessageId: true, attempts: true },
      }),
    ).toEqual({
      status: "SENT",
      providerMessageId: "recruitment-company-provider-1",
      attempts: 1,
    });
  });

  it("blocks legacy-runtime rollback while a materialized notification is active", async () => {
    const companyWork = await prisma.recruitmentNotificationWork.create({
      data: {
        applicationId,
        audience: "COMPANY",
        kind: "APPLICATION_RECEIVED",
        targetReference: fixture.company.id,
        payloadRef: { v: 1, event: "APPLICATION_RECEIVED" },
        idempotencyKey: "recruitment-notification-rollback-precondition-work",
      },
    });
    const workShape =
      await prisma.recruitmentNotificationWork.findUniqueOrThrow({
        where: { id: companyWork.id },
        select: { leaseOwner: true, leaseExpiresAt: true },
      });
    expect(workShape).toEqual({ leaseOwner: null, leaseExpiresAt: null });

    await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-rollback-precondition-handoff",
      1,
    ).pollOnce();
    const outbox = await prisma.emailOutbox.findFirstOrThrow({
      where: {
        idempotencyKey: { startsWith: `recruitment:${companyWork.id}:` },
      },
      select: { id: true, kind: true, status: true },
    });
    expect(outbox.kind).toBe("RECRUITMENT_NOTIFICATION");
    expect(outbox.status).toBe("PENDING");

    const blocked = await runRecruitmentMigrationVerification(
      "--assert-rollback-safe",
    );
    expect(blocked.exitCode).toBe(1);
    expect(JSON.parse(blocked.stdout)).toMatchObject({
      pass: true,
      migrations: {
        "095_company_deletion_manifest": true,
        "096_recruitment_notification_delivery": true,
      },
      sharedRuntime: { activeMaterializedRows: 1 },
      rollback: {
        ready: false,
        blockedByActiveMaterializedRows: true,
      },
    });

    await prisma.emailOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "SENT",
        providerMessageId: "rollback-precondition-drained",
      },
    });
    const ready = await runRecruitmentMigrationVerification(
      "--assert-rollback-safe",
    );
    expect(ready.exitCode).toBe(0);
    expect(JSON.parse(ready.stdout)).toMatchObject({
      pass: true,
      sharedRuntime: { activeMaterializedRows: 0 },
      rollback: {
        ready: true,
        blockedByActiveMaterializedRows: false,
      },
    });
  });

  it("rechecks candidate preferences before a retry can deliver", async () => {
    const work = await prisma.recruitmentNotificationWork.create({
      data: {
        applicationId,
        audience: "CANDIDATE",
        kind: "APPLICATION_STAGE_CHANGED",
        targetReference: fixture.userIds[0]!,
        payloadRef: {
          v: 2,
          event: "APPLICATION_STAGE_CHANGED",
          stage: "VIEWED",
        },
        idempotencyKey: "recruitment-notification-preference-work",
      },
    });
    await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-preference-handoff",
      1,
    ).pollOnce();
    const outbox = await prisma.emailOutbox.findFirstOrThrow({
      where: { idempotencyKey: { startsWith: `recruitment:${work.id}:` } },
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new EmailDeliveryError("SMTP_CONNECTION_TIMEOUT", true),
      )
      .mockResolvedValueOnce({ providerMessageId: "should-not-send" });
    try {
      await new DueOutboxProcessor(
        undefined,
        { send },
        "email-recruitment-preference-initial",
        1,
      ).pollOnce();
      await prisma.applicationNotificationPreference.update({
        where: { applicationId },
        data: { emailEnabled: false },
      });
      await prisma.emailOutbox.update({
        where: { id: outbox.id },
        data: { nextAttemptAt: new Date(0) },
      });
      await new DueOutboxProcessor(
        undefined,
        { send },
        "email-recruitment-preference-retry",
        1,
      ).pollOnce();

      expect(send).toHaveBeenCalledTimes(1);
      expect(
        await prisma.emailOutbox.findUniqueOrThrow({
          where: { id: outbox.id },
          select: { status: true, safeErrorCode: true, attempts: true },
        }),
      ).toEqual({
        status: "DEAD",
        safeErrorCode: "RECRUITMENT_NOTIFICATION_RECIPIENT_NOT_ELIGIBLE",
        attempts: 2,
      });
    } finally {
      await prisma.applicationNotificationPreference.update({
        where: { applicationId },
        data: { emailEnabled: true },
      });
    }
  });

  it("rechecks company membership after handoff and before provider delivery", async () => {
    const companyWork = await prisma.recruitmentNotificationWork.create({
      data: {
        applicationId,
        audience: "COMPANY",
        kind: "APPLICATION_RECEIVED",
        targetReference: fixture.company.id,
        payloadRef: { v: 1, event: "APPLICATION_RECEIVED" },
        idempotencyKey: "recruitment-notification-membership-work",
      },
    });
    await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-membership-handoff",
      1,
    ).pollOnce();
    const outbox = await prisma.emailOutbox.findFirstOrThrow({
      where: {
        idempotencyKey: { startsWith: `recruitment:${companyWork.id}:` },
      },
    });
    const membership = await prisma.companyMembership.findFirstOrThrow({
      where: {
        companyId: fixture.company.id,
        userId: fixture.userIds[1]!,
      },
      select: { id: true, status: true },
    });
    expect(membership.status).toBe("ACTIVE");
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "should-not-send-membership-revoked",
    });
    try {
      await prisma.companyMembership.update({
        where: { id: membership.id },
        data: { status: "SUSPENDED", stateChangedAt: new Date() },
      });
      await new DueOutboxProcessor(
        undefined,
        { send },
        "email-recruitment-membership-revoked",
        1,
      ).pollOnce();

      expect(send).not.toHaveBeenCalled();
      expect(
        await prisma.emailOutbox.findUniqueOrThrow({
          where: { id: outbox.id },
          select: { status: true, safeErrorCode: true },
        }),
      ).toEqual({
        status: "DEAD",
        safeErrorCode: "RECRUITMENT_NOTIFICATION_RECIPIENT_NOT_ELIGIBLE",
      });
    } finally {
      await prisma.companyMembership.update({
        where: { id: membership.id },
        data: { status: "ACTIVE", stateChangedAt: new Date() },
      });
    }
  });

  it("rechecks company account state after handoff and before provider delivery", async () => {
    const companyWork = await prisma.recruitmentNotificationWork.create({
      data: {
        applicationId,
        audience: "COMPANY",
        kind: "APPLICATION_STAGE_CHANGED",
        targetReference: fixture.company.id,
        payloadRef: {
          v: 1,
          event: "APPLICATION_STAGE_CHANGED",
          stage: "VIEWED",
        },
        idempotencyKey: "recruitment-notification-company-account-work",
      },
    });
    await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-company-account-handoff",
      1,
    ).pollOnce();
    const outbox = await prisma.emailOutbox.findFirstOrThrow({
      where: {
        idempotencyKey: { startsWith: `recruitment:${companyWork.id}:` },
      },
    });
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "should-not-send-disabled-company-account",
    });
    try {
      await prisma.userAccount.update({
        where: { id: fixture.userIds[1]! },
        data: { state: "SUSPENDED", stateChangedAt: new Date() },
      });
      await new DueOutboxProcessor(
        undefined,
        { send },
        "email-recruitment-company-account-disabled",
        1,
      ).pollOnce();

      expect(send).not.toHaveBeenCalled();
      expect(
        await prisma.emailOutbox.findUniqueOrThrow({
          where: { id: outbox.id },
          select: { status: true, safeErrorCode: true },
        }),
      ).toEqual({
        status: "DEAD",
        safeErrorCode: "RECRUITMENT_NOTIFICATION_RECIPIENT_NOT_ELIGIBLE",
      });
    } finally {
      await prisma.userAccount.update({
        where: { id: fixture.userIds[1]! },
        data: { state: "ACTIVE", stateChangedAt: new Date() },
      });
    }
  });

  it("terminates an expired lease that already exhausted its attempts", async () => {
    const work = await prisma.recruitmentNotificationWork.create({
      data: {
        applicationId,
        audience: "CANDIDATE",
        kind: "APPLICATION_SUBMITTED",
        targetReference: fixture.userIds[0]!,
        payloadRef: { v: 1, event: "APPLICATION_SUBMITTED" },
        idempotencyKey: "recruitment-notification-expired-exhausted-work",
        status: "PROCESSING",
        attempts: 5,
        leaseOwner: "crashed-worker",
        leaseExpiresAt: new Date(fixture.now.getTime() - 1_000),
        nextAttemptAt: fixture.now,
      },
    });

    const claimed = await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-after-crash",
      1,
    ).pollOnce(fixture.now);

    expect(claimed).toBe(0);
    expect(
      await prisma.recruitmentNotificationWork.findUniqueOrThrow({
        where: { id: work.id },
        select: {
          status: true,
          attempts: true,
          leaseOwner: true,
          leaseExpiresAt: true,
          safeErrorCode: true,
        },
      }),
    ).toEqual({
      status: "DEAD",
      attempts: 5,
      leaseOwner: null,
      leaseExpiresAt: null,
      safeErrorCode: "RECRUITMENT_NOTIFICATION_MAX_ATTEMPTS",
    });
  });

  it("fans out only to active company members and rejects a mismatched target", async () => {
    const companyWork = await prisma.recruitmentNotificationWork.create({
      data: {
        applicationId,
        audience: "COMPANY",
        kind: "APPLICATION_RECEIVED",
        targetReference: fixture.company.id,
        payloadRef: {
          v: 1,
          event: "APPLICATION_RECEIVED",
          applicationId,
        },
        idempotencyKey: "recruitment-notification-company-work",
      },
    });
    await prisma.userAccount.update({
      where: { id: fixture.userIds[1]! },
      data: { state: "DELETED", deletedAt: new Date() },
    });
    const companyPass = await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-company",
      1,
    ).pollOnce();
    expect(companyPass).toBe(1);
    expect(
      await prisma.emailOutbox.count({
        where: {
          idempotencyKey: { startsWith: `recruitment:${companyWork.id}:` },
        },
      }),
    ).toBe(0);

    await prisma.userAccount.update({
      where: { id: fixture.userIds[1]! },
      data: { state: "ACTIVE", deletedAt: null },
    });
    const invalidWork = await prisma.recruitmentNotificationWork.create({
      data: {
        applicationId,
        audience: "CANDIDATE",
        kind: "APPLICATION_SUBMITTED",
        targetReference: fixture.userIds[1]!,
        payloadRef: { v: 1, event: "APPLICATION_SUBMITTED" },
        idempotencyKey: "recruitment-notification-invalid-target",
      },
    });
    await new RecruitmentNotificationWorkProcessor(
      undefined,
      undefined,
      "recruitment-invalid-target",
      1,
    ).pollOnce();
    expect(
      await prisma.recruitmentNotificationWork.findUniqueOrThrow({
        where: { id: invalidWork.id },
        select: { status: true, safeErrorCode: true, attempts: true },
      }),
    ).toEqual({
      status: "DEAD",
      safeErrorCode: "RECRUITMENT_NOTIFICATION_TARGET_MISMATCH",
      attempts: 1,
    });
  });
});
