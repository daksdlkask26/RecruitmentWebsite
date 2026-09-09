import { describe, expect, it, vi } from "vitest";
import {
  aiAssessmentSchema,
  automaticMatchSchema,
  type AiAssessment,
  type AutomaticMatch,
} from "@/shared/contracts/scoring";
import type { prisma } from "@/backend/database/prisma";
import { PrismaScoringRepository } from "@/backend/scoring/repositories/prisma-scoring-repository";
import type { PublishedScoringRecord } from "@/backend/scoring/repositories/scoring-repository";

describe("PrismaScoringRepository scoring detail compatibility", () => {
  it("projects legacy reasoning and partial questions into the current detail contract", async () => {
    const db = {
      applicationScoringResult: {
        findFirst: vi.fn().mockResolvedValue({
          id: "result-1",
          generation: 1,
          state: "SCORED",
          finalScore: 80,
          automaticScore: 80,
          aiScore: 80,
          formulaVersion: "hybrid-60-40-v1",
          cvSnapshotVersionId: "cv-1",
          jobDescriptionVersionId: "jd-1",
          scoringConfigVersionId: "hybrid-60-40-v1",
          computedAt: new Date("2026-08-16T00:00:00.000Z"),
          operationId: "operation-1",
          operation: { id: "operation-1", state: "COMPLETED" },
          automaticMatch: {
            id: "automatic-1",
            score: 80,
            cvSnapshotVersionId: "cv-1",
            jobDescriptionVersionId: "jd-1",
            scoringConfigVersionId: "hybrid-60-40-v1",
            parserBundleVersion: "parser-v2",
            mayBeIncomplete: false,
            incompletenessLabel: null,
            minimumExperienceYears: 3,
            detectedExperienceYears: 4,
            experienceEvidence: {
              intervals: [
                {
                  startMonth: 2020 * 12,
                  endMonthExclusive: 2022 * 12,
                  source: "work-history",
                  startToken: "2020",
                  endToken: "2022",
                },
                {
                  startMonth: 2021 * 12,
                  endMonthExclusive: 2023 * 12,
                  source: "work-history",
                  startToken: "2021",
                  endToken: "2023",
                },
              ],
              mergedIntervals: [
                { startMonth: 2020 * 12, endMonthExclusive: 2023 * 12 },
              ],
            },
            parseResults: [
              { documentKind: "CV", status: "PARSED_SUCCESSFULLY" },
              {
                documentKind: "JOB_DESCRIPTION",
                status: "PARSED_SUCCESSFULLY",
              },
            ],
            skillEvidence: [],
          },
          aiAssessment: {
            id: "ai-1",
            score: 80,
            confidencePercent: 90,
            confidenceLevel: "STANDARD",
            humanReviewGuidance: null,
            providerAdapterVersion: "approved-v4",
            modelVersion: "model-v1",
            promptVersion: "prompt-v4-ai-cv-assessment",
            sensitiveAttributePolicyVersion: "sensitive-attributes-v1",
            overallSummaryEncrypted: "Relevant evidence is available.",
            technicalAbilitySummaryEncrypted: "T".repeat(420),
            roleFitSummaryEncrypted: "R".repeat(360),
            deductionSummaryEncrypted: "One item remains to verify.",
            complianceStatementLabel:
              "Sensitive personal attributes are excluded from scoring.",
            questionFallbackLabel: null,
            scoreReasoningJsonEncrypted: JSON.stringify({
              score: 80,
              breakdown: [
                { category: "old-category", points: "40/40", note: null },
                { category: "old-category", points: "25/25", note: null },
                { category: "old-category", points: "15/15", note: null },
                { category: "old-category", points: "0/10", note: null },
                { category: "old-category", points: "0/10", note: null },
              ],
              aiTotal: 80,
              matchLabel: "high match",
              confidence: { percent: 90, level: "High", cappedReason: null },
            }),
            findings: [],
            questions: [
              {
                questionEncrypted: "What was your direct contribution?",
                pointToVerifyFindingId: "finding-1",
              },
            ],
          },
        }),
      },
    };

    const result = await new PrismaScoringRepository(
      db as unknown as typeof prisma,
    ).findCurrent("application-1");

    expect(result?.ai).not.toBeNull();
    expect(aiAssessmentSchema.parse(result?.ai).questions.kind).toBe(
      "INSUFFICIENT_DATA",
    );
    expect(result?.ai?.suggestedQuestions).toEqual([]);
    expect(result?.ai?.breakdown).toHaveLength(3);
    expect(result?.ai?.breakdown.every((item) => item.length <= 300)).toBe(
      true,
    );
    expect(result?.automatic.detectedExperience).toMatchObject({
      kind: "DETECTED",
      intervals: expect.any(Array),
      mergedIntervals: [
        { startMonth: 2020 * 12, endMonthExclusive: 2023 * 12 },
      ],
    });
  });

  it("uses fresh database ids for findings on every rescore", async () => {
    const parseStatus = {
      code: "PARSED_SUCCESSFULLY" as const,
      label: "Parsed successfully" as const,
      parserVersion: "parser-v2",
      processingMilliseconds: 0,
      snapshotVersion: "cv-v1",
    };
    const automatic = automaticMatchSchema.parse({
      resultId: "automatic-1",
      score: 80,
      cvVersion: "cv-v1",
      jdVersion: "jd-v1",
      configVersion: "config-v1",
      parserVersion: "parser-v2",
      cvParse: parseStatus,
      jdParse: { ...parseStatus, snapshotVersion: "jd-v1" },
      mayBeIncomplete: false,
      incompletenessLabel: null,
      foundRequiredSkills: [],
      missingRequiredSkills: [],
      preferredSkills: [],
      minimumExperienceYears: 3,
      detectedExperience: {
        kind: "DETECTED",
        years: 4,
        label: "4 years",
        intervals: [
          {
            startMonth: 2020 * 12,
            endMonthExclusive: 2022 * 12,
            source: "work-history",
            startToken: "2020",
            endToken: "2022",
          },
          {
            startMonth: 2021 * 12,
            endMonthExclusive: 2023 * 12,
            source: "work-history",
            startToken: "2021",
            endToken: "2023",
          },
        ],
        mergedIntervals: [
          { startMonth: 2020 * 12, endMonthExclusive: 2023 * 12 },
        ],
      },
    });
    const ai = aiAssessmentSchema.parse({
      assessmentId: "provider-assessment-1",
      score: 80,
      confidencePercent: 90,
      confidenceLevel: "HIGH",
      confidenceLabel: "High confidence",
      humanReviewGuidance: null,
      requiresHumanReview: false,
      provider: "test-provider",
      modelVersion: "test-model",
      promptVersion: "test-prompt",
      policyVersion: "test-policy",
      overallSummary: "Relevant evidence is available.",
      breakdown: ["Required skills", "Experience", "Preferred skills"],
      scoreReasoning: {
        score: 80,
        breakdown: [
          { category: "Required skills", points: "32/40", note: null },
          { category: "Experience", points: "20/25", note: null },
          { category: "Preferred skills", points: "12/15", note: null },
          { category: "Education/certifications", points: "8/10", note: null },
          { category: "Languages", points: "8/10", note: null },
        ],
        aiTotal: 80,
        matchLabel: "high match",
        confidence: { percent: 90, level: "High", cappedReason: null },
      },
      strengths: [],
      pointsToVerify: [],
      suggestedQuestions: ["Question one", "Question two", "Question three"],
      questionsUnavailableReason: null,
      assessmentLimitedByDataQuality: false,
      dataQualityNotes: [],
      findings: [
        {
          id: "strength-1",
          kind: "STRENGTH",
          title: "Delivery evidence",
          evidence: "The CV cites a delivered project.",
        },
        {
          id: "point-to-verify-1",
          kind: "POINT_TO_VERIFY",
          title: "Ownership scope",
          evidence: "Confirm the candidate's direct ownership.",
        },
      ],
      compliance: {
        code: "SENSITIVE_ATTRIBUTES_EXCLUDED",
        label: "Sensitive personal attributes are excluded from scoring.",
      },
      questions: {
        kind: "GENERATED",
        items: [
          { question: "Question one", pointToVerifyId: "point-to-verify-1" },
          { question: "Question two", pointToVerifyId: "point-to-verify-1" },
          { question: "Question three", pointToVerifyId: "point-to-verify-1" },
        ],
      },
    });
    const persistedAssessments: unknown[] = [];
    const tx = {
      jobApplication: {
        findUnique: vi.fn().mockResolvedValue({ scoringGeneration: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      automaticMatchResult: {
        create: vi.fn().mockResolvedValue({ id: "automatic-result-1" }),
      },
      aiAssessment: {
        create: vi
          .fn()
          .mockImplementation(async ({ data }: { data: unknown }) => {
            persistedAssessments.push(data);
            return { id: `assessment-${persistedAssessments.length}` };
          }),
      },
      applicationScoringResult: {
        create: vi.fn().mockResolvedValue({ id: "published-result-1" }),
      },
      scoringWorkItem: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = {
      $transaction: vi.fn(
        async (callback: (value: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const repository = new PrismaScoringRepository(
      db as unknown as typeof prisma,
    );
    vi.spyOn(repository, "findCurrent").mockResolvedValue(
      {} as PublishedScoringRecord,
    );

    const publishInput = {
      applicationId: "application-1",
      operationId: "operation-1",
      automatic: automatic as AutomaticMatch,
      ai: ai as AiAssessment,
      finalScore: null,
    };
    await repository.publish(publishInput);
    await repository.publish({ ...publishInput, operationId: "operation-2" });

    expect(tx.automaticMatchResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          experienceEvidence: {
            intervals: expect.any(Array),
            mergedIntervals: [
              { startMonth: 2020 * 12, endMonthExclusive: 2023 * 12 },
            ],
          },
        }),
      }),
    );

    const records = persistedAssessments as Array<{
      findings: { create: Array<{ id: string; kind: string }> };
      questions: { create: Array<{ pointToVerifyFindingId: string }> };
    }>;
    const firstPointFinding = records[0].findings.create.find(
      (finding) => finding.kind === "POINT_TO_VERIFY",
    );
    const secondPointFinding = records[1].findings.create.find(
      (finding) => finding.kind === "POINT_TO_VERIFY",
    );
    expect(firstPointFinding?.id).toBeTruthy();
    expect(secondPointFinding?.id).toBeTruthy();
    expect(firstPointFinding?.id).not.toBe("point-to-verify-1");
    expect(secondPointFinding?.id).not.toBe("point-to-verify-1");
    expect(secondPointFinding?.id).not.toBe(firstPointFinding?.id);
    expect(records[0].questions.create[0]?.pointToVerifyFindingId).toBe(
      firstPointFinding?.id,
    );
    expect(records[1].questions.create[0]?.pointToVerifyFindingId).toBe(
      secondPointFinding?.id,
    );
  });
});
