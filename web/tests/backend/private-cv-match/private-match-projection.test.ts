import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PrivateCheckRecord } from "@/backend/repositories/private-cv-match/prisma-private-cv-match-repository";
import {
  PrivateMatchProjectionError,
  projectPrivateMatchCheck,
} from "@/backend/private-cv-match/private-match-projection";

const now = new Date("2026-08-16T00:00:00.000Z");

function digest(value: unknown) {
  const canonical = JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested))
      return nested;
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function checkWithRetryLease(leaseExpiresAt: Date | null): PrivateCheckRecord {
  const jdSnapshot = {
    jobId: "job-1",
    slug: "java-engineer",
    title: "Java Engineer",
    company: "Acme",
    location: "Remote",
    employmentType: "FULL_TIME",
    workArrangement: "REMOTE",
    requiredExperienceYears: null,
    requirements: ["Java"],
    requiredSkills: [],
    preferredSkills: [],
    requiredLanguages: [],
    jdVersion: 1,
    jdUpdatedAt: now.toISOString(),
    jdText: "Java",
    parseStatus: "READY" as const,
  };
  return {
    id: "pmc-1",
    candidateUserId: "candidate-1",
    cvVersionId: "cv-1",
    cvVersion: 1,
    cvDigest: "a".repeat(64),
    jobPostingId: "job-1",
    jdVersion: 1,
    jdDigest: digest(jdSnapshot),
    scoringConfigVersion: "HS-40/60-v1",
    creationDedupeKey: "c".repeat(64),
    cvSnapshot: {
      versionId: "cv-1",
      version: 1,
      displayName: "Resume",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      byteSize: 100,
      pageCount: null,
      parseStatus: "READY",
      confirmedAt: now.toISOString(),
      checksumSha256: "a".repeat(64),
    },
    jdSnapshot,
    cvTextSnapshot: "Java engineer",
    currentAttemptId: "attempt-1",
    state: "READY",
    createdAt: now,
    expiresAt: new Date("2027-08-16T00:00:00.000Z"),
    inaccessibleAt: null,
    deleteAfter: null,
    deletedAt: null,
    deleteLeaseOwner: null,
    deleteLeaseExpiresAt: null,
    deleteAttempts: 0,
    deleteFailureCode: null,
    currentAttempt: {
      id: "attempt-1",
      checkId: "pmc-1",
      attemptNumber: 1,
      trigger: "INITIAL",
      state: "READY",
      deterministicResultId: "automatic-1",
      aiResultId: "ai-1",
      hybridScore: 81,
      matchBand: "HIGH_MATCH",
      startedAt: now,
      completedAt: now,
      failureCode: null,
      provider: "test",
      model: "test-model",
      promptVersion: "test-prompt",
      inputPolicyVersion: "test-policy",
      scoringPolicyVersion: "HS-40/60-v1",
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: now,
      deterministicResultByAttempt: {
        id: "automatic-1",
        attemptId: "attempt-1",
        attempt: { id: "attempt-1", checkId: "pmc-1" },
        score: 90,
        weight: 0.4,
        weightedContribution: 36,
        matchedRequirements: [],
        gaps: [],
        requiredExperience: null,
        detectedExperience: null,
        evidenceCoverage: 100,
        parserProvenance: {
          parserVersion: "private-cv-match-parser-v1",
          cvStatus: "Parsed successfully",
          jdStatus: "Parsed successfully",
          cvVersion: "cv-cv-1-v1",
          jdVersion: "jd-job-1-v1",
          configVersion: "HS-40/60-v1",
        },
        calculatedAt: now,
        mayBeIncomplete: false,
        evidence: [],
      },
      aiResultByAttempt: {
        id: "ai-1",
        attemptId: "attempt-1",
        score: 75,
        weight: 0.6,
        weightedContribution: 45,
        summary: "Good evidence.",
        strengths: [],
        mainGap: null,
        actions: [],
        evidenceConfidence: 80,
        evidenceLevel: "HIGH",
        provider: "test",
        model: "test-model",
        promptVersion: "test-prompt",
        policyVersion: "HS-40/60-v1",
        durationMs: 1,
        completedAt: now,
      },
    },
    attempts: [
      {
        id: "retry-1",
        checkId: "pmc-1",
        attemptNumber: 2,
        trigger: "AI_RETRY",
        state: "AI_RUNNING",
        deterministicResultId: "automatic-1",
        aiResultId: null,
        hybridScore: null,
        matchBand: null,
        startedAt: now,
        completedAt: null,
        failureCode: null,
        provider: null,
        model: null,
        promptVersion: null,
        inputPolicyVersion: null,
        scoringPolicyVersion: "HS-40/60-v1",
        leaseOwner: "worker-1",
        leaseExpiresAt,
        createdAt: now,
        deterministicResultByAttempt: null,
        aiResultByAttempt: null,
      },
    ],
    commandReceipts: [],
  } as unknown as PrivateCheckRecord;
}

describe("private match projection retry state", () => {
  it("projects a completed AI retry from its immutable deterministic pointer", () => {
    const check = checkWithRetryLease(null);
    const initial = check.currentAttempt;
    if (!initial?.deterministicResultByAttempt || !initial.aiResultByAttempt)
      throw new Error("INITIAL_RESULT_EXPECTED");

    const retry = {
      ...initial,
      id: "retry-completed",
      attemptNumber: 2,
      trigger: "AI_RETRY" as const,
      state: "READY" as const,
      deterministicResultId: initial.deterministicResultByAttempt.id,
      deterministicResultByAttempt: null,
      deterministicResult: initial.deterministicResultByAttempt,
      aiResultId: "ai-retry",
      aiResultByAttempt: {
        ...initial.aiResultByAttempt,
        id: "ai-retry",
        attemptId: "retry-completed",
      },
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: now,
    };

    const report = projectPrivateMatchCheck(
      {
        ...check,
        currentAttemptId: retry.id,
        currentAttempt: retry,
        attempts: [retry],
      } as unknown as PrivateCheckRecord,
      now,
    );

    expect(report.view).toBe("FULL_REPORT");
  });

  it("does not lock the retry control after an AI worker lease expires", () => {
    const report = projectPrivateMatchCheck(
      checkWithRetryLease(new Date(now.getTime() - 1_000)),
      now,
    );

    if (report.view !== "FULL_REPORT") throw new Error("FULL_REPORT_EXPECTED");
    expect(report.retryInProgress).toBe(false);
  });

  it("keeps the retry control locked while its worker lease is valid", () => {
    const report = projectPrivateMatchCheck(
      checkWithRetryLease(new Date(now.getTime() + 30_000)),
      now,
    );

    if (report.view !== "FULL_REPORT") throw new Error("FULL_REPORT_EXPECTED");
    expect(report.retryInProgress).toBe(true);
  });

  it("fails closed when the immutable job snapshot digest no longer matches", () => {
    const check = checkWithRetryLease(null);
    const jobSnapshot = check.jdSnapshot as Record<string, unknown>;
    expect(() =>
      projectPrivateMatchCheck({
        ...check,
        jdSnapshot: { ...jobSnapshot, title: "Tampered title" },
      } as unknown as PrivateCheckRecord),
    ).toThrow(PrivateMatchProjectionError);
  });

  it("removes numeric output when evidence cannot be traced to the CV snapshot", () => {
    const check = checkWithRetryLease(null);
    const attempt = check.currentAttempt;
    const deterministicResult = attempt?.deterministicResultByAttempt;
    if (!attempt || !deterministicResult)
      throw new Error("DETERMINISTIC_RESULT_EXPECTED");
    const deterministic = {
      ...deterministicResult,
      matchedRequirements: [
        {
          id: "java",
          label: "Java",
          kind: "REQUIRED" as const,
          matched: true,
        },
      ],
      evidence: [
        {
          classification: "SKILL",
          quote: "Python experience",
          criterionId: "java",
          criterionVersion: "java-v1",
          location: { section: "Skills", page: 1 },
          confidenceMetadata: { confidence: 0.9 },
        },
      ],
    };
    const report = projectPrivateMatchCheck(
      {
        ...check,
        currentAttempt: {
          ...attempt,
          deterministicResultByAttempt: deterministic,
        },
      } as unknown as PrivateCheckRecord,
      now,
    );

    if (report.view !== "FULL_REPORT") throw new Error("FULL_REPORT_EXPECTED");
    expect(report.presentationState).toBe("INCOMPLETE");
    expect(report.scoreEligible).toBe(false);
    expect(report.hybridScore).toBeNull();
    expect(report.automatic.score).toBeNull();
    expect(report.automatic.weightedContribution).toBeNull();
    expect(report.aiEvaluation.score).toBeNull();
  });

  it("rejects parser provenance that is not bound to the current snapshots and policy", () => {
    const check = checkWithRetryLease(null);
    const attempt = check.currentAttempt;
    const deterministicResult = attempt?.deterministicResultByAttempt;
    if (!attempt || !deterministicResult)
      throw new Error("DETERMINISTIC_RESULT_EXPECTED");
    const parserProvenance = deterministicResult.parserProvenance as Record<
      string,
      unknown
    >;
    expect(() =>
      projectPrivateMatchCheck({
        ...check,
        currentAttempt: {
          ...attempt,
          deterministicResultByAttempt: {
            ...deterministicResult,
            parserProvenance: {
              ...parserProvenance,
              configVersion: "HS-40/60-tampered",
            },
          },
        },
      } as unknown as PrivateCheckRecord),
    ).toThrow(PrivateMatchProjectionError);
  });
});
