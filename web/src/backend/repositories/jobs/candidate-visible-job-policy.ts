import "server-only";

import { Prisma } from "@/backend/generated/prisma/client";
import { getPublicCompanySql } from "@/backend/repositories/companies/public-company-visibility-policy";

/**
 * Candidate discovery and private CV Match Check must agree on which jobs can
 * be selected. Keep the SQL and Prisma forms together: callers use the form
 * appropriate for their query without reimplementing a weaker policy.
 */
export function candidateVisibleJobSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    j."status" = 'ACTIVE'::"JobPostingStatus"
    AND j."approvedAt" IS NOT NULL
    AND j."publishedAt" IS NOT NULL AND j."publishedAt" <= ${now}
    AND (j."applicationDeadline" IS NULL OR j."applicationDeadline" > ${now})
    AND EXISTS (
      SELECT 1 FROM "Company" c
      WHERE c."id" = j."companyId"
        AND ${getPublicCompanySql("c")}
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM "JobPostReviewAggregate" r
        WHERE r."publicJobPostingId" = j."id"
      )
      OR EXISTS (
        SELECT 1 FROM "JobPostReviewAggregate" r
        WHERE r."publicJobPostingId" = j."id"
          AND r."approvedVersionId" IS NOT NULL
          AND r."closedAt" IS NULL
          AND r."visibilityState" = 'PUBLISHED'::"JobPostVisibilityState"
      )
    )
  `;
}

export function candidateVisibleJobWhere(
  now: Date,
  jobId?: string,
): Prisma.JobPostingWhereInput {
  return {
    ...(jobId ? { id: jobId } : {}),
    status: "ACTIVE",
    approvedAt: { not: null },
    publishedAt: { not: null, lte: now },
    company: {
      verifiedAt: { not: null },
      verificationState: "ACTIVE",
      verificationInactiveAt: null,
      moderationState: "ACTIVE",
    },
    AND: [
      {
        OR: [
          { applicationDeadline: null },
          { applicationDeadline: { gt: now } },
        ],
      },
      {
        OR: [
          { reviewAggregate: null },
          {
            reviewAggregate: {
              is: {
                approvedVersionId: { not: null },
                closedAt: null,
                visibilityState: "PUBLISHED",
              },
            },
          },
        ],
      },
    ],
  };
}
