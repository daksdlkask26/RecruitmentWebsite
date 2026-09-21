import "server-only";

import { CandidateExportWorker } from "./candidate-export-worker";

const maxJobsPerTick = 10;

/**
 * Runs the leased export worker inside the long-lived application process.
 * Database leases still make it safe to run an additional dedicated worker.
 */
export class CandidateExportWorkerRuntime {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private activeTick: Promise<void> | null = null;

  constructor(private readonly worker = new CandidateExportWorker()) {}

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
      for (let index = 0; index < maxJobsPerTick; index += 1) {
        if (!(await this.worker.runOnce())) break;
      }
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "EXPORT_RUNTIME_FAILED";
      console.error("[analytics-export] " + code);
    } finally {
      this.running = false;
    }
  }
}
