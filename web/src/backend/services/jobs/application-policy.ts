import "server-only";
import type { ApplicationSubmission } from "@/shared/contracts/jobs/actions";

export const ACTIVE_APPLICATION_CONSENT_VERSION = "2026-08-01";

export type DirectApplicationCv = Readonly<{
  id: string;
  displayName: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  checksumSha256: string;
  /** Optional lifecycle hooks supplied by a request-scoped temporary upload. */
  claimOwnership?: () => void;
  preserveOnUnknown?: () => void;
  /** Completes a deferred object write after its ownership ledger is staged. */
  ensureStored?: () => Promise<void>;
}>;

export class ApplicationRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type Question = {
  id: string;
  prompt: string;
  description: string | null;
  kind: "TEXT" | "BOOLEAN" | "SINGLE_CHOICE";
  required: boolean;
  options: string[] | null;
  version: number;
};

export type ApplicationPolicyContext = {
  candidate: {
    userId: string;
    name: string;
    email?: string | null;
    headline: string | null;
    summary?: string | null;
    phone?: string | null;
    location: string | null;
    skills: Array<{ id: string; label: string }>;
    experience: Array<{
      title: string;
      company: string;
      startDate: Date | string;
      endDate: Date | string | null;
    }>;
    education: Array<{
      institution: string;
      degree: string;
      field: string | null;
    }>;
  };
  cv: {
    id: string;
    candidateUserId: string;
    displayName: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    storageKey: string;
    checksumSha256: string;
    version: number;
    confirmedAt: Date | null;
    archivedAt: Date | null;
  } | null;
  job: {
    id: string;
    version: number;
    title: string;
    companyId: string;
    companyName: string;
    location: string;
    employmentType: string;
    experienceLevel: string;
    workArrangement: string;
    requiredSkills: string[];
  };
  questions: Question[];
};

function plainText(value: string | null, maximum: number, required = false) {
  const normalized = (value ?? "")
    .normalize("NFKC")
    .replace(
      /<(?:script|style|textarea|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|textarea|noscript)>/giu,
      " ",
    )
    .replace(/<[^>]*>/gu, " ")
    .replace(/[<>]/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (required && !normalized)
    throw new ApplicationRepositoryError("APPLICATION_ANSWER_REQUIRED");
  if (Array.from(normalized).length > maximum)
    throw new ApplicationRepositoryError("APPLICATION_TEXT_TOO_LONG");
  return normalized || null;
}

function coverLetterText(
  value: ApplicationSubmission["coverLetter"],
): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (value.kind === "NONE") return null;
  if (value.kind === "TEXT") return value.text;
  throw new ApplicationRepositoryError("APPLICATION_COVER_LETTER_INELIGIBLE");
}

const iso = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString().slice(0, 10);

export function prepareApplicationSubmission(
  context: ApplicationPolicyContext,
  command: ApplicationSubmission,
  activeConsentVersion: string,
  now: Date,
) {
  // The application wizard permits phone/location overrides for this
  // application. Use the submitted snapshot when present; otherwise retain
  // the legacy direct-application profile values.
  const candidate = {
    ...context.candidate,
    phone: command.contactSnapshot?.phone ?? context.candidate.phone,
    location: command.contactSnapshot?.location ?? context.candidate.location,
  };
  if (!candidate.name.trim() || !candidate.location?.trim()) {
    throw new ApplicationRepositoryError("APPLICATION_PROFILE_INCOMPLETE");
  }
  const cv = context.cv;
  if (
    !cv ||
    cv.id !== command.cvId ||
    cv.candidateUserId !== context.candidate.userId ||
    !cv.confirmedAt ||
    cv.archivedAt ||
    cv.byteSize < 1 ||
    cv.byteSize > 5_000_000 ||
    ![
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(cv.mimeType)
  )
    throw new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE");
  if (
    !command.consentAccepted ||
    command.consentVersion !== activeConsentVersion
  ) {
    throw new ApplicationRepositoryError("APPLICATION_CONSENT_STALE");
  }

  const supplied = new Map(
    command.answers.map((answer) => [answer.questionId, answer.value]),
  );
  if (supplied.size !== command.answers.length)
    throw new ApplicationRepositoryError("APPLICATION_ANSWER_DUPLICATE");
  if (
    command.answers.some(
      (answer) =>
        !context.questions.some(
          (question) => question.id === answer.questionId,
        ),
    )
  ) {
    throw new ApplicationRepositoryError("APPLICATION_ANSWER_UNKNOWN");
  }
  const answers = context.questions.flatMap((question) => {
    const value = supplied.get(question.id);
    if (value === undefined) {
      if (question.required)
        throw new ApplicationRepositoryError("APPLICATION_ANSWER_REQUIRED");
      return [];
    }
    let answer: string | boolean;
    if (question.kind === "BOOLEAN") {
      if (typeof value !== "boolean")
        throw new ApplicationRepositoryError("APPLICATION_ANSWER_INVALID");
      answer = value;
    } else {
      if (typeof value !== "string")
        throw new ApplicationRepositoryError("APPLICATION_ANSWER_INVALID");
      const normalized = plainText(value, 3000, question.required);
      if (normalized === null) return [];
      if (
        question.kind === "SINGLE_CHOICE" &&
        !question.options?.includes(normalized)
      ) {
        throw new ApplicationRepositoryError("APPLICATION_ANSWER_INVALID");
      }
      answer = normalized;
    }
    return [
      {
        questionId: question.id,
        questionSnapshot: {
          v: 1,
          prompt: question.prompt,
          description: question.description,
          kind: question.kind,
          required: question.required,
          options: question.options,
          version: question.version,
        },
        answer,
      },
    ];
  });

  return {
    coverLetter: plainText(coverLetterText(command.coverLetter), 10_000),
    profileSnapshot: {
      v: 1,
      candidateName: candidate.name,
      email: candidate.email ?? null,
      headline: candidate.headline!,
      summary: candidate.summary ?? null,
      phone: candidate.phone ?? null,
      location: candidate.location!,
      skills: candidate.skills,
      experience: candidate.experience.map((item) => ({
        ...item,
        startDate: iso(item.startDate),
        endDate: iso(item.endDate),
      })),
      education: candidate.education,
    },
    cvSnapshot: {
      v: 1,
      cvId: cv.id,
      cvVersion: cv.version,
      displayName: cv.displayName,
      fileName: cv.fileName,
      mimeType: cv.mimeType,
      byteSize: cv.byteSize,
      checksumSha256: cv.checksumSha256,
      storageKey: cv.storageKey,
      confirmedAt: cv.confirmedAt.toISOString(),
    },
    jobSnapshot: {
      v: 1,
      jobId: context.job.id,
      jobVersion: context.job.version,
      ...context.job,
    },
    answers,
    consentedAt: now,
  };
}
