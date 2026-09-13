import { createElement } from "react";
import { render } from "react-email";
import { describe, expect, it } from "vitest";
import {
  RecruitmentNotificationTemplate,
  recruitmentNotificationEmailPayloadSchema,
  recruitmentNotificationEmailText,
} from "@/backend/email/templates/recruitment-notification";

const payload = {
  v: 1 as const,
  audience: "CANDIDATE" as const,
  notificationKind: "APPLICATION_SUBMITTED" as const,
  applicationId: "application-1",
  jobId: "job-1",
  jobTitle: "<script>alert(1)</script>",
  companyName: "Northstar Labs",
  applicationUrl: "http://localhost:3001/jobs/applied/application-1",
};

describe("recruitment notification email contract", () => {
  it("renders bounded public job context without exposing internal fields", async () => {
    const html = await render(
      createElement(RecruitmentNotificationTemplate, payload),
    );
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("finalScore");
    expect(html).toContain("NextGen Careers");
    expect(html).not.toContain("SmartHire");
    expect(recruitmentNotificationEmailText(payload)).toContain(
      "application-1",
    );
  });

  it("rejects payload fields outside the provider contract", () => {
    expect(
      recruitmentNotificationEmailPayloadSchema.safeParse({
        ...payload,
        finalScore: 99,
      }).success,
    ).toBe(false);
  });
});
