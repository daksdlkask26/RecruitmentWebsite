import "server-only";

export type AdminWorkerLoop = {
  name:
    | "snapshot"
    | "evidence"
    | "verification-deadline"
    | "verification-admin-notification-reconcile"
    | "business-verification-preparation-cleanup"
    | "notification"
    | "verification-notification"
    | "in-app-notification-retention"
    | "retention"
    | "support"
    | "connections"
    | "job-post-lifecycle"
    | "job-review-retention"
    | "team-application-retention"
    | "candidate-cv-artifact-reconciliation"
    | "company-deletion-reconciliation"
    | "backup";
  intervalMs: number;
  run(now: Date): Promise<unknown>;
};

export class AdminWorkerRuntime {
  private timers: ReturnType<typeof setInterval>[] = [];
  private active = new Set<Promise<unknown>>();
  private stopping = false;
  constructor(private readonly loops: readonly AdminWorkerLoop[]) {}

  async probe(now = new Date()) {
    const results = await Promise.allSettled(
      this.loops.map(async (loop) => ({
        name: loop.name,
        result: await loop.run(now),
      })),
    );
    return results.map((result, index) => ({
      name: this.loops[index]?.name,
      ready: result.status === "fulfilled",
    }));
  }

  start() {
    this.stopping = false;
    for (const loop of this.loops) {
      const timer = setInterval(() => {
        if (this.stopping) return;
        const run = loop.run(new Date()).catch(() => undefined);
        this.active.add(run);
        void run.finally(() => this.active.delete(run));
      }, loop.intervalMs);
      this.timers.push(timer);
    }
  }

  async stop(timeoutMs = 15_000) {
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (!this.active.size) return { drained: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const drained = await Promise.race([
      Promise.allSettled([...this.active]).then(() => true),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    return { drained };
  }
}
