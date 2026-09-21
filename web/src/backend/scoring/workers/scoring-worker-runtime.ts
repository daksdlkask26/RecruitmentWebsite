import "server-only";

import { ScoringWorker } from "./scoring-worker";
import { createScoringWorkProcessor } from "./scoring-work-processor";

export class ScoringWorkerRuntime {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private activeTick: Promise<void> | null = null;
  private readonly worker = new ScoringWorker(
    undefined,
    createScoringWorkProcessor(),
  );

  start(intervalMilliseconds = 2_000) {
    if (this.timer) return;
    void this.beginTick();
    this.timer = setInterval(() => void this.beginTick(), intervalMilliseconds);
    this.timer.unref?.();
  }

  async stop(timeoutMs = 15_000) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const active = this.activeTick;
    if (!active) return { drained: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const drained = await Promise.race([active.then(() => true), timeout]);
    if (timer) clearTimeout(timer);
    return { drained };
  }

  private beginTick() {
    if (this.running && this.activeTick) return this.activeTick;
    const active = this.tick();
    this.activeTick = active;
    void active.finally(() => {
      if (this.activeTick === active) this.activeTick = null;
    });
    return active;
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
