import { expect, it, vi } from "vitest";

import {
  TeamApplicationCommandError,
  TeamApplicationService,
} from "@/backend/services/company-members/team-application-service";

it("fails closed for the removed plaintext Team Application submit contract", async () => {
  const prepared = {
    cleanup: vi.fn().mockResolvedValue(undefined),
  };

  await expect(
    new TeamApplicationService().submit(
      "candidate-1",
      "company-1",
      "RECRUITER",
      prepared as never,
    ),
  ).rejects.toMatchObject({
    code: "TEAM_APPLICATION_UNAVAILABLE",
  } satisfies Partial<TeamApplicationCommandError>);

  expect(prepared.cleanup).toHaveBeenCalledOnce();
});
