import { performance } from "node:perf_hooks";

import { checkCvScanner } from "./check-cv-scanner.mjs";
import { ClamAvScanner } from "../src/backend/cv/scanning/clamav.ts";

const SOCKET_PATH = "/run/clamav/clamd.sock";
const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

async function* bytes(value) {
  yield Buffer.from(value, "utf8");
}

const timed = async (operation) => {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 };
};

const startedAt = new Date().toISOString();
const readiness = await timed(() => checkCvScanner());
const scanner = new ClamAvScanner({ socketPath: SOCKET_PATH });
const clean = await timed(() => scanner.scan(bytes("%PDF-1.4\\n% candidate-first clean fixture\\n")));
const infected = await timed(() => scanner.scan(bytes(EICAR)));
const metadata = scanner.assessmentMetadata();

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  startedAt,
  evidenceClass:
    process.env.CF003_SHARED_SERVICE === "1"
      ? "shared-service-live"
      : "isolated-test-service",
  status:
    readiness.value.signatureFresh &&
    clean.value.outcome === "CLEAN" &&
    infected.value.outcome === "INFECTED"
      ? "PASS"
      : "FAIL",
  transport: readiness.value.transport,
  engine: readiness.value.engine,
  socketPath: SOCKET_PATH,
  readiness: {
    status: "PASS",
    durationMs: readiness.durationMs,
    signatureFresh: readiness.value.signatureFresh,
  },
  scanCases: [
    {
      name: "synthetic-pdf",
      expected: "CLEAN",
      actual: clean.value.outcome,
      durationMs: clean.durationMs,
      engineVersion:
        clean.value.outcome === "CLEAN" ? clean.value.engineVersion : null,
    },
    {
      name: "eicar-test-string",
      expected: "INFECTED",
      actual: infected.value.outcome,
      failureCode:
        infected.value.outcome === "INFECTED" ? infected.value.threatCode : null,
      durationMs: infected.durationMs,
    },
  ],
  signature: metadata
    ? {
        engineVersion: metadata.engineVersion,
        signatureVersion: metadata.signatureVersion,
        publishedAt: metadata.publishedAt.toISOString(),
      }
    : null,
  topology: {
    workerContainer:
      process.env.CF003_SCANNER_WORKER ?? "smarthire-cv-worker-1",
    clamavContainer:
      process.env.CF003_SCANNER_CONTAINER ?? "smarthire-clamav-1",
    database: process.env.CF003_DATABASE ?? "not-used-by-scanner-probe",
    storage: process.env.CF003_STORAGE ?? "not-used-by-scanner-probe",
  },
  limitations: [
    "The EICAR string is a harmless industry test signature and is not real malware.",
  ],
};

process.stdout.write(`${JSON.stringify(report)}\n`);

if (report.status !== "PASS") process.exitCode = 1;
