import { z } from "zod";
import { profileBasicsSchema } from "@/shared/contracts/account/profile";

export const MAX_APPLICATION_ATTEMPTS = 5;
export const MAX_APPLICATION_ATTEMPTS_MESSAGE =
  "You have reached the maximum number of applications for this job.";

export const jobProblemSchema = z
  .object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    fieldErrors: z.record(z.string(), z.array(z.string()).max(5)).optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
  })
  .strict();

export const savedJobOutcomeSchema = z
  .object({
    jobId: z.string().min(1).max(128),
    saved: z.boolean(),
    message: z.string().min(1).max(300),
  })
  .strict();

export const jobReportReasonSchema = z.enum([
  "FRAUD",
  "MISLEADING",
  "DUPLICATE",
  "DISCRIMINATORY",
  "INAPPROPRIATE",
  "OTHER",
]);

export const jobReportInputSchema = z
  .object({
    reason: jobReportReasonSchema,
    details: z.string().trim().max(2000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ["OTHER", "MISLEADING", "DISCRIMINATORY"].includes(value.reason) &&
      (value.details?.length ?? 0) < 20
    ) {
      context.addIssue({
        code: "custom",
        path: ["details"],
        message: "Provide at least 20 characters of detail for this reason.",
      });
    }
  });

export const jobReportOutcomeSchema = z
  .object({
    received: z.literal(true),
    duplicate: z.boolean(),
    message: z.string().min(1).max(300),
  })
  .strict();

export const candidateCvOptionSchema = z
  .object({
    id: z.string().min(1).max(128),
    displayName: z.string().min(1).max(200),
    fileName: z.string().min(1).max(255),
    mimeType: z.enum([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    byteSize: z.number().int().min(1).max(5_000_000),
    version: z.number().int().positive(),
    confirmedAt: z.string().datetime(),
  })
  .strict();

export const applicationContactSnapshotSchema = z
  .object({
    fullName: z.string().trim().min(1).max(150),
    email: z.string().trim().email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^(?:0|\+84)(?:3|5|7|8|9)\d{8}$/u),
    // Phone and location can be edited for one application. Keep this
    // optional so legacy direct-application clients remain compatible.
    location: z.string().trim().max(160).optional(),
  })
  .strict();

export const applicationContactFormSchema = z
  .object({
    fullName: z.string().max(150),
    email: z.string().max(254),
    phone: z.string().max(20),
  })
  .strict();

export const applicationQuestionSchema = z
  .object({
    id: z.string().min(1).max(128),
    prompt: z.string().min(1).max(500),
    description: z.string().max(1000).nullable(),
    kind: z.enum(["TEXT", "BOOLEAN", "SINGLE_CHOICE"]),
    required: z.boolean(),
    options: z.array(z.string().min(1).max(200)).min(2).max(20).nullable(),
    version: z.number().int().positive(),
  })
  .strict();

export const applicationFormSchema = z
  .object({
    jobId: z.string().min(1).max(128),
    jobTitle: z.string().min(1).max(200),
    jobLocation: z.string().trim().min(1).max(160),
    companyName: z.string().min(1).max(160),
    profileReady: z.boolean(),
    missingProfileFields: z.array(z.string().min(1).max(80)).max(20),
    profileRevision: z.number().int().nonnegative(),
    profileBasics: profileBasicsSchema,
    cvs: z.array(candidateCvOptionSchema).max(50),
    contact: applicationContactFormSchema.optional(),
    questions: z.array(applicationQuestionSchema).max(20),
    consentVersion: z.string().min(1).max(64),
    csrfToken: z.string().min(1).max(256),
    applicationCount: z.number().int().nonnegative().optional(),
    maxApplicationAttempts: z.literal(MAX_APPLICATION_ATTEMPTS).optional(),
  })
  .strict();

export const applicationAnswerInputSchema = z
  .object({
    questionId: z.string().min(1).max(128),
    value: z.union([z.string().trim().max(3000), z.boolean()]),
  })
  .strict();

export const DIRECT_APPLICATION_CV_ID = "application-upload";

export const applicationCoverLetterInputSchema = z.union([
  z.string().trim().max(5_000),
  z.object({ kind: z.literal("NONE") }).strict(),
  z
    .object({
      kind: z.literal("TEXT"),
      text: z.string().trim().min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("FILE"),
      validatedDocumentId: z.string().min(1).max(128),
    })
    .strict(),
]);

export const applicationSubmissionSchema = z
  .object({
    cvId: z.string().min(1).max(128),
    cvUploadId: z.string().min(1).max(128).optional(),
    cvFileRef: z.string().min(1).max(256).nullable().optional(),
    contactSnapshot: applicationContactSnapshotSchema.optional(),
    shareContactWithRecruiter: z.boolean().optional(),
    answers: z.array(applicationAnswerInputSchema).max(20),
    coverLetter: applicationCoverLetterInputSchema.nullable(),
    message: z.string().trim().max(2_000).nullable().optional(),
    consentVersion: z.string().min(1).max(64),
    consentAccepted: z.literal(true),
    aiAnalysisConsent: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.answers.map((answer) => answer.questionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message: "Answer each question once.",
      });
    }
  });

export const applicationOutcomeSchema = z
  .object({
    applicationId: z.string().min(1).max(128),
    jobId: z.string().min(1).max(128),
    stage: z.literal("APPLIED"),
    stageVersion: z.number().int().positive().optional(),
    submittedAt: z.string().datetime(),
    created: z.boolean(),
    message: z.string().min(1).max(300),
    aiAnalysisConsent: z.boolean().optional(),
    aiMatchScore: z.number().int().min(0).max(100).nullable().optional(),
    applicationAttemptNumber: z.number().int().positive().optional(),
  })
  .strict();

export const idempotencyKeySchema = z.string().min(16).max(128);

export type JobProblem = z.infer<typeof jobProblemSchema>;
export type JobReportInput = z.infer<typeof jobReportInputSchema>;
export type ApplicationContactSnapshot = z.infer<
  typeof applicationContactSnapshotSchema
>;
export type ApplicationForm = z.infer<typeof applicationFormSchema>;
export type ApplicationSubmission = z.infer<typeof applicationSubmissionSchema>;
export type ApplicationOutcome = z.infer<typeof applicationOutcomeSchema>;
