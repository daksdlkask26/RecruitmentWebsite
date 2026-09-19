import { describe, expect, it } from "vitest";
import { PrivateMatchRetentionService } from "@/backend/private-cv-match/private-match-retention";

describe("private CV match retention", () => {
  it("delegates expiry with the controlled deadline and batch limit", async () => {
    const calls: unknown[] = [];
    const service = new PrivateMatchRetentionService({
      expireDueChecks: async (now: Date, limit: number) => {
        calls.push([now, limit]);
        return 3;
      },
    } as never);
    const now = new Date("2027-08-16T00:00:00.000Z");

    await expect(service.expire(now, 25)).resolves.toBe(3);
    expect(calls).toEqual([[now, 25]]);
  });

  it("claims and physically removes due checks with bounded retry handling", async () => {
    const claims = ["pmc-1", "pmc-2", null];
    const deleted: string[] = [];
    const failures: string[] = [];
    const service = new PrivateMatchRetentionService({
      claimCleanup: async () => claims.shift() ?? null,
      physicallyDeleteClaimed: async (checkId: string) => {
        if (checkId === "pmc-2")
          throw new Error("storage temporarily unavailable");
        deleted.push(checkId);
        return true;
      },
      recordCleanupFailure: async (checkId: string) => {
        failures.push(checkId);
        return true;
      },
    } as never);

    await expect(
      service.cleanup("retention-worker", new Date(), 10),
    ).resolves.toEqual({
      claimed: 2,
      deleted: 1,
    });
    expect(deleted).toEqual(["pmc-1"]);
    expect(failures).toEqual(["pmc-2"]);
  });
});
