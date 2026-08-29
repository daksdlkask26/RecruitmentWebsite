import "server-only";

import type { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";

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
  cvSnapshot: true,
  jobSnapshot: true,
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
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      originalFilenameEncrypted: true,
      mediaType: true,
      byteLength: true,
      committedAt: true,
    },
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
  contactConsent: { select: { sharedAt: true, withdrawnAt: true, version: true } },
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

export class PrismaCandidateApplicationRepository {
  constructor(private readonly db: typeof prisma = prisma) {}

  getTracker(candidateUserId: string, applicationId: string) {
    return this.db.jobApplication.findFirst({
      where: { id: applicationId, candidateUserId },
      select: trackerSelect,
    });
  }

  list(candidateUserId: string, limit: number, cursor?: string) {
    return this.db.jobApplication.findMany({
      where: { candidateUserId },
      orderBy: [{ lastStageChangedAt: "desc" }, { id: "desc" }],
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: limit + 1,
      select: summarySelect,
    });
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
