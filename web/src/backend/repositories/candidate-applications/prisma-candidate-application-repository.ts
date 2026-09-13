import "server-only";

import type { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import type {
  CandidateApplicationListFilter,
  CandidateApplicationListSort,
} from "@/shared/contracts/candidate-applications";
import type { ApplicationStage } from "@/shared/contracts/jobs/applications";

const trackerSelect = {
  id: true,
  candidateUserId: true,
  jobPostingId: true,
  stage: true,
  stageVersion: true,
  submittedAt: true,
  lastStageChangedAt: true,
  withdrawalOutcome: true,
  withdrawnAt: true,
  documentAccessDeniedAt: true,
  documentDeletedAt: true,
  profileSnapshotAccessDeniedAt: true,
  profileSnapshot: true,
  contactSnapshot: true,
  cvSnapshot: true,
  jobSnapshot: true,
  consentVersion: true,
  consentedAt: true,
  submissionMessage: true,
  // Keep the legacy text column in the projection for applications created
  // before the normalized coverLetterText relation was introduced. The
  // service decodes it without exposing the stored representation and only
  // falls back when the normalized relation is absent.
  coverLetter: true,
  selectedCv: {
    select: {
      id: true,
      displayName: true,
      fileName: true,
      mimeType: true,
      byteSize: true,
      version: true,
      confirmedAt: true,
    },
  },
  jobPosting: {
    select: {
      slug: true,
      title: true,
      location: true,
      employmentType: true,
      experienceLevel: true,
      workArrangement: true,
      applicationDeadline: true,
      status: true,
      removedAt: true,
      company: { select: { displayName: true, logoUrl: true } },
    },
  },
  applicationDocuments: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      originalFilenameEncrypted: true,
      mediaType: true,
      byteLength: true,
      committedAt: true,
      ordinaryAccessDeniedAt: true,
      deleteAfter: true,
      deletedAt: true,
      sourceCandidateCvId: true,
      sourceArtifactId: true,
      scanAssessmentId: true,
      sourceArtifact: {
        select: {
          status: true,
          contentInaccessibleAt: true,
          deletedAt: true,
        },
      },
      scanAssessment: { select: { status: true } },
    },
  },
  coverLetterText: {
    select: {
      textEncrypted: true,
      ordinaryAccessDeniedAt: true,
      deleteAfter: true,
      deletedAt: true,
    },
  },
  answers: {
    orderBy: { createdAt: "asc" },
    select: { questionSnapshot: true, answer: true },
  },
  legalHolds: {
    select: { startsAt: true, endsAt: true, releasedAt: true },
  },
  intake: {
    select: {
      state: true,
      progressPercent: true,
      receivedAt: true,
      checkingStartedAt: true,
      sentAt: true,
      failureCode: true,
      version: true,
      updatedAt: true,
    },
  },
  publicUpdates: {
    orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      kind: true,
      publicStage: true,
      publicOutcome: true,
      title: true,
      variables: true,
      effectiveAt: true,
      sourceEventReference: true,
    },
  },
  stageEvents: {
    where: { candidateVisible: true },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fromStage: true,
      toStage: true,
      occurredAt: true,
      candidateVisibleReason: true,
      candidateVisible: true,
    },
  },
  notificationPreference: {
    select: {
      emailEnabled: true,
      inAppEnabled: true,
      version: true,
      updatedAt: true,
    },
  },
  contactConsent: {
    select: { sharedAt: true, withdrawnAt: true, version: true },
  },
  candidate: {
    select: {
      user: {
        select: {
          preferences: { select: { applicationUpdatesEmail: true } },
        },
      },
    },
  },
} satisfies Prisma.JobApplicationSelect;

const summarySelect = {
  id: true,
  jobPostingId: true,
  stage: true,
  stageVersion: true,
  submittedAt: true,
  lastStageChangedAt: true,
  withdrawalOutcome: true,
  withdrawnAt: true,
  jobSnapshot: true,
  jobPosting: {
    select: {
      slug: true,
      title: true,
      location: true,
      status: true,
      removedAt: true,
      company: { select: { displayName: true, logoUrl: true } },
    },
  },
} satisfies Prisma.JobApplicationSelect;

export type CandidateApplicationTrackerRow = Prisma.JobApplicationGetPayload<{
  select: typeof trackerSelect;
}>;

export type CandidateApplicationSummaryRow = Prisma.JobApplicationGetPayload<{
  select: typeof summarySelect;
}>;

export type CandidateApplicationListInput = {
  candidateUserId: string;
  limit: number;
  filter: CandidateApplicationListFilter;
  sort: CandidateApplicationListSort;
  cursor: { submittedAt: Date; id: string } | null;
};

const candidateListFilters = [
  "ALL",
  "APPLICATION_SUBMITTED",
  "UNDER_REVIEW",
  "INTERVIEW",
  "OUTCOME",
  "WITHDRAWN",
] as const;

function listWhere(
  input: CandidateApplicationListInput,
): Prisma.JobApplicationWhereInput {
  const stage =
    input.filter === "APPLICATION_SUBMITTED"
      ? { in: ["APPLIED"] as ApplicationStage[] }
      : input.filter === "UNDER_REVIEW"
        ? { in: ["VIEWED", "SHORTLISTED"] as ApplicationStage[] }
        : input.filter === "INTERVIEW"
          ? { in: ["INTERVIEWING"] as ApplicationStage[] }
          : input.filter === "OUTCOME"
            ? {
                in: [
                  "OFFERED",
                  "HIRED",
                  "OFFER_DECLINED",
                  "REJECTED",
                  "WAITLISTED",
                ] as ApplicationStage[],
              }
            : undefined;
  const base: Prisma.JobApplicationWhereInput = {
    candidateUserId: input.candidateUserId,
    ...(input.filter === "WITHDRAWN"
      ? { withdrawalOutcome: "CANDIDATE_WITHDRAWN" }
      : input.filter !== "ALL"
        ? { withdrawalOutcome: null, stage }
        : {}),
  };
  if (!input.cursor) return base;
  const after =
    input.sort === "SUBMITTED_DESC"
      ? {
          OR: [
            { submittedAt: { lt: input.cursor.submittedAt } },
            {
              submittedAt: input.cursor.submittedAt,
              id: { lt: input.cursor.id },
            },
          ],
        }
      : {
          OR: [
            { submittedAt: { gt: input.cursor.submittedAt } },
            {
              submittedAt: input.cursor.submittedAt,
              id: { gt: input.cursor.id },
            },
          ],
        };
  return { AND: [base, after] };
}

export class PrismaCandidateApplicationRepository {
  constructor(private readonly db: typeof prisma = prisma) {}

  getTracker(candidateUserId: string, applicationId: string) {
    return this.db.jobApplication.findFirst({
      where: { id: applicationId, candidateUserId },
      select: trackerSelect,
    });
  }

  async list(input: CandidateApplicationListInput) {
    const direction = input.sort === "SUBMITTED_DESC" ? "desc" : "asc";
    const [rows, total, ...filterCounts] = await Promise.all([
      this.db.jobApplication.findMany({
        where: listWhere(input),
        orderBy: [{ submittedAt: direction }, { id: direction }],
        take: input.limit + 1,
        select: summarySelect,
      }),
      this.db.jobApplication.count({
        where: listWhere({ ...input, cursor: null }),
      }),
      ...candidateListFilters.map((filter) =>
        this.db.jobApplication.count({
          where: listWhere({ ...input, filter, cursor: null }),
        }),
      ),
    ]);
    return {
      rows,
      total,
      counts: Object.fromEntries(
        candidateListFilters.map((filter, index) => [
          filter,
          filterCounts[index] ?? 0,
        ]),
      ) as Record<(typeof candidateListFilters)[number], number>,
    };
  }

  preferenceDefaults(row: CandidateApplicationTrackerRow) {
    return {
      emailEnabled:
        row.notificationPreference?.emailEnabled ??
        row.candidate.user.preferences?.applicationUpdatesEmail ??
        true,
      inAppEnabled: row.notificationPreference?.inAppEnabled ?? true,
    };
  }
}
