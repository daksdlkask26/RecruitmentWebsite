import { z } from "zod";
import {
  applicationStageSchema,
  type ApplicationStage,
} from "@/shared/contracts/jobs/applications";

const idSchema = z.string().trim().min(1).max(128);
const isoDateTime = z.string().datetime();

export const applicationFileMimeTypeSchema = z.enum([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const applicationFileParseStatusSchema = z.enum([
  "READY",
  "PARTIAL",
  "FAILED",
  "NOT_APPLICABLE",
]);

/**
 * Candidate-facing metadata for one immutable, validated application file.
 * Internal storage locators and checksums intentionally never cross this
 * contract boundary.
 */
export const applicationFileDescriptorSchema = z
  .object({
    versionId: idSchema,
    displayName: z.string().trim().min(1).max(200),
    fileName: z.string().trim().min(1).max(255).optional(),
    mimeType: applicationFileMimeTypeSchema,
    byteSize: z.number().int().min(1).max(5_000_000),
    version: z.number().int().positive().optional(),
    pageCount: z.number().int().positive().nullable().optional(),
    parseStatus: applicationFileParseStatusSchema,
    confirmedAt: isoDateTime.optional(),
  })
  .strict();

export type ApplicationFileDescriptor = z.infer<
  typeof applicationFileDescriptorSchema
>;

export const candidatePersonalInfoSchema = z
  .object({
    fullName: z.string().trim().min(1).max(150),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(20),
    currentLocation: z.string().trim().max(160).default(""),
    linkedInPortfolio: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .nullable()
      .default(null),
  })
  .strict();

export type CandidatePersonalInfo = z.infer<typeof candidatePersonalInfoSchema>;

export const applicationCvSourceSchema = z.enum(["PROFILE", "UPLOADED"]);
export type ApplicationCvSource = z.infer<typeof applicationCvSourceSchema>;

export const coverLetterTextDraftSchema = z
  .object({
    kind: z.literal("TEXT"),
    text: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const coverLetterFileDraftSchema = z
  .object({
    kind: z.literal("FILE"),
    file: applicationFileDescriptorSchema,
  })
  .strict();

/** One optional field with mutually exclusive text/file variants. */
export const coverLetterDraftSchema = z.discriminatedUnion("kind", [
  coverLetterTextDraftSchema,
  coverLetterFileDraftSchema,
]);

export type CoverLetterDraft = z.infer<typeof coverLetterDraftSchema>;

export const applicationDraftSchema = z
  .object({
    draftId: idSchema,
    jobId: idSchema,
    revision: z.number().int().positive(),
    personalInformation: candidatePersonalInfoSchema,
    cv: applicationFileDescriptorSchema.nullable(),
    cvSource: applicationCvSourceSchema.nullable().default(null),
    coverLetter: coverLetterDraftSchema.nullable(),
    message: z.string().max(2_000).nullable(),
    confirmationAccepted: z.boolean(),
    updatedAt: isoDateTime,
    expiresAt: isoDateTime,
  })
  .strict();

export type ApplicationDraft = z.infer<typeof applicationDraftSchema>;

/**
 * Draft endpoints return the draft directly. Keep accepting the older
 * `{ draft }` envelope so client transitions remain compatible with any
 * already-deployed response.
 */
export function parseApplicationDraftResponse(
  value: unknown,
): ApplicationDraft {
  const payload =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "draft" in value
      ? (value as { draft?: unknown }).draft
      : value;
  const parsed = applicationDraftSchema.parse(payload);
  // Keep the parser tolerant of drafts created before the application-flow
  // profile fields and CV source were added. New responses retain the full
  // projection; legacy responses keep their original shape for callers that
  // only need to refresh the existing draft.
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const source = payload as Record<string, unknown>;
    const personalInformation = source.personalInformation;
    if (
      personalInformation &&
      typeof personalInformation === "object" &&
      !Array.isArray(personalInformation) &&
      !("currentLocation" in personalInformation) &&
      !("linkedInPortfolio" in personalInformation)
    ) {
      const legacy = { ...parsed } as Record<string, unknown>;
      const legacyPersonalInformation = {
        ...(parsed.personalInformation as Record<string, unknown>),
      };
      delete legacyPersonalInformation.currentLocation;
      delete legacyPersonalInformation.linkedInPortfolio;
      legacy.personalInformation = legacyPersonalInformation;
      if (!("cvSource" in source)) delete legacy.cvSource;
      return legacy as ApplicationDraft;
    }
  }
  return parsed;
}

export const saveApplicationDraftCommandSchema = z
  .object({
    jobId: idSchema,
    expectedRevision: z.number().int().positive().nullable(),
    personalInformation: candidatePersonalInfoSchema,
    cvVersionId: idSchema.nullable(),
    cvSource: applicationCvSourceSchema.nullable().default(null),
    coverLetter: coverLetterDraftSchema.nullable(),
    message: z.string().max(2_000).nullable(),
    confirmationAccepted: z.boolean(),
  })
  .strict();

export type SaveApplicationDraftCommand = z.infer<
  typeof saveApplicationDraftCommandSchema
>;

export const applicationReviewSchema = z
  .object({
    job: z
      .object({
        id: idSchema,
        slug: z.string().trim().min(1).max(220),
        title: z.string().trim().min(1).max(200),
        companyName: z.string().trim().min(1).max(160),
        location: z.string().trim().min(1).max(300),
        employmentType: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .default("Not specified"),
        experienceLevel: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .default("Not specified"),
        workArrangement: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .default("Not specified"),
        applicationDeadline: isoDateTime.nullable().default(null),
        isOpen: z.boolean(),
      })
      .strict(),
    draft: applicationDraftSchema,
  })
  .strict();

export type ApplicationReview = z.infer<typeof applicationReviewSchema>;

export const applicationSubmitCommandSchema = z
  .object({
    draftId: idSchema,
    expectedRevision: z.number().int().positive(),
    informationConfirmed: z.literal(true),
    shareContactWithRecruiter: z.boolean().optional(),
  })
  .strict();

export type ApplicationSubmitCommand = z.infer<
  typeof applicationSubmitCommandSchema
>;

export const intakeStateSchema = z.enum([
  "RECEIVED",
  "CHECKING_FILES",
  "SENT_TO_RECRUITER",
  "ATTENTION_REQUIRED",
]);
export type IntakeState = z.infer<typeof intakeStateSchema>;

export const intakeStepCodeSchema = z.enum([
  "APPLICATION_RECEIVED",
  "CHECKING_FILES",
  "SENT_TO_RECRUITER",
]);
export type IntakeStepCode = z.infer<typeof intakeStepCodeSchema>;

export const intakeStepStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "COMPLETE",
  "ATTENTION_REQUIRED",
]);

export const applicationIntakeSchema = z
  .object({
    state: intakeStateSchema,
    progressPercent: z.number().int().min(0).max(100),
    steps: z
      .array(
        z
          .object({
            code: intakeStepCodeSchema,
            status: intakeStepStatusSchema,
            timestamp: isoDateTime.nullable(),
          })
          .strict(),
      )
      .length(3),
    failureCode: z.string().trim().min(1).max(80).nullable(),
    updatedAt: isoDateTime,
  })
  .strict();

export type ApplicationIntake = z.infer<typeof applicationIntakeSchema>;

export const publicStageSchema = z.enum([
  "APPLICATION_SUBMITTED",
  "UNDER_REVIEW",
  "INTERVIEW",
  "OUTCOME",
]);
export type PublicStage = z.infer<typeof publicStageSchema>;

export const publicOutcomeSchema = z.enum([
  "OFFERED",
  "HIRED",
  "OFFER_DECLINED",
  "REJECTED",
  "WAITLISTED",
  "WITHDRAWN",
]);
export type PublicOutcome = z.infer<typeof publicOutcomeSchema>;

export const publicUpdateKindSchema = z.enum([
  "SUBMITTED",
  "UNDER_REVIEW",
  "INTERVIEW",
  "OUTCOME",
  "WITHDRAWN",
  "TECHNICAL_UPDATE",
]);

/**
 * Stable, locale-neutral identifiers for the Candidate timeline.  Labels and
 * descriptions belong to the workspace copy boundary; these codes are the
 * transport contract and must not be translated by the API.
 */
export const publicTimelineEventCodeSchema = z.enum([
  "APPLICATION_SUBMITTED",
  "APPLICATION_VIEWED",
  "APPLICATION_SHORTLISTED",
  "INTERVIEW_STARTED",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
  "APPLICATION_REJECTED",
  "APPLICATION_WAITLISTED",
  "APPLICATION_WITHDRAWN",
  "FILE_PROCESSING_UPDATED",
]);

export type PublicTimelineEventCode = z.infer<
  typeof publicTimelineEventCodeSchema
>;

export const applicationPublicUpdateSchema = z
  .object({
    id: idSchema,
    eventCode: publicTimelineEventCodeSchema,
    kind: publicUpdateKindSchema,
    publicStage: publicStageSchema.nullable().optional(),
    publicOutcome: publicOutcomeSchema.nullable().optional(),
    canonicalStage: applicationStageSchema.nullable().optional(),
    title: z.string().trim().min(1).max(160),
    /** Candidate-visible author text is never localized or machine-translated. */
    userMessage: z.string().max(500).nullable().optional(),
    occurredAt: isoDateTime,
  })
  .strict();

export type ApplicationPublicUpdate = z.infer<
  typeof applicationPublicUpdateSchema
>;

export const notificationPreferenceSchema = z
  .object({
    emailEnabled: z.boolean(),
    inAppEnabled: z.boolean(),
    version: z.number().int().positive(),
    updatedAt: isoDateTime,
  })
  .strict();

export type ApplicationNotificationPreference = z.infer<
  typeof notificationPreferenceSchema
>;

const publicFileSchema = applicationFileDescriptorSchema;

/**
 * A candidate can see whether a submitted artifact remains available without
 * receiving any storage, malware, retention, or legal-hold internals.
 */
export const applicationDocumentAvailabilitySchema = z.enum([
  "AVAILABLE",
  "EXPIRED",
  "DELETED",
  "HELD",
  "TEMPORARILY_UNAVAILABLE",
]);

const submittedCalendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .nullable();

const submittedProfileEntrySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(200),
    startDate: submittedCalendarDateSchema,
    endDate: submittedCalendarDateSchema,
  })
  .strict();

const submittedEducationEntrySchema = z
  .object({
    institution: z.string().trim().min(1).max(200),
    degree: z.string().trim().min(1).max(200),
    field: z.string().trim().max(200).nullable(),
    startDate: submittedCalendarDateSchema,
    endDate: submittedCalendarDateSchema,
  })
  .strict();

export const submittedProfileSnapshotSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("AVAILABLE"),
      fullName: z.string().trim().min(1).max(150),
      headline: z.string().trim().max(200).nullable(),
      summary: z.string().trim().max(5_000).nullable(),
      skills: z.array(z.string().trim().min(1).max(80)).max(50),
      experience: z.array(submittedProfileEntrySchema).max(50),
      education: z.array(submittedEducationEntrySchema).max(50),
    })
    .strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict(),
]);

export const submittedContactSnapshotSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("AVAILABLE"),
      fullName: z.string().trim().min(1).max(150),
      email: z.string().trim().email().max(254),
      phone: z.string().trim().min(1).max(20),
      location: z.string().trim().max(160).nullable(),
    })
    .strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict(),
]);

export const submittedConsentSnapshotSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("AVAILABLE"),
      version: z.string().trim().min(1).max(64),
      consentedAt: isoDateTime,
    })
    .strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict(),
]);

export const submittedApplicationSnapshotSchema = z
  .object({
    profile: submittedProfileSnapshotSchema,
    contact: submittedContactSnapshotSchema,
    consent: submittedConsentSnapshotSchema,
    job: z
      .object({
        available: z.boolean(),
        title: z.string().trim().min(1).max(200).nullable(),
        companyName: z.string().trim().min(1).max(160).nullable(),
        location: z.string().trim().min(1).max(300).nullable(),
        employmentType: z.string().trim().min(1).max(80).nullable(),
        experienceLevel: z.string().trim().min(1).max(80).nullable(),
        workArrangement: z.string().trim().min(1).max(80).nullable(),
        requiredSkills: z.array(z.string().trim().min(1).max(160)).max(100),
        version: z.number().int().positive().nullable(),
      })
      .strict(),
    cv: z
      .object({
        availability: applicationDocumentAvailabilitySchema,
        file: applicationFileDescriptorSchema.nullable(),
        previewSupported: z.boolean(),
      })
      .strict(),
    coverLetter: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("NONE"),
          availability: z.literal("NOT_PROVIDED"),
        })
        .strict(),
      z
        .object({
          kind: z.literal("TEXT"),
          availability: applicationDocumentAvailabilitySchema,
          text: z.string().trim().min(1).max(10_000).nullable(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("FILE"),
          availability: applicationDocumentAvailabilitySchema,
          file: applicationFileDescriptorSchema.nullable(),
          previewSupported: z.boolean(),
        })
        .strict(),
    ]),
    answers: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(500),
            answer: z.union([z.string().trim().max(3_000), z.boolean()]),
          })
          .strict(),
      )
      .max(20),
    message: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export type SubmittedApplicationSnapshot = z.infer<
  typeof submittedApplicationSnapshotSchema
>;

export const applicationTrackerSchema = z
  .object({
    applicationId: idSchema,
    job: z
      .object({
        jobId: idSchema,
        slug: z.string().trim().min(1).max(220).nullable(),
        title: z.string().trim().min(1).max(200),
        companyName: z.string().trim().min(1).max(160),
        companyLogoUrl: z.string().url().nullable(),
        location: z.string().trim().min(1).max(300),
        employmentType: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .default("Not specified"),
        experienceLevel: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .default("Not specified"),
        workArrangement: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .default("Not specified"),
        applicationDeadline: isoDateTime.nullable().default(null),
        jobAvailable: z.boolean(),
      })
      .strict(),
    publicStage: publicStageSchema,
    publicOutcome: publicOutcomeSchema.nullable(),
    canonicalStage: applicationStageSchema,
    transitionFromStage: applicationStageSchema.nullable().optional(),
    stageVersion: z.number().int().positive(),
    submittedAt: isoDateTime,
    lastUpdatedAt: isoDateTime,
    intake: applicationIntakeSchema,
    updates: z.array(applicationPublicUpdateSchema).max(500),
    files: z.array(publicFileSchema).min(1).max(2),
    submission: submittedApplicationSnapshotSchema,
    notificationPreference: notificationPreferenceSchema,
    contactConsent: z
      .object({ shared: z.boolean(), version: z.number().int().positive() })
      .strict()
      .optional(),
    canWithdraw: z.boolean(),
  })
  .strict();

export type ApplicationTracker = z.infer<typeof applicationTrackerSchema>;

export const offerResponseCommandSchema = z
  .object({
    decision: z.enum(["ACCEPT", "DECLINE"]),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export type OfferResponseCommand = z.infer<typeof offerResponseCommandSchema>;

export const offerResponseOutcomeSchema = z
  .object({
    applicationId: idSchema,
    fromStage: z.literal("OFFERED"),
    stage: z.enum(["HIRED", "OFFER_DECLINED", "WAITLISTED"]),
    stageVersion: z.number().int().positive(),
    lastStageChangedAt: isoDateTime,
    eventId: idSchema,
  })
  .strict();

export type OfferResponseOutcome = z.infer<typeof offerResponseOutcomeSchema>;

export const applicationReceiptSchema = z
  .object({
    applicationId: idSchema,
    submittedAt: isoDateTime,
    publicStage: z.literal("APPLICATION_SUBMITTED"),
    intake: applicationIntakeSchema,
    files: z.array(publicFileSchema).min(1).max(2),
  })
  .strict();

export type ApplicationReceipt = z.infer<typeof applicationReceiptSchema>;

export const withdrawalCommandSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    confirmed: z.literal(true),
  })
  .strict();

export const withdrawalOutcomeSchema = z
  .object({
    applicationId: idSchema,
    outcome: z.literal("WITHDRAWN"),
    withdrawnAt: isoDateTime,
    preservedStage: z.enum(["APPLIED", "VIEWED", "SHORTLISTED", "WAITLISTED"]),
    version: z.number().int().positive(),
  })
  .strict();

export type WithdrawalOutcome = z.infer<typeof withdrawalOutcomeSchema>;

export const notificationPreferenceUpdateSchema = z
  .object({
    emailEnabled: z.boolean(),
    inAppEnabled: z.boolean(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const candidateApplicationSummarySchema = z
  .object({
    applicationId: idSchema,
    jobId: idSchema,
    jobSlug: z.string().trim().min(1).max(220).nullable(),
    jobTitle: z.string().trim().min(1).max(200),
    companyName: z.string().trim().min(1).max(160),
    companyLogoUrl: z.string().url().nullable(),
    location: z.string().trim().min(1).max(300),
    publicStage: publicStageSchema,
    publicOutcome: publicOutcomeSchema.nullable(),
    canonicalStage: applicationStageSchema,
    stageVersion: z.number().int().positive(),
    submittedAt: isoDateTime,
    lastUpdatedAt: isoDateTime,
    jobAvailable: z.boolean(),
  })
  .strict();

export const candidateApplicationListResponseSchema = z
  .object({
    applications: z.array(candidateApplicationSummarySchema).max(100),
    nextCursor: z.string().min(1).max(1024).nullable(),
    hasMore: z.boolean(),
    total: z.number().int().nonnegative(),
    counts: z
      .object({
        ALL: z.number().int().nonnegative(),
        APPLICATION_SUBMITTED: z.number().int().nonnegative(),
        UNDER_REVIEW: z.number().int().nonnegative(),
        INTERVIEW: z.number().int().nonnegative(),
        OUTCOME: z.number().int().nonnegative(),
        WITHDRAWN: z.number().int().nonnegative(),
      })
      .strict(),
    filter: z.enum([
      "ALL",
      "APPLICATION_SUBMITTED",
      "UNDER_REVIEW",
      "INTERVIEW",
      "OUTCOME",
      "WITHDRAWN",
    ]),
    sort: z.enum(["SUBMITTED_DESC", "SUBMITTED_ASC"]),
  })
  .strict();

export const candidateApplicationListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    filter: z
      .enum([
        "ALL",
        "APPLICATION_SUBMITTED",
        "UNDER_REVIEW",
        "INTERVIEW",
        "OUTCOME",
        "WITHDRAWN",
      ])
      .default("ALL"),
    sort: z.enum(["SUBMITTED_DESC", "SUBMITTED_ASC"]).default("SUBMITTED_DESC"),
  })
  .strict();

export type CandidateApplicationListFilter = z.infer<
  typeof candidateApplicationListResponseSchema
>["filter"];
export type CandidateApplicationListSort = z.infer<
  typeof candidateApplicationListResponseSchema
>["sort"];

export type CandidateApplicationSummary = z.infer<
  typeof candidateApplicationSummarySchema
>;

export function publicStageForCanonicalStage(
  stage: ApplicationStage,
): PublicStage {
  if (stage === "INTERVIEWING") return "INTERVIEW";
  if (
    ["OFFERED", "HIRED", "OFFER_DECLINED", "REJECTED", "WAITLISTED"].includes(
      stage,
    )
  ) {
    return "OUTCOME";
  }
  if (["VIEWED", "SHORTLISTED"].includes(stage)) {
    return "UNDER_REVIEW";
  }
  return "APPLICATION_SUBMITTED";
}

export function publicOutcomeForCanonicalStage(
  stage: ApplicationStage,
): PublicOutcome | null {
  if (
    stage === "OFFERED" ||
    stage === "HIRED" ||
    stage === "OFFER_DECLINED" ||
    stage === "REJECTED" ||
    stage === "WAITLISTED"
  ) {
    return stage;
  }
  return null;
}

export function publicUpdateKindForCanonicalStage(
  stage: ApplicationStage,
): z.infer<typeof publicUpdateKindSchema> {
  if (stage === "APPLIED") return "SUBMITTED";
  if (stage === "VIEWED" || stage === "SHORTLISTED") return "UNDER_REVIEW";
  if (stage === "INTERVIEWING") return "INTERVIEW";
  return "OUTCOME";
}

export function publicTimelineEventCodeForCanonicalStage(
  stage: ApplicationStage,
): PublicTimelineEventCode {
  switch (stage) {
    case "APPLIED":
      return "APPLICATION_SUBMITTED";
    case "VIEWED":
      return "APPLICATION_VIEWED";
    case "SHORTLISTED":
      return "APPLICATION_SHORTLISTED";
    case "INTERVIEWING":
      return "INTERVIEW_STARTED";
    case "OFFERED":
      return "OFFER_SENT";
    case "HIRED":
      return "OFFER_ACCEPTED";
    case "OFFER_DECLINED":
      return "OFFER_DECLINED";
    case "REJECTED":
      return "APPLICATION_REJECTED";
    case "WAITLISTED":
      return "APPLICATION_WAITLISTED";
  }
}

export function publicUpdateTitleForCanonicalStage(stage: ApplicationStage) {
  switch (stage) {
    case "APPLIED":
      return "Application submitted";
    case "VIEWED":
      return "Application viewed";
    case "SHORTLISTED":
      return "Application shortlisted";
    case "INTERVIEWING":
      return "Interview stage reached";
    case "OFFERED":
      return "Offer sent";
    case "HIRED":
      return "Offer accepted";
    case "OFFER_DECLINED":
      return "Offer declined";
    case "REJECTED":
      return "Application rejected";
    case "WAITLISTED":
      return "Application waitlisted";
  }
}
