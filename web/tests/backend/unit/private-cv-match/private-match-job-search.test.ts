import { describe, expect, it } from "vitest";
import {
  PRIVATE_MATCH_INITIAL_JOB_LIMIT,
  PRIVATE_MATCH_REMOTE_JOB_LIMIT,
  privateMatchJobsQuerySchema,
} from "@/backend/private-cv-match/private-cv-match-service";
import { PRIVATE_MATCH_JOB_PICKER_LIMIT } from "@/shared/contracts/private-cv-match";
import { candidateVisibleJobWhere } from "@/backend/repositories/jobs/candidate-visible-job-policy";

describe("private CV Match Check job search contract", () => {
  it("accepts the public search modes and bounds picker results", () => {
    expect(
      privateMatchJobsQuerySchema.parse({
        q: "designer",
        searchBy: "COMPANY",
        limit: PRIVATE_MATCH_JOB_PICKER_LIMIT,
      }),
    ).toEqual({
      q: "designer",
      searchBy: "COMPANY",
      limit: PRIVATE_MATCH_JOB_PICKER_LIMIT,
    });
    expect(
      privateMatchJobsQuerySchema.safeParse({
        q: "designer",
        limit: PRIVATE_MATCH_JOB_PICKER_LIMIT + 1,
      }).success,
    ).toBe(false);
    expect(PRIVATE_MATCH_REMOTE_JOB_LIMIT).toBe(PRIVATE_MATCH_JOB_PICKER_LIMIT);
    expect(PRIVATE_MATCH_INITIAL_JOB_LIMIT).toBe(6);
  });

  it("uses the candidate-visible policy for a selected job", () => {
    const where = candidateVisibleJobWhere(
      new Date("2026-08-20T00:00:00.000Z"),
      "job-1",
    );

    expect(where).toMatchObject({
      id: "job-1",
      status: "ACTIVE",
      company: {
        verificationState: "ACTIVE",
        moderationState: "ACTIVE",
      },
    });
    expect(JSON.stringify(where)).toContain('"visibilityState":"PUBLISHED"');
  });
});
