import { describe, expect, it } from "vitest";
import {
  applicationFileDescriptorSchema,
  applicationTrackerSchema,
  coverLetterDraftSchema,
  parseApplicationDraftResponse,
} from "@/shared/contracts/candidate-applications";

const file = {
  versionId: "cv-1",
  displayName: "Resume.pdf",
  fileName: "Resume.pdf",
  mimeType: "application/pdf" as const,
  byteSize: 1200,
  version: 2,
  parseStatus: "READY" as const,
};

describe("candidate application workflow contracts", () => {
  it("models cover letters as one discriminated text-or-file field", () => {
    expect(
      coverLetterDraftSchema.parse({ kind: "TEXT", text: "Hello" }),
    ).toEqual({
      kind: "TEXT",
      text: "Hello",
    });
    expect(coverLetterDraftSchema.parse({ kind: "FILE", file })).toEqual({
      kind: "FILE",
      file,
    });
    expect(() =>
      coverLetterDraftSchema.parse({ kind: "TEXT", text: "Hello", file }),
    ).toThrow();
  });

  it("keeps tracker projections structurally free of recruiter evaluation data", () => {
    const tracker = applicationTrackerSchema.parse({
      applicationId: "application-1",
      job: {
        jobId: "job-1",
        slug: "role",
        title: "Role",
        companyName: "Company",
        companyLogoUrl: null,
        location: "Remote",
        jobAvailable: true,
      },
      publicStage: "APPLICATION_SUBMITTED",
      publicOutcome: null,
      canonicalStage: "APPLIED",
      stageVersion: 1,
      submittedAt: "2026-08-17T00:00:00.000Z",
      lastUpdatedAt: "2026-08-17T00:00:00.000Z",
      intake: {
        state: "RECEIVED",
        progressPercent: 0,
        steps: [
          {
            code: "APPLICATION_RECEIVED",
            status: "COMPLETE",
            timestamp: "2026-08-17T00:00:00.000Z",
          },
          { code: "CHECKING_FILES", status: "PENDING", timestamp: null },
          { code: "SENT_TO_RECRUITER", status: "PENDING", timestamp: null },
        ],
        failureCode: null,
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
      updates: [],
      files: [applicationFileDescriptorSchema.parse(file)],
      submission: {
        profile: {
          status: "AVAILABLE",
          fullName: "Candidate",
          headline: null,
          summary: null,
          skills: [],
          experience: [],
          education: [],
        },
        contact: {
          status: "AVAILABLE",
          fullName: "Candidate",
          email: "candidate@example.com",
          phone: "0901234567",
          location: null,
        },
        consent: {
          status: "AVAILABLE",
          version: "2026-08-01",
          consentedAt: "2026-08-17T00:00:00.000Z",
        },
        job: {
          available: true,
          title: "Role",
          companyName: "Company",
          location: "Remote",
          employmentType: "FULL_TIME",
          experienceLevel: "MID",
          workArrangement: "REMOTE",
          requiredSkills: [],
          version: 1,
        },
        cv: {
          availability: "AVAILABLE",
          file: applicationFileDescriptorSchema.parse(file),
          previewSupported: true,
        },
        coverLetter: { kind: "NONE", availability: "NOT_PROVIDED" },
        answers: [],
        message: null,
      },
      notificationPreference: {
        emailEnabled: true,
        inAppEnabled: true,
        version: 1,
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
      canWithdraw: true,
    });

    expect("score" in tracker).toBe(false);
    expect("rank" in tracker).toBe(false);
    expect("employerNotes" in tracker).toBe(false);
    expect("reason" in tracker).toBe(false);
  });

  it("accepts the direct draft response returned by the draft API", () => {
    const draft = {
      draftId: "draft-1",
      jobId: "job-1",
      revision: 1,
      personalInformation: {
        fullName: "Candidate",
        email: "candidate@example.com",
        phone: "0123456789",
      },
      cv: null,
      coverLetter: null,
      message: null,
      confirmationAccepted: false,
      updatedAt: "2026-08-17T00:00:00.000Z",
      expiresAt: "2026-09-16T00:00:00.000Z",
    };

    expect(parseApplicationDraftResponse(draft)).toEqual(draft);
    expect(parseApplicationDraftResponse({ draft })).toEqual(draft);
  });
});
