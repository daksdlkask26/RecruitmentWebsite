import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { safeCvFilename as safeFilename } from "@/backend/cv/safe-filename";
import {
  applicationPageSchema,
  pipelineApplicationStages,
  pipelineScoreSchema,
  pipelineStagePageSchema,
  type ApplicationPage,
  type PipelineBoardColumnStage,
} from "@/shared/contracts/applications";
import type {
  ApplicationDocumentRecord,
  ApplicationRepositoryPort,
  RecruitmentPipelineRepositoryPort,
  PipelineStageCounts,
  PipelineStageRepositoryPage,
} from "./application-repository";
import {
  automaticScoreBand,
  automaticScoreConfigForPublishedResult,
} from "@/backend/applications/services/automatic-score-stage-config";

const cursorVersion = 1;
const cursorSecret = () =>
  process.env.APPLICATION_CURSOR_SECRET ?? "local-application-cursor-secret";

type Cursor = Readonly<{
  v: number;
  jobId: string;
  submittedAt: string;
  id: string;
}>;

type PipelineCursor = Cursor & Readonly<{ stage: PipelineBoardColumnStage }>;

function encodeCursor(cursor: Cursor): string {
  const body = Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", cursorSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function decodeCursor(value: string | undefined, jobId: string): Cursor | null {
  if (!value || value.length > 512) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", cursorSecret())
    .update(body)
    .digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<Cursor>;
    if (
      parsed.v !== cursorVersion ||
      parsed.jobId !== jobId ||
      typeof parsed.id !== "string" ||
      typeof parsed.submittedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.submittedAt))
    ) {
      return null;
    }
    return parsed as Cursor;
  } catch {
    return null;
  }
}

function encodePipelineCursor(cursor: PipelineCursor): string {
  const body = Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", cursorSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function decodePipelineCursor(
  value: string | undefined,
  jobId: string,
  stage: PipelineBoardColumnStage,
): PipelineCursor | null {
  const parsed = decodeCursor(value, jobId) as PipelineCursor | null;
  return parsed?.stage === stage ? parsed : null;
}

function safeAvatar(value: string | null): string | null {
  if (!value || !/^https:\/\//iu.test(value)) return null;
  return value.length <= 500 ? value : null;
}

function sharedPhone(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const phone = (value as Record<string, unknown>).phone;
  return typeof phone === "string" && phone.length <= 32 ? phone : null;
}

function previewSupported(mediaType: string): boolean {
  return [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ].includes(mediaType);
}

function decodeCoverLetterText(value: string): string {
  if (!value.startsWith("b64:v1:")) return value;
  try {
    return Buffer.from(value.slice("b64:v1:".length), "base64").toString(
      "utf8",
    );
  } catch {
    return value;
  }
}

function isInternalFilename(value: string | null): boolean {
  return Boolean(
    value &&
    (/^(?:imported-cv|application-cv|candidate-cv)-[A-Za-z0-9-]+\.[A-Za-z0-9]{1,8}$/iu.test(
      value,
    ) ||
      /^[A-Za-z0-9_-]{32,128}\.[A-Za-z0-9]{1,8}$/u.test(value)),
  );
}

async function originalFilename(input: {
  db: typeof prisma;
  kind: "cv" | "cover-letter";
  candidateOwned?: boolean;
  application: {
    candidateUserId: string;
    selectedCvId: string;
    selectedCv: { fileName: string } | null;
  };
  document: {
    originalFilenameEncrypted: string;
    sourceCandidateCvId: string | null;
  };
}): Promise<string> {
  if (input.candidateOwned) {
    // The source column is named *Encrypted* and may contain an internal
    // envelope. Candidate routes receive a neutral filename; storage and
    // encryption metadata never crosses that boundary.
    return input.kind === "cv" ? "candidate-cv.pdf" : "cover-letter.pdf";
  }
  const stored = input.document.originalFilenameEncrypted;
  if (!isInternalFilename(stored)) return stored;
  const sourceId =
    input.document.sourceCandidateCvId ?? input.application.selectedCvId;
  if (sourceId.startsWith("candidate-cv-")) {
    const uploadId = sourceId.slice("candidate-cv-".length);
    const upload = await input.db.cvUpload.findFirst({
      where: { id: uploadId, accountId: input.application.candidateUserId },
      select: { accountId: true, displayFilenameCiphertext: true },
    });
    const recovered = safeFilename(upload?.displayFilenameCiphertext ?? null, {
      accountId: input.application.candidateUserId,
      uploadId,
    });
    if (recovered && !isInternalFilename(recovered)) return recovered;
  }
  const selected = input.application.selectedCv?.fileName;
  if (selected && !isInternalFilename(selected)) return selected;
  return input.kind === "cv" ? "candidate-cv.pdf" : "cover-letter.pdf";
}

function coverLetterProjection(row: {
  applicationDocuments: Array<{
    kind: string;
    mediaType: string;
    deletedAt: Date | null;
  }>;
  coverLetterText: { deletedAt: Date | null } | null;
  coverLetter: string | null;
}): ApplicationPage["items"][number]["coverLetter"] {
  const file = row.applicationDocuments.find(
    (document) => document.kind === "COVER_LETTER" && !document.deletedAt,
  );
  if (file) {
    return {
      kind:
        file.mediaType === "application/pdf"
          ? "PDF"
          : file.mediaType === "application/msword"
            ? "DOC"
            : "DOCX",
      available: true,
      previewSupported: previewSupported(file.mediaType),
    };
  }
  if (row.coverLetterText && !row.coverLetterText.deletedAt) {
    return { kind: "TEXT", available: true, previewSupported: true };
  }
  if (row.coverLetter) {
    return { kind: "TEXT", available: true, previewSupported: true };
  }
  return { kind: "NONE" };
}

export class PrismaApplicationRepository
  implements ApplicationRepositoryPort, RecruitmentPipelineRepositoryPort
{
  constructor(private readonly db: typeof prisma = prisma) {}

  async countPipelineStages(jobId: string): Promise<PipelineStageCounts> {
    const grouped = await this.db.jobApplication.groupBy({
      by: ["stage"],
      where: {
        jobPostingId: jobId,
        withdrawalOutcome: null,
        documentDeletedAt: null,
        candidate: { user: { emailVerified: true } },
      },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      pipelineApplicationStages.map((stage) => [stage, 0]),
    ) as PipelineStageCounts;
    for (const row of grouped) counts[row.stage] = row._count._all;
    return counts;
  }

  async countWithdrawnApplications(jobId: string): Promise<number> {
    return this.db.jobApplication.count({
      where: {
        jobPostingId: jobId,
        withdrawalOutcome: "CANDIDATE_WITHDRAWN",
        documentDeletedAt: null,
        candidate: { user: { emailVerified: true } },
      },
    });
  }

  async latestUpdatedAt(jobId: string): Promise<Date | null> {
    const row = await this.db.jobApplication.findFirst({
      where: {
        jobPostingId: jobId,
        documentDeletedAt: null,
        candidate: { user: { emailVerified: true } },
      },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }

  async listPipelineStage(input: {
    jobId: string;
    stage: PipelineBoardColumnStage;
    limit: number;
    cursor?: string;
  }): Promise<PipelineStageRepositoryPage> {
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const cursor = decodePipelineCursor(input.cursor, input.jobId, input.stage);
    if (input.cursor && !cursor) throw new Error("INVALID_CURSOR");
    const withdrawn = input.stage === "WITHDRAWN";
    const canonicalStage =
      input.stage === "WITHDRAWN" ? undefined : input.stage;
    const rows = await this.db.jobApplication.findMany({
      where: {
        jobPostingId: input.jobId,
        ...(withdrawn
          ? { withdrawalOutcome: "CANDIDATE_WITHDRAWN" as const }
          : { stage: canonicalStage!, withdrawalOutcome: null }),
        documentDeletedAt: null,
        candidate: { user: { emailVerified: true } },
        AND: [
          ...(cursor
            ? [
                {
                  OR: [
                    { submittedAt: { lt: new Date(cursor.submittedAt) } },
                    {
                      submittedAt: new Date(cursor.submittedAt),
                      id: { lt: cursor.id },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        submittedAt: true,
        stage: true,
        withdrawalOutcome: true,
        stageVersion: true,
        scoringStatus: true,
        currentScoringResult: {
          select: {
            state: true,
            finalScore: true,
            aiScore: true,
            mediumThreshold: true,
            highThreshold: true,
          },
        },
        candidate: {
          select: {
            user: { select: { name: true, image: true, emailVerified: true } },
          },
        },
        applicationDocuments: {
          where: { committedAt: { not: null }, deletedAt: null },
          select: { kind: true },
        },
        coverLetterText: { select: { deletedAt: true } },
        coverLetter: true,
      },
    });
    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => {
      const final =
        row.currentScoringResult?.state === "SCORED" &&
        row.currentScoringResult.finalScore !== null
          ? Number(row.currentScoringResult.finalScore)
          : null;
      const aiScore =
        row.currentScoringResult?.state === "SCORED" &&
        row.currentScoringResult.aiScore !== null
          ? Number(row.currentScoringResult.aiScore)
          : null;
      const scoreConfig = automaticScoreConfigForPublishedResult({
        mediumThreshold: row.currentScoringResult?.mediumThreshold,
        highThreshold: row.currentScoringResult?.highThreshold,
      });
      const scoreState =
        row.currentScoringResult?.state === "SCORED" &&
        (final !== null || aiScore !== null)
          ? "SCORED"
          : row.currentScoringResult?.state === "DETERMINISTIC_ONLY"
            ? "UNAVAILABLE"
            : row.scoringStatus === "PENDING"
              ? "PENDING"
              : row.scoringStatus === "PROCESSING"
                ? "PROCESSING"
                : row.scoringStatus === "FAILED"
                  ? "FAILED"
                  : "NOT_CALCULATED";
      const score =
        scoreState === "NOT_CALCULATED"
          ? null
          : pipelineScoreSchema.parse({
              state: scoreState,
              final,
              aiScore,
              band:
                final === null
                  ? null
                  : (() => {
                      const band = automaticScoreBand(final, scoreConfig);
                      return { code: band.code, label: band.label };
                    })(),
              aiScoreBand:
                aiScore === null
                  ? null
                  : (() => {
                      const band = automaticScoreBand(aiScore, scoreConfig);
                      return { code: band.code, label: band.label };
                    })(),
            });
      return {
        applicationId: row.id,
        candidate: {
          displayName: row.candidate.user.name,
          avatarUrl: safeAvatar(row.candidate.user.image),
        },
        submittedAt: row.submittedAt.toISOString(),
        stage: row.stage,
        withdrawalOutcome: row.withdrawalOutcome,
        stageVersion: row.stageVersion,
        documents: {
          cvAvailable: row.applicationDocuments.some(
            (document) => document.kind === "CV",
          ),
          coverLetterAvailable:
            row.applicationDocuments.some(
              (document) => document.kind === "COVER_LETTER",
            ) ||
            Boolean(row.coverLetterText && !row.coverLetterText.deletedAt) ||
            Boolean(row.coverLetter),
        },
        score,
      };
    });
    const last = items.at(-1);
    const nextCursor =
      hasNext && last
        ? encodePipelineCursor({
            v: cursorVersion,
            jobId: input.jobId,
            stage: input.stage,
            submittedAt: last.submittedAt,
            id: last.applicationId,
          })
        : null;
    const parsed = pipelineStagePageSchema
      .omit({ stage: true, observedAt: true })
      .parse({
        items: items.map((item) => ({ ...item, allowedDestinations: [] })),
        nextCursor,
      });
    return {
      items: parsed.items.map((card) => {
        const { allowedDestinations, ...item } = card;
        void allowedDestinations;
        return item;
      }),
      nextCursor: parsed.nextCursor,
    };
  }

  async listSubmittedCandidates(input: {
    jobId: string;
    limit: number;
    cursor?: string;
    now?: Date;
  }): Promise<ApplicationPage> {
    const cursor = decodeCursor(input.cursor, input.jobId);
    if (input.cursor && !cursor) throw new Error("INVALID_CURSOR");
    const now = input.now ?? new Date();
    const rows = await this.db.jobApplication.findMany({
      where: {
        jobPostingId: input.jobId,
        legacyDocumentState: { not: "UNAVAILABLE" },
        documentDeletedAt: null,
        AND: [
          {
            OR: [
              { documentAccessDeniedAt: null },
              { documentAccessDeniedAt: { gt: now } },
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { submittedAt: { lt: new Date(cursor.submittedAt) } },
                    {
                      submittedAt: new Date(cursor.submittedAt),
                      id: { lt: cursor.id },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: Math.min(input.limit, 100) + 1,
      select: {
        id: true,
        submittedAt: true,
        stage: true,
        contactSnapshot: true,
        contactConsent: { select: { sharedAt: true, withdrawnAt: true } },
        coverLetter: true,
        candidate: {
          select: {
            user: {
              select: {
                name: true,
                email: true,
                emailVerified: true,
                image: true,
              },
            },
          },
        },
        applicationDocuments: {
          where: { committedAt: { not: null }, deletedAt: null },
          select: { kind: true, mediaType: true, deletedAt: true },
        },
        coverLetterText: { select: { deletedAt: true } },
      },
    });
    const hasNext = rows.length > input.limit;
    const items = rows.slice(0, input.limit).flatMap((row) => {
      if (!row.candidate.user.emailVerified) return [];
      const cv = row.applicationDocuments.find(
        (document) => document.kind === "CV" && !document.deletedAt,
      );
      if (!cv) return [];
      return [
        {
          applicationId: row.id,
          candidate: {
            displayName: row.candidate.user.name,
            verifiedEmail:
              row.contactConsent?.sharedAt && !row.contactConsent.withdrawnAt
                ? row.candidate.user.email
                : null,
            sharedPhone:
              row.contactConsent?.sharedAt && !row.contactConsent.withdrawnAt
                ? sharedPhone(row.contactSnapshot)
                : null,
            avatarUrl: safeAvatar(row.candidate.user.image),
          },
          submittedAt: row.submittedAt.toISOString(),
          stage: row.stage,
          cv: {
            available: true,
            mediaType: cv.mediaType as
              | "application/pdf"
              | "application/msword"
              | "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            previewSupported: previewSupported(cv.mediaType),
          },
          coverLetter: coverLetterProjection(row),
        },
      ];
    });
    const last = items.at(-1);
    const nextCursor =
      hasNext && last
        ? encodeCursor({
            v: cursorVersion,
            jobId: input.jobId,
            submittedAt: last.submittedAt,
            id: last.applicationId,
          })
        : null;
    return applicationPageSchema.parse({ items, nextCursor });
  }

  async findDocument(input: {
    jobId?: string;
    candidateUserId?: string;
    applicationId: string;
    kind: "cv" | "cover-letter";
    now?: Date;
  }): Promise<ApplicationDocumentRecord | null> {
    const now = input.now ?? new Date();
    const application = await this.db.jobApplication.findFirst({
      where: {
        id: input.applicationId,
        ...(input.jobId ? { jobPostingId: input.jobId } : {}),
        ...(input.candidateUserId
          ? { candidateUserId: input.candidateUserId }
          : {}),
        ...(input.candidateUserId
          ? {
              legalHolds: {
                none: {
                  releasedAt: null,
                  startsAt: { lte: now },
                  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
                },
              },
            }
          : {}),
        legacyDocumentState: { not: "UNAVAILABLE" },
        documentDeletedAt: null,
        OR: [
          { documentAccessDeniedAt: null },
          { documentAccessDeniedAt: { gt: now } },
        ],
      },
      select: {
        id: true,
        stage: true,
        stageVersion: true,
        candidateUserId: true,
        selectedCvId: true,
        jobPostingId: true,
        coverLetter: true,
        profileSnapshot: true,
        selectedCv: { select: { fileName: true } },
        applicationDocuments: {
          where: {
            kind: input.kind === "cv" ? "CV" : "COVER_LETTER",
            committedAt: { not: null },
            deletedAt: null,
            ordinaryAccessDeniedAt: null,
            OR: [{ deleteAfter: null }, { deleteAfter: { gt: now } }],
          },
          select: {
            kind: true,
            originalFilenameEncrypted: true,
            contentDigestHmac: true,
            sourceCandidateCvId: true,
            mediaType: true,
            byteLength: true,
            storageKeyEncrypted: true,
            sourceArtifactId: true,
            scanAssessmentId: true,
            sourceArtifact: {
              select: {
                uploadId: true,
              },
            },
            scanAssessment: {
              select: {
                status: true,
              },
            },
          },
          take: 1,
        },
        coverLetterText: {
          select: {
            textEncrypted: true,
            characterCount: true,
            ordinaryAccessDeniedAt: true,
            deleteAfter: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!application) return null;
    if (
      input.kind === "cover-letter" &&
      application.applicationDocuments.length === 0
    ) {
      const text =
        application.coverLetterText &&
        !application.coverLetterText.deletedAt &&
        !application.coverLetterText.ordinaryAccessDeniedAt &&
        (!application.coverLetterText.deleteAfter ||
          application.coverLetterText.deleteAfter > now)
          ? decodeCoverLetterText(application.coverLetterText.textEncrypted)
          : !application.coverLetterText && application.coverLetter
            ? decodeCoverLetterText(application.coverLetter)
            : null;
      if (!text || text.length === 0) return null;
      return {
        applicationId: application.id,
        jobId: application.jobPostingId,
        stage: application.stage,
        stageVersion: application.stageVersion,
        kind: "cover-letter",
        fileName: null,
        mediaType: "text/plain",
        byteLength: Buffer.byteLength(text, "utf8"),
        storageKey: null,
        text,
        previewSupported: true,
        contentVersion: createHash("sha256").update(text, "utf8").digest("hex"),
        applicationProfileSnapshot: application.profileSnapshot,
        sourceCandidateCvId: null,
      };
    }
    const document = application.applicationDocuments[0];
    if (!document) return null;
    return {
      applicationId: application.id,
      jobId: application.jobPostingId,
      stage: application.stage,
      stageVersion: application.stageVersion,
      kind: input.kind,
      fileName: await originalFilename({
        db: this.db,
        kind: input.kind,
        candidateOwned: Boolean(input.candidateUserId),
        application,
        document,
      }),
      mediaType: document.mediaType,
      byteLength: document.byteLength,
      storageKey: document.storageKeyEncrypted,
      text: null,
      previewSupported: previewSupported(document.mediaType),
      contentVersion: document.contentDigestHmac,
      applicationProfileSnapshot: application.profileSnapshot,
      sourceCandidateCvId: document.sourceCandidateCvId,
      sourceArtifactId: document.sourceArtifactId,
      scanAssessmentId: document.scanAssessmentId,
      scanStatus: document.scanAssessment?.status ?? null,
      uploadId: document.sourceArtifact?.uploadId ?? null,
      candidateUserId: application.candidateUserId,
    };
  }
}
