import "server-only";

import { ScoringWorker } from "./scoring-worker";
import { createScoringWorkProcessor } from "./scoring-work-processor";

export class ScoringWorkerRuntime {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly worker = new ScoringWorker(
    undefined,
    createScoringWorkProcessor(),
  );

  start(intervalMilliseconds = 2_000) {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMilliseconds);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (let index = 0; index < 10; index++) {
        const result = await this.worker.runOnce("application-scoring-runtime");
        if (result.state === "IDLE") break;
      }
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "SCORING_RUNTIME_FAILED";
      console.error(`[application-scoring] ${code}`);
    } finally {
      this.running = false;
    }
  }
}
