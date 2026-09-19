import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export type Phase5BrowserPrivateMatchIds = Readonly<{
  fullHigh: string;
  fullMedium: string;
  fullLow: string;
  limited: string;
  incompleteCv: string;
  incompleteJd: string;
  missingCriteria: string;
  evidenceEmpty: string;
  failedParse: string;
  queued: string;
  analyzing: string;
  retrying: string;
  retryFailure: string;
  expired: string;
  revoked: string;
  deleted: string;
}>;

export async function runPhase5BrowserControl<T>(
  command:
    | "seed"
    | "profile-empty"
    | "profile-restore"
    | "cleanup"
    | "expire-apply-job",
  payload: unknown = null,
) {
  const script = resolve(
    process.cwd(),
    "tests/helpers/phase5-browser-control.mjs",
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
  const resultLine = stdout.trim().split(/\r?\n/u).at(-1);
  if (!resultLine)
    throw new Error("Phase 5 browser control returned no result");
  return JSON.parse(resultLine) as T;
}
