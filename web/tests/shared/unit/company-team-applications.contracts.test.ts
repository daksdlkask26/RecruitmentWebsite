import { describe, expect, it } from "vitest";
import {
  candidateTeamApplicationListSchema,
  ownerTeamApplicationSchema,
  teamApplicationAcceptSchema,
  teamApplicationRejectSchema,
  teamApplicationStatusLabels,
  teamRoleSchema,
} from "@/shared/contracts/company-members/team-applications";
import { teamApplicationFixture } from "../../helpers/company-team-applications-fixture";

describe("Team Applications shared contracts", () => {
  it("keeps the candidate projection free of Owner-only fields", () => {
    const candidate = candidateTeamApplicationListSchema.parse({
      items: [teamApplicationFixture()],
      nextCursor: null,
      hasMore: false,
      total: 1,
      filter: { status: null, role: null },
      sort: "SUBMITTED_DESC",
    });
    expect(candidate.items[0]).not.toHaveProperty("candidateName");
    expect(candidate.items[0]).not.toHaveProperty("rejectionReason");
  });

  it("accepts only the two supported team roles", () => {
    expect(teamRoleSchema.safeParse("HR_MANAGER").success).toBe(true);
    expect(teamRoleSchema.safeParse("RECRUITER").success).toBe(true);
    expect(teamRoleSchema.safeParse("OWNER").success).toBe(false);
    expect(teamRoleSchema.safeParse("HIRING_MANAGER").success).toBe(false);
  });

  it("bounds Owner decisions and rejection reasons", () => {
    expect(
      teamApplicationAcceptSchema.safeParse({ role: "RECRUITER" }).success,
    ).toBe(true);
    expect(
      teamApplicationRejectSchema.safeParse({ reason: "  Not a fit yet  " })
        .success,
    ).toBe(true);
    expect(
      teamApplicationRejectSchema.safeParse({ reason: "x".repeat(2_001) })
        .success,
    ).toBe(false);
  });

  it("does not expose a private rejection reason in the candidate contract", () => {
    const owner = ownerTeamApplicationSchema.parse({
      ...teamApplicationFixture({ status: "REJECTED" }),
      candidateName: "Candidate",
      applicationEmail: "candidate@example.com",
      cvFileName: "resume.pdf",
      cvMimeType: "application/pdf",
      cvByteSize: 64,
      rejectionReason: "Private reason",
      invitationEmailStatus: null,
    });
    expect(owner.rejectionReason).toBe("Private reason");
    expect(teamApplicationStatusLabels.REJECTED).toBeTruthy();
    expect(() =>
      candidateTeamApplicationListSchema.parse({ items: [owner] }),
    ).toThrow();
  });
});
