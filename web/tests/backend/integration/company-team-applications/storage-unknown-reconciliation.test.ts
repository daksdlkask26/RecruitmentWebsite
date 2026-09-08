import { expect, it, vi } from "vitest";

import { TeamApplicationService } from "@/backend/services/company-members/team-application-service";

it("rejects a legacy Team CV before an unknown storage write can occur", async () => {
  const prepared = {
    ensureStored: vi.fn().mockRejectedValue(new Error("STORAGE_RESPONSE_LOST")),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };

  await expect(
    new TeamApplicationService().submit(
      "candidate-test-only",
      "company-test-only",
      "HR_MANAGER",
      prepared as never,
    ),
  ).rejects.toMatchObject({ code: "TEAM_APPLICATION_UNAVAILABLE" });

  expect(prepared.ensureStored).not.toHaveBeenCalled();
  expect(prepared.cleanup).toHaveBeenCalledOnce();
});
