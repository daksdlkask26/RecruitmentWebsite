import { describe, expect, it } from "vitest";
import {
  canTransitionJobPostReview,
  jobReviewMaterialIdentity,
  jobReviewSnapshotSha256,
  normalizeJobReviewSnapshot,
} from "@/backend/jobs/review/job-post-review-policy";
import { projectJobReviewSnapshot } from "@/backend/jobs/review/job-post-publication-projector";
import { buildJobReviewSnapshot } from "../../../helpers/job-post-reviews/job-post-review-fixtures";

describe("job-post review policy", () => {
  it("normalizes content and produces deterministic material identities", () => {
    const first = normalizeJobReviewSnapshot(
      buildJobReviewSnapshot({
        title: "  Senior Platform Engineer  ",
        skillTags: [" PostgreSQL ", "TypeScript"],
      }),
    );
    const second = normalizeJobReviewSnapshot(
      buildJobReviewSnapshot({
        title: "Senior Platform Engineer",
        skillTags: ["PostgreSQL", "TypeScript"],
      }),
    );
    expect(first).toEqual(second);
    expect(jobReviewMaterialIdentity(first)).toBe(
      jobReviewMaterialIdentity(second),
    );
    expect(jobReviewSnapshotSha256(first)).toMatch(/^[a-f0-9]{64}$/u);
    expect(jobReviewSnapshotSha256(first)).toBe(
      jobReviewSnapshotSha256(second),
    );
  });

  it("maps allow-listed JSON labels into the relational public projection", () => {
    const projection = projectJobReviewSnapshot(buildJobReviewSnapshot());
    expect(projection).toMatchObject({
      employmentType: "FULL_TIME",
      experienceLevel: "SENIOR",
      workArrangement: "HYBRID",
      salaryPeriod: "MONTH",
    });
    expect(projection.skills.map((skill) => skill.normalizedName)).toEqual([
      "typescript",
      "postgresql",
      "distributed systems",
    ]);
    expect(projection.skills.map((skill) => skill.required)).toEqual([
      true,
      true,
      true,
    ]);
    expect(() =>
      projectJobReviewSnapshot(buildJobReviewSnapshot({ level: "wizard" })),
    ).toThrow("UNPUBLISHABLE_JOB_MAPPING");
  });

  it("uses the shared accent-insensitive normalization across the full search document", () => {
    const projection = projectJobReviewSnapshot(
      buildJobReviewSnapshot({
        title: "Kế toán trưởng",
        description: {
          ...buildJobReviewSnapshot().description,
          overview: "Báo cáo tài chính hàng tháng.",
          responsibilities: ["Đối chiếu sổ sách kế toán."],
          requirements: ["Am hiểu chuẩn mực kế toán Việt Nam."],
          benefits: [{ icon: "gift", label: "Đào tạo chuyên môn." }],
        },
      }),
    );
    expect(projection.normalizedTitle).toBe("ke toan truong");
    expect(projection.normalizedLocation).not.toMatch(/[ăâđêôơư]/u);
    expect(projection.searchDocumentNormalized).toContain(
      "bao cao tai chinh hang thang",
    );
    expect(projection.searchDocumentNormalized).toContain(
      "doi chieu so sach ke toan",
    );
  });

  it("blocks snapshots whose joined public text would violate the relational projection", () => {
    const snapshot = buildJobReviewSnapshot();
    expect(() =>
      projectJobReviewSnapshot({
        ...snapshot,
        description: { ...snapshot.description, responsibilities: [] },
      }),
    ).toThrow("UNPUBLISHABLE_JOB_CONTENT");
    expect(() =>
      projectJobReviewSnapshot({
        ...snapshot,
        description: { ...snapshot.description, requirements: [] },
      }),
    ).toThrow("UNPUBLISHABLE_JOB_CONTENT");
  });

  it("permits one terminal decision and never reopens a terminal version", () => {
    expect(canTransitionJobPostReview("PENDING_REVIEW", "APPROVED")).toBe(true);
    expect(canTransitionJobPostReview("PENDING_REVIEW", "REJECTED")).toBe(true);
    expect(canTransitionJobPostReview("APPROVED", "PENDING_REVIEW")).toBe(
      false,
    );
    expect(canTransitionJobPostReview("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionJobPostReview("WITHDRAWN", "APPROVED")).toBe(false);
  });
});
