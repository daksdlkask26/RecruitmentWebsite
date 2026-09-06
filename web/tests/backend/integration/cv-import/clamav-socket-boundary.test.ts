import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The executable readiness module is intentionally plain ESM so the stripped
// worker image can run it without loading the application bundle.
import {
  validateCvScannerSocketMetadata,
  validateCvScannerVersion,
} from "../../../../scripts/check-cv-scanner.mjs";

const repositoryRoot = resolve(process.cwd(), "..");

function docker(args: string[]) {
  return spawnSync(process.env.CF003_DOCKER_BIN ?? "docker", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
}

describe("ClamAV Unix-socket boundary", () => {
  it("keeps signature updates alive while clamd fails closed and retries", async () => {
    const entrypoint = await readFile(
      resolve(repositoryRoot, "infra/clamav/entrypoint.sh"),
      "utf8",
    );
    const clamdConfiguration = await readFile(
      resolve(repositoryRoot, "infra/clamav/clamd.conf"),
      "utf8",
    );

    const synchronousRefresh = entrypoint.indexOf("if ! freshclam");
    const clamdStart = entrypoint.indexOf(
      'clamd --foreground --config-file="${CLAMD_CONFIG}" &',
    );
    const daemonRefresh = entrypoint.indexOf("freshclam \\\n    --daemon \\");
    const daemonStart = entrypoint.indexOf(
      "\nstart_freshclam\n",
      synchronousRefresh,
    );

    expect(synchronousRefresh).toBeGreaterThan(-1);
    expect(daemonRefresh).toBeGreaterThan(-1);
    expect(daemonStart).toBeGreaterThan(synchronousRefresh);
    expect(clamdStart).toBeGreaterThan(daemonStart);
    expect(entrypoint).toContain("has_signature_database");
    expect(entrypoint).toContain(
      "ClamAV signatures already cached; skipping initial refresh.",
    );
    expect(entrypoint).toContain("if ! freshclam");
    expect(entrypoint).toContain("#!/bin/sh\nset -eu");
    expect(entrypoint).toContain(
      'readonly RESTART_DELAY="${CLAMD_RESTART_DELAY_SECONDS:-60}"',
    );
    expect(entrypoint).toContain("while true; do");
    expect(entrypoint).toContain("ensure_freshclam");
    expect(entrypoint).toContain(
      "signatures remain fail-closed and startup will retry",
    );
    expect(entrypoint).not.toContain(
      "clamd exited before creating its Unix socket",
    );
    expect(clamdConfiguration).toMatch(/^FailIfCvdOlderThan 2$/mu);
  });

  it("keeps the Compose socket private to clamd and the CV worker", async () => {
    const source = await readFile(
      resolve(repositoryRoot, "compose.yaml"),
      "utf8",
    );
    expect(source).toContain("clamav_runtime:/run/clamav");
    expect(source).toContain("CV_CLAMD_SOCKET_PATH: /run/clamav/clamd.sock");
    expect(source).toContain("CV_STORAGE_LOCAL_ROOT: /app/.local/cv-storage");
    expect(source).toContain("@postgres:5432/");

    const rendered = docker(["compose", "config", "--format", "json"]);
    if (rendered.status !== 0) {
      throw new Error("CV_CONTAINER_COMPOSE_CONFIG_FAILED");
    }
    const configuration = JSON.parse(rendered.stdout) as {
      services: Record<
        string,
        { volumes?: Array<{ target?: string }>; ports?: unknown[] }
      >;
    };
    expect(configuration.services.clamav?.ports ?? []).toHaveLength(0);
    expect(configuration.services["cv-worker"]?.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "/run/clamav" }),
        expect.objectContaining({ target: "/app/.local/cv-storage" }),
      ]),
    );
    for (const service of ["web", "email", "email-worker"]) {
      expect(
        configuration.services[service]?.volumes?.some(
          (volume) => volume.target === "/run/clamav",
        ) ?? false,
      ).toBe(false);
    }
  });

  it("fails closed for wrong socket ownership/mode and stale signatures", () => {
    const valid = {
      isSocket: () => true,
      uid: 100,
      gid: 101,
      mode: 0o140660,
    };
    expect(() => validateCvScannerSocketMetadata(valid, [101])).not.toThrow();
    expect(() =>
      validateCvScannerSocketMetadata({ ...valid, mode: 0o140666 }, [101]),
    ).toThrow("mode must be exactly 0660");
    expect(() =>
      validateCvScannerSocketMetadata(
        { ...valid, isSocket: () => false },
        [101],
      ),
    ).toThrow("not a Unix socket");
    expect(() => validateCvScannerSocketMetadata(valid, [])).toThrow(
      "not a member",
    );

    const now = new Date("2026-08-01T12:00:00.000Z");
    expect(() =>
      validateCvScannerVersion(
        "ClamAV 1.4.5/fixture/Fri Jul 31 13:00:00 2026 GMT",
        now,
      ),
    ).not.toThrow();
    expect(() =>
      validateCvScannerVersion(
        "ClamAV 1.4.5/fixture/Thu Jul 30 11:59:59 2026 GMT",
        now,
      ),
    ).toThrow("older than 24 hours");
    expect(() => validateCvScannerVersion("unavailable", now)).toThrow(
      "engine version",
    );
  });

  it.runIf(process.env.CV_CONTAINER_TESTS === "true")(
    "passes the live same-host worker/clamd boundary probe",
    () => {
      const socket = docker([
        "compose",
        "exec",
        "-T",
        "clamav",
        "sh",
        "-c",
        "stat -c '%u:%g:%a:%F' /run/clamav/clamd.sock",
      ]);
      expect(socket.status, socket.stderr).toBe(0);
      expect(socket.stdout.trim()).toBe("100:101:660:socket");

      const tcp = docker([
        "compose",
        "exec",
        "-T",
        "clamav",
        "sh",
        "-c",
        "grep -E ':0CEE|:1CBD' /proc/net/tcp /proc/net/tcp6",
      ]);
      expect(tcp.status).not.toBe(0);

      const probe = docker([
        "compose",
        "exec",
        "-T",
        "cv-worker",
        "node",
        "scripts/run-cv-worker.mjs",
        "--probe",
      ]);
      expect(probe.status, `${probe.stdout}\n${probe.stderr}`).toBe(0);
      expect(probe.stdout).toContain("CV worker probe passed");
    },
    120_000,
  );
});
