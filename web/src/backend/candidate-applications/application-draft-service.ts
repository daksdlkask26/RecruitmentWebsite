import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import { createApplicationDocumentStorage } from "@/backend/applications/storage/factory";
import { logCvUploadRejection } from "@/backend/cv/upload-observability";
import { ensureCandidateCvLibrary } from "@/backend/services/profile/candidate-cv-library";
import type { CandidateActor } from "@/backend/services/jobs/job-types";
import {
  applicationDraftSchema,
  applicationCvSourceSchema,
  applicationFileDescriptorSchema,
  applicationReviewSchema,
  candidatePersonalInfoSchema,
  coverLetterDraftSchema,
  saveApplicationDraftCommandSchema,
  type ApplicationDraft,
  type ApplicationReview,
  type ApplicationCvSource,
  type CandidatePersonalInfo,
} from "@/shared/contracts/candidate-applications";
import {
  MAX_APPLICATION_ATTEMPTS,
  MAX_APPLICATION_ATTEMPTS_MESSAGE,
} from "@/shared/contracts/jobs/actions";
import { CV_SECURITY_POLICY_VERSION } from "@/shared/contracts/cv-import/common";
import {
  CV_MAX_FILE_BYTES,
  CvFileValidationError,
  validateCvFileBytes,
} from "@/shared/cv-file-validation";
import { CandidateApplicationError } from "./candidate-application-errors";

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_FILE_BYTES = 5_000_000;
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const supportedCvMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type StoredCoverLetterDraft = {
  kind: "FILE";
  file: ApplicationDraftFileDescriptor & {
    storageKey: string;
    checksumSha256: string;
  };
};

type ApplicationDraftFileDescriptor = {
  versionId: string;
  displayName: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  parseStatus: "NOT_APPLICABLE";
};

type DraftDatabase = typeof prisma;

const activeApplicationWhere = (
  candidateUserId: string,
  jobPostingId: string,
) => ({
  candidateUserId,
  jobPostingId,
  withdrawalOutcome: null,
  stage: { not: "REJECTED" as const },
});

async function activeApplication(
  db: DraftDatabase,
  candidateUserId: string,
  jobPostingId: string,
) {
  const delegate = db.jobApplication as unknown as {
    findFirst?: (input: unknown) => Promise<{ id: string } | null>;
  };
  if (typeof delegate.findFirst !== "function") return null;
  return delegate.findFirst({
    where: activeApplicationWhere(candidateUserId, jobPostingId),
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
}

async function applicationCount(
  db: DraftDatabase,
  candidateUserId: string,
  jobPostingId: string,
) {
  const counterDelegate = (
    db as DraftDatabase & {
      jobApplicationAttemptCounter?: typeof prisma.jobApplicationAttemptCounter;
    }
  ).jobApplicationAttemptCounter;
  if (!counterDelegate) return 0;
  const counter = await counterDelegate.findUnique({
    where: {
      candidateUserId_jobPostingId: { candidateUserId, jobPostingId },
    },
    select: { applicationCount: true },
  });
  return counter?.applicationCount ?? 0;
}

function assertApplicationAttemptsAvailable(count: number) {
  if (count < MAX_APPLICATION_ATTEMPTS) return;
  throw new CandidateApplicationError(
    409,
    "APPLICATION_MAX_ATTEMPTS",
    MAX_APPLICATION_ATTEMPTS_MESSAGE,
  );
}

type CandidateContactRow = {
  user: { name: string; email: string };
  profile: {
    phone: string | null;
    location: string | null;
    socialLinks: Array<{ url: string }>;
  } | null;
};

const storedPersonalInformationSchema = candidatePersonalInfoSchema
  .extend({ cvSource: applicationCvSourceSchema.nullable().default(null) })
  .strict();

function normalizedText(value: string | null | undefined, maximum: number) {
  const normalized = (value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .trim();
  if (Array.from(normalized).length > maximum) {
    throw new CandidateApplicationError(
      400,
      "APPLICATION_DRAFT_TEXT_TOO_LONG",
      "Shorten the application message before saving.",
    );
  }
  return normalized || null;
}

function normalizePersonalInfo(input: CandidatePersonalInfo) {
  const value = candidatePersonalInfoSchema.parse({
    fullName: input.fullName.normalize("NFKC").trim(),
    email: input.email.normalize("NFKC").trim(),
    phone: input.phone.normalize("NFKC").trim(),
    currentLocation: input.currentLocation.normalize("NFKC").trim(),
    linkedInPortfolio: input.linkedInPortfolio
      ? input.linkedInPortfolio.normalize("NFKC").trim()
      : null,
  });
  return value;
}

function storedPersonalInformation(
  personalInformation: CandidatePersonalInfo,
  cvSource: ApplicationCvSource | null,
) {
  return storedPersonalInformationSchema.parse({
    ...personalInformation,
    cvSource,
  });
}

function isSupportedFile(file: {
  mimeType: string;
  byteSize: number;
  fileName?: string;
}) {
  if (
    !supportedCvMimeTypes.has(file.mimeType) ||
    !Number.isSafeInteger(file.byteSize) ||
    file.byteSize < 1 ||
    file.byteSize > MAX_FILE_BYTES
  ) {
    return false;
  }
  const extension = file.fileName?.toLowerCase().split(".").pop();
  return extension === "pdf" || extension === "doc" || extension === "docx";
}

function safeFilename(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\r\n]/gu, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 255);
  return normalized || "cover-letter";
}

function fileDescriptor(row: {
  id: string;
  displayName: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  version: number;
  confirmedAt: Date | null;
}) {
  if (
    !row.confirmedAt ||
    !isSupportedFile(row) ||
    !supportedCvMimeTypes.has(row.mimeType)
  ) {
    return null;
  }
  return applicationFileDescriptorSchema.parse({
    versionId: row.id,
    displayName: row.displayName.trim() || row.fileName,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    version: row.version,
    parseStatus: "READY",
    confirmedAt: row.confirmedAt.toISOString(),
  });
}

function parseStoredCoverLetter(value: unknown) {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "FILE"
  ) {
    const file = (value as { file?: unknown }).file;
    if (!file || typeof file !== "object" || Array.isArray(file)) return null;
    const rawFile = file as Record<string, unknown>;
    const parsedFile = applicationFileDescriptorSchema.safeParse({
      versionId: rawFile.versionId,
      displayName: rawFile.displayName,
      fileName: rawFile.fileName,
      mimeType: rawFile.mimeType,
      byteSize: rawFile.byteSize,
      version: rawFile.version,
      parseStatus: rawFile.parseStatus ?? "NOT_APPLICABLE",
      confirmedAt: rawFile.confirmedAt,
    });
    if (!parsedFile.success) return null;
    return { kind: "FILE" as const, file: parsedFile.data };
  }
  const parsed = coverLetterDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function storedCoverLetter(
  value: unknown,
): StoredCoverLetterDraft | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { kind?: unknown }).kind !== "FILE"
  ) {
    return null;
  }
  const file = (value as { file?: unknown }).file;
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  const parsed = file as Record<string, unknown>;
  if (
    typeof parsed.storageKey !== "string" ||
    typeof parsed.checksumSha256 !== "string" ||
    !parsed.storageKey ||
    !/^[a-f0-9]{64}$/iu.test(parsed.checksumSha256)
  ) {
    return null;
  }
  const publicFile = applicationFileDescriptorSchema.safeParse({
    versionId: parsed.versionId,
    displayName: parsed.displayName,
    fileName: parsed.fileName,
    mimeType: parsed.mimeType,
    byteSize: parsed.byteSize,
    parseStatus: "NOT_APPLICABLE",
  });
  if (!publicFile.success) return null;
  const fileName = publicFile.data.fileName ?? publicFile.data.displayName;
  return {
    kind: "FILE",
    file: {
      ...publicFile.data,
      fileName,
      parseStatus: "NOT_APPLICABLE" as const,
      storageKey: parsed.storageKey,
      checksumSha256: parsed.checksumSha256,
    },
  };
}

export async function validateStoredCoverLetter(value: unknown) {
  const stored = storedCoverLetter(value);
  if (!stored) return null;
  try {
    const storage = createApplicationDocumentStorage();
    await storage.assertReady();
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of storage.open(
      stored.file.storageKey,
      stored.file.byteSize,
    )) {
      bytes += chunk.byteLength;
      if (bytes > stored.file.byteSize) return null;
      hash.update(Buffer.from(chunk));
    }
    if (bytes !== stored.file.byteSize) return null;
    if (hash.digest("hex") !== stored.file.checksumSha256) return null;
    return stored;
  } catch {
    return null;
  }
}

function initialPersonalInfo(
  candidate: CandidateContactRow,
): CandidatePersonalInfo {
  const profileLink =
    candidate.profile?.socialLinks.find((link) =>
      /linkedin|portfolio/iu.test(link.url),
    ) ?? candidate.profile?.socialLinks[0];
  return normalizePersonalInfo({
    fullName: candidate.user.name,
    email: candidate.user.email,
    phone: candidate.profile?.phone ?? "",
    currentLocation: candidate.profile?.location ?? "",
    linkedInPortfolio: profileLink?.url ?? null,
  });
}

function personalInfoForApplication(
  candidate: CandidateContactRow,
  draftPersonalInfo: unknown,
): CandidatePersonalInfo {
  const profileInformation = initialPersonalInfo(candidate);
  const draftInformation =
    storedPersonalInformationSchema.safeParse(draftPersonalInfo);
  return normalizePersonalInfo({
    fullName: profileInformation.fullName,
    email: profileInformation.email,
    // Full name and email remain profile-authoritative. Phone is editable for
    // this application and is stored through the existing draft field.
    phone: draftInformation.success
      ? draftInformation.data.phone
      : profileInformation.phone,
    currentLocation: draftInformation.success
      ? draftInformation.data.currentLocation
      : profileInformation.currentLocation,
    linkedInPortfolio: draftInformation.success
      ? draftInformation.data.linkedInPortfolio
      : profileInformation.linkedInPortfolio,
  });
}

function draftProjection(row: {
  id: string;
  jobPostingId: string;
  revision: number;
  personalInfoDraft: unknown;
  selectedCv: {
    id: string;
    displayName: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    version: number;
    confirmedAt: Date | null;
  } | null;
  coverLetterDraft: unknown;
  messageDraft: string | null;
  confirmationAccepted: boolean;
  updatedAt: Date;
  expiresAt: Date;
}): ApplicationDraft {
  const storedInformation = storedPersonalInformationSchema.parse(
    row.personalInfoDraft,
  );
  const { cvSource, ...personalInformation } = storedInformation;
  return applicationDraftSchema.parse({
    draftId: row.id,
    jobId: row.jobPostingId,
    revision: row.revision,
    personalInformation: candidatePersonalInfoSchema.parse(personalInformation),
    cv: row.selectedCv ? fileDescriptor(row.selectedCv) : null,
    cvSource: row.selectedCv ? (cvSource ?? "PROFILE") : null,
    coverLetter: parseStoredCoverLetter(row.coverLetterDraft),
    message: row.messageDraft,
    confirmationAccepted: row.confirmationAccepted,
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  });
}

function openJobWhere(jobId: string | undefined, now: Date) {
  return {
    ...(jobId ? { id: jobId } : {}),
    status: "ACTIVE" as const,
    approvedAt: { not: null },
    publishedAt: { not: null, lte: now },
    OR: [{ applicationDeadline: null }, { applicationDeadline: { gt: now } }],
    company: { verifiedAt: { not: null } },
  };
}

async function candidateContact(db: DraftDatabase, candidateUserId: string) {
  const candidate = await db.candidateIdentity.findFirst({
    where: { userId: candidateUserId, user: { state: "ACTIVE" } },
    select: {
      user: { select: { name: true, email: true } },
      profile: {
        select: {
          phone: true,
          location: true,
          socialLinks: {
            orderBy: { position: "asc" },
            select: { url: true },
          },
        },
      },
    },
  });
  if (!candidate) {
    throw new CandidateApplicationError(
      404,
      "APPLICATION_UNAVAILABLE",
      "This application is unavailable.",
    );
  }
  return candidate;
}

export async function validCv(
  db: DraftDatabase,
  candidateUserId: string,
  cvId: string | null,
) {
  if (!cvId) return null;
  const cv = await db.candidateCv.findFirst({
    where: {
      id: cvId,
      candidateUserId,
      confirmedAt: { not: null },
      archivedAt: null,
      byteSize: { gte: 1, lte: MAX_FILE_BYTES },
      mimeType: { in: [...supportedCvMimeTypes] },
      sourceArtifactId: { not: null },
      scanAssessmentId: { not: null },
      sourceArtifact: {
        is: {
          kind: "SOURCE_DOCUMENT",
          status: "AVAILABLE",
          deletedAt: null,
          contentInaccessibleAt: null,
          upload: {
            is: {
              status: { in: ["SECURITY_CLEAN", "CONFIRMED"] },
              purpose: { in: ["PROFILE_IMPORT", "PROFILE_DIRECT"] },
              policyVersion: CV_SECURITY_POLICY_VERSION,
              deletedAt: null,
              contentInaccessibleAt: null,
            },
          },
        },
      },
      scanAssessment: {
        is: {
          status: "CLEAN",
          completedAt: { not: null },
          policyVersion: CV_SECURITY_POLICY_VERSION,
        },
      },
    },
    select: {
      id: true,
      displayName: true,
      fileName: true,
      mimeType: true,
      byteSize: true,
      version: true,
      confirmedAt: true,
      checksumSha256: true,
      storageKey: true,
      sourceArtifactId: true,
      scanAssessmentId: true,
      sourceArtifact: { select: { id: true } },
      scanAssessment: { select: { id: true, sourceArtifactId: true } },
    },
  });
  if (
    !cv ||
    cv.sourceArtifactId !== cv.sourceArtifact?.id ||
    cv.scanAssessmentId !== cv.scanAssessment?.id ||
    cv.scanAssessment?.sourceArtifactId !== cv.sourceArtifact?.id ||
    !fileDescriptor(cv) ||
    !/^[a-f0-9]{64}$/iu.test(cv.checksumSha256)
  ) {
    throw new CandidateApplicationError(
      400,
      "APPLICATION_CV_INELIGIBLE",
      "Select a confirmed, readable CV from your Profile.",
    );
  }
  return cv;
}

async function optionalValidCv(
  db: DraftDatabase,
  candidateUserId: string,
  cvId: string | null | undefined,
) {
  if (!cvId) return null;
  try {
    return await validCv(db, candidateUserId, cvId);
  } catch (error) {
    if (
      error instanceof CandidateApplicationError &&
      error.code === "APPLICATION_CV_INELIGIBLE"
    ) {
      // A stale private-match link must not block the new application flow or
      // silently select a different CV as its replacement.
      return null;
    }
    throw error;
  }
}

async function draftRow(
  db: DraftDatabase,
  candidateUserId: string,
  jobId: string,
) {
  return db.candidateApplicationDraft.findUnique({
    where: {
      candidateUserId_jobPostingId: {
        candidateUserId,
        jobPostingId: jobId,
      },
    },
    include: {
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
    },
  });
}

export class ApplicationDraftService {
  constructor(private readonly db: DraftDatabase = prisma) {}

  async jobBySlug(slug: string, now = new Date()) {
    const job = await this.db.jobPosting.findFirst({
      where: {
        slug,
        ...openJobWhere(undefined, now),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        location: true,
        employmentType: true,
        experienceLevel: true,
        workArrangement: true,
        applicationDeadline: true,
        company: { select: { displayName: true } },
      },
    });
    return job;
  }

  private async assertOpenJob(jobId: string, now: Date) {
    const job = await this.db.jobPosting.findFirst({
      where: openJobWhere(jobId, now),
      select: {
        id: true,
        slug: true,
        title: true,
        location: true,
        company: { select: { displayName: true } },
      },
    });
    if (!job) {
      throw new CandidateApplicationError(
        404,
        "JOB_UNAVAILABLE",
        "This job is no longer accepting applications.",
      );
    }
    return job;
  }

  async getOrCreate(
    actor: CandidateActor,
    jobId: string,
    now = new Date(),
    prefilledCvId?: string | null,
  ) {
    await ensureCandidateCvLibrary(actor.userId, this.db);
    await this.assertOpenJob(jobId, now);
    const candidate = await candidateContact(this.db, actor.userId);
    let result: NonNullable<Awaited<ReturnType<typeof draftRow>>>;
    try {
      result = await this.db.$transaction(async (tx) => {
        const existingApplication = await activeApplication(
          tx as DraftDatabase,
          actor.userId,
          jobId,
        );
        if (existingApplication) {
          throw new CandidateApplicationError(
            409,
            "APPLICATION_EXISTS",
            "You already applied to this job.",
          );
        }
        assertApplicationAttemptsAvailable(
          await applicationCount(tx as DraftDatabase, actor.userId, jobId),
        );
        const existing = await draftRow(
          tx as DraftDatabase,
          actor.userId,
          jobId,
        );
        if (existing && existing.expiresAt > now) {
          if (!existing.selectedCv && prefilledCvId) {
            const cv = await optionalValidCv(
              tx as DraftDatabase,
              actor.userId,
              prefilledCvId,
            );
            if (cv) {
              const updated = await tx.candidateApplicationDraft.update({
                where: { id: existing.id },
                data: {
                  selectedCvId: cv.id,
                  revision: { increment: 1 },
                  updatedAt: now,
                  expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
                },
                include: {
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
                },
              });
              return updated;
            }
          }
          return existing;
        }
        if (existing) {
          await tx.candidateApplicationDraft.delete({
            where: { id: existing.id },
          });
        }
        const requested = await optionalValidCv(
          tx as DraftDatabase,
          actor.userId,
          prefilledCvId,
        );
        let selectedCvId = requested?.id ?? null;
        if (!selectedCvId && !prefilledCvId) {
          const firstCv = await tx.candidateCv.findFirst({
            where: {
              candidateUserId: actor.userId,
              confirmedAt: { not: null },
              archivedAt: null,
              byteSize: { gte: 1, lte: MAX_FILE_BYTES },
              mimeType: { in: [...supportedCvMimeTypes] },
              sourceArtifactId: { not: null },
              scanAssessmentId: { not: null },
              sourceArtifact: {
                is: {
                  kind: "SOURCE_DOCUMENT",
                  status: "AVAILABLE",
                  deletedAt: null,
                  contentInaccessibleAt: null,
                  upload: {
                    is: {
                      status: { in: ["SECURITY_CLEAN", "CONFIRMED"] },
                      purpose: { in: ["PROFILE_IMPORT", "PROFILE_DIRECT"] },
                      policyVersion: CV_SECURITY_POLICY_VERSION,
                      deletedAt: null,
                      contentInaccessibleAt: null,
                    },
                  },
                },
              },
              scanAssessment: {
                is: {
                  status: "CLEAN",
                  completedAt: { not: null },
                  policyVersion: CV_SECURITY_POLICY_VERSION,
                },
              },
            },
            orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          selectedCvId = firstCv?.id ?? null;
        }
        return tx.candidateApplicationDraft.create({
          data: {
            candidateUserId: actor.userId,
            jobPostingId: jobId,
            revision: 1,
            personalInfoDraft: storedPersonalInformation(
              initialPersonalInfo(candidate),
              selectedCvId ? "PROFILE" : null,
            ) as Prisma.InputJsonValue,
            selectedCvId,
            coverLetterDraft: Prisma.JsonNull,
            messageDraft: null,
            confirmationAccepted: false,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
          },
          include: {
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
          },
        });
      });
    } catch (error) {
      // The page can be rendered concurrently (for example by a refresh and a
      // navigation). The unique constraint is the final authority; after a
      // competing request wins creation, return its durable draft instead of
      // surfacing a false failure to the candidate.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrent = await draftRow(this.db, actor.userId, jobId);
        if (concurrent && concurrent.expiresAt > now) {
          result = concurrent;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    return draftProjection(result);
  }

  async get(actor: CandidateActor, jobId: string, now = new Date()) {
    await ensureCandidateCvLibrary(actor.userId, this.db);
    const row = await draftRow(this.db, actor.userId, jobId);
    if (!row) return null;
    if (row.expiresAt <= now) {
      await this.db.candidateApplicationDraft.delete({ where: { id: row.id } });
      return null;
    }
    return draftProjection(row);
  }

  async currentPersonalInfo(
    actor: CandidateActor,
    draftPersonalInfo?: unknown,
  ) {
    return personalInfoForApplication(
      await candidateContact(this.db, actor.userId),
      draftPersonalInfo,
    );
  }

  async existingApplication(actor: CandidateActor, jobId: string) {
    return activeApplication(this.db, actor.userId, jobId);
  }

  async save(actor: CandidateActor, raw: unknown, now = new Date()) {
    const command = saveApplicationDraftCommandSchema.parse(raw);
    await ensureCandidateCvLibrary(actor.userId, this.db);
    await this.assertOpenJob(command.jobId, now);
    const existingApplication = await activeApplication(
      this.db,
      actor.userId,
      command.jobId,
    );
    if (existingApplication) {
      throw new CandidateApplicationError(
        409,
        "APPLICATION_EXISTS",
        "You already applied to this job.",
      );
    }
    assertApplicationAttemptsAvailable(
      await applicationCount(this.db, actor.userId, command.jobId),
    );
    const candidate = await candidateContact(this.db, actor.userId);
    const personalInformation = personalInfoForApplication(
      candidate,
      command.personalInformation,
    );
    const message = normalizedText(command.message, MAX_MESSAGE_LENGTH);
    const coverLetter = command.coverLetter
      ? coverLetterDraftSchema.parse(command.coverLetter)
      : null;
    const selectedCv = command.cvVersionId
      ? await validCv(this.db, actor.userId, command.cvVersionId)
      : null;
    const cvSource = selectedCv ? (command.cvSource ?? "PROFILE") : null;
    const personalInfoDraft = storedPersonalInformation(
      personalInformation,
      cvSource,
    );
    const current = await draftRow(this.db, actor.userId, command.jobId);
    let storedCoverLetterValue: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      Prisma.JsonNull;
    if (coverLetter?.kind === "TEXT") {
      storedCoverLetterValue = coverLetter as Prisma.InputJsonValue;
    } else if (coverLetter?.kind === "FILE") {
      const previous =
        current && current.expiresAt > now
          ? storedCoverLetter(current.coverLetterDraft)
          : null;
      if (!previous || previous.file.versionId !== coverLetter.file.versionId) {
        throw new CandidateApplicationError(
          400,
          "APPLICATION_COVER_LETTER_INELIGIBLE",
          "Upload the cover letter again before saving this draft.",
        );
      }
      storedCoverLetterValue = previous as unknown as Prisma.InputJsonValue;
    }
    if (current && current.expiresAt <= now) {
      await this.db.candidateApplicationDraft.delete({
        where: { id: current.id },
      });
    }
    if (
      current &&
      current.expiresAt > now &&
      command.expectedRevision !== null &&
      current.revision !== command.expectedRevision
    ) {
      throw new CandidateApplicationError(
        409,
        "APPLICATION_DRAFT_CONFLICT",
        "This application draft changed in another tab. Refresh and try again.",
      );
    }
    if (current && current.expiresAt > now) {
      const changed = await this.db.candidateApplicationDraft.updateMany({
        where: {
          id: current.id,
          candidateUserId: actor.userId,
          jobPostingId: command.jobId,
          revision: current.revision,
          expiresAt: { gt: now },
        },
        data: {
          revision: current.revision + 1,
          personalInfoDraft: personalInfoDraft as Prisma.InputJsonValue,
          selectedCvId: selectedCv?.id ?? null,
          coverLetterDraft: storedCoverLetterValue,
          messageDraft: message,
          confirmationAccepted: command.confirmationAccepted,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
        },
      });
      if (changed.count !== 1) {
        throw new CandidateApplicationError(
          409,
          "APPLICATION_DRAFT_CONFLICT",
          "This application draft changed in another tab. Refresh it and try again.",
        );
      }
      const saved = await draftRow(this.db, actor.userId, command.jobId);
      if (!saved) {
        throw new CandidateApplicationError(
          503,
          "APPLICATION_DRAFT_UNAVAILABLE",
          "The application draft could not be saved.",
        );
      }
      if (
        storedCoverLetter(current.coverLetterDraft) &&
        (coverLetter?.kind !== "FILE" ||
          coverLetter.file.versionId !==
            storedCoverLetter(current.coverLetterDraft)?.file.versionId)
      ) {
        await createApplicationDocumentStorage()
          .delete(storedCoverLetter(current.coverLetterDraft)!.file.storageKey)
          .catch(() => undefined);
      }
      return draftProjection(saved);
    }
    const revision = 1;
    const saved = await this.db.candidateApplicationDraft.upsert({
      where: {
        candidateUserId_jobPostingId: {
          candidateUserId: actor.userId,
          jobPostingId: command.jobId,
        },
      },
      create: {
        candidateUserId: actor.userId,
        jobPostingId: command.jobId,
        revision,
        personalInfoDraft: personalInfoDraft as Prisma.InputJsonValue,
        selectedCvId: selectedCv?.id ?? null,
        coverLetterDraft: storedCoverLetterValue,
        messageDraft: message,
        confirmationAccepted: command.confirmationAccepted,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
      },
      update: {
        revision,
        personalInfoDraft: personalInfoDraft as Prisma.InputJsonValue,
        selectedCvId: selectedCv?.id ?? null,
        coverLetterDraft: storedCoverLetterValue,
        messageDraft: message,
        confirmationAccepted: command.confirmationAccepted,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
      },
      include: {
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
      },
    });
    if (
      current &&
      storedCoverLetter(current.coverLetterDraft) &&
      (coverLetter?.kind !== "FILE" ||
        coverLetter.file.versionId !==
          storedCoverLetter(current.coverLetterDraft)?.file.versionId)
    ) {
      await createApplicationDocumentStorage()
        .delete(storedCoverLetter(current.coverLetterDraft)!.file.storageKey)
        .catch(() => undefined);
    }
    // Keep the profile as the source of truth for the review display. The
    // draft stores a bounded snapshot only so a partially completed wizard is
    // resumable; submission revalidates this contact again.
    void candidate;
    return draftProjection(saved);
  }

  async review(
    actor: CandidateActor,
    draftId: string,
    now = new Date(),
  ): Promise<ApplicationReview> {
    await ensureCandidateCvLibrary(actor.userId, this.db);
    const row = await this.db.candidateApplicationDraft.findFirst({
      where: { id: draftId, candidateUserId: actor.userId },
      include: {
        jobPosting: {
          select: {
            id: true,
            slug: true,
            title: true,
            location: true,
            employmentType: true,
            experienceLevel: true,
            workArrangement: true,
            status: true,
            approvedAt: true,
            publishedAt: true,
            applicationDeadline: true,
            company: { select: { displayName: true, verifiedAt: true } },
          },
        },
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
      },
    });
    if (!row || row.expiresAt <= now) {
      if (row)
        await this.db.candidateApplicationDraft.delete({
          where: { id: row.id },
        });
      throw new CandidateApplicationError(
        404,
        "APPLICATION_DRAFT_NOT_FOUND",
        "This application draft is unavailable. Start again from the job page.",
      );
    }
    const jobOpen =
      row.jobPosting.status === "ACTIVE" &&
      row.jobPosting.approvedAt !== null &&
      row.jobPosting.publishedAt !== null &&
      row.jobPosting.publishedAt <= now &&
      (row.jobPosting.applicationDeadline === null ||
        row.jobPosting.applicationDeadline > now) &&
      row.jobPosting.company.verifiedAt !== null;
    if (!jobOpen) {
      throw new CandidateApplicationError(
        409,
        "JOB_UNAVAILABLE",
        "This job is no longer accepting applications.",
      );
    }
    const candidate = await candidateContact(this.db, actor.userId);
    const currentInfo = personalInfoForApplication(
      candidate,
      row.personalInfoDraft,
    );
    const storedInfo = storedPersonalInformationSchema.parse(
      row.personalInfoDraft,
    );
    const cv = await validCv(this.db, actor.userId, row.selectedCvId);
    if (
      row.coverLetterDraft &&
      typeof row.coverLetterDraft === "object" &&
      !Array.isArray(row.coverLetterDraft) &&
      (row.coverLetterDraft as { kind?: unknown }).kind === "FILE" &&
      !(await validateStoredCoverLetter(row.coverLetterDraft))
    ) {
      throw new CandidateApplicationError(
        409,
        "APPLICATION_COVER_LETTER_INELIGIBLE",
        "The cover letter needs to be uploaded again before review.",
      );
    }
    const draft = draftProjection({
      ...row,
      personalInfoDraft: storedPersonalInformation(
        currentInfo,
        storedInfo.cvSource,
      ),
      selectedCv: cv,
    });
    return applicationReviewSchema.parse({
      job: {
        id: row.jobPosting.id,
        slug: row.jobPosting.slug,
        title: row.jobPosting.title,
        companyName: row.jobPosting.company.displayName,
        location: row.jobPosting.location,
        employmentType: row.jobPosting.employmentType,
        experienceLevel: row.jobPosting.experienceLevel,
        workArrangement: row.jobPosting.workArrangement,
        applicationDeadline:
          row.jobPosting.applicationDeadline?.toISOString() ?? null,
        isOpen: jobOpen,
      },
      draft,
    });
  }

  async getForSubmission(
    actor: CandidateActor,
    draftId: string,
    now = new Date(),
  ) {
    const row = await this.db.candidateApplicationDraft.findFirst({
      where: {
        id: draftId,
        candidateUserId: actor.userId,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        candidateUserId: true,
        jobPostingId: true,
        revision: true,
        personalInfoDraft: true,
        selectedCvId: true,
        coverLetterDraft: true,
        messageDraft: true,
        confirmationAccepted: true,
      },
    });
    if (!row) {
      throw new CandidateApplicationError(
        404,
        "APPLICATION_DRAFT_NOT_FOUND",
        "This application draft is unavailable. Start again from the job page.",
      );
    }
    return row;
  }

  async attachCoverLetter(
    actor: CandidateActor,
    draftId: string,
    expectedRevision: number,
    file: File,
    now = new Date(),
  ) {
    const draft = await this.db.candidateApplicationDraft.findFirst({
      where: {
        id: draftId,
        candidateUserId: actor.userId,
        expiresAt: { gt: now },
      },
      include: {
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
      },
    });
    if (!draft || draft.revision !== expectedRevision) {
      throw new CandidateApplicationError(
        409,
        "APPLICATION_DRAFT_CONFLICT",
        "This application draft changed in another tab. Refresh and try again.",
      );
    }
    const existingApplication = await activeApplication(
      this.db,
      actor.userId,
      draft.jobPostingId,
    );
    if (existingApplication) {
      throw new CandidateApplicationError(
        409,
        "APPLICATION_EXISTS",
        "You already applied to this job.",
      );
    }
    assertApplicationAttemptsAvailable(
      await applicationCount(this.db, actor.userId, draft.jobPostingId),
    );
    if (file.size < 1 || file.size > CV_MAX_FILE_BYTES) {
      throw new CandidateApplicationError(
        400,
        "APPLICATION_COVER_LETTER_INELIGIBLE",
        "Cover letters must be PDF, DOC, or DOCX files between 1 and 5 MB.",
      );
    }
    let sourceBytes: Uint8Array;
    let mimeType: string;
    try {
      sourceBytes = new Uint8Array(await file.arrayBuffer());
      const validated = validateCvFileBytes({
        bytes: sourceBytes,
        fileName: file.name,
        declaredMimeType: file.type,
      });
      mimeType = validated.mimeType;
    } catch (error) {
      if (error instanceof CvFileValidationError) {
        logCvUploadRejection({
          reason: error.code,
          byteSize: file.size,
          declaredMimeType: file.type,
        });
      }
      throw new CandidateApplicationError(
        400,
        "APPLICATION_COVER_LETTER_INELIGIBLE",
        error instanceof CvFileValidationError
          ? error.message
          : "The cover letter could not be read. Upload it again.",
      );
    }
    const storage = createApplicationDocumentStorage();
    await storage.assertReady();
    const hash = createHash("sha256").update(sourceBytes);
    let stored: Awaited<ReturnType<typeof storage.put>>;
    try {
      stored = await storage.put({
        expectedBytes: sourceBytes.byteLength,
        source: (async function* () {
          yield sourceBytes;
        })(),
      });
    } catch {
      throw new CandidateApplicationError(
        503,
        "APPLICATION_STORAGE_UNAVAILABLE",
        "The cover letter could not be saved. Try again in a moment.",
      );
    }
    const descriptor: StoredCoverLetterDraft = {
      kind: "FILE",
      file: {
        versionId: randomUUID(),
        displayName: safeFilename(file.name),
        fileName: safeFilename(file.name),
        mimeType,
        byteSize: sourceBytes.byteLength,
        parseStatus: "NOT_APPLICABLE",
        storageKey: stored.locator,
        checksumSha256: hash.digest("hex"),
      },
    };
    let persisted = false;
    try {
      const changed = await this.db.candidateApplicationDraft.updateMany({
        where: {
          id: draft.id,
          candidateUserId: actor.userId,
          revision: expectedRevision,
          expiresAt: { gt: now },
        },
        data: {
          revision: { increment: 1 },
          coverLetterDraft: descriptor as unknown as Prisma.InputJsonValue,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
        },
      });
      if (changed.count !== 1) {
        throw new CandidateApplicationError(
          409,
          "APPLICATION_DRAFT_CONFLICT",
          "This application draft changed in another tab. Refresh it and try again.",
        );
      }
      // `updateMany` is the ownership boundary. A later read/projection may
      // fail after the row has committed, so the newly stored object must be
      // retained for review/reconciliation instead of being deleted here.
      persisted = true;
      const updated = await draftRow(this.db, actor.userId, draft.jobPostingId);
      if (!updated) {
        throw new CandidateApplicationError(
          503,
          "APPLICATION_DRAFT_UNAVAILABLE",
          "The application draft could not be saved.",
        );
      }
      // The database now points at the new object. Keep the object if a later
      // projection/response step fails; deleting it here would leave a
      // dangling coverLetterDraft that can never pass review validation.
      const previous = storedCoverLetter(draft.coverLetterDraft);
      if (previous)
        await storage.delete(previous.file.storageKey).catch(() => undefined);
      return draftProjection(updated);
    } catch (error) {
      if (!persisted)
        await storage.delete(stored.locator).catch(() => undefined);
      throw error;
    }
  }
}
