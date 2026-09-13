import "server-only";
import type { Prisma, PrismaClient } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";

const RECRUITMENT_WORK_LEASE_MS = 60_000;
const RECRUITMENT_WORK_MAX_ATTEMPTS = 5;

const applicationSelect = {
  candidateUserId: true,
  jobPosting: {
    select: {
      id: true,
      companyId: true,
      title: true,
      company: { select: { displayName: true } },
      reviewAggregate: { select: { jobId: true } },
    },
  },
} as const;

export type ClaimedRecruitmentNotificationWork =
  Prisma.RecruitmentNotificationWorkGetPayload<{
    include: { application: { select: typeof applicationSelect } };
  }>;

export class PrismaRecruitmentNotificationWorkRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async claimDue(
    owner: string,
    now: Date,
    limit = 10,
    leaseMs = RECRUITMENT_WORK_LEASE_MS,
  ): Promise<ClaimedRecruitmentNotificationWork[]> {
    const leaseUntil = new Date(now.getTime() + leaseMs);
    await this.db.$executeRaw`
      UPDATE "RecruitmentNotificationWork"
      SET "status" = 'DEAD',
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "safeErrorCode" = 'RECRUITMENT_NOTIFICATION_MAX_ATTEMPTS',
          "updatedAt" = ${now}
      WHERE "attempts" >= ${RECRUITMENT_WORK_MAX_ATTEMPTS}
        AND (
          "status" IN ('PENDING', 'RETRYABLE')
          OR ("status" = 'PROCESSING' AND "leaseExpiresAt" <= ${now})
        )
    `;
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      WITH due AS (
        SELECT "id"
        FROM "RecruitmentNotificationWork"
        WHERE (("status" IN ('PENDING', 'RETRYABLE')
              AND "nextAttemptAt" <= ${now}
              AND "attempts" < ${RECRUITMENT_WORK_MAX_ATTEMPTS})
          OR ("status" = 'PROCESSING'
              AND "leaseExpiresAt" <= ${now}
              AND "attempts" < ${RECRUITMENT_WORK_MAX_ATTEMPTS}))
        ORDER BY "nextAttemptAt", "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "RecruitmentNotificationWork" work
      SET "status" = 'PROCESSING',
          "leaseOwner" = ${owner},
          "leaseExpiresAt" = ${leaseUntil},
          "attempts" = work."attempts" + 1,
          "updatedAt" = ${now}
      FROM due
      WHERE work."id" = due."id"
      RETURNING work."id"
    `;
    if (!rows.length) return [];
    return this.db.recruitmentNotificationWork.findMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        leaseOwner: owner,
        status: "PROCESSING",
      },
      include: { application: { select: applicationSelect } },
      orderBy: { createdAt: "asc" },
    });
  }

  async markSent(id: string, owner: string) {
    return this.db.recruitmentNotificationWork.updateMany({
      where: { id, leaseOwner: owner, status: "PROCESSING" },
      data: {
        status: "SENT",
        leaseOwner: null,
        leaseExpiresAt: null,
        safeErrorCode: null,
      },
    });
  }

  async markFailure(input: {
    id: string;
    owner: string;
    attempts: number;
    code: string;
    retryable: boolean;
    now: Date;
  }) {
    const dead =
      !input.retryable || input.attempts >= RECRUITMENT_WORK_MAX_ATTEMPTS;
    const delaySeconds = Math.min(
      3600,
      30 * 2 ** Math.max(0, input.attempts - 1),
    );
    return this.db.recruitmentNotificationWork.updateMany({
      where: { id: input.id, leaseOwner: input.owner, status: "PROCESSING" },
      data: {
        status: dead ? "DEAD" : "RETRYABLE",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(input.now.getTime() + delaySeconds * 1000),
        safeErrorCode: input.code,
      },
    });
  }
}

export { RECRUITMENT_WORK_LEASE_MS, RECRUITMENT_WORK_MAX_ATTEMPTS };
