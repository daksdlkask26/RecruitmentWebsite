import fs from "node:fs";
import { spawn } from "node:child_process";

const target = "candidate_phase5_final_20260917_e2e_test";
const envText = fs.readFileSync(".env.local", "utf8");
function sourceUrl(name) {
  const line = envText
    .split(/\r?\n/u)
    .find((value) => value.startsWith(`${name}=`));
  if (!line) throw new Error(`${name}_MISSING`);
  const url = new URL(line.slice(name.length + 1));
  url.pathname = `/${target}`;
  return url.toString();
}

const databaseUrl = sourceUrl("DATABASE_URL");
const directUrl = sourceUrl("DIRECT_URL");
const verifiedDatabase = decodeURIComponent(
  new URL(databaseUrl).pathname.replace(/^\//u, ""),
);
if (
  verifiedDatabase !== target ||
  !/(?:^|[-_])(test|tests|spec|e2e)(?:[-_]|$)/iu.test(verifiedDatabase)
) {
  throw new Error("ISOLATED_DATABASE_VERIFICATION_FAILED");
}

const [executable, ...arguments_] = process.argv.slice(2);
if (!executable) throw new Error("COMMAND_REQUIRED");
const child = spawn(executable, arguments_, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: directUrl,
    PHASE5_DB_NAME: target,
    SMART_HIRE_TEST_DATABASE_REQUIRED: "1",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
