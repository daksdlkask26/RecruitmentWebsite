import { describe, expect, it } from "vitest";
import {
  offerResponseCommandSchema,
  publicOutcomeForCanonicalStage,
  publicStageForCanonicalStage,
  publicTimelineEventCodeForCanonicalStage,
  publicUpdateKindForCanonicalStage,
  publicUpdateTitleForCanonicalStage,
} from "@/shared/contracts/candidate-applications";
import { canTransitionApplicationStage } from "@/backend/services/jobs/application-stage-policy";

describe("candidate recruitment stage projection", () => {
  it("maps every canonical stage to its candidate-facing group and update", () => {
    const expected = {
      APPLIED: [
        "APPLICATION_SUBMITTED",
        null,
        "SUBMITTED",
        "Application submitted",
        "APPLICATION_SUBMITTED",
      ],
      VIEWED: [
        "UNDER_REVIEW",
        null,
        "UNDER_REVIEW",
        "Application viewed",
        "APPLICATION_VIEWED",
      ],
      SHORTLISTED: [
        "UNDER_REVIEW",
        null,
        "UNDER_REVIEW",
        "Application shortlisted",
        "APPLICATION_SHORTLISTED",
      ],
      INTERVIEWING: [
        "INTERVIEW",
        null,
        "INTERVIEW",
        "Interview stage reached",
        "INTERVIEW_STARTED",
      ],
      OFFERED: ["OUTCOME", "OFFERED", "OUTCOME", "Offer sent", "OFFER_SENT"],
      HIRED: [
        "OUTCOME",
        "HIRED",
        "OUTCOME",
        "Offer accepted",
        "OFFER_ACCEPTED",
      ],
      OFFER_DECLINED: [
        "OUTCOME",
        "OFFER_DECLINED",
        "OUTCOME",
        "Offer declined",
        "OFFER_DECLINED",
      ],
      REJECTED: [
        "OUTCOME",
        "REJECTED",
        "OUTCOME",
        "Application rejected",
        "APPLICATION_REJECTED",
      ],
      WAITLISTED: [
        "OUTCOME",
        "WAITLISTED",
        "OUTCOME",
        "Application waitlisted",
        "APPLICATION_WAITLISTED",
      ],
    } as const;

    for (const [stage, values] of Object.entries(expected)) {
      const canonicalStage = stage as keyof typeof expected;
      expect([
        publicStageForCanonicalStage(canonicalStage),
        publicOutcomeForCanonicalStage(canonicalStage),
        publicUpdateKindForCanonicalStage(canonicalStage),
        publicUpdateTitleForCanonicalStage(canonicalStage),
        publicTimelineEventCodeForCanonicalStage(canonicalStage),
      ]).toEqual(values);
    }
  });

  it("allows waitlisting from every active stage", () => {
    for (const stage of [
      "APPLIED",
      "VIEWED",
      "SHORTLISTED",
      "INTERVIEWING",
    ] as const) {
      expect(canTransitionApplicationStage(stage, "WAITLISTED")).toBe(true);
    }
  });

  it("accepts only the two candidate offer responses", () => {
    expect(
      offerResponseCommandSchema.parse({
        decision: "ACCEPT",
        expectedVersion: 3,
      }),
    ).toEqual({ decision: "ACCEPT", expectedVersion: 3 });
    expect(
      offerResponseCommandSchema.safeParse({
        decision: "REJECT",
        expectedVersion: 3,
      }).success,
    ).toBe(false);
  });
});
