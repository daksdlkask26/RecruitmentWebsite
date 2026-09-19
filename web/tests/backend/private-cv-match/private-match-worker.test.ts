import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { AiAssessmentProviderError } from "@/backend/scoring/providers/ai-assessment-provider-port";
import type { AiEvaluationPort } from "@/backend/scoring-engine/ai-evaluation-port";
import type { AutomaticMatchingPort } from "@/backend/scoring-engine/automatic-matching-port";
import type { AutomaticMatchingResult } from "@/backend/scoring-engine/scoring-contracts";
import type {
  ClaimedPrivateAttempt,
  PrivateCvMatchRepository,
} from "@/backend/repositories/private-cv-match/prisma-private-cv-match-repository";
import { PrivateMatchWorker } from "@/backend/private-cv-match/private-match-worker";

function claimedInitialAttempt(): ClaimedPrivateAttempt {
  return {
    id: "attempt-1",
    trigger: "INITIAL",
    state: "AUTOMATIC_RUNNING",
    deterministicResultId: null,
    deterministicResultByAttempt: null,
    check: {
      id: "pmc-1",
      candidateUserId: "candidate-1",
      cvVersionId: "cv-1",
      cvVersion: 1,
      cvDigest: "a".repeat(64),
      jobPostingId: "job-1",
      jdVersion: 3,
      jdDigest: "b".repeat(64),
      scoringConfigVersion: "HS-40/60-v1",
      cvSnapshot: {
        mimeType: "application/pdf",
        byteSize: 128,
      },
      jdSnapshot: {
        title: "Java Engineer",
        jdText: "Java and REST APIs",
        requiredSkills: [{ code: "java", label: "Java" }],
        preferredSkills: [],
        requirements: ["Java"],
        requiredExperienceYears: 3,
        requiredLanguages: [],
      },
      cvTextSnapshot: "Java engineer\nBuilt REST APIs",
    },
  } as unknown as ClaimedPrivateAttempt;
}

const automaticResult: AutomaticMatchingResult = {
  resultId: "automatic-1",
  score: 92,
  weight: 0.4,
  weightedContribution: 36.8,
  matchedRequirements: [
    { id: "java", label: "Java", kind: "REQUIRED", matched: true },
  ],
  gaps: [],
  requiredExperience: 3,
  detectedExperience: 4,
  evidenceCoverage: 100,
  evidenceConfidence: 95,
  evidence: [],
  parserProvenance: {
    parserVersion: "test",
    cvStatus: "ready",
    jdStatus: "ready",
  },
  mayBeIncomplete: false,
  cvVersion: "cv-cv-1-v1",
  jdVersion: "jd-job-1-v3",
  configVersion: "HS-40/60-v1",
};

const validCvClassifier = {
  classify: async () => ({
    isCv: true,
    confidence: 0.95,
    source: "AI" as const,
  }),
};

describe("private match worker fallback", () => {
  it("publishes deterministic evidence as limited when AI times out", async () => {
    const calls: string[] = [];
    const attempt = claimedInitialAttempt();
    const repository = {
      claimNextAttempt: async () => attempt,
      setCheckAnalyzing: async () => true,
      saveAutomaticResult: async () => {
        calls.push("automatic");
      },
      beginAi: async () => {
        calls.push("ai-start");
      },
      publishLimited: async (input: { failureCode: string }) => {
        calls.push(`limited:${input.failureCode}`);
      },
      publishHybrid: async () => {
        calls.push("hybrid");
      },
      markFailed: async () => {
        calls.push("failed");
      },
    } as unknown as PrivateCvMatchRepository;
    const automatic: AutomaticMatchingPort = {
      match: async () => automaticResult,
    };
    const ai: AiEvaluationPort = {
      evaluate: async () => {
        throw new AiAssessmentProviderError("AI_PROVIDER_TIMEOUT", true);
      },
    };

    const result = await new PrivateMatchWorker({
      repository,
      automatic,
      ai,
      classifier: validCvClassifier,
      workerId: "worker-1",
      now: () => new Date("2026-08-16T00:00:00.000Z"),
    }).processNext();

    expect(result).toBe("LIMITED");
    expect(calls).toEqual([
      "automatic",
      "ai-start",
      "limited:AI_PROVIDER_TIMEOUT",
    ]);
    expect(calls).not.toContain("failed");
    expect(calls).not.toContain("hybrid");
  });

  it("marks a private scoring attempt failed when the whole job exceeds its deadline", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const attempt = claimedInitialAttempt();
      const repository = {
        claimNextAttempt: async () => attempt,
        setCheckAnalyzing: async () => true,
        saveAutomaticResult: async () => calls.push("automatic"),
        beginAi: async () => calls.push("ai-start"),
        publishLimited: async () => calls.push("limited"),
        publishHybrid: async () => calls.push("hybrid"),
        markFailed: async (input: { failureCode: string }) => {
          calls.push(`failed:${input.failureCode}`);
          return true;
        },
      } as unknown as PrivateCvMatchRepository;
      const automatic: AutomaticMatchingPort = {
        match: async () => automaticResult,
      };
      const ai: AiEvaluationPort = {
        evaluate: async () => new Promise<never>(() => undefined),
      };

      const pending = new PrivateMatchWorker({
        repository,
        automatic,
        ai,
        classifier: validCvClassifier,
        workerId: "worker-timeout",
        timeoutMilliseconds: 25,
        now: () => new Date("2026-08-16T00:00:00.000Z"),
      }).processNext();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toBe("FAILED");
      expect(calls).toContain("failed:SCORING_TIMEOUT");
      expect(calls).not.toContain("limited");
      expect(calls).not.toContain("hybrid");
    } finally {
      vi.useRealTimers();
    }
  });
});
