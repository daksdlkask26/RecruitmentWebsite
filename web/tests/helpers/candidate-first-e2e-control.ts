import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export async function runCandidateFirstE2EControl<T>(
  command: "create" | "delete",
  payload: unknown = null,
) {
  const script = resolve(
    process.cwd(),
    "tests/helpers/candidate-first-e2e-control.mjs",
  );
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", script, command, encoded],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    },
  );
  const result = JSON.parse(stdout) as T;
  if (
    command === "delete" &&
    result &&
    typeof result === "object" &&
    "storageCleanupError" in result &&
    result.storageCleanupError
  ) {
    throw new Error(
      `Candidate-first storage cleanup failed: ${String(result.storageCleanupError)}`,
    );
  }
  return result;
}
