import { describe, expect, it } from "vitest";
import {
  jobDetailSchema,
  jobSearchQuerySchema,
  jobSearchResponseSchema,
} from "@/shared/contracts/jobs/discovery";
import {
  savedFilterPresetSchema,
  userJobStateViewSchema,
} from "@/shared/contracts/jobs/catalog";
import {
  applicationSubmissionSchema,
  candidateCvOptionSchema,
  jobReportInputSchema,
} from "@/shared/contracts/jobs/actions";

describe("job board transport contracts", () => {
  it("bounds and validates public search criteria", () => {
    expect(
      jobSearchQuerySchema.parse({
        q: "Lập trình viên",
        employmentType: ["FULL_TIME"],
        limit: "20",
      }),
    ).toMatchObject({ q: "Lập trình viên", limit: 20 });
    expect(jobSearchQuerySchema.parse({}).searchMode).toBe("SMART");
    expect(
      jobSearchQuerySchema.parse({ searchMode: "LITERAL" }).searchMode,
    ).toBe("LITERAL");
    expect(() =>
      jobSearchQuerySchema.parse({ searchMode: "UNSAFE" }),
    ).toThrow();
    expect(() =>
      jobSearchQuerySchema.parse({ salaryMin: "10", salaryMax: "2" }),
    ).toThrow();
    expect(() => jobSearchQuerySchema.parse({ limit: "51" })).toThrow();
    expect(
      jobSearchQuerySchema.parse({
        categoryId: ["r03-software-development"],
      }).categoryId,
    ).toEqual(["r03-software-development"]);
    expect(
      jobSearchQuerySchema.parse({ categoryTitle: ["Software Engineer"] })
        .categoryTitle,
    ).toEqual(["Software Engineer"]);
    expect(
      jobSearchQuerySchema.parse({ salaryNegotiable: "true" }).salaryNegotiable,
    ).toBe(true);
    expect(() =>
      jobSearchQuerySchema.parse({
        salaryNegotiable: "true",
        salaryMin: "10",
      }),
    ).toThrow();
  });

  it("rejects ownership fields and unsafe report shapes", () => {
    expect(() =>
      jobReportInputSchema.parse({
        reason: "FRAUD",
        details: null,
        reporterUserId: "other-user",
      }),
    ).toThrow();
    expect(() =>
      jobReportInputSchema.parse({ reason: "OTHER", details: "too short" }),
    ).toThrow();
    expect(
      jobReportInputSchema.parse({
        reason: "OTHER",
        details: "The listing requests an advance payment.",
      }),
    ).toMatchObject({ reason: "OTHER" });
  });

  it("requires one answer per question and explicit consent", () => {
    const valid = {
      cvId: "cv-1",
      answers: [{ questionId: "q-1", value: "Five years" }],
      coverLetter: null,
      consentVersion: "2026-08-01",
      consentAccepted: true,
    };
    expect(applicationSubmissionSchema.parse(valid)).toEqual(valid);
    expect(() =>
      applicationSubmissionSchema.parse({ ...valid, userId: "other" }),
    ).toThrow();
    expect(() =>
      applicationSubmissionSchema.parse({
        ...valid,
        answers: [...valid.answers, valid.answers[0]],
      }),
    ).toThrow();
    expect(() =>
      applicationSubmissionSchema.parse({ ...valid, consentAccepted: false }),
    ).toThrow();
  });

  it("uses the constitutional decimal CV byte limit", () => {
    const option = {
      id: "cv-1",
      displayName: "Application CV",
      fileName: "application.pdf",
      mimeType: "application/pdf" as const,
      byteSize: 5_000_000,
      version: 1,
      confirmedAt: "2026-08-01T00:00:00.000Z",
    };
    expect(candidateCvOptionSchema.parse(option).byteSize).toBe(5_000_000);
    expect(() =>
      candidateCvOptionSchema.parse({ ...option, byteSize: 5_000_001 }),
    ).toThrow();
  });

  it("keeps public job projections strict", () => {
    const card = {
      id: "job-1",
      slug: "lap-trinh-vien",
      title: "Lập trình viên",
      company: {
        slug: "smart-hire",
        displayName: "SmartHire",
        logoUrl: null,
        websiteUrl: null,
        publicDescription: null,
        publicLocation: "Hồ Chí Minh",
      },
      location: "Hồ Chí Minh",
      employmentType: "FULL_TIME",
      experienceLevel: "MID",
      workArrangement: "HYBRID",
      salary: null,
      summary: "Build useful products.",
      skills: ["TypeScript"],
      publishedAt: "2026-08-01T00:00:00.000Z",
      applicationDeadline: null,
      actions: {
        authenticated: false,
        saved: false,
        applied: false,
        canSave: false,
        canReport: false,
        canApply: true,
      },
    };
    expect(
      jobSearchResponseSchema.parse({
        items: [card],
        total: 1,
        nextCursor: null,
        page: 1,
        totalPages: 1,
        criteria: {},
      }).items[0]?.title,
    ).toBe("Lập trình viên");
    expect(() =>
      jobDetailSchema.parse({
        ...card,
        state: "ACTIVE",
        description: "Description",
        responsibilities: "Responsibilities",
        requirements: "Requirements",
        benefits: null,
        canonicalUrl: "https://jobs.example.test/jobs/lap-trinh-vien",
        moderationReason: "private",
      }),
    ).toThrow();
  });

  it("keeps saved searches bounded and backward compatible", () => {
    const preset = savedFilterPresetSchema.parse({
      id: "preset-1",
      name: "  Remote accountant  ",
      filters: { q: "ketoan", location: "Da Nang", page: "4" },
    });

    expect(preset).toMatchObject({
      id: "preset-1",
      name: "Remote accountant",
      q: "",
    });
    expect(preset.searchMode).toBeUndefined();
    expect(
      userJobStateViewSchema.parse({
        savedJobIds: [],
        hiddenJobIds: [],
        appliedJobIds: [],
      }).savedFilterPresets,
    ).toEqual([]);
    expect(() =>
      savedFilterPresetSchema.parse({
        id: "preset-1",
        name: "x",
        filters: {},
        unexpected: true,
      }),
    ).toThrow();
  });
});
