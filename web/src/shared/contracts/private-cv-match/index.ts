import { z } from "zod";

const isoDateTime = z.string().datetime();

export const matchPresentationStateSchema = z.enum([
  "AVAILABLE",
  "INCOMPLETE",
  "UNAVAILABLE",
]);

export const privateMatchErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "INVALID_REQUEST",
  "UNAVAILABLE",
  "CONFLICT",
  "JOB_UNAVAILABLE",
  "CV_UNAVAILABLE",
  "CV_NOT_PARSED",
  "INTERNAL_FAILURE",
]);

export const privateMatchErrorResponseSchema = z
  .object({ code: privateMatchErrorCodeSchema })
  .strict();

export const createPrivateMatchRequestSchema = z
  .object({
    jobId: z.string().trim().min(1).max(128),
    cvVersionId: z.string().trim().min(1).max(128),
  })
  .strict();

export const sourceProvenanceSchema = z
  .object({
    inputSource: z.literal("CV"),
    completeness: matchPresentationStateSchema,
    presentationState: matchPresentationStateSchema,
    scoreEligible: z.boolean(),
    cvVersionId: z.string().min(1).max(128),
    cvVersion: z.number().int().positive(),
    jdVersion: z.number().int().positive(),
    scoringConfigVersion: z.string().min(1).max(64),
    aiProvider: z.string().max(100).nullable(),
    aiModel: z.string().max(200).nullable(),
    promptVersion: z.string().max(100).nullable(),
    inputPolicyVersion: z.string().max(100).nullable(),
  })
  .strict();

export const privateMatchCvSchema = z
  .object({
    versionId: z.string().min(1).max(128),
    version: z.number().int().positive(),
    displayName: z.string().min(1).max(200),
    fileName: z.string().min(1).max(255),
    mimeType: z.enum([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    byteSize: z.number().int().positive().max(5_000_000),
    pageCount: z.number().int().positive().nullable(),
    parseStatus: z.enum(["READY", "PARTIAL", "FAILED"]),
    confirmedAt: isoDateTime,
  })
  .strict();

export const privateMatchJobSchema = z
  .object({
    jobId: z.string().min(1).max(128),
    slug: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    company: z.string().min(1).max(200),
    location: z.string().min(1).max(200),
    employmentType: z.string().min(1).max(80),
    workArrangement: z.string().min(1).max(80),
    requiredExperienceYears: z.number().int().nonnegative().nullable(),
    requirements: z.array(z.string().min(1).max(200)).max(100),
    jdVersion: z.number().int().positive(),
    jdUpdatedAt: isoDateTime,
  })
  .strict();

// The picker presents the complete candidate-visible result set in a bounded
// scroll region. This comfortably covers the public catalogue while keeping
// the private endpoint payload explicitly bounded.
export const PRIVATE_MATCH_JOB_PICKER_LIMIT = 250;

export const privateMatchJobsResponseSchema = z
  .object({
    items: z.array(privateMatchJobSchema).max(PRIVATE_MATCH_JOB_PICKER_LIMIT),
  })
  .strict();

export const privateMatchEvidenceSchema = z
  .object({
    type: z.enum([
      "SKILL",
      "PROJECT",
      "IMPACT",
      "EXPERIENCE",
      "EDUCATION",
      "OTHER",
    ]),
    quote: z.string().min(1).max(1_000),
    criterion: z.string().min(1).max(300),
    location: z.string().min(1).max(160),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const privateRequirementMatchSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(200),
    kind: z.enum(["REQUIRED", "PREFERRED"]),
    matched: z.boolean(),
  })
  .strict();

export const privateRequirementGapSchema = z
  .object({
    code: z.string().min(1).max(160),
    title: z.string().min(1).max(300),
    description: z.string().min(1).max(500),
    kind: z.enum(["REQUIRED", "PREFERRED", "EXPERIENCE"]),
  })
  .strict();

export const privateAutomaticComponentSchema = z
  .object({
    score: z.number().min(0).max(100).nullable(),
    weight: z.union([z.literal(0.4), z.literal(0.6)]),
    weightedContribution: z.number().min(0).max(60).nullable(),
    evidenceCoverage: z.number().min(0).max(100).nullable(),
    evidenceConfidence: z.number().min(0).max(100).nullable(),
    matchedRequirements: z.array(privateRequirementMatchSchema).max(200),
    gaps: z.array(privateRequirementGapSchema).max(200),
    requiredExperience: z.number().nonnegative().nullable(),
    detectedExperience: z.number().nonnegative().nullable(),
    evidence: z.array(privateMatchEvidenceSchema).max(500),
    parserProvenance: z
      .object({
        parserVersion: z.string().min(1).max(80),
        cvStatus: z.string().min(1).max(80),
        jdStatus: z.string().min(1).max(80),
      })
      .strict(),
    mayBeIncomplete: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.weightedContribution !== null &&
      value.weightedContribution > value.weight * 100
    ) {
      context.addIssue({
        code: "custom",
        path: ["weightedContribution"],
        message: "Weighted contribution exceeds the component weight",
      });
    }
  });

export const privateAiEvaluationSchema = z
  .object({
    score: z.number().min(0).max(100).nullable(),
    weight: z.union([z.literal(0.4), z.literal(0.6)]),
    weightedContribution: z.number().min(0).max(60).nullable(),
    summary: z.string().min(1).max(1_000),
    strengths: z
      .array(
        z
          .object({
            title: z.string().min(1).max(160),
            evidence: z.string().min(1).max(1_000),
          })
          .strict(),
      )
      .max(4),
    mainGap: z.string().max(1_000).nullable(),
    actions: z.array(z.string().min(1).max(500)).max(4),
    evidenceConfidence: z.number().int().min(0).max(100).nullable(),
    evidenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    promptVersion: z.string().min(1).max(100),
    policyVersion: z.string().min(1).max(100),
    durationMs: z.number().int().nonnegative(),
    completedAt: isoDateTime,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.weightedContribution !== null &&
      value.weightedContribution > value.weight * 100
    ) {
      context.addIssue({
        code: "custom",
        path: ["weightedContribution"],
        message: "Weighted contribution exceeds the component weight",
      });
    }
  });

const privateMatchBaseSchema = {
  checkId: z.string().min(1).max(128),
  inputSource: z.literal("CV"),
  completeness: matchPresentationStateSchema,
  presentationState: matchPresentationStateSchema,
  scoreEligible: z.boolean(),
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
  provenance: sourceProvenanceSchema,
  job: privateMatchJobSchema,
  cv: privateMatchCvSchema,
};

export const privateMatchStatusSchema = z
  .object({
    view: z.literal("STATUS"),
    ...privateMatchBaseSchema,
    state: z.enum(["QUEUED", "ANALYZING", "FAILED"]),
    failureCode: z.string().min(1).max(80).nullable(),
    durationSeconds: z.number().nonnegative().nullable(),
  })
  .strict();

export const limitedPrivateReportSchema = z
  .object({
    view: z.literal("LIMITED_REPORT"),
    ...privateMatchBaseSchema,
    state: z.literal("LIMITED"),
    mode: z.literal("LIMITED"),
    automatic: privateAutomaticComponentSchema,
    aiEvaluation: z.null(),
    hybridScore: z.null(),
    matchBand: z.null(),
    canRetryAi: z.literal(true),
    canApply: z.boolean(),
    retryInProgress: z.boolean(),
    completedAt: isoDateTime,
    failureCode: z.string().min(1).max(80).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.presentationState !== "AVAILABLE") {
      if (
        value.automatic.score !== null ||
        value.automatic.weightedContribution !== null ||
        value.automatic.evidenceCoverage !== null ||
        value.automatic.evidenceConfidence !== null ||
        value.automatic.requiredExperience !== null ||
        value.automatic.detectedExperience !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["automatic"],
          message:
            "Incomplete or unavailable reports cannot expose numeric results",
        });
      }
    }
    if (value.scoreEligible !== (value.presentationState === "AVAILABLE")) {
      context.addIssue({
        code: "custom",
        path: ["scoreEligible"],
        message: "Score eligibility must match presentation state",
      });
    }
  });

export const fullPrivateReportSchema = z
  .object({
    view: z.literal("FULL_REPORT"),
    ...privateMatchBaseSchema,
    state: z.literal("READY"),
    mode: z.literal("HYBRID"),
    hybridScore: z.number().min(0).max(100).multipleOf(0.1).nullable(),
    matchBand: z.enum(["HIGH_MATCH", "MEDIUM_MATCH", "LOW_MATCH"]).nullable(),
    automatic: privateAutomaticComponentSchema,
    aiEvaluation: privateAiEvaluationSchema,
    evidenceConfidence: z.number().int().min(0).max(100).nullable(),
    summary: z.string().min(1).max(1_000),
    actions: z.array(z.string().min(1).max(500)).max(4),
    canApply: z.boolean(),
    completedAt: isoDateTime,
    // A completed report stays readable while a new immutable AI attempt runs.
    retryInProgress: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const available = value.presentationState === "AVAILABLE";
    if (value.scoreEligible !== available) {
      context.addIssue({
        code: "custom",
        path: ["scoreEligible"],
        message: "Score eligibility must match presentation state",
      });
    }
    if (available && (value.hybridScore === null || value.matchBand === null)) {
      context.addIssue({
        code: "custom",
        path: ["hybridScore"],
        message: "Available reports must expose a hybrid score and band",
      });
    }
    if (!available && value.hybridScore !== null) {
      context.addIssue({
        code: "custom",
        path: ["hybridScore"],
        message:
          "Incomplete or unavailable reports cannot expose a hybrid score",
      });
    }
    if (!available && value.aiEvaluation.score !== null) {
      context.addIssue({
        code: "custom",
        path: ["aiEvaluation", "score"],
        message: "Incomplete or unavailable reports cannot expose an AI score",
      });
    }
    if (!available) {
      const numericFields = [
        ["automatic", "score", value.automatic.score],
        [
          "automatic",
          "weightedContribution",
          value.automatic.weightedContribution,
        ],
        ["automatic", "evidenceCoverage", value.automatic.evidenceCoverage],
        ["automatic", "evidenceConfidence", value.automatic.evidenceConfidence],
        ["automatic", "requiredExperience", value.automatic.requiredExperience],
        ["automatic", "detectedExperience", value.automatic.detectedExperience],
        [
          "aiEvaluation",
          "weightedContribution",
          value.aiEvaluation.weightedContribution,
        ],
        [
          "aiEvaluation",
          "evidenceConfidence",
          value.aiEvaluation.evidenceConfidence,
        ],
      ] as const;
      for (const [parent, field, fieldValue] of numericFields) {
        if (fieldValue !== null) {
          context.addIssue({
            code: "custom",
            path: [parent, field],
            message:
              "Incomplete or unavailable reports cannot expose numeric results",
          });
        }
      }
    }
  });

export const privateMatchListItemSchema = z
  .object({
    checkId: z.string().min(1).max(128),
    inputSource: z.literal("CV"),
    completeness: matchPresentationStateSchema,
    presentationState: matchPresentationStateSchema,
    scoreEligible: z.boolean(),
    state: z.enum(["QUEUED", "ANALYZING", "LIMITED", "READY", "FAILED"]),
    createdAt: isoDateTime,
    expiresAt: isoDateTime,
    job: z
      .object({
        jobId: z.string().min(1).max(128),
        slug: z.string().min(1).max(200),
        title: z.string().min(1).max(200),
        company: z.string().min(1).max(200),
        location: z.string().min(1).max(200),
      })
      .strict(),
    cv: z
      .object({
        versionId: z.string().min(1).max(128),
        displayName: z.string().min(1).max(200),
        fileName: z.string().min(1).max(255),
        version: z.number().int().positive(),
      })
      .strict(),
    hybridScore: z.number().min(0).max(100).multipleOf(0.1).nullable(),
    deterministicScore: z.number().min(0).max(100).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.presentationState !== "AVAILABLE" && value.scoreEligible) {
      context.addIssue({
        code: "custom",
        path: ["scoreEligible"],
        message: "Only available list items may be score eligible",
      });
    }
    if (
      value.presentationState !== "AVAILABLE" &&
      (value.hybridScore !== null || value.deterministicScore !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["hybridScore"],
        message: "Incomplete or unavailable list items cannot expose scores",
      });
    }
  });

export const privateMatchListResponseSchema = z
  .object({ items: z.array(privateMatchListItemSchema).max(50) })
  .strict();

export const privateMatchResponseSchema = z.discriminatedUnion("view", [
  privateMatchStatusSchema,
  limitedPrivateReportSchema,
  fullPrivateReportSchema,
]);

export type CreatePrivateMatchRequest = z.infer<
  typeof createPrivateMatchRequestSchema
>;
export type PrivateMatchErrorCode = z.infer<typeof privateMatchErrorCodeSchema>;
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;
export type MatchPresentationState = z.infer<
  typeof matchPresentationStateSchema
>;
export type PrivateMatchCv = z.infer<typeof privateMatchCvSchema>;
export type PrivateMatchJob = z.infer<typeof privateMatchJobSchema>;
export type PrivateMatchJobsResponse = z.infer<
  typeof privateMatchJobsResponseSchema
>;
export type PrivateMatchEvidence = z.infer<typeof privateMatchEvidenceSchema>;
export type PrivateRequirementMatch = z.infer<
  typeof privateRequirementMatchSchema
>;
export type PrivateRequirementGap = z.infer<typeof privateRequirementGapSchema>;
export type PrivateAutomaticComponent = z.infer<
  typeof privateAutomaticComponentSchema
>;
export type PrivateAiEvaluation = z.infer<typeof privateAiEvaluationSchema>;
export type PrivateMatchStatus = z.infer<typeof privateMatchStatusSchema>;
export type LimitedPrivateReport = z.infer<typeof limitedPrivateReportSchema>;
export type FullPrivateReport = z.infer<typeof fullPrivateReportSchema>;
export type PrivateMatchListItem = z.infer<typeof privateMatchListItemSchema>;
export type PrivateMatchListResponse = z.infer<
  typeof privateMatchListResponseSchema
>;
export type PrivateMatchResponse = z.infer<typeof privateMatchResponseSchema>;
