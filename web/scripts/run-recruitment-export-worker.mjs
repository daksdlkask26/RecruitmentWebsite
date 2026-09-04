import nextEnv from "@next/env";

// Standalone workers do not pass through the custom server's loadEnvConfig call.
// Load the same local/container environment before importing server-only modules.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const watch = process.argv.includes("--watch");
const probe = process.argv.includes("--probe");
let stopping = false;
let processed = 0;

const stop = () => {
  stopping = true;
};

if (watch) {
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (process.platform === "win32") process.once("SIGBREAK", stop);
}

if (probe) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_NOT_CONFIGURED");
  }
  console.log(
    JSON.stringify(
      { worker: "recruitment-analytics-export", ready: true, mode: "probe" },
      null,
      2,
    ),
  );
} else {
  const workerModule =
    await import("../src/backend/exports/candidate-export-worker.ts");
  const worker = new workerModule.CandidateExportWorker();
  while (!stopping) {
    const didProcess = await worker.runOnce();
    if (didProcess) {
      processed += 1;
      continue;
    }
    if (!watch) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  console.log(
    JSON.stringify(
      {
        worker: "recruitment-analytics-export",
        ready: true,
        mode: watch ? "lease-aware-watch" : "lease-aware",
        processed,
      },
      null,
      2,
    ),
  );
}
