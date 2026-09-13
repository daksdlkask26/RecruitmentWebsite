import "server-only";

import type {
  ApplicationPage,
  ApplicationStage,
  PipelineBoardColumnStage,
  PipelineApplicationCard,
} from "@/shared/contracts/applications";

export type PipelineStageCounts = Record<ApplicationStage, number>;
export type PipelineStageRepositoryPage = Readonly<{
  items: ReadonlyArray<
    Omit<PipelineApplicationCard, "allowedDestinations" | "dragDestinations">
  >;
  nextCursor: string | null;
}>;

export type ApplicationDocumentRecord = Readonly<{
  applicationId: string;
  jobId: string;
  stage?: ApplicationStage;
  stageVersion?: number;
  kind: "cv" | "cover-letter";
  fileName: string | null;
  mediaType: string | null;
  byteLength: number;
  storageKey: string | null;
  text: string | null;
  previewSupported: boolean;
  contentVersion?: string | null;
  applicationProfileSnapshot?: unknown;
  sourceCandidateCvId?: string | null;
  sourceArtifactId?: string | null;
  scanAssessmentId?: string | null;
  scanStatus?: string | null;
  uploadId?: string | null;
  candidateUserId?: string | null;
}>;

export type RecruitmentPipelineRepositoryPort = Readonly<{
  countPipelineStages(jobId: string): Promise<PipelineStageCounts>;
  countWithdrawnApplications?(jobId: string): Promise<number>;
  latestUpdatedAt?(jobId: string): Promise<Date | null>;
  listPipelineStage(input: {
    jobId: string;
    stage: PipelineBoardColumnStage;
    limit: number;
    cursor?: string;
  }): Promise<PipelineStageRepositoryPage>;
}>;

export type ApplicationRepositoryPort = Readonly<{
  listSubmittedCandidates(input: {
    jobId: string;
    limit: number;
    cursor?: string;
    now?: Date;
  }): Promise<ApplicationPage>;
  findDocument(input: {
    jobId?: string;
    candidateUserId?: string;
    applicationId: string;
    kind: "cv" | "cover-letter";
    now?: Date;
  }): Promise<ApplicationDocumentRecord | null>;
}>;
