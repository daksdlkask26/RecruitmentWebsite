import "server-only";

import { spawn } from "node:child_process";

const maxBackupBytes = 512 * 1024 * 1024;

function connectionEnvironment() {
  const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  delete environment.DIRECT_URL;
  delete environment.DATABASE_URL_UNPOOLED;
  environment.PGHOST = url.hostname;
  if (url.port) environment.PGPORT = url.port;
  environment.PGUSER = decodeURIComponent(url.username);
  environment.PGPASSWORD = decodeURIComponent(url.password);
  environment.PGDATABASE = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

export async function createPostgresBackup(
  options: Readonly<{
    timeoutMs?: number;
    maxBytes?: number;
  }> = {},
) {
  const timeoutMs = options.timeoutMs ?? 8 * 60_000;
  const maximumBytes = options.maxBytes ?? maxBackupBytes;
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-privileges"],
      { stdio: ["ignore", "pipe", "pipe"], env: connectionEnvironment() },
    );
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let byteCount = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref?.();
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      byteCount += chunk.byteLength;
      if (byteCount > maximumBytes) {
        child.kill("SIGTERM");
        return;
      }
      output.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(Buffer.concat(errors)) < 1_000_000)
        errors.push(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("BACKUP_DUMP_UNAVAILABLE"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("BACKUP_DUMP_TIMEOUT"));
      if (byteCount > maximumBytes)
        return reject(new Error("BACKUP_DUMP_TOO_LARGE"));
      if (code === 0) return resolve(Buffer.concat(output));
      const detail = Buffer.concat(errors).toString("utf8").toLowerCase();
      if (detail.includes("password authentication failed"))
        return reject(new Error("BACKUP_DATABASE_AUTH_FAILED"));
      if (detail.includes("connection") || detail.includes("could not connect"))
        return reject(new Error("BACKUP_DATABASE_UNAVAILABLE"));
      reject(new Error("BACKUP_DUMP_FAILED"));
    });
  });
}
