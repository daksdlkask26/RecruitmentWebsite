import { describe, expect, it } from "vitest";
import {
  candidateTeamApplicationListSchema,
  teamApplicationSubmitSchema,
} from "@/shared/contracts/company-members/team-applications";
import { teamApplicationFixture } from "../../helpers/company-team-applications-fixture";

describe("Candidate Team Application contract", () => {
  it("validates multipart field values before CV promotion", () => {
    expect(
      teamApplicationSubmitSchema.safeParse({
        companyId: "company-1",
        role: "HR_MANAGER",
      }).success,
    ).toBe(true);
    expect(
      teamApplicationSubmitSchema.safeParse({
        companyId: "company-1",
        role: "OWNER",
      }).success,
    ).toBe(false);
  });

  it("returns candidate-safe status fields", () => {
    const response = candidateTeamApplicationListSchema.parse({
      items: [teamApplicationFixture()],
      nextCursor: null,
      hasMore: false,
      total: 1,
      filter: { status: null, role: null },
      sort: "SUBMITTED_DESC",
    });
    expect(response.items[0]).toMatchObject({
      companyId: "company-team-028",
      status: "SUBMITTED",
      ownerViewed: false,
    });
  });
});
