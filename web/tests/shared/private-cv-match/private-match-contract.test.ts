import { describe, expect, it } from "vitest";
import {
  privateMatchListResponseSchema,
  privateMatchResponseSchema,
  privateMatchStatusSchema,
} from "@/shared/contracts/private-cv-match";

const base = {
  checkId: "pmc_1",
  createdAt: "2026-08-16T00:00:00.000Z",
  expiresAt: "2027-08-16T00:00:00.000Z",
  inputSource: "CV" as const,
  completeness: "AVAILABLE" as const,
  presentationState: "UNAVAILABLE" as const,
  scoreEligible: false,
  provenance: {
    inputSource: "CV" as const,
    completeness: "AVAILABLE" as const,
    presentationState: "UNAVAILABLE" as const,
    scoreEligible: false,
    cvVersionId: "cv-1",
    cvVersion: 1,
    jdVersion: 3,
    scoringConfigVersion: "HS-40/60-v1",
    aiProvider: null,
    aiModel: null,
    promptVersion: null,
    inputPolicyVersion: null,
  },
  cv: {
    versionId: "cv-1",
    version: 1,
    displayName: "Resume",
    fileName: "resume.pdf",
    mimeType: "application/pdf",
    byteSize: 100,
    pageCount: null,
    parseStatus: "READY",
    confirmedAt: "2026-08-16T00:00:00.000Z",
  },
  job: {
    jobId: "job-1",
    slug: "java-engineer",
    title: "Java Engineer",
    company: "Acme",
    location: "Remote",
    employmentType: "FULL_TIME",
    workArrangement: "REMOTE",
    requiredExperienceYears: 3,
    requirements: ["Java"],
    jdVersion: 3,
    jdUpdatedAt: "2026-08-16T00:00:00.000Z",
  },
};

describe("private match response contracts", () => {
  it("accepts status and keeps the response allow-listed", () => {
    const response = privateMatchStatusSchema.parse({
      ...base,
      view: "STATUS",
      state: "QUEUED",
      failureCode: null,
      durationSeconds: null,
    });
    expect(response.view).toBe("STATUS");
    expect(() =>
      privateMatchStatusSchema.parse({ ...response, rank: 1 }),
    ).toThrow();
  });

  it("does not accept employer-only score/ranking fields in status", () => {
    expect(() =>
      privateMatchResponseSchema.parse({
        ...base,
        view: "STATUS",
        state: "QUEUED",
        failureCode: null,
        durationSeconds: null,
        internalNotes: "secret",
        recruiterScore: 99,
      }),
    ).toThrow();
  });

  it("keeps the saved-check list owner-safe and report-free", () => {
    const response = privateMatchListResponseSchema.parse({
      items: [
        {
          checkId: "pmc_1",
          inputSource: "CV",
          completeness: "AVAILABLE",
          presentationState: "AVAILABLE",
          scoreEligible: true,
          state: "READY",
          createdAt: "2026-08-16T00:00:00.000Z",
          expiresAt: "2027-08-16T00:00:00.000Z",
          job: {
            jobId: "job-1",
            slug: "java-engineer",
            title: "Java Engineer",
            company: "Acme",
            location: "Remote",
          },
          cv: {
            versionId: "cv-1",
            displayName: "Resume",
            fileName: "resume.pdf",
            version: 1,
          },
          hybridScore: 89.6,
          deterministicScore: 92,
        },
      ],
    });
    expect(response.items[0]?.hybridScore).toBe(89.6);
    expect(() =>
      privateMatchListResponseSchema.parse({
        items: [{ ...response.items[0], rank: 1 }],
      }),
    ).toThrow();
  });

  it("rejects numeric output on an incomplete full report", () => {
    const report = privateMatchResponseSchema.parse({
      ...base,
      completeness: "INCOMPLETE",
      presentationState: "INCOMPLETE",
      scoreEligible: false,
      provenance: {
        ...base.provenance,
        completeness: "INCOMPLETE",
        presentationState: "INCOMPLETE",
        scoreEligible: false,
      },
      view: "FULL_REPORT",
      state: "READY",
      mode: "HYBRID",
      hybridScore: null,
      matchBand: null,
      automatic: {
        score: null,
        weight: 0.4,
        weightedContribution: null,
        evidenceCoverage: null,
        evidenceConfidence: null,
        matchedRequirements: [],
        gaps: [],
        requiredExperience: null,
        detectedExperience: null,
        evidence: [],
        parserProvenance: {
          parserVersion: "parser-v1",
          cvStatus: "PARTIAL",
          jdStatus: "READY",
        },
        mayBeIncomplete: true,
      },
      aiEvaluation: {
        score: null,
        weight: 0.6,
        weightedContribution: null,
        summary: "The report is incomplete.",
        strengths: [],
        mainGap: null,
        actions: [],
        evidenceConfidence: null,
        evidenceLevel: "LOW",
        provider: "test",
        model: "test-model",
        promptVersion: "prompt-v1",
        policyVersion: "policy-v1",
        durationMs: 1,
        completedAt: "2026-08-16T00:00:12.000Z",
      },
      evidenceConfidence: null,
      summary: "The report is incomplete.",
      actions: [],
      canApply: true,
      completedAt: "2026-08-16T00:00:12.000Z",
      retryInProgress: false,
    });

    expect(report.view).toBe("FULL_REPORT");
    if (report.view !== "FULL_REPORT") throw new Error("FULL_REPORT_EXPECTED");
    expect(() =>
      privateMatchResponseSchema.parse({
        ...report,
        automatic: { ...report.automatic, score: 10 },
      }),
    ).toThrow();
  });
});
