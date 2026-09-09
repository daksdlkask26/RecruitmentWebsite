import "server-only";

import type { Prisma } from "@/backend/generated/prisma/client";

type RetentionDatabase = {
  activityLegalHold: Pick<Prisma.TransactionClient["activityLegalHold"], "findFirst">;
  applicationDocumentLegalHold: Pick<
    Prisma.TransactionClient["applicationDocumentLegalHold"],
    "findFirst"
  >;
  jobReport: Pick<Prisma.TransactionClient["jobReport"], "findFirst">;
  messagingReport: Pick<Prisma.TransactionClient["messagingReport"], "findFirst">;
  moderationReport: Pick<Prisma.TransactionClient["moderationReport"], "findFirst">;
};

export type CompanyDeletionRetentionBlockCode =
  | "LEGAL_HOLD_ACTIVE"
  | "ACTIVITY_LEGAL_HOLD_ACTIVE"
  | "JOB_REPORT_ACTIVE"
  | "MESSAGING_REPORT_ACTIVE"
  | "MODERATION_REPORT_ACTIVE";

export type CompanyDeletionRetentionBlock = Readonly<{
  code: CompanyDeletionRetentionBlockCode;
}>;

type Scope = Readonly<{
  companyId: string;
  jobIds: readonly string[];
  applicationIds: readonly string[];
  threadIds: readonly string[];
  conversationIds: readonly string[];
  now: Date;
}>;

function targetReferences(scope: Scope) {
  return [
    `company:${scope.companyId}`,
    ...scope.jobIds.flatMap((id) => [`job:${id}`, `job_posting:${id}`]),
    ...scope.applicationIds.flatMap((id) => [
      `application:${id}`,
      `job_application:${id}`,
    ]),
    ...scope.threadIds.map((id) => `recruitment_thread:${id}`),
    ...scope.conversationIds.map((id) => `messaging_conversation:${id}`),
  ];
}

/**
 * All report/hold sources that can make a company or its application history
 * non-purgeable. The returned value is deliberately a machine code only; no
 * report detail, reporter identity, or message content crosses this boundary.
 */
export async function findActiveCompanyDeletionRetentionBlock(
  db: RetentionDatabase,
  scope: Scope,
): Promise<CompanyDeletionRetentionBlock | null> {
  const activityTargets = targetReferences(scope);
  const jobIds = [...scope.jobIds];
  const applicationIds = [...scope.applicationIds];
  const threadIds = [...scope.threadIds];
  const conversationIds = [...scope.conversationIds];

  const [documentHold, activityHold, jobReport, moderationReport, messagingReport] =
    await Promise.all([
      applicationIds.length
        ? db.applicationDocumentLegalHold.findFirst({
            where: {
              jobApplicationId: { in: applicationIds },
              startsAt: { lte: scope.now },
              OR: [{ endsAt: null }, { endsAt: { gt: scope.now } }],
              AND: [{ OR: [{ releasedAt: null }, { releasedAt: { gt: scope.now } }] }],
            },
            select: { id: true },
          })
        : null,
      db.activityLegalHold.findFirst({
        where: {
          scopeType: "TARGET",
          scopeReference: { in: activityTargets },
          startsAt: { lte: scope.now },
          endsAt: { gt: scope.now },
          OR: [{ releasedAt: null }, { releasedAt: { gt: scope.now } }],
        },
        select: { id: true },
      }),
      jobIds.length
        ? db.jobReport.findFirst({
            where: {
              jobPostingId: { in: jobIds },
              status: "PENDING_REVIEW",
            },
            select: { id: true },
          })
        : null,
      db.moderationReport.findFirst({
        where: {
          state: "PENDING_REVIEW",
          OR: [
            { companyReference: scope.companyId },
            ...(jobIds.length
              ? [{ jobReference: { in: jobIds } }]
              : []),
            ...(applicationIds.length
              ? [{ applicationReference: { in: applicationIds } }]
              : []),
            {
              targetType: "COMPANY" as const,
              targetReference: scope.companyId,
            },
            ...(jobIds.length
              ? [{ targetType: "JOB" as const, targetReference: { in: jobIds } }]
              : []),
          ],
        },
        select: { id: true },
      }),
      threadIds.length || conversationIds.length
        ? db.messagingReport.findFirst({
            where: {
              AND: [
                { OR: [{ state: "PENDING_REVIEW" }, { preserveUntil: { gt: scope.now } }] },
                {
                  OR: [
                    ...(threadIds.length
                      ? [{ recruitmentThreadId: { in: threadIds } }]
                      : []),
                    ...(conversationIds.length
                      ? [{ conversationId: { in: conversationIds } }]
                      : []),
                  ],
                },
              ],
            },
            select: { id: true },
          })
        : null,
    ]);

  if (documentHold) return { code: "LEGAL_HOLD_ACTIVE" };
  if (activityHold) return { code: "ACTIVITY_LEGAL_HOLD_ACTIVE" };
  if (jobReport) return { code: "JOB_REPORT_ACTIVE" };
  if (messagingReport) return { code: "MESSAGING_REPORT_ACTIVE" };
  if (moderationReport) return { code: "MODERATION_REPORT_ACTIVE" };
  return null;
}
