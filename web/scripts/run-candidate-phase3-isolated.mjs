import fs from "node:fs";
import { spawn } from "node:child_process";

const targetDatabase = "candidate_phase3_test_20260911";
const sourceLine = fs
  .readFileSync(".env.local", "utf8")
  .split(/\r?\n/u)
  .find((value) => value.startsWith("DATABASE_URL="));
if (!sourceLine) throw new Error("DATABASE_URL_MISSING");

const testUrl = new URL(sourceLine.slice("DATABASE_URL=".length));
testUrl.pathname = `/${targetDatabase}`;
const effectiveDatabase = testUrl.pathname.replace(/^\//u, "");
if (
  effectiveDatabase !== targetDatabase ||
  /(?:^|[-_])(test|tests|spec|e2e)(?:[-_]|$)/iu.test(effectiveDatabase) ===
    false
) {
  throw new Error("ISOLATED_DATABASE_VERIFICATION_FAILED");
}

process.env.DATABASE_URL = testUrl.toString();
process.env.DIRECT_URL = testUrl.toString();
process.env.SMART_HIRE_TEST_DATABASE_REQUIRED = "1";
console.log(`isolated-db=${effectiveDatabase}`);

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(executable, process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
