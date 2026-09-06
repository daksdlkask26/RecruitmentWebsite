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
    | "backup";
  intervalMs: number;
  run(now: Date): Promise<unknown>;
};

export class AdminWorkerRuntime {
  private timers: ReturnType<typeof setInterval>[] = [];
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
    for (const loop of this.loops) {
      const timer = setInterval(
        () => void loop.run(new Date()).catch(() => undefined),
        loop.intervalMs,
      );
      this.timers.push(timer);
    }
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}
