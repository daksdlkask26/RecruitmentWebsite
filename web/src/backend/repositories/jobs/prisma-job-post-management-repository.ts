import "server-only";
import {
  Prisma,
  type Prisma as PrismaTypes,
} from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import { FEATURED_PLACEMENT_CAPACITY } from "@/backend/jobs/management/job-post-feature-policy";
import { maskEmail } from "@/backend/repositories/admin/prisma-account-directory-repository";
import type { z } from "zod";
import type { jobManagementListQuerySchema } from "@/shared/contracts/admin/job-post-management";
import { appendJobPostingLifecycleFact } from "@/backend/repositories/analytics/prisma-analytics-repository";

type Transaction = PrismaTypes.TransactionClient;
type JobManagementListInput = z.infer<typeof jobManagementListQuerySchema>;

/** Safe, consolidated management projections. Reporter identities never leave this boundary. */
export async function listManagedJobPosts(input: JobManagementListInput) {
  const search = input.q?.toLowerCase();
  const reportGroups =
    input.reportState === "ANY" || (!input.reportState && !input.minimumReports)
      ? []
      : await prisma.moderationReport.groupBy({
          by: ["jobReference"],
          where: { jobReference: { not: null }, state: "PENDING_REVIEW" },
          _count: { _all: true },
        });
  const matchingReportJobIds = reportGroups
    .filter((row) =>
      input.minimumReports ? row._count._all >= input.minimumReports : true,
    )
    .map((row) => row.jobReference)
    .filter((jobId): jobId is string => Boolean(jobId));
  const where: Prisma.JobPostReviewAggregateWhereInput = {
    approvedVersionId: { not: null },
    ...(input.visibility ? { visibilityState: input.visibility } : {}),
    ...(input.applicationState
      ? { applicationState: input.applicationState }
      : {}),
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.featured
      ? {
          featuredPlacements: {
            some: { state: { in: ["SCHEDULED", "ACTIVE"] } },
          },
        }
      : {}),
    ...(input.reportState === "REPORTED" || input.minimumReports
      ? { jobId: { in: matchingReportJobIds } }
      : input.reportState === "UNREPORTED"
        ? {
            jobId: {
              notIn: reportGroups
                .map((row) => row.jobReference)
                .filter((id): id is string => Boolean(id)),
            },
          }
        : {}),
    AND: [
      ...(input.recruiterId
        ? [
            {
              approvedVersion: { is: { submittedByUserId: input.recruiterId } },
            },
          ]
        : []),
      ...(input.approverId
        ? [
            {
              approvedVersion: {
                is: { decidedByAdminUserId: input.approverId },
              },
            },
          ]
        : []),
      ...(input.approvedFrom || input.approvedTo
        ? [
            {
              publicJobPosting: {
                is: {
                  approvedAt: {
                    ...(input.approvedFrom ? { gte: input.approvedFrom } : {}),
                    ...(input.approvedTo ? { lte: input.approvedTo } : {}),
                  },
                },
              },
            },
          ]
        : []),
      ...(input.publishedFrom || input.publishedTo
        ? [
            {
              publicJobPosting: {
                is: {
                  publishedAt: {
                    ...(input.publishedFrom
                      ? { gte: input.publishedFrom }
                      : {}),
                    ...(input.publishedTo ? { lte: input.publishedTo } : {}),
                  },
                },
              },
            },
          ]
        : []),
    ],
    ...(search
      ? {
          OR: [
            {
              publicJobPosting: {
                is: { normalizedTitle: { contains: search } },
              },
            },
            {
              company: {
                displayName: { contains: input.q!, mode: "insensitive" },
              },
            },
            {
              approvedVersion: {
                submittedBy: {
                  is: { name: { contains: input.q!, mode: "insensitive" } },
                },
              },
            },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.jobPostReviewAggregate.findMany({
      where,
      skip: (input.page - 1) * input.perPage,
      take: input.perPage,
      orderBy: { updatedAt: "desc" },
      include: {
        company: { select: { displayName: true } },
        publicJobPosting: {
          select: { title: true, approvedAt: true, publishedAt: true },
        },
        approvedVersion: {
          select: {
            submittedBy: { select: { name: true } },
            decidedByAdmin: { select: { name: true } },
          },
        },
        featuredPlacements: {
          where: { state: { in: ["SCHEDULED", "ACTIVE"] } },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma.jobPostReviewAggregate.count({ where }),
  ]);
  const [reportRows, applicationRows] = await Promise.all([
    prisma.moderationReport.groupBy({
      by: ["jobReference"],
      where: {
        jobReference: { in: rows.map((row) => row.jobId) },
        state: "PENDING_REVIEW",
      },
      _count: { _all: true },
    }),
    prisma.jobApplication.groupBy({
      by: ["jobPostingId"],
      where: { jobPostingId: { in: rows.map((row) => row.jobId) } },
      _count: { _all: true },
    }),
  ]);
  const reportCount = new Map(
    reportRows.map((row) => [row.jobReference, row._count._all]),
  );
  const applicationCount = new Map(
    applicationRows.map((row) => [row.jobPostingId, row._count._all]),
  );
  return {
    data: rows.map((row) => ({
      id: row.jobId,
      title: row.publicJobPosting?.title ?? "Unavailable job",
      company: row.company.displayName,
      recruiter: row.approvedVersion?.submittedBy?.name ?? null,
      approver: row.approvedVersion?.decidedByAdmin?.name ?? null,
      visibility: row.visibilityState,
      applicationState: row.applicationState,
      applicationCount: applicationCount.get(row.jobId) ?? 0,
      approvedAt: row.publicJobPosting?.approvedAt?.toISOString() ?? null,
      publishedAt: row.publicJobPosting?.publishedAt?.toISOString() ?? null,
      featured: row.featuredPlacements.length > 0,
      reportCount: reportCount.get(row.jobId) ?? 0,
      version: row.version,
    })),
    total,
  };
}

export async function findManagedJobPostDetail(jobId: string) {
  const row = await prisma.jobPostReviewAggregate.findUnique({
    where: { jobId },
    include: {
      company: {
        select: { id: true, displayName: true, verificationState: true },
      },
      publicJobPosting: true,
      approvedVersion: {
        include: {
          submittedBy: { select: { id: true, name: true, email: true } },
          decidedByAdmin: { select: { id: true, name: true } },
        },
      },
      pendingVersion: {
        select: { id: true, sequence: true, submittedAt: true, state: true },
      },
      correctionRequests: { orderBy: { createdAt: "desc" } },
      featuredPlacements: { orderBy: { startsAt: "desc" } },
      operationalHistory: { orderBy: { occurredAt: "desc" }, take: 100 },
      enforcementTargets: {
        include: { enforcementAction: { include: { reportLinks: true } } },
      },
    },
  });
  if (!row) return null;
  const [reports, applicationCount] = await Promise.all([
    prisma.moderationReport.findMany({
      where: { jobReference: jobId, state: "PENDING_REVIEW" },
      select: {
        id: true,
        reporterUserId: true,
        priority: true,
        category: true,
        createdAt: true,
      },
    }),
    prisma.jobApplication.count({ where: { jobPostingId: jobId } }),
  ]);
  const priorities = { CRITICAL: 3, HIGH: 2, NORMAL: 1 } as const;
  const highestPriority = reports.reduce<keyof typeof priorities | null>(
    (highest, report) =>
      !highest || priorities[report.priority] > priorities[highest]
        ? report.priority
        : highest,
    null,
  );
  return {
    ...row,
    id: row.jobId,
    version: row.version,
    reportSummary: {
      activeCount: reports.length,
      distinctReporterCount: new Set(
        reports.map((report) => report.reporterUserId),
      ).size,
      highestPriority,
    },
    reports: reports.map(({ reporterUserId: _reporterUserId, ...report }) => {
      void _reporterUserId;
      return { ...report };
    }),
    applicationCount,
    recruiterContact: row.approvedVersion?.submittedBy
      ? {
          name: row.approvedVersion.submittedBy.name,
          maskedEmail: maskEmail(row.approvedVersion.submittedBy.email),
        }
      : null,
  };
}

export async function findManagedJobPostForCommand(
  tx: Transaction,
  jobId: string,
) {
  return tx.jobPostReviewAggregate.findUnique({
    where: { jobId },
    include: {
      publicJobPosting: {
        select: { id: true, applicationDeadline: true },
      },
      approvedVersion: { select: { submittedByUserId: true } },
    },
  });
}

export async function syncManagedJobPublicProjection(
  tx: Transaction,
  input: {
    publicJobPostingId: string;
    visibility: "PUBLISHED" | "HIDDEN" | "ARCHIVED";
    applicationState: "OPEN" | "CLOSED";
    now: Date;
    actorUserId?: string | null;
    correlationId?: string;
  },
) {
  const status =
    input.visibility === "PUBLISHED"
      ? input.applicationState === "OPEN"
        ? "ACTIVE"
        : "CLOSED"
      : "REMOVED";
  const current = await tx.jobPosting.findUniqueOrThrow({
    where: { id: input.publicJobPostingId },
    select: { status: true },
  });
  const updated = await tx.jobPosting.update({
    where: { id: input.publicJobPostingId },
    data: {
      status,
      closedAt: input.applicationState === "CLOSED" ? input.now : null,
      removedAt: input.visibility === "PUBLISHED" ? null : input.now,
      version: { increment: 1 },
    },
  });
  await appendJobPostingLifecycleFact(tx, {
    jobPostingId: updated.id,
    companyId: updated.companyId,
    fromStatus: current.status,
    toStatus: updated.status,
    effectiveAt: input.now,
    postingVersion: updated.version,
    actorUserId: input.actorUserId,
    correlationId: input.correlationId ?? "job-post-management:" + updated.id,
  });
  return updated;
}

export async function reserveManagedJobFeaturePlacement(
  tx: Transaction,
  input: {
    aggregateId: string;
    featureId?: string;
    placement: "HOME_FEATURED" | "SEARCH_FEATURED";
    startsAt: Date;
    endsAt: Date;
    priority: number;
    reason: string;
    createdByAdminUserId: string;
    now: Date;
  },
) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.placement}))`,
  );
  const booked = await tx.jobPostFeaturedPlacement.count({
    where: {
      placement: input.placement,
      state: { in: ["SCHEDULED", "ACTIVE"] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      ...(input.featureId ? { id: { not: input.featureId } } : {}),
    },
  });
  if (booked >= FEATURED_PLACEMENT_CAPACITY) {
    throw new Error("FEATURE_CAPACITY_CONFLICT");
  }
  const state = input.startsAt <= input.now ? "ACTIVE" : "SCHEDULED";
  if (!input.featureId) {
    return tx.jobPostFeaturedPlacement.create({
      data: {
        aggregateId: input.aggregateId,
        placement: input.placement,
        priority: input.priority,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        state,
        reason: input.reason,
        createdByAdminUserId: input.createdByAdminUserId,
      },
    });
  }
  const changed = await tx.jobPostFeaturedPlacement.updateMany({
    where: {
      id: input.featureId,
      aggregateId: input.aggregateId,
      state: { in: ["SCHEDULED", "ACTIVE"] },
    },
    data: {
      placement: input.placement,
      priority: input.priority,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      state,
      reason: input.reason,
      version: { increment: 1 },
    },
  });
  if (changed.count !== 1) throw new Error("TARGET_UNAVAILABLE");
  return changed;
}
