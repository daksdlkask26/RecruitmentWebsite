import { describe, expect, it } from "vitest";
import { ownerTeamApplicationListSchema } from "@/shared/contracts/company-members/team-applications";
import { teamApplicationFixture } from "../../helpers/company-team-applications-fixture";

describe("Owner Team Application contract", () => {
  it("allows CV metadata and delivery state only in the Owner projection", () => {
    const result = ownerTeamApplicationListSchema.parse({
      items: [
        {
          ...teamApplicationFixture(),
          candidateName: "Candidate",
          applicationEmail: "candidate@example.com",
          cvFileName: "resume.docx",
          cvMimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cvByteSize: 5_000_000,
          rejectionReason: null,
          invitationEmailStatus: "SENT",
        },
      ],
      nextCursor: null,
      hasMore: false,
      total: 1,
      pendingCount: 1,
      filter: { status: null, role: null },
      sort: "SUBMITTED_DESC",
    });
    expect(result.items[0]?.cvByteSize).toBe(5_000_000);
  });
});
