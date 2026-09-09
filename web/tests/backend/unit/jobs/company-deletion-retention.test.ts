import { beforeEach, describe, expect, it, vi } from "vitest";
import { findActiveCompanyDeletionRetentionBlock } from "@/backend/services/jobs/company-deletion-retention";

const db = {
  activityLegalHold: { findFirst: vi.fn() },
  applicationDocumentLegalHold: { findFirst: vi.fn() },
  jobReport: { findFirst: vi.fn() },
  messagingReport: { findFirst: vi.fn() },
  moderationReport: { findFirst: vi.fn() },
};

const scope = {
  companyId: "company-1",
  jobIds: ["job-1"],
  applicationIds: ["application-1"],
  threadIds: ["thread-1"],
  conversationIds: ["conversation-1"],
  now: new Date("2026-09-09T00:00:00.000Z"),
};

describe("company deletion retention gate", () => {
  beforeEach(() => {
    for (const delegate of Object.values(db)) {
      for (const method of Object.values(delegate)) {
        method.mockReset();
        method.mockResolvedValue(null);
      }
    }
  });

  it.each([
    ["application document legal hold", "applicationDocumentLegalHold", "LEGAL_HOLD_ACTIVE"],
    ["activity legal hold", "activityLegalHold", "ACTIVITY_LEGAL_HOLD_ACTIVE"],
    ["job report", "jobReport", "JOB_REPORT_ACTIVE"],
    ["messaging report", "messagingReport", "MESSAGING_REPORT_ACTIVE"],
    ["moderation report", "moderationReport", "MODERATION_REPORT_ACTIVE"],
  ] as const)("blocks an active %s", async (_name, source, code) => {
    db[source].findFirst.mockResolvedValue({ id: `${source}-1` });

    await expect(
      findActiveCompanyDeletionRetentionBlock(db, scope),
    ).resolves.toEqual({ code });
  });

  it("does not block when every retention source is inactive", async () => {
    await expect(
      findActiveCompanyDeletionRetentionBlock(db, scope),
    ).resolves.toBeNull();
    expect(db.jobReport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          jobPostingId: { in: ["job-1"] },
          status: "PENDING_REVIEW",
        }),
      }),
    );
  });
});
