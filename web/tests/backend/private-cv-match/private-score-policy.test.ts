import { describe, expect, it } from "vitest";
import {
  calculatePrivateHybridScore,
  privateScoreBand,
} from "@/backend/scoring-engine/hybrid-score-policy";
import {
  sanitizeCvText,
  type AiEvaluationResult,
  type AutomaticMatchingResult,
} from "@/backend/scoring-engine/scoring-contracts";

function automatic(
  score: number,
  evidenceCoverage = 100,
): AutomaticMatchingResult {
  return {
    resultId: "automatic-1",
    score,
    weight: 0.4,
    weightedContribution: score * 0.4,
    matchedRequirements: [],
    gaps: [],
    requiredExperience: null,
    detectedExperience: null,
    evidenceCoverage,
    evidenceConfidence: 10,
    evidence: [],
    parserProvenance: {
      parserVersion: "test",
      cvStatus: "ready",
      jdStatus: "ready",
    },
    mayBeIncomplete: false,
    cvVersion: "cv-v1",
    jdVersion: "jd-v1",
    configVersion: "HS-40/60-v1",
  };
}

function ai(score: number, confidence = 0): AiEvaluationResult {
  return {
    resultId: "ai-1",
    score,
    weight: 0.6,
    weightedContribution: score * 0.6,
    summary: "Summary",
    strengths: [],
    mainGap: null,
    actions: [],
    evidenceConfidence: confidence,
    evidenceLevel: "HIGH",
    provider: "test",
    model: "test-model",
    promptVersion: "prompt-v1",
    policyVersion: "HS-40/60-v1",
    durationMs: 1,
    completedAt: new Date("2026-08-16T00:00:00.000Z"),
    cvVersion: "cv-v1",
    jdVersion: "jd-v1",
    configVersion: "HS-40/60-v1",
  };
}

describe("private CV match scoring boundary", () => {
  it("reuses 40/60 arithmetic and rounds only the final value", () => {
    const result = calculatePrivateHybridScore(automatic(92, 10), ai(88, 0));
    expect(result.value).toBe(89.6);
    expect(result.automaticContribution).toBe(36.8);
    expect(result.aiContribution).toBe(52.8);
    expect(result.formulaText).toContain("89.6");
  });

  it("uses exact 80 and 60 band thresholds", () => {
    expect(privateScoreBand(80).code).toBe("HIGH_MATCH");
    expect(privateScoreBand(79.9).code).toBe("MEDIUM_MATCH");
    expect(privateScoreBand(60).code).toBe("MEDIUM_MATCH");
    expect(privateScoreBand(59.9).code).toBe("LOW_MATCH");
  });

  it("does not feed evidence quality signals into the hybrid score", () => {
    expect(calculatePrivateHybridScore(automatic(92, 0), ai(88, 0)).value).toBe(
      calculatePrivateHybridScore(automatic(92, 100), ai(88, 100)).value,
    );
  });

  it("rejects a component from a different immutable input lineage", () => {
    expect(() =>
      calculatePrivateHybridScore(automatic(92), {
        ...ai(88),
        jdVersion: "jd-v2",
      }),
    ).toThrow("INCOMPATIBLE_SCORE_LINEAGE");
  });

  it("removes sensitive attributes before either component sees the CV text", () => {
    const safe = sanitizeCvText(
      "Java engineer\nGender: female\nAge: 31\nBuilt REST APIs\nname@example.com",
    );
    expect(safe).toContain("Java engineer");
    expect(safe).toContain("Built REST APIs");
    expect(safe).not.toMatch(/female|age:|name@example.com/iu);
  });
});
