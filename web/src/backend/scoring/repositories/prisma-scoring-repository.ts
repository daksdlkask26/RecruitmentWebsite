import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import type {
  AiAssessment,
  AutomaticMatch,
  FinalScore,
  ManualPriority,
  ScoringOperation,
} from "@/shared/contracts/scoring";
import {
  aiScoreReasoningSchema,
  experienceEvidenceSchema,
} from "@/shared/contracts/scoring";
import type {
  ScoringRepositoryPort,
  PublishedScoringRecord,
} from "./scoring-repository";
import { SKILL_NORMALIZATION_VERSION } from "../domain/skill-evidence-extractor";
import {
  automaticScoreBand,
  automaticScoreConfigForPublishedResult,
  getAutomaticScoreStageRuleConfig,
  type AutomaticScoreStageRuleConfig,
} from "@/backend/applications/services/automatic-score-stage-config";
import {
  AI_WEIGHT,
  AUTOMATIC_WEIGHT,
  FORMULA_VERSION,
} from "@/backend/scoring/domain/hybrid-score-calculator";

/* The generated Prisma include projection is intentionally narrowed at the
 * contract boundary below; the projection contains encrypted text fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */

const parseStatus = (
  value: string | undefined,
  snapshotVersion: string,
  parserVersion: string,
) =>
  ({
    code:
      value === "FAILED" || value === "PARSED_WITH_ERRORS"
        ? value
        : "PARSED_SUCCESSFULLY",
    label:
      value === "FAILED"
        ? "Failed"
        : value === "PARSED_WITH_ERRORS"
          ? "Parsed with errors"
          : "Parsed successfully",
    parserVersion,
    processingMilliseconds: 0,
    snapshotVersion,
  }) as const;

function priorityLabel(value: ManualPriority["value"]) {
  return value === "HIGH"
    ? "High review priority"
    : value === "LOW"
      ? "Low review priority"
      : value === "HOLD"
        ? "Hold"
        : "Normal";
}

function humanAiFindingTitle(value: string): string {
  const normalized = value.trim();
  return (
    {
      required_skills_match: "Required skills match",
      experience_match: "Experience match",
      preferred_skills_match: "Preferred skills match",
      education_certifications: "Education and certifications",
      languages: "Language proficiency",
      "Skill found verbatim": "Skill found",
      input_limitation: "Input limitation",
      extraction_uncertainty: "Extraction uncertainty",
      data_quality_notes: "Data quality review",
      "Data quality review": "Data quality review",
      "Extraction flag": "Extraction flag",
    }[normalized] ?? normalized
  );
}

type HybridWeight = 0.4 | 0.6;

function storedHybridWeight(
  value: unknown,
  fallback: HybridWeight,
): HybridWeight {
  const weight = Number(value);
  return weight === 0.4 || weight === 0.6 ? weight : fallback;
}

function aiQualityCategory(title: string, evidence: string): string {
  const value = `${title} ${evidence}`.toLocaleLowerCase("en-US");
  if (/date|employment|startdate|enddate|duration|redact/iu.test(value))
    return "employment_dates";
  if (/duplicate|repeated|appears more than once/iu.test(value))
    return "duplicate_records";
  if (/bullet|responsibilit|no .*provided/iu.test(value))
    return "missing_responsibilities";
  if (/cover letter/iu.test(value)) return "missing_cover_letter";
  if (/anomal|unrelated|merge|cross.?candidate|stale/iu.test(value))
    return "anomalous_profile_data";
  return value.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizedEvidenceText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim();
}

function boundedDisplaySummary(value: unknown, maximum = 300): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "Not provided";
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 3)).trimEnd()}...`;
}

function persistedExperienceEvidence(
  experience: AutomaticMatch["detectedExperience"],
) {
  if (experience.kind === "NOT_DETECTED") {
    return experience.incomplete ? { incomplete: true } : undefined;
  }
  const intervals = experience.intervals ?? [];
  const mergedIntervals = experience.mergedIntervals ?? [];
  if (!intervals.length && !mergedIntervals.length && !experience.incomplete)
    return undefined;
  return {
    ...(intervals.length ? { intervals } : {}),
    ...(mergedIntervals.length ? { mergedIntervals } : {}),
    ...(experience.incomplete ? { incomplete: true } : {}),
  };
}

function deterministicStrengthFallback(
  automatic: AutomaticMatch,
  findings: AiAssessment["findings"],
): AiAssessment["findings"] {
  return automatic.foundRequiredSkills
    .filter((skill) => {
      const label = normalizedEvidenceText(skill.label);
      return !findings.some(
        (finding) =>
          finding.kind === "STRENGTH" &&
          normalizedEvidenceText(
            `${finding.title} ${finding.evidence}`,
          ).includes(label),
      );
    })
    .map((skill) => ({
      id: `deterministic-skill-${skill.skillCode}`,
      kind: "STRENGTH" as const,
      title: "Skill found",
      evidence:
        skill.evidence[0]?.excerpt ??
        `Matched by deterministic CV evidence: ${skill.label}. Verbatim excerpt is unavailable for this scoring run.`,
    }));
}

function operationProjection(row: {
  id: string;
  kind: "INITIAL" | "JOB_RESCORE" | "AI_RETRY";
  state:
    | "QUEUED"
    | "RUNNING"
    | "COMPLETED"
    | "COMPLETED_WITH_FAILURES"
    | "FAILED";
  totalCount: number;
  succeededCount: number;
  deterministicOnlyCount: number;
  failedCount: number;
  requestedAt: Date;
  completedAt: Date | null;
}): ScoringOperation {
  return {
    operationId: row.id,
    kind: row.kind,
    state: row.state,
    totalCount: row.totalCount,
    succeededCount: row.succeededCount,
    deterministicOnlyCount: row.deterministicOnlyCount,
    failedCount: row.failedCount,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export class PrismaScoringRepository implements ScoringRepositoryPort {
  constructor(private readonly db: typeof prisma = prisma) {}

  async createOperation(
    input: Parameters<ScoringRepositoryPort["createOperation"]>[0],
  ) {
    const row = await this.db.scoringOperation.upsert({
      where: {
        requestedByUserId_idempotencyKey: {
          requestedByUserId: input.requestedByUserId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      update: {},
      create: {
        kind: input.kind,
        jobPostingId: input.jobPostingId,
        jobApplicationId: input.jobApplicationId,
        requestedByUserId: input.requestedByUserId,
        requestedAt: input.requestedAt,
        confirmationIntent: input.confirmationIntent,
        idempotencyKey: input.idempotencyKey,
        targetJobDescriptionVersionId: input.targetJobDescriptionVersionId,
        targetScoringConfigVersionId: input.targetScoringConfigVersionId,
        reusedAutomaticMatchResultId: input.reusedAutomaticMatchResultId,
      },
      select: {
        id: true,
        kind: true,
        state: true,
        totalCount: true,
        succeededCount: true,
        deterministicOnlyCount: true,
        failedCount: true,
        requestedAt: true,
        completedAt: true,
      },
    });
    return operationProjection(row);
  }

  async findOperation(operationId: string) {
    const row = await this.db.scoringOperation.findUnique({
      where: { id: operationId },
      select: {
        id: true,
        kind: true,
        state: true,
        totalCount: true,
        succeededCount: true,
        deterministicOnlyCount: true,
        failedCount: true,
        requestedAt: true,
        completedAt: true,
      },
    });
    return row ? operationProjection(row) : null;
  }

  async findCurrent(
    applicationId: string,
  ): Promise<PublishedScoringRecord | null> {
    const row = await this.db.applicationScoringResult.findFirst({
      where: {
        jobApplicationId: applicationId,
        application: { currentScoringResultId: { not: null } },
      },
      orderBy: { generation: "desc" },
      include: {
        automaticMatch: {
          include: {
            parseResults: true,
            skillEvidence: { include: { excerpts: true } },
          },
        },
        aiAssessment: { include: { findings: true, questions: true } },
        operation: {
          select: {
            id: true,
            state: true,
            workItems: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                consecutiveAiFailureCount: true,
                lastSafeFailureCode: true,
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    const automatic = this.projectAutomatic(row.automaticMatch);
    const scoreConfig = automaticScoreConfigForPublishedResult({
      mediumThreshold: row.mediumThreshold,
      highThreshold: row.highThreshold,
    });
    const automaticWeight = storedHybridWeight(
      row.automaticWeight,
      AUTOMATIC_WEIGHT,
    );
    const aiWeight = storedHybridWeight(row.aiWeight, AI_WEIGHT);
    const ai = row.aiAssessment
      ? this.projectAi(row.aiAssessment, automatic, scoreConfig)
      : null;
    const finalScore =
      row.finalScore === null || !ai
        ? null
        : ({
            value: Number(row.finalScore),
            formulaText: `${Number(row.automaticScore)} × ${automaticWeight * 100}% + ${Number(row.aiScore)} × ${aiWeight * 100}% = ${Number(row.finalScore)}`,
            formulaVersion: row.formulaVersion,
            automaticWeight,
            aiWeight,
            band:
              Number(row.finalScore) >= scoreConfig.strongScoreThreshold
                ? { code: "HIGH_MATCH", label: "Strong match", iconLabel: "✓" }
                : Number(row.finalScore) >= scoreConfig.lowScoreThreshold
                  ? {
                      code: "MEDIUM_MATCH",
                      label: "Review needed",
                      iconLabel: "!",
                    }
                  : { code: "LOW_MATCH", label: "Low match", iconLabel: "✕" },
            cvVersion: row.cvSnapshotVersionId,
            jdVersion: row.jobDescriptionVersionId,
            configVersion: row.scoringConfigVersionId,
            computedAt: row.computedAt.toISOString(),
          } satisfies FinalScore);
    const explicitFinalScore = finalScore
      ? ({
          ...finalScore,
          formulaText: `${Number(row.automaticScore)} ${String.fromCharCode(215)} ${automaticWeight * 100}% + ${Number(row.aiScore)} ${String.fromCharCode(215)} ${aiWeight * 100}% = ${Number(row.finalScore)}`,
          band: {
            ...finalScore.band,
            iconLabel:
              finalScore.band.code === "HIGH_MATCH"
                ? String.fromCharCode(10003)
                : finalScore.band.code === "LOW_MATCH"
                  ? String.fromCharCode(10005)
                  : "!",
          },
        } satisfies FinalScore)
      : null;
    return {
      resultId: row.id,
      generation: row.generation,
      state: row.state,
      automatic,
      ai,
      finalScore: explicitFinalScore,
      operationId: row.operationId,
      safeFailureCode:
        row.operation.workItems?.[0]?.lastSafeFailureCode ?? null,
      consecutiveFailures: Math.max(
        1,
        row.operation.workItems?.[0]?.consecutiveAiFailureCount ?? 1,
      ),
      rescoreInProgress:
        row.operation.state === "QUEUED" || row.operation.state === "RUNNING",
    };
  }

  private projectAutomatic(row: any): AutomaticMatch {
    const cvParse = row.parseResults.find(
      (item: any) => item.documentKind === "CV",
    );
    const jdParse = row.parseResults.find(
      (item: any) => item.documentKind === "JOB_DESCRIPTION",
    );
    const skills = row.skillEvidence.map((item: any) => ({
      skillCode: item.skillCanonicalId,
      label: item.skillLabel,
      requirementKind: item.requirementKind,
      matchState: item.matchState,
      evidence: item.excerpts.map((excerpt: any) => ({
        excerpt: excerpt.excerptEncrypted,
        ...(excerpt.pageNumber
          ? { pageNumber: excerpt.pageNumber }
          : { sectionLabel: excerpt.sectionLabel ?? "CV body" }),
        cvSnapshotVersion: excerpt.cvSnapshotVersionId,
        parserVersion: excerpt.parserVersion,
      })),
    }));
    const experienceEvidenceResult = experienceEvidenceSchema.safeParse(
      row.experienceEvidence,
    );
    const experienceEvidence = experienceEvidenceResult.success
      ? experienceEvidenceResult.data
      : {};
    return {
      resultId: row.id,
      score: Number(row.score),
      cvVersion: row.cvSnapshotVersionId,
      jdVersion: row.jobDescriptionVersionId,
      configVersion: row.scoringConfigVersionId,
      parserVersion: row.parserBundleVersion,
      cvParse: parseStatus(
        cvParse?.status,
        row.cvSnapshotVersionId,
        row.parserBundleVersion,
      ),
      jdParse: parseStatus(
        jdParse?.status,
        row.jobDescriptionVersionId,
        row.parserBundleVersion,
      ),
      mayBeIncomplete: row.mayBeIncomplete,
      incompletenessLabel: row.incompletenessLabel,
      foundRequiredSkills: skills.filter(
        (item: any) =>
          item.matchState === "FOUND" && item.requirementKind === "REQUIRED",
      ),
      missingRequiredSkills: skills.filter(
        (item: any) => item.matchState === "MISSING",
      ),
      preferredSkills: skills.filter(
        (item: any) => item.requirementKind === "PREFERRED",
      ),
      minimumExperienceYears:
        row.minimumExperienceYears === null
          ? null
          : Number(row.minimumExperienceYears),
      detectedExperience:
        row.detectedExperienceYears === null
          ? {
              kind: "NOT_DETECTED",
              label: "Not detected",
              ...experienceEvidence,
            }
          : {
              kind: "DETECTED",
              years: Number(row.detectedExperienceYears),
              label: `${Number(row.detectedExperienceYears)} years detected`,
              ...experienceEvidence,
            },
    };
  }

  private projectAi(
    row: any,
    automatic?: AutomaticMatch,
    scoreConfig: AutomaticScoreStageRuleConfig = getAutomaticScoreStageRuleConfig(),
  ): AiAssessment {
    const dataQualityNotes = row.findings
      .filter(
        (finding: any) =>
          typeof finding.kind === "string" &&
          finding.kind.startsWith("DATA_QUALITY"),
      )
      .map((finding: any) => {
        const bucket = finding.kind.endsWith("INPUT_LIMITATION")
          ? "input_limitation"
          : "extraction_uncertainty";
        const severity =
          finding.kind.includes("_HIGH_") ||
          (!finding.kind.includes("_MINOR_") && row.confidenceLevel === "LOW")
            ? "HIGH"
            : "MINOR";
        return {
          id: finding.id,
          bucket,
          severity,
          title: humanAiFindingTitle(finding.titleEncrypted),
          evidence: finding.evidenceEncrypted,
          affectedCategories: [],
        };
      })
      .filter(
        (finding: any, index: number, values: any[]) =>
          values.findIndex(
            (candidate) =>
              aiQualityCategory(candidate.title, candidate.evidence) ===
              aiQualityCategory(finding.title, finding.evidence),
          ) === index,
      );
    const visibleFindings = row.findings
      .filter(
        (finding: any) => !String(finding.kind).startsWith("DATA_QUALITY"),
      )
      .map((finding: any) => {
        const title = humanAiFindingTitle(finding.titleEncrypted);
        return {
          id: finding.id,
          kind: finding.kind,
          title,
          evidence: finding.evidenceEncrypted,
        };
      })
      .filter(
        (finding: any, index: number, values: any[]) =>
          values.findIndex(
            (candidate) =>
              `${candidate.kind}|${candidate.title}|${candidate.evidence}`.toLocaleLowerCase(
                "en-US",
              ) ===
              `${finding.kind}|${finding.title}|${finding.evidence}`.toLocaleLowerCase(
                "en-US",
              ),
          ) === index,
      )
      .filter(
        (finding: any, index: number, values: any[]) =>
          finding.kind !== "STRENGTH" ||
          values.findIndex(
            (candidate) =>
              candidate.kind === "STRENGTH" &&
              candidate.evidence.toLocaleLowerCase("en-US") ===
                finding.evidence.toLocaleLowerCase("en-US"),
          ) === index,
      );
    const legacyQualityNotes = visibleFindings.filter((finding: any) =>
      [
        "Data quality review",
        "Extraction flag",
        "Input limitation",
        "Extraction uncertainty",
      ].includes(finding.title),
    );
    const normalizedVisibleFindings = visibleFindings.filter(
      (finding: any) =>
        ![
          "Data quality review",
          "Extraction flag",
          "Input limitation",
          "Extraction uncertainty",
        ].includes(finding.title),
    );
    for (const finding of legacyQualityNotes) {
      const bucket = finding.evidence.startsWith("input_limitation:")
        ? "input_limitation"
        : "extraction_uncertainty";
      const title = finding.evidence.match(/date|employment/iu)
        ? "Employment dates"
        : finding.evidence.match(/duplicate/iu)
          ? "Duplicate profile records"
          : finding.evidence.match(/bullet|responsibilit/iu)
            ? "Missing responsibilities"
            : "Input limitation";
      if (
        !dataQualityNotes.some(
          (note: any) =>
            aiQualityCategory(note.title, note.evidence) ===
            aiQualityCategory(title, finding.evidence),
        )
      )
        dataQualityNotes.push({
          id: finding.id,
          bucket,
          severity: "MINOR",
          title,
          evidence: finding.evidence,
          affectedCategories: [],
        });
    }
    let scoreReasoning: AiAssessment["scoreReasoning"] | null = null;
    if (typeof row.scoreReasoningJsonEncrypted === "string") {
      try {
        const decoded = aiScoreReasoningSchema.safeParse(
          JSON.parse(row.scoreReasoningJsonEncrypted),
        );
        // Rows written before the v5 contract may still contain a JSON object
        // with five breakdown entries but invalid categories, totals, or
        // confidence fields. Do not let one legacy row make the whole detail
        // endpoint look like the application disappeared; fall back to a
        // contract-valid projection instead.
        if (
          decoded.success &&
          Math.abs(decoded.data.score - Number(row.score)) <= 0.1
        )
          scoreReasoning = decoded.data;
      } catch {
        scoreReasoning = null;
      }
    }
    if (!scoreReasoning) {
      const score = Number(row.score);
      const required = Math.min(40, score);
      const experience = Math.min(25, Math.max(0, score - required));
      const preferred = Math.min(
        15,
        Math.max(0, score - required - experience),
      );
      const education = Math.min(
        10,
        Math.max(0, score - required - experience - preferred),
      );
      const languages = Math.min(
        10,
        Math.max(0, score - required - experience - preferred - education),
      );
      const confidencePercent =
        row.confidenceLevel === "LOW"
          ? Math.min(50, row.confidencePercent)
          : row.confidenceLevel === "STANDARD"
            ? Math.min(95, row.confidencePercent)
            : row.confidencePercent;
      const level =
        confidencePercent >= 76
          ? "High"
          : confidencePercent >= 60
            ? "Medium"
            : "Low";
      scoreReasoning = {
        score,
        breakdown: [
          { category: "Required skills", points: `${required}/40`, note: null },
          { category: "Experience", points: `${experience}/25`, note: null },
          {
            category: "Preferred skills",
            points: `${preferred}/15`,
            note: null,
          },
          {
            category: "Education/certifications",
            points: `${education}/10`,
            note: null,
          },
          { category: "Languages", points: `${languages}/10`, note: null },
        ],
        aiTotal: score,
        matchLabel:
          score >= 75
            ? "high match"
            : score >= 45
              ? "medium match"
              : "low match",
        confidence: {
          percent: confidencePercent,
          level,
          cappedReason: dataQualityNotes.length
            ? "Confidence was capped because the CV contains data-quality limitations."
            : null,
        },
      };
    }
    const assessmentLimitedByDataQuality =
      dataQualityNotes.some((note: any) => note.severity === "HIGH") &&
      normalizedVisibleFindings.length === 0;
    const fallbackStrengths = automatic
      ? deterministicStrengthFallback(automatic, normalizedVisibleFindings)
      : [];
    const visibleStrengths = [
      ...normalizedVisibleFindings.filter(
        (finding: any) => finding.kind === "STRENGTH",
      ),
      ...fallbackStrengths,
    ]
      .filter(
        (finding: any, index: number, values: any[]) =>
          values.findIndex(
            (candidate) =>
              candidate.kind === "STRENGTH" &&
              candidate.evidence === finding.evidence,
          ) === index,
      )
      .map((finding: any) => ({
        title:
          finding.title === "Skill found"
            ? "Relevant skill evidence"
            : finding.title,
        evidence: finding.evidence,
      }))
      .slice(0, 4);
    const projectedFindings = [
      ...normalizedVisibleFindings,
      ...fallbackStrengths,
    ]
      .filter(
        (finding: any, index: number, values: any[]) =>
          values.findIndex(
            (candidate) =>
              candidate.kind === finding.kind &&
              candidate.evidence === finding.evidence,
          ) === index,
      )
      .map((finding: any) => ({
        id: finding.id,
        kind: finding.kind,
        title:
          finding.kind === "STRENGTH" && finding.title === "Skill found"
            ? "Relevant skill evidence"
            : finding.title,
        evidence: finding.evidence,
      }));
    const visiblePoints = normalizedVisibleFindings
      .filter((finding: any) => finding.kind === "POINT_TO_VERIFY")
      .map((finding: any) => ({
        title: finding.title,
        reason: finding.evidence,
      }))
      .slice(0, 4);
    const questionItems = row.questions
      .map((question: any) => ({
        question: question.questionEncrypted,
        pointToVerifyId: question.pointToVerifyFindingId,
      }))
      .filter(
        (question: { question: unknown; pointToVerifyId: unknown }) =>
          typeof question.question === "string" &&
          typeof question.pointToVerifyId === "string",
      )
      .slice(0, 3) as Array<{ question: string; pointToVerifyId: string }>;
    // The v5 contract deliberately exposes exactly three questions when the
    // generated state is usable. Older rows with only one or two persisted
    // questions are represented as insufficient data instead of making the
    // strict scoring detail schema reject the entire candidate.
    const suggestedQuestions =
      questionItems.length === 3
        ? questionItems.map((question) => question.question)
        : [];
    const confidenceLevel =
      scoreReasoning.confidence.level === "Low"
        ? "LOW"
        : scoreReasoning.confidence.level === "Medium"
          ? "MEDIUM"
          : "HIGH";
    const confidencePercent = scoreReasoning.confidence.percent;
    return {
      assessmentId: row.id,
      score: scoreReasoning.score,
      aiScoreBand: automaticScoreBand(scoreReasoning.score, scoreConfig),
      confidencePercent,
      confidenceLevel,
      confidenceLabel:
        confidenceLevel === "LOW"
          ? "Low confidence"
          : confidenceLevel === "MEDIUM"
            ? "Medium confidence"
            : "High confidence",
      humanReviewGuidance: assessmentLimitedByDataQuality
        ? "Assessment is limited by CV data quality. Review the notes in the CV & Cover letter tab before using the score."
        : row.humanReviewGuidance,
      requiresHumanReview:
        confidenceLevel !== "HIGH" || Boolean(row.humanReviewGuidance),
      provider: row.providerAdapterVersion,
      modelVersion: row.modelVersion,
      promptVersion: row.promptVersion,
      policyVersion: row.sensitiveAttributePolicyVersion,
      overallSummary: assessmentLimitedByDataQuality
        ? "Low data quality — assessment limited. The CV could not be assessed reliably; manual review is required."
        : row.overallSummaryEncrypted,
      breakdown: [
        boundedDisplaySummary(row.technicalAbilitySummaryEncrypted),
        boundedDisplaySummary(row.roleFitSummaryEncrypted),
        boundedDisplaySummary(row.deductionSummaryEncrypted),
      ],
      scoreReasoning,
      strengths: visibleStrengths,
      pointsToVerify: visiblePoints,
      suggestedQuestions,
      questionsUnavailableReason:
        suggestedQuestions.length === 3
          ? null
          : (row.questionFallbackLabel ??
            "There is not enough evidence to generate suggested questions."),
      assessmentLimitedByDataQuality,
      dataQualityNotes,
      // Data-quality warnings should limit confidence, not hide positive
      // evidence. Older published rows may have no AI STRENGTH findings, so
      // project the deterministic matches as a transparent compatibility
      // fallback until the application is rescored with the fixed adapter.
      findings: projectedFindings,
      compliance: {
        code: "SENSITIVE_ATTRIBUTES_EXCLUDED",
        label: row.complianceStatementLabel,
      },
      questions:
        suggestedQuestions.length === 3
          ? {
              kind: "GENERATED",
              items: questionItems,
            }
          : {
              kind: "INSUFFICIENT_DATA",
              fallbackMessage:
                row.questionFallbackLabel ??
                "There is not enough evidence to generate suggested questions.",
            },
    };
  }

  async publish(input: Parameters<ScoringRepositoryPort["publish"]>[0]) {
    const scoreConfig = getAutomaticScoreStageRuleConfig();
    await this.db.$transaction(async (tx) => {
      const application = await tx.jobApplication.findUnique({
        where: { id: input.applicationId },
        select: { scoringGeneration: true },
      });
      if (!application) throw new Error("APPLICATION_UNAVAILABLE");
      if (
        input.expectedGeneration !== undefined &&
        application.scoringGeneration !== input.expectedGeneration
      ) {
        throw new Error("SCORING_GENERATION_CONFLICT");
      }
      if (input.workItemId) {
        const lease = await tx.scoringWorkItem.findFirst({
          where: {
            id: input.workItemId,
            operationId: input.operationId,
            jobApplicationId: input.applicationId,
            state: "LEASED",
            ...(input.workerId ? { leaseOwner: input.workerId } : {}),
          },
          select: { id: true },
        });
        if (!lease) throw new Error("SCORING_WORK_LEASE_LOST");
      }
      const generation =
        (input.expectedGeneration ?? application.scoringGeneration) + 1;
      const automatic = await tx.automaticMatchResult.create({
        data: {
          jobApplicationId: input.applicationId,
          jobDescriptionVersionId: input.automatic.jdVersion,
          cvSnapshotVersionId: input.automatic.cvVersion,
          scoringConfigVersionId: input.automatic.configVersion,
          parserBundleVersion: input.automatic.parserVersion,
          score: input.automatic.score,
          requiredSkillPoints:
            input.automatic.foundRequiredSkills.length +
              input.automatic.missingRequiredSkills.length ===
            0
              ? 75
              : (input.automatic.foundRequiredSkills.length /
                  (input.automatic.foundRequiredSkills.length +
                    input.automatic.missingRequiredSkills.length)) *
                75,
          experiencePoints:
            input.automatic.minimumExperienceYears === null ||
            input.automatic.minimumExperienceYears <= 0
              ? 25
              : input.automatic.detectedExperience.kind === "DETECTED"
                ? Math.min(
                    25,
                    (input.automatic.detectedExperience.years /
                      Math.max(1, input.automatic.minimumExperienceYears)) *
                      25,
                  )
                : 0,
          preferredSkillBonus: 0,
          minimumExperienceYears: input.automatic.minimumExperienceYears,
          detectedExperienceYears:
            input.automatic.detectedExperience.kind === "DETECTED"
              ? input.automatic.detectedExperience.years
              : null,
          experienceEvidence: persistedExperienceEvidence(
            input.automatic.detectedExperience,
          ),
          experienceInterpretationCode: input.automatic.detectedExperience.kind,
          experienceInterpretationLabel:
            input.automatic.detectedExperience.label,
          mayBeIncomplete: input.automatic.mayBeIncomplete,
          incompletenessLabel: input.automatic.incompletenessLabel,
          computedAt: new Date(),
          skillEvidence: {
            create: [
              ...input.automatic.foundRequiredSkills,
              ...input.automatic.missingRequiredSkills,
              ...input.automatic.preferredSkills,
            ].map((item) => ({
              skillCanonicalId: item.skillCode,
              skillLabel: item.label,
              requirementKind: item.requirementKind,
              matchState: item.matchState,
              normalizationVersion: SKILL_NORMALIZATION_VERSION,
              excerpts: {
                create: item.evidence.map((excerpt) => ({
                  excerptEncrypted: excerpt.excerpt,
                  ...(excerpt.pageNumber !== undefined
                    ? { pageNumber: excerpt.pageNumber }
                    : {}),
                  ...(excerpt.sectionLabel !== undefined
                    ? { sectionLabel: excerpt.sectionLabel }
                    : {}),
                  cvSnapshotVersionId: excerpt.cvSnapshotVersion,
                  parserVersion: excerpt.parserVersion,
                })),
              },
            })),
          },
          parseResults: {
            create: [input.automatic.cvParse, input.automatic.jdParse].map(
              (status, index) => ({
                documentKind: index === 0 ? "CV" : "JOB_DESCRIPTION",
                snapshotVersion: status.snapshotVersion,
                parserName: "deterministic-parser",
                parserVersion: status.parserVersion,
                schemaVersion: "scoring-evidence-v1",
                status: status.code,
                processingMilliseconds: status.processingMilliseconds,
                safeIssueCodes: [],
                parsedAt: new Date(),
              }),
            ),
          },
        },
      });
      const aiInput = input.ai;
      const findingIdMap = new Map<string, string>();
      const persistedFindings = aiInput
        ? [
            ...aiInput.findings.map((finding, ordinal) => {
              // Provider finding ids are assessment-local (for example
              // "strength-1"). They must not be used as database primary
              // keys because every rescore can produce the same local ids.
              const persistedId = `ai-finding-${randomUUID()}`;
              findingIdMap.set(finding.id, persistedId);
              return {
                id: persistedId,
                kind: finding.kind,
                titleEncrypted: finding.title,
                evidenceEncrypted: finding.evidence,
                ordinal,
              };
            }),
            ...aiInput.dataQualityNotes.map((note, index) => ({
              id: `ai-finding-${randomUUID()}`,
              kind: `DATA_QUALITY_${note.severity}_${note.bucket === "input_limitation" ? "INPUT_LIMITATION" : "EXTRACTION_UNCERTAINTY"}`,
              titleEncrypted: note.title,
              evidenceEncrypted: note.evidence,
              ordinal: aiInput.findings.length + index,
            })),
          ]
        : [];
      const fallbackPointFindingId = persistedFindings.find(
        (finding) => finding.kind === "POINT_TO_VERIFY",
      )?.id;
      const ai = aiInput
        ? await tx.aiAssessment.create({
            data: {
              jobApplicationId: input.applicationId,
              automaticMatchResultId: automatic.id,
              score: aiInput.score,
              confidencePercent: aiInput.confidencePercent,
              confidenceLevel: aiInput.confidenceLevel,
              confidenceLabel: aiInput.confidenceLabel,
              humanReviewGuidance: aiInput.humanReviewGuidance,
              providerAdapterVersion: aiInput.provider,
              providerModel: aiInput.modelVersion,
              modelVersion: aiInput.modelVersion,
              promptVersion: aiInput.promptVersion,
              assessmentSchemaVersion: "ai-assessment-v5",
              sensitiveAttributePolicyVersion: aiInput.policyVersion,
              overallSummaryEncrypted: aiInput.overallSummary,
              technicalAbilitySummaryEncrypted:
                aiInput.breakdown[0] ?? "Not provided",
              roleFitSummaryEncrypted: aiInput.breakdown[1] ?? "Not provided",
              deductionSummaryEncrypted: aiInput.breakdown[2] ?? "Not provided",
              scoreReasoningJsonEncrypted: JSON.stringify(
                aiInput.scoreReasoning,
              ),
              complianceStatementCode: aiInput.compliance.code,
              complianceStatementLabel: aiInput.compliance.label,
              questionState: aiInput.questions.kind,
              questionFallbackLabel:
                aiInput.questions.kind === "INSUFFICIENT_DATA"
                  ? aiInput.questions.fallbackMessage
                  : null,
              computedAt: new Date(),
              findings: {
                create: persistedFindings,
              },
              questions:
                aiInput.questions.kind === "GENERATED"
                  ? {
                      create: aiInput.questions.items.map(
                        (question, ordinal) => {
                          const pointToVerifyFindingId =
                            findingIdMap.get(question.pointToVerifyId) ??
                            fallbackPointFindingId;
                          if (!pointToVerifyFindingId)
                            throw new Error(
                              "AI_ASSESSMENT_FINDING_UNAVAILABLE",
                            );
                          return {
                            pointToVerifyFindingId,
                            questionEncrypted: question.question,
                            ordinal,
                          };
                        },
                      ),
                    }
                  : undefined,
            },
          })
        : null;
      const published = await tx.applicationScoringResult.create({
        data: {
          jobApplicationId: input.applicationId,
          generation,
          operationId: input.operationId,
          automaticMatchResultId: automatic.id,
          aiAssessmentId: ai?.id,
          automaticScore: input.automatic.score,
          aiScore: input.ai?.score,
          finalScore: input.finalScore?.value,
          state: input.finalScore ? "SCORED" : "DETERMINISTIC_ONLY",
          formulaVersion: input.finalScore?.formulaVersion ?? FORMULA_VERSION,
          automaticWeight: AUTOMATIC_WEIGHT,
          aiWeight: AI_WEIGHT,
          highThreshold: scoreConfig.strongScoreThreshold,
          mediumThreshold: scoreConfig.lowScoreThreshold,
          roundingRule: "round-half-up-1-decimal",
          jobDescriptionVersionId: input.automatic.jdVersion,
          cvSnapshotVersionId: input.automatic.cvVersion,
          scoringConfigVersionId: input.automatic.configVersion,
          parserBundleVersion: input.automatic.parserVersion,
          mayBeIncomplete: input.automatic.mayBeIncomplete,
          incompletenessLabel: input.automatic.incompletenessLabel,
          computedAt: new Date(),
          publishedAt: new Date(),
        },
      });
      const workItemChanged = await tx.scoringWorkItem.updateMany({
        where: {
          ...(input.workItemId ? { id: input.workItemId } : {}),
          operationId: input.operationId,
          jobApplicationId: input.applicationId,
          ...(input.workItemId
            ? {
                state: "LEASED",
                ...(input.workerId ? { leaseOwner: input.workerId } : {}),
              }
            : {}),
        },
        data: input.finalScore
          ? {
              lastSafeFailureCode: null,
              consecutiveAiFailureCount: 0,
            }
          : {
              lastSafeFailureCode:
                input.safeFailureCode ?? "AI_PROVIDER_UNAVAILABLE",
              ...(input.consecutiveFailures === undefined
                ? {}
                : { consecutiveAiFailureCount: input.consecutiveFailures }),
            },
      });
      if (input.workItemId && workItemChanged.count !== 1)
        throw new Error("SCORING_WORK_LEASE_LOST");
      const fenced = await tx.jobApplication.updateMany({
        where: {
          id: input.applicationId,
          scoringGeneration:
            input.expectedGeneration ?? application.scoringGeneration,
        },
        data: {
          scoringGeneration: { increment: 1 },
          currentScoringResultId: published.id,
          scoringStatus: input.finalScore ? "COMPLETED" : "FAILED",
          aiMatchScore: input.ai?.score ?? null,
        },
      });
      if (fenced.count !== 1) throw new Error("SCORING_GENERATION_CONFLICT");
      return published;
    });
    const current = await this.findCurrent(input.applicationId);
    if (!current) throw new Error("SCORING_PUBLICATION_UNAVAILABLE");
    return current;
  }

  async setPriority(
    input: Parameters<ScoringRepositoryPort["setPriority"]>[0],
  ) {
    const row = await this.db.$transaction(async (tx) => {
      const current = await tx.manualApplicationPriority.findFirst({
        where: { jobApplicationId: input.applicationId, active: true },
        orderBy: { version: "desc" },
      });
      const expected = current?.version ?? 0;
      if (expected !== input.expectedVersion)
        throw new Error("PRIORITY_CONFLICT");
      if (current)
        await tx.manualApplicationPriority.update({
          where: { id: current.id },
          data: {
            active: false,
            removedByUserId: input.actorUserId,
            removedAt: input.now,
            removalReasonEncrypted: input.reason,
          },
        });
      return tx.manualApplicationPriority.create({
        data: {
          jobApplicationId: input.applicationId,
          value: input.value,
          reasonEncrypted: input.reason,
          setByUserId: input.actorUserId,
          setAt: input.now,
          version: expected + 1,
          active: true,
        },
      });
    });
    return {
      id: row.id,
      value: row.value,
      label: priorityLabel(row.value),
      reason: row.reasonEncrypted,
      actorUserId: row.setByUserId,
      setAt: row.setAt.toISOString(),
      version: row.version,
      active: true,
    } satisfies ManualPriority;
  }

  async removePriority(
    input: Parameters<ScoringRepositoryPort["removePriority"]>[0],
  ) {
    const changed = await this.db.manualApplicationPriority.updateMany({
      where: {
        jobApplicationId: input.applicationId,
        active: true,
        version: input.expectedVersion,
      },
      data: {
        active: false,
        removedByUserId: input.actorUserId,
        removedAt: input.now,
        removalReasonEncrypted: input.reason,
      },
    });
    if (changed.count !== 1) throw new Error("PRIORITY_CONFLICT");
  }
}
