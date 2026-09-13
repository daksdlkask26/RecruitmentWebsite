import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import { serverEnvironment } from "@/backend/env/runtime";
import { applicationStageSchema } from "@/shared/contracts/jobs/applications";
import { safeErrorCode } from "@/backend/security/redaction";
import { PrismaOutboxRepository } from "@/backend/repositories/email/outbox-repository";
import {
  PrismaRecruitmentNotificationWorkRepository,
  type ClaimedRecruitmentNotificationWork,
} from "@/backend/repositories/notifications/recruitment-notification-work-repository";
import { z } from "zod";

const sourcePayloadSchema = z
  .object({
    v: z.number().int().min(1).max(10),
    event: z.string().trim().min(1).max(120),
    stage: z.string().trim().min(1).max(80).optional(),
  })
  .passthrough();

const companyRecipientRoles = [
  "OWNER",
  "HR_MANAGER",
  "RECRUITER",
  "HIRING_MANAGER",
] as const;

type NotificationDb = PrismaClient | Prisma.TransactionClient;

class RecruitmentNotificationWorkError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "RecruitmentNotificationWorkError";
  }
}

function permanent(code: string): never {
  throw new RecruitmentNotificationWorkError(code, false);
}

function retryAt(attempts: number, now: Date) {
  const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delaySeconds * 1000);
}

function normalizedStage(row: ClaimedRecruitmentNotificationWork) {
  const payload = sourcePayloadSchema.safeParse(row.payloadRef);
  if (!payload.success) permanent("RECRUITMENT_NOTIFICATION_PAYLOAD_INVALID");
  if (row.kind !== "APPLICATION_STAGE_CHANGED") return undefined;
  const stage = applicationStageSchema.safeParse(payload.data.stage);
  if (!stage.success) permanent("RECRUITMENT_NOTIFICATION_STAGE_INVALID");
  return stage.data;
}

async function recipientUserIds(
  db: NotificationDb,
  row: ClaimedRecruitmentNotificationWork,
) {
  const application = row.application;
  if (row.audience === "CANDIDATE") {
    if (row.targetReference !== application.candidateUserId)
      permanent("RECRUITMENT_NOTIFICATION_TARGET_MISMATCH");
    const [user, preference] = await Promise.all([
      db.userAccount.findFirst({
        where: { id: row.targetReference, state: "ACTIVE", deletedAt: null },
        select: {
          id: true,
          preferences: { select: { applicationUpdatesEmail: true } },
        },
      }),
      db.applicationNotificationPreference.findUnique({
        where: { applicationId: row.applicationId },
        select: { emailEnabled: true },
      }),
    ]);
    if (
      !user ||
      !(preference?.emailEnabled ?? true) ||
      !(user.preferences?.applicationUpdatesEmail ?? true)
    )
      return [];
    return [user.id];
  }

  if (row.targetReference !== application.jobPosting.companyId)
    permanent("RECRUITMENT_NOTIFICATION_TARGET_MISMATCH");
  const memberships = await db.companyMembership.findMany({
    where: {
      companyId: row.targetReference,
      status: "ACTIVE",
      role: { in: [...companyRecipientRoles] },
      user: { state: "ACTIVE", deletedAt: null },
    },
    select: {
      user: {
        select: {
          id: true,
          preferences: { select: { applicationUpdatesEmail: true } },
        },
      },
    },
    orderBy: { userId: "asc" },
  });
  return [
    ...new Set(
      memberships
        .filter(({ user }) => user.preferences?.applicationUpdatesEmail ?? true)
        .map(({ user }) => user.id),
    ),
  ];
}

function emailPayload(
  row: ClaimedRecruitmentNotificationWork,
  stage: ReturnType<typeof normalizedStage>,
) {
  const job = row.application.jobPosting;
  const jobId = job.reviewAggregate?.jobId ?? job.id;
  const applicationUrl =
    row.audience === "CANDIDATE"
      ? `/jobs/applied/${encodeURIComponent(row.applicationId)}`
      : `/recruiter/candidates/${encodeURIComponent(jobId)}?application=${encodeURIComponent(row.applicationId)}`;
  const absoluteApplicationUrl = new URL(
    applicationUrl,
    serverEnvironment.NEXT_PUBLIC_APP_URL,
  ).toString();
  return {
    v: 1 as const,
    audience: row.audience,
    notificationKind: row.kind,
    applicationId: row.applicationId,
    jobId,
    jobTitle: job.title,
    companyName: job.company.displayName,
    ...(stage ? { stage } : {}),
    applicationUrl: absoluteApplicationUrl,
  } satisfies Prisma.InputJsonObject;
}

export class RecruitmentNotificationWorkProcessor {
  private stopping = false;

  constructor(
    private readonly repository = new PrismaRecruitmentNotificationWorkRepository(),
    private readonly db: PrismaClient = prisma,
    private readonly owner = `recruitment-worker:${randomUUID()}`,
    private readonly batchSize = 10,
  ) {}

  stop() {
    this.stopping = true;
  }

  private async materialize(row: ClaimedRecruitmentNotificationWork) {
    const stage = normalizedStage(row);
    await this.db.$transaction(async (tx) => {
      const recipients = await recipientUserIds(tx, row);
      const outbox = new PrismaOutboxRepository(tx);
      const payload = emailPayload(row, stage);
      for (const userId of recipients) {
        await outbox.enqueueIdempotent({
          kind: "RECRUITMENT_NOTIFICATION",
          userId,
          recipientRef: userId,
          templateVersion: "recruitment-notification.v1",
          payloadRef: payload,
          idempotencyKey: `recruitment:${row.id}:${userId}`,
        });
      }
      const changed = await tx.recruitmentNotificationWork.updateMany({
        where: { id: row.id, leaseOwner: this.owner, status: "PROCESSING" },
        data: {
          status: "SENT",
          leaseOwner: null,
          leaseExpiresAt: null,
          safeErrorCode: null,
        },
      });
      if (changed.count !== 1)
        throw new Error("RECRUITMENT_NOTIFICATION_LEASE_LOST");
    });
  }

  async pollOnce(now = new Date()) {
    if (this.stopping) return 0;
    const rows = await this.repository.claimDue(
      this.owner,
      now,
      this.batchSize,
    );
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.materialize(row);
        } catch (error) {
          await this.repository.markFailure({
            id: row.id,
            owner: this.owner,
            attempts: row.attempts,
            code: safeErrorCode(error),
            retryable:
              !(error instanceof RecruitmentNotificationWorkError) ||
              error.retryable,
            now,
          });
        }
      }),
    );
    return rows.length;
  }

  async run(pollMs = 1000) {
    while (!this.stopping) {
      const count = await this.pollOnce();
      if (!count && !this.stopping)
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export { retryAt as recruitmentNotificationRetryAt };
