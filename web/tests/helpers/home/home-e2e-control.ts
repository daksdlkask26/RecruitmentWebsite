import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export type HomeE2EDatabaseFixture = {
  now: string;
  suffix: string;
  company: { id: string; displayName: string };
  userIds: string[];
  jobs: {
    active: { id: string; slug: string; title: string };
    activeSecond: { id: string; slug: string; title: string };
    pending: { id: string; slug: string; title: string };
  };
};

export type HomeE2EFixture = {
  databaseFixture: HomeE2EDatabaseFixture;
  candidate: { id: string; email: string; name: string };
  employer: { id: string; email: string; name: string };
};

export async function runHomeE2EControl<T>(
  command:
    | "create"
    | "delete"
    | "expire-user"
    | "deactivate-company"
    | "close-authoritative-job"
    | "ban-authoritative-company"
    | "unban-authoritative-company"
    | "expire-job-for-race"
    | "set-language"
    | "public-job-count",
  payload: unknown = null,
) {
  const script = resolve(
    process.cwd(),
    "tests/helpers/home/home-e2e-control.mjs",
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
  // Authoritative services emit structured operational events through
  // console.info. The control process writes its result as the final JSON
  // line, so parse that line without weakening the command's real output.
  const resultLine = stdout.trim().split(/\r?\n/u).at(-1);
  if (!resultLine) throw new Error("Home E2E control returned no result");
  return JSON.parse(resultLine) as T;
}
