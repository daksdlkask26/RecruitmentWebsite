import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const { assertTestDatabaseEnvironment } =
  await import("../tests/helpers/test-database-guard.ts");
assertTestDatabaseEnvironment();

const workspace = resolve(process.cwd());
const port = process.env.PHASE7_BROWSER_PORT ?? "3107";
const nextDistDir = process.env.PHASE7_NEXT_DIST_DIR ?? ".next-phase7";
const playwrightConfig = process.env.PHASE7_PLAYWRIGHT_CONFIG;
const playwrightProject = process.env.PHASE7_PLAYWRIGHT_PROJECT;
const playwrightGrep = process.env.PHASE7_PLAYWRIGHT_GREP;
const playwrightCli = fileURLToPath(
  new URL("../../node_modules/@playwright/test/cli.js", import.meta.url),
);
const specs = process.argv.slice(2);
const selectedSpecs = specs.length
  ? specs
  : [
      "tests/system/e2e/candidate-first/candidate-first-smoke.spec.ts",
      "tests/system/e2e/candidate-first/candidate-phase3.spec.ts",
    ];

const browserEnvironment = {
  ...process.env,
  EMAIL_ADAPTER: "capture",
  NODE_ENV: "production",
  HOSTNAME: "127.0.0.1",
  PORT: port,
  NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  CANDIDATE_ORIGIN: `http://localhost:${port}`,
  ADMIN_ORIGIN: `http://console.admin.localhost:${port}`,
  RECRUITER_ORIGIN: `http://console.recruiter.localhost:${port}`,
  PHASE5_NEXT_DIST_DIR: nextDistDir,
  PHASE7_NEXT_DIST_DIR: nextDistDir,
  PLAYWRIGHT_APP_ONLY: "1",
  PLAYWRIGHT_PRODUCTION: "1",
  PLAYWRIGHT_REUSE_SERVER: "1",
  PLAYWRIGHT_PORT: port,
  RUN_CANDIDATE_FIRST_E2E: "1",
  RUN_CANDIDATE_PHASE3_E2E: "1",
};

let server;

function waitForServer(child) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectReady(new Error("PHASE7_BROWSER_SERVER_TIMEOUT"));
    }, 120_000);
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
      if (stdout.includes("SmartHire ready at")) settle(resolveReady);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.once("error", (error) => settle(rejectReady, error));
    child.once("exit", (code) => {
      if (code !== 0) {
        settle(
          rejectReady,
          new Error(
            `PHASE7_BROWSER_SERVER_EXIT_${code ?? "unknown"}: ${stderr
              .trim()
              .slice(-2_000)}`,
          ),
        );
      }
    });
  });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      if (server && server.exitCode === null) server.kill("SIGKILL");
      resolveExit();
    }, 10_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

function runPlaywright() {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        playwrightCli,
        "test",
        ...(playwrightConfig ? ["--config", playwrightConfig] : []),
        ...selectedSpecs,
        ...(playwrightProject ? [`--project=${playwrightProject}`] : []),
        ...(playwrightGrep ? ["--grep", playwrightGrep] : []),
        "--workers=1",
        "--retries=0",
        "--reporter=line",
      ],
      {
        cwd: workspace,
        env: browserEnvironment,
        stdio: "inherit",
      },
    );
    child.once("error", rejectResult);
    child.once("exit", (code) => resolveResult(code ?? 1));
  });
}

let exitCode;
try {
  server = spawn(
    process.execPath,
    [
      "--import",
      "./scripts/register-server-runtime.mjs",
      "--import",
      "tsx",
      "scripts/run-phase6a-production-server.mjs",
    ],
    {
      cwd: workspace,
      env: browserEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(server);
  exitCode = await runPlaywright();
} finally {
  await stopServer();
}

process.exit(exitCode);
