import { expect, it, vi } from "vitest";

import { saveDirectCandidateCv } from "@/backend/services/profile/save-direct-candidate-cv";

it("rejects and cleans the legacy plaintext profile-CV contract", async () => {
  const prepared = {
    cleanup: vi.fn().mockResolvedValue(undefined),
  };

  await expect(
    saveDirectCandidateCv("candidate-1", prepared as never),
  ).rejects.toThrow("APPLICATION_CV_INELIGIBLE");

  expect(prepared.cleanup).toHaveBeenCalledOnce();
});
