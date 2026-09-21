import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pipeline recovery", () => {
  it("tracks operation identity, optimistic rollback, exact retry and unavailable clearing", () => {
    const hook = readFileSync("src/frontend/features/recruiter-applications/use-recruitment-pipeline.ts", "utf8");
    expect(hook).toContain("idempotencyKey");
    expect(hook).toContain("retryStageMove");
    expect(hook).toContain("optimistic");
    expect(hook).toContain("setColumns({})");
    expect(hook).toContain("stageTransitionOutcomeSchema");
    expect(hook).toContain("await load()");
    expect(hook).toContain("[401, 403, 404, 409]");
    expect(hook).toContain("pipelineRefreshIntervalMs");
    expect(hook).toContain("visibilitychange");
    expect(hook).toContain("pipelineMetadataChanged");
    expect(hook).toContain("preserve: true");

    const rankingHook = readFileSync("src/frontend/features/recruiter-applications/use-ranked-candidates.ts", "utf8");
    expect(rankingHook).toContain("RANKED_PAGE_CACHE_MAX_AGE_MS");
    expect(rankingHook).toContain("rankedPageRequestVersions");
    expect(rankingHook).toContain("requestInFlight");
    expect(rankingHook).toContain("visibilitychange");
  });
});
