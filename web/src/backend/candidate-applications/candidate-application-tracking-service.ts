import "server-only";

import { prisma } from "@/backend/database/prisma";
import {
  applicationStageSchema,
  type ApplicationStage,
} from "@/shared/contracts/jobs/applications";
import {
  applicationFileDescriptorSchema,
  applicationIntakeSchema,
  applicationPublicUpdateSchema,
  applicationTrackerSchema,
  candidateApplicationListQuerySchema,
  candidateApplicationListResponseSchema,
  candidateApplicationSummarySchema,
  notificationPreferenceSchema,
  publicOutcomeForCanonicalStage,
  publicTimelineEventCodeForCanonicalStage,
  publicUpdateKindForCanonicalStage,
  publicUpdateTitleForCanonicalStage,
  publicStageForCanonicalStage,
  type ApplicationIntake,
  type ApplicationPublicUpdate,
  type ApplicationTracker,
  type CandidateApplicationSummary,
} from "@/shared/contracts/candidate-applications";
import type { CandidateActor } from "@/backend/services/jobs/job-types";
import { CandidateApplicationError } from "./candidate-application-errors";
import {
  decodeApplicationListCursor,
  encodeApplicationListCursor,
} from "@/backend/applications/application-list-cursor";
import {
  PrismaCandidateApplicationRepository,
  type CandidateApplicationSummaryRow,
  type CandidateApplicationTrackerRow,
} from "@/backend/repositories/candidate-applications/prisma-candidate-application-repository";

const withdrawableStages = new Set<ApplicationStage>([
  "APPLIED",
  "VIEWED",
  "SHORTLISTED",
  "WAITLISTED",
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boundedText(value: unknown, maximum: number) {
  const normalized = text(value);
  return normalized && normalized.length <= maximum ? normalized : null;
}

function calendarDate(value: unknown) {
  const normalized = boundedText(value, 10);
  return normalized && /^\d{4}-\d{2}-\d{2}$/u.test(normalized)
    ? normalized
    : null;
}

function isoDateTime(value: unknown) {
  const candidate =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  return candidate && Number.isFinite(candidate.getTime())
    ? candidate.toISOString()
    : null;
}

function publicUpdateTitle(kind: string) {
  switch (kind) {
    case "SUBMITTED":
      return "Application submitted";
    case "UNDER_REVIEW":
      return "Application under review";
    case "INTERVIEW":
      return "Interview stage reached";
    case "OUTCOME":
      return "Application outcome updated";
    case "WITHDRAWN":
      return "Application withdrawn";
    case "TECHNICAL_UPDATE":
      return "Application file check updated";
    default:
      return null;
  }
}

function exactCandidateMessage(value: unknown) {
  return typeof value === "string" && value.length <= 500 ? value : null;
}

function eventCodeForPublicUpdate(input: {
  kind: string;
  canonicalStage: ApplicationStage | null;
  publicOutcome: string | null | undefined;
}) {
  if (input.kind === "WITHDRAWN" || input.publicOutcome === "WITHDRAWN")
    return "APPLICATION_WITHDRAWN" as const;
  if (input.kind === "TECHNICAL_UPDATE")
    return "FILE_PROCESSING_UPDATED" as const;
  if (input.canonicalStage)
    return publicTimelineEventCodeForCanonicalStage(input.canonicalStage);
  if (input.kind === "SUBMITTED") return "APPLICATION_SUBMITTED" as const;
  return "FILE_PROCESSING_UPDATED" as const;
}

function safeFilename(value: string | null | undefined, fallback: string) {
  const normalized = value
    ?.replace(/[\\/\r\n]/gu, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim();
  if (
    !normalized ||
    /^(?:application|candidate|imported)-cv-/iu.test(normalized)
  ) {
    return fallback;
  }
  return normalized.slice(0, 255);
}

function fileFromCv(row: CandidateApplicationTrackerRow) {
  const snapshot = object(row.cvSnapshot);
  const source = row.selectedCv;
  const mimeType = text(snapshot.mimeType) ?? source.mimeType;
  const descriptor = applicationFileDescriptorSchema.safeParse({
    versionId: text(snapshot.cvId) ?? source.id,
    displayName: text(snapshot.displayName) ?? source.displayName,
    fileName: safeFilename(
      text(snapshot.fileName) ?? source.fileName,
      "candidate-cv.pdf",
    ),
    mimeType,
    byteSize:
      typeof snapshot.byteSize === "number"
        ? snapshot.byteSize
        : source.byteSize,
    version:
      typeof snapshot.cvVersion === "number"
        ? snapshot.cvVersion
        : source.version,
    parseStatus: "READY",
    confirmedAt: source.confirmedAt?.toISOString(),
  });
  if (!descriptor.success) {
    throw new CandidateApplicationError(
      503,
      "APPLICATION_PROJECTION_UNAVAILABLE",
      "This application is temporarily unavailable.",
    );
  }
  return descriptor.data;
}

function fileFromDocument(
  document: CandidateApplicationTrackerRow["applicationDocuments"][number],
) {
  const fallback =
    document.kind === "COVER_LETTER" ? "cover-letter.pdf" : "candidate-cv.pdf";
  const parsed = applicationFileDescriptorSchema.safeParse({
    versionId: document.id,
    // ApplicationDocument.originalFilenameEncrypted is an internal storage
    // field. Candidate projections use a neutral name instead of ever
    // guessing whether its value is plaintext or encrypted metadata.
    displayName: fallback,
    fileName: fallback,
    mimeType: document.mediaType,
    byteSize: document.byteLength,
    parseStatus: "NOT_APPLICABLE",
  });
  return parsed.success ? parsed.data : null;
}

function decodeCoverLetterText(value: string | null | undefined) {
  if (!value) return null;
  if (!value.startsWith("b64:v1:")) return text(value);
  try {
    return text(
      Buffer.from(value.slice("b64:v1:".length), "base64").toString("utf8"),
    );
  } catch {
    return null;
  }
}

function hasActiveHold(row: CandidateApplicationTrackerRow, now: Date) {
  return (row.legalHolds ?? []).some(
    (hold) =>
      hold.releasedAt === null &&
      hold.startsAt <= now &&
      (hold.endsAt === null || hold.endsAt > now),
  );
}

function documentAvailability(
  row: CandidateApplicationTrackerRow,
  document:
    | CandidateApplicationTrackerRow["applicationDocuments"][number]
    | undefined,
  now: Date,
) {
  if (row.documentDeletedAt || document?.deletedAt) return "DELETED" as const;
  if (hasActiveHold(row, now)) return "HELD" as const;
  if (
    (row.documentAccessDeniedAt && row.documentAccessDeniedAt <= now) ||
    (document?.ordinaryAccessDeniedAt &&
      document.ordinaryAccessDeniedAt <= now) ||
    (document?.deleteAfter && document.deleteAfter <= now)
  ) {
    return "EXPIRED" as const;
  }
  if (
    document?.kind === "CV" &&
    (document.scanAssessment?.status !== "CLEAN" ||
      !document.sourceArtifactId ||
      !document.scanAssessmentId ||
      !document.sourceArtifact ||
      !["QUARANTINED", "AVAILABLE"].includes(document.sourceArtifact.status) ||
      document.sourceArtifact.contentInaccessibleAt ||
      document.sourceArtifact.deletedAt)
  ) {
    return "TEMPORARILY_UNAVAILABLE" as const;
  }
  return document
    ? ("AVAILABLE" as const)
    : ("TEMPORARILY_UNAVAILABLE" as const);
}

function textAvailability(row: CandidateApplicationTrackerRow, now: Date) {
  const coverLetter = row.coverLetterText;
  if (row.documentDeletedAt || coverLetter?.deletedAt)
    return "DELETED" as const;
  if (hasActiveHold(row, now)) return "HELD" as const;
  if (
    (row.documentAccessDeniedAt && row.documentAccessDeniedAt <= now) ||
    (coverLetter?.ordinaryAccessDeniedAt &&
      coverLetter.ordinaryAccessDeniedAt <= now) ||
    (coverLetter?.deleteAfter && coverLetter.deleteAfter <= now)
  ) {
    return "EXPIRED" as const;
  }
  return "AVAILABLE" as const;
}

function submittedCvFile(row: CandidateApplicationTrackerRow) {
  const snapshot = object(row.cvSnapshot);
  const parsed = applicationFileDescriptorSchema.safeParse({
    versionId: text(snapshot.cvId),
    displayName: text(snapshot.displayName),
    fileName: safeFilename(text(snapshot.fileName), "candidate-cv.pdf"),
    mimeType: text(snapshot.mimeType),
    byteSize: snapshot.byteSize,
    version: snapshot.cvVersion,
    parseStatus: "READY",
    confirmedAt: text(snapshot.confirmedAt) ?? undefined,
  });
  return parsed.success ? parsed.data : null;
}

function unavailableSubmittedProfile() {
  return { status: "UNAVAILABLE" as const };
}

function submittedProfile(row: CandidateApplicationTrackerRow) {
  if (row.profileSnapshotAccessDeniedAt) {
    return unavailableSubmittedProfile();
  }
  const snapshot = object(row.profileSnapshot);
  const fullName = boundedText(snapshot.candidateName, 150);
  const sourceSkills = snapshot.skills;
  const sourceExperience = snapshot.experience;
  const sourceEducation = snapshot.education;
  if (
    !fullName ||
    !Array.isArray(sourceSkills) ||
    sourceSkills.length > 50 ||
    !Array.isArray(sourceExperience) ||
    sourceExperience.length > 50 ||
    !Array.isArray(sourceEducation) ||
    sourceEducation.length > 50
  ) {
    return unavailableSubmittedProfile();
  }

  const skills = sourceSkills.map((skill) =>
    typeof skill === "string"
      ? boundedText(skill, 80)
      : boundedText(object(skill).label, 80),
  );
  if (skills.some((skill) => !skill)) return unavailableSubmittedProfile();

  const experience = sourceExperience.map((entry) => {
    const value = object(entry);
    const title = boundedText(value.title, 200);
    const company = boundedText(value.company, 200);
    if (!title || !company) return null;
    return {
      title,
      company,
      startDate: calendarDate(value.startDate),
      endDate: calendarDate(value.endDate),
    };
  });
  const education = sourceEducation.map((entry) => {
    const value = object(entry);
    const institution = boundedText(value.institution, 200);
    const degree = boundedText(value.degree, 200);
    if (!institution || !degree) return null;
    return {
      institution,
      degree,
      field: boundedText(value.field, 200),
      startDate: calendarDate(value.startDate),
      endDate: calendarDate(value.endDate),
    };
  });
  if (experience.some((entry) => !entry) || education.some((entry) => !entry)) {
    return unavailableSubmittedProfile();
  }

  return {
    status: "AVAILABLE" as const,
    fullName,
    headline: boundedText(snapshot.headline, 200),
    summary: boundedText(snapshot.summary, 5_000),
    skills: skills as string[],
    experience: experience as NonNullable<(typeof experience)[number]>[],
    education: education as NonNullable<(typeof education)[number]>[],
  };
}

function submittedContact(row: CandidateApplicationTrackerRow) {
  const snapshot = object(row.contactSnapshot);
  const fullName = boundedText(snapshot.fullName, 150);
  const email = boundedText(snapshot.email, 254);
  const phone = boundedText(snapshot.phone, 20);
  if (
    !fullName ||
    !email ||
    !phone ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    return { status: "UNAVAILABLE" as const };
  }
  return {
    status: "AVAILABLE" as const,
    fullName,
    email,
    phone,
    location: boundedText(snapshot.location, 160),
  };
}

function submittedConsent(row: CandidateApplicationTrackerRow) {
  const version = boundedText(row.consentVersion, 64);
  const consentedAt = isoDateTime(row.consentedAt);
  if (!version || !consentedAt) return { status: "UNAVAILABLE" as const };
  return { status: "AVAILABLE" as const, version, consentedAt };
}

function submittedAnswers(row: CandidateApplicationTrackerRow) {
  return (row.answers ?? []).flatMap((answer) => {
    const question = text(object(answer.questionSnapshot).prompt);
    if (
      !question ||
      (typeof answer.answer !== "string" && typeof answer.answer !== "boolean")
    ) {
      return [];
    }
    return [{ question, answer: answer.answer }];
  });
}

function submission(row: CandidateApplicationTrackerRow) {
  const now = new Date();
  const job = object(row.jobSnapshot);
  const title = text(job.title);
  const companyName = text(job.companyName);
  const location = text(job.location);
  const employmentType = text(job.employmentType);
  const experienceLevel = text(job.experienceLevel);
  const workArrangement = text(job.workArrangement);
  const requiredSkills = Array.isArray(job.requiredSkills)
    ? job.requiredSkills.flatMap((skill) => (text(skill) ? [text(skill)!] : []))
    : [];
  const jobVersion =
    typeof job.jobVersion === "number" &&
    Number.isInteger(job.jobVersion) &&
    job.jobVersion > 0
      ? job.jobVersion
      : null;
  const snapshotAvailable = Boolean(
    title &&
    companyName &&
    location &&
    employmentType &&
    experienceLevel &&
    workArrangement &&
    jobVersion,
  );
  const cvDocument = row.applicationDocuments.find(
    (document) => document.kind === "CV" && document.committedAt !== null,
  );
  const cvAvailability = documentAvailability(row, cvDocument, now);
  const cv = submittedCvFile(row);
  const coverLetterDocument = row.applicationDocuments.find(
    (document) =>
      document.kind === "COVER_LETTER" && document.committedAt !== null,
  );
  const coverLetterFileAvailability = documentAvailability(
    row,
    coverLetterDocument,
    now,
  );
  const coverLetterFile = coverLetterDocument
    ? fileFromDocument(coverLetterDocument)
    : null;
  const normalizedCoverLetterText = decodeCoverLetterText(
    row.coverLetterText?.textEncrypted,
  );
  const legacyCoverLetterText =
    row.coverLetterText === null
      ? decodeCoverLetterText(row.coverLetter)
      : null;
  const coverLetterText = normalizedCoverLetterText ?? legacyCoverLetterText;
  const hasStoredText =
    row.coverLetterText !== null && row.coverLetterText !== undefined
      ? true
      : legacyCoverLetterText !== null;

  return {
    job: {
      available: snapshotAvailable,
      title,
      companyName,
      location,
      employmentType,
      experienceLevel,
      workArrangement,
      requiredSkills,
      version: jobVersion,
    },
    cv: {
      availability:
        cvAvailability === "AVAILABLE" && !cv
          ? "TEMPORARILY_UNAVAILABLE"
          : cvAvailability,
      file: cv,
      previewSupported: cv?.mimeType === "application/pdf",
    },
    coverLetter: coverLetterDocument
      ? {
          kind: "FILE" as const,
          availability:
            coverLetterFileAvailability === "AVAILABLE" && !coverLetterFile
              ? "TEMPORARILY_UNAVAILABLE"
              : coverLetterFileAvailability,
          file: coverLetterFile,
          previewSupported: coverLetterFile?.mimeType === "application/pdf",
        }
      : hasStoredText
        ? {
            kind: "TEXT" as const,
            availability: coverLetterText
              ? textAvailability(row, now)
              : ("TEMPORARILY_UNAVAILABLE" as const),
            text:
              textAvailability(row, now) === "AVAILABLE"
                ? coverLetterText
                : null,
          }
        : { kind: "NONE" as const, availability: "NOT_PROVIDED" as const },
    answers: submittedAnswers(row),
    message: text(row.submissionMessage),
    profile: submittedProfile(row),
    contact: submittedContact(row),
    consent: submittedConsent(row),
  };
}

function intake(row: CandidateApplicationTrackerRow): ApplicationIntake {
  const current = row.intake ?? {
    state: "SENT_TO_RECRUITER" as const,
    progressPercent: 100,
    receivedAt: row.submittedAt,
    checkingStartedAt: row.submittedAt,
    sentAt: row.submittedAt,
    failureCode: null,
    updatedAt: row.submittedAt,
  };
  const state = current.state;
  const steps = [
    {
      code: "APPLICATION_RECEIVED" as const,
      status: "COMPLETE" as const,
      timestamp: current.receivedAt.toISOString(),
    },
    {
      code: "CHECKING_FILES" as const,
      status:
        state === "ATTENTION_REQUIRED"
          ? ("ATTENTION_REQUIRED" as const)
          : state === "RECEIVED"
            ? ("PENDING" as const)
            : state === "SENT_TO_RECRUITER"
              ? ("COMPLETE" as const)
              : ("ACTIVE" as const),
      timestamp: current.checkingStartedAt?.toISOString() ?? null,
    },
    {
      code: "SENT_TO_RECRUITER" as const,
      status:
        state === "SENT_TO_RECRUITER"
          ? ("COMPLETE" as const)
          : ("PENDING" as const),
      timestamp: current.sentAt?.toISOString() ?? null,
    },
  ];
  return applicationIntakeSchema.parse({
    state,
    progressPercent: current.progressPercent,
    steps,
    failureCode: current.failureCode,
    updatedAt: current.updatedAt.toISOString(),
  });
}

function stageUpdate(
  event: CandidateApplicationTrackerRow["stageEvents"][number],
): ApplicationPublicUpdate | null {
  const stage = applicationStageSchema.parse(event.toStage);
  const publicStage = publicStageForCanonicalStage(stage);
  const kind = publicUpdateKindForCanonicalStage(stage);
  const title = publicUpdateTitleForCanonicalStage(stage);
  return applicationPublicUpdateSchema.parse({
    id: event.id,
    eventCode: publicTimelineEventCodeForCanonicalStage(stage),
    kind,
    publicStage,
    publicOutcome: publicOutcomeForCanonicalStage(stage),
    canonicalStage: stage,
    title,
    userMessage: exactCandidateMessage(event.candidateVisibleReason),
    occurredAt: event.occurredAt.toISOString(),
  });
}

function publicUpdates(row: CandidateApplicationTrackerRow) {
  const visibleStageEvents = row.stageEvents.filter(
    (event) => event.candidateVisible !== false,
  );
  const stageEventsById = new Map(
    visibleStageEvents.map((event) => [event.id, event]),
  );
  const updates: ApplicationPublicUpdate[] = [];
  const logicalKeys = new Set<string>();
  const addUpdate = (update: ApplicationPublicUpdate, logicalKey: string) => {
    if (logicalKeys.has(logicalKey)) return;
    logicalKeys.add(logicalKey);
    updates.push(update);
  };
  row.publicUpdates.forEach((update) => {
    const title = update.title.trim() || publicUpdateTitle(update.kind);
    if (!title) return;
    const isWithdrawalUpdate =
      update.kind === "WITHDRAWN" || update.publicOutcome === "WITHDRAWN";
    const sourceEvent = update.sourceEventReference
      ? stageEventsById.get(update.sourceEventReference)
      : undefined;
    const canonicalStage = isWithdrawalUpdate
      ? null
      : sourceEvent
        ? applicationStageSchema.parse(sourceEvent.toStage)
        : update.kind === "SUBMITTED"
          ? "APPLIED"
          : null;
    const publicStage = isWithdrawalUpdate
      ? "OUTCOME"
      : canonicalStage
        ? publicStageForCanonicalStage(canonicalStage)
        : update.publicStage;
    const publicOutcome = isWithdrawalUpdate
      ? "WITHDRAWN"
      : canonicalStage
        ? publicOutcomeForCanonicalStage(canonicalStage)
        : update.publicOutcome;
    const kind = isWithdrawalUpdate
      ? "WITHDRAWN"
      : canonicalStage
        ? publicUpdateKindForCanonicalStage(canonicalStage)
        : update.kind;
    const eventCode = eventCodeForPublicUpdate({
      kind,
      canonicalStage,
      publicOutcome,
    });
    const projected = applicationPublicUpdateSchema.parse({
      id: update.id,
      eventCode,
      kind,
      publicStage,
      publicOutcome,
      canonicalStage,
      title: isWithdrawalUpdate
        ? "Application withdrawn"
        : canonicalStage
          ? publicUpdateTitleForCanonicalStage(canonicalStage)
          : title,
      userMessage: sourceEvent
        ? exactCandidateMessage(sourceEvent.candidateVisibleReason)
        : null,
      occurredAt: update.effectiveAt.toISOString(),
    });
    const logicalKey = sourceEvent
      ? `stage:${sourceEvent.id}`
      : `public:${update.id}`;
    addUpdate(projected, logicalKey);
  });
  const knownEventReferences = new Set(
    row.publicUpdates
      .map((update) => update.sourceEventReference)
      .filter((reference): reference is string => Boolean(reference)),
  );
  for (const event of visibleStageEvents) {
    const update = stageUpdate(event);
    if (update && !knownEventReferences.has(event.id)) {
      addUpdate(update, `stage:${event.id}`);
    }
  }
  return updates
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(-500);
}

function tracker(row: CandidateApplicationTrackerRow): ApplicationTracker {
  const canonicalStage = applicationStageSchema.parse(row.stage);
  const documents = row.applicationDocuments
    .filter(
      (document) => document.kind !== "CV" && document.committedAt !== null,
    )
    .map(fileFromDocument)
    .filter((file): file is NonNullable<typeof file> => Boolean(file));
  const cv =
    documents.find((file) => file.versionId === row.selectedCv.id) ??
    fileFromCv(row);
  const files = [
    cv,
    ...documents.filter((file) => file.versionId !== cv.versionId),
  ];
  const preference = row.notificationPreference
    ? notificationPreferenceSchema.parse({
        emailEnabled: row.notificationPreference.emailEnabled,
        inAppEnabled: row.notificationPreference.inAppEnabled,
        version: row.notificationPreference.version,
        updatedAt: row.notificationPreference.updatedAt.toISOString(),
      })
    : notificationPreferenceSchema.parse({
        emailEnabled:
          row.candidate.user.preferences?.applicationUpdatesEmail ?? true,
        inAppEnabled: true,
        version: 1,
        updatedAt: row.submittedAt.toISOString(),
      });
  const publicOutcome =
    row.withdrawalOutcome === "CANDIDATE_WITHDRAWN"
      ? "WITHDRAWN"
      : publicOutcomeForCanonicalStage(canonicalStage);
  const publicStage =
    row.withdrawalOutcome === "CANDIDATE_WITHDRAWN"
      ? "OUTCOME"
      : publicStageForCanonicalStage(canonicalStage);
  const currentStageEvent = [...row.stageEvents]
    .reverse()
    .find(
      (event) => applicationStageSchema.parse(event.toStage) === canonicalStage,
    );
  return applicationTrackerSchema.parse({
    applicationId: row.id,
    job: {
      jobId: row.jobPostingId,
      slug: row.jobPosting.slug,
      // This object is the intentionally live public listing context used for
      // navigation/status guidance. Submitted evidence is projected below
      // from jobSnapshot and must never fall back to these mutable values.
      title: row.jobPosting.title,
      companyName: row.jobPosting.company.displayName,
      companyLogoUrl: row.jobPosting.company.logoUrl,
      location: row.jobPosting.location,
      employmentType: row.jobPosting.employmentType,
      experienceLevel: row.jobPosting.experienceLevel,
      workArrangement: row.jobPosting.workArrangement,
      applicationDeadline:
        row.jobPosting.applicationDeadline?.toISOString() ?? null,
      jobAvailable:
        row.jobPosting.status === "ACTIVE" && row.jobPosting.removedAt === null,
    },
    publicStage,
    publicOutcome,
    canonicalStage,
    transitionFromStage: currentStageEvent?.fromStage
      ? applicationStageSchema.parse(currentStageEvent.fromStage)
      : null,
    stageVersion: row.stageVersion,
    submittedAt: row.submittedAt.toISOString(),
    lastUpdatedAt: new Date(
      Math.max(
        row.lastStageChangedAt.getTime(),
        row.withdrawnAt?.getTime() ?? 0,
      ),
    ).toISOString(),
    intake: intake(row),
    updates: publicUpdates(row),
    files: files.slice(0, 2),
    submission: submission(row),
    notificationPreference: preference,
    contactConsent: {
      shared: Boolean(
        row.contactConsent?.sharedAt && !row.contactConsent.withdrawnAt,
      ),
      version: row.contactConsent?.version ?? 1,
    },
    canWithdraw:
      withdrawableStages.has(canonicalStage) && !row.withdrawalOutcome,
  });
}

function summary(
  row: CandidateApplicationSummaryRow,
): CandidateApplicationSummary {
  const canonicalStage = applicationStageSchema.parse(row.stage);
  const publicOutcome =
    row.withdrawalOutcome === "CANDIDATE_WITHDRAWN"
      ? "WITHDRAWN"
      : publicOutcomeForCanonicalStage(canonicalStage);
  const publicStage =
    row.withdrawalOutcome === "CANDIDATE_WITHDRAWN"
      ? "OUTCOME"
      : publicStageForCanonicalStage(canonicalStage);

  return candidateApplicationSummarySchema.parse({
    applicationId: row.id,
    jobId: row.jobPostingId,
    jobSlug: row.jobPosting.slug,
    jobTitle: text(object(row.jobSnapshot).title) ?? row.jobPosting.title,
    companyName:
      text(object(row.jobSnapshot).companyName) ??
      row.jobPosting.company.displayName,
    companyLogoUrl: row.jobPosting.company.logoUrl,
    location: text(object(row.jobSnapshot).location) ?? row.jobPosting.location,
    publicStage,
    publicOutcome,
    canonicalStage,
    stageVersion: row.stageVersion,
    submittedAt: row.submittedAt.toISOString(),
    lastUpdatedAt: new Date(
      Math.max(
        row.lastStageChangedAt.getTime(),
        row.withdrawnAt?.getTime() ?? 0,
      ),
    ).toISOString(),
    jobAvailable:
      row.jobPosting.status === "ACTIVE" && row.jobPosting.removedAt === null,
  });
}

export class CandidateApplicationTrackingService {
  constructor(
    private readonly repository = new PrismaCandidateApplicationRepository(),
  ) {}

  async get(actor: CandidateActor, applicationId: string) {
    const row = await this.repository.getTracker(actor.userId, applicationId);
    if (!row) {
      throw new CandidateApplicationError(
        404,
        "APPLICATION_UNAVAILABLE",
        "This application is unavailable.",
      );
    }
    return tracker(row);
  }

  async list(
    actor: CandidateActor,
    input: {
      limit?: number;
      cursor?: string;
      filter?: string;
      sort?: string;
    } = {},
  ) {
    const parsed = candidateApplicationListQuerySchema.safeParse(input);
    if (!parsed.success) {
      throw new CandidateApplicationError(
        400,
        "APPLICATION_LIST_REQUEST_INVALID",
        "Choose valid application list filters.",
      );
    }
    const query = parsed.data;
    const cursor = query.cursor
      ? decodeApplicationListCursor(query.cursor, {
          list: "CANDIDATE_JOB_APPLICATIONS",
          subjectId: actor.userId,
          scopeId: null,
          filter: query.filter,
          sort: query.sort,
        })
      : null;
    if (query.cursor && !cursor) {
      throw new CandidateApplicationError(
        400,
        "APPLICATION_LIST_CURSOR_INVALID",
        "This page has expired. Restart the application list.",
      );
    }
    const page = await this.repository.list({
      candidateUserId: actor.userId,
      limit: query.limit,
      filter: query.filter,
      sort: query.sort,
      cursor: cursor
        ? { submittedAt: new Date(cursor.submittedAt), id: cursor.id }
        : null,
    });
    const hasMore = page.rows.length > query.limit;
    const visible = hasMore ? page.rows.slice(0, query.limit) : page.rows;
    const last = visible.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeApplicationListCursor({
            list: "CANDIDATE_JOB_APPLICATIONS",
            subjectId: actor.userId,
            scopeId: null,
            filter: query.filter,
            sort: query.sort,
            submittedAt: last.submittedAt.toISOString(),
            id: last.id,
          })
        : null;
    return candidateApplicationListResponseSchema.parse({
      applications: visible.map(summary),
      nextCursor,
      hasMore,
      total: page.total,
      counts: page.counts,
      filter: query.filter,
      sort: query.sort,
    });
  }

  async updatePreference(
    actor: CandidateActor,
    applicationId: string,
    input: {
      emailEnabled: boolean;
      inAppEnabled: boolean;
      expectedVersion: number;
    },
    now = new Date(),
  ) {
    return prisma.$transaction(
      async (tx) => {
        const application = await tx.jobApplication.findFirst({
          where: { id: applicationId, candidateUserId: actor.userId },
          select: { id: true },
        });
        if (!application) {
          throw new CandidateApplicationError(
            404,
            "APPLICATION_UNAVAILABLE",
            "This application is unavailable.",
          );
        }
        const current = await tx.applicationNotificationPreference.findUnique({
          where: { applicationId },
        });
        if (current && current.version !== input.expectedVersion) {
          throw new CandidateApplicationError(
            409,
            "APPLICATION_PREFERENCE_CONFLICT",
            "These notification settings changed. Refresh and try again.",
          );
        }
        if (!current && input.expectedVersion !== 1) {
          throw new CandidateApplicationError(
            409,
            "APPLICATION_PREFERENCE_CONFLICT",
            "These notification settings changed. Refresh and try again.",
          );
        }
        const next = current
          ? await tx.applicationNotificationPreference.updateMany({
              where: { applicationId, version: input.expectedVersion },
              data: {
                emailEnabled: input.emailEnabled,
                inAppEnabled: input.inAppEnabled,
                version: { increment: 1 },
                updatedAt: now,
              },
            })
          : null;
        if (current && next?.count !== 1) {
          throw new CandidateApplicationError(
            409,
            "APPLICATION_PREFERENCE_CONFLICT",
            "These notification settings changed. Refresh and try again.",
          );
        }
        const saved = current
          ? await tx.applicationNotificationPreference.findUniqueOrThrow({
              where: { applicationId },
            })
          : await tx.applicationNotificationPreference.create({
              data: {
                applicationId,
                emailEnabled: input.emailEnabled,
                inAppEnabled: input.inAppEnabled,
                version: 1,
                updatedAt: now,
              },
            });
        return notificationPreferenceSchema.parse({
          emailEnabled: saved.emailEnabled,
          inAppEnabled: saved.inAppEnabled,
          version: saved.version,
          updatedAt: saved.updatedAt.toISOString(),
        });
      },
      { isolationLevel: "Serializable" },
    );
  }
}
