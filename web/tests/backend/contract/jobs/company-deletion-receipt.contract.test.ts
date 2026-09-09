import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/recruiter/company/deletion/[requestId]/route";

const mocks = vi.hoisted(() => ({
  requireAccountRequest: vi.fn(),
  getCompanyDeletionReceipt: vi.fn(),
}));

vi.mock("@/backend/security/account-request-boundary", async () => {
  const actual = await vi.importActual<
    typeof import("@/backend/security/account-request-boundary")
  >("@/backend/security/account-request-boundary");
  return {
    ...actual,
    requireAccountRequest: mocks.requireAccountRequest,
  };
});
vi.mock("@/backend/services/jobs/company-deletion-manifest-service", () => ({
  getCompanyDeletionReceipt: mocks.getCompanyDeletionReceipt,
}));

const receipt = {
  requestId: "request-1",
  status: "COMPLETED" as const,
  holdState: "CLEAR" as const,
  purgeState: "COMPLETE" as const,
  requestedAt: "2026-09-09T00:00:00.000Z",
  retentionEligibleAt: "2026-09-09T00:00:00.000Z",
  completedAt: "2026-09-09T00:00:01.000Z",
  manifest: {
    total: 1,
    databaseRecords: 1,
    objects: 0,
    pending: 0,
    deleted: 1,
    retainedShared: 0,
    blocked: 0,
    retryable: 0,
    conflicts: 0,
  },
};

describe("company deletion receipt API", () => {
  it("returns the safe receipt only for the authenticated request owner", async () => {
    mocks.requireAccountRequest.mockResolvedValue({ userId: "owner-1" });
    mocks.getCompanyDeletionReceipt.mockResolvedValue(receipt);

    const response = await GET(
      new Request("https://nextgen.test/api/recruiter/company/deletion/request-1"),
      { params: Promise.resolve({ requestId: "request-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(receipt);
    expect(mocks.getCompanyDeletionReceipt).toHaveBeenCalledWith(
      "request-1",
      "owner-1",
    );
  });

  it("uses a content-free 404 for an unknown or cross-account request", async () => {
    mocks.requireAccountRequest.mockResolvedValue({ userId: "other-owner" });
    mocks.getCompanyDeletionReceipt.mockResolvedValue(null);

    const response = await GET(
      new Request("https://nextgen.test/api/recruiter/company/deletion/request-1"),
      { params: Promise.resolve({ requestId: "request-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ code: "COMPANY_DELETION_NOT_FOUND" });
    expect(JSON.stringify(body)).not.toContain("owner-1");
    expect(JSON.stringify(body)).not.toContain("company");
    expect(JSON.stringify(body)).not.toContain("failure");
  });
});
