import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export type CandidatePhase3BrowserFixture = {
  candidateEmail: string;
  employerEmail: string;
  company: { id: string };
  userIds: string[];
  suffix: string;
  companyIds: string[];
  companyTwoId: string;
  companyThreeId: string;
  applicationId: string;
  activeJobId: string;
  ordinaryApplicationCount: number;
  teamApplicationCount: number;
};

export async function runCandidatePhase3E2EControl<T = unknown>(
  command: "create" | "delete",
  payload: unknown = null,
) {
  const script = resolve(
    process.cwd(),
    "tests/helpers/candidate-phase3-e2e-control.mjs",
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
  return JSON.parse(stdout) as T;
}
