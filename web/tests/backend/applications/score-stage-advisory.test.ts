import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ApplicationStageService } from "@/backend/services/jobs/application-stage-service";
import { automaticScoreBand } from "@/backend/applications/services/automatic-score-stage-config";

describe("score stage advisory boundary", () => {
  it.each([
    [59.9, "LOW_MATCH"],
    [60, "MEDIUM_MATCH"],
    [80, "HIGH_MATCH"],
  ] as const)("classifies %s as advisory band %s", (score, code) => {
    expect(automaticScoreBand(score).code).toBe(code);
  });

  it("has no production score-to-stage writer or legacy system score actor", () => {
    const files = [
      "src/backend/applications/services/mark-application-viewed.ts",
      "src/backend/applications/services/open-application-document.ts",
      "src/backend/applications/services/recruitment-pipeline-board.ts",
      "src/backend/scoring/services/scoring-detail-service.ts",
      "src/backend/scoring/workers/scoring-worker.ts",
      "src/backend/scoring/workers/scoring-worker-runtime.ts",
      "src/backend/services/jobs/application-stage-service.ts",
    ].map((path) => readFileSync(path, "utf8"));
    expect(files.join("\n")).not.toContain("system_auto_score");
    expect(files.join("\n")).not.toContain("AUTOMATIC_SCORE_RULE");
    expect(files.join("\n")).not.toContain("applyAutomatic");
  });

  it.each(["system_auto_score", "system_capacity_check"] as const)(
    "rejects a non-human stage actor at the public authority boundary: %s",
    async (kind) => {
      const findUnique = vi.fn();
      const service = new ApplicationStageService({
        jobApplication: { findUnique },
      } as never);

      await expect(
        service.attemptStageTransition({
          candidateApplicationId: "application-1",
          targetStage: "REJECTED",
          actor: { kind } as never,
        }),
      ).rejects.toMatchObject({
        status: 403,
        body: { code: "APPLICATION_STAGE_ACTOR_INVALID" },
      });
      expect(findUnique).not.toHaveBeenCalled();
    },
  );
});
