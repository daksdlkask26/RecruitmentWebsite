import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "..");
const reviewedClamAvDigest =
  "sha256:aeac907bb9445b12c1dd76f9283415272d8dcd596d402245ed13729d7181bb8a";
const reviewedWorkerBaseDigest =
  "sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436";

const reviewedPackages = {
  "@aws-sdk/client-s3": { version: "3.1101.0", license: "Apache-2.0" },
  "pdfjs-dist": { version: "6.2.108", license: "Apache-2.0" },
  mammoth: { version: "1.12.0", license: "BSD-2-Clause" },
  yauzl: { version: "3.4.0", license: "MIT" },
  "fast-xml-parser": { version: "5.10.1", license: "MIT" },
  openai: { version: "7.3.0", license: "Apache-2.0" },
  "@types/yauzl": { version: "3.4.0", license: "MIT" },
} as const;

function run(
  command: string,
  args: readonly string[],
  options?: { timeout?: number; acceptedStatuses?: readonly number[] },
): string {
  const useNpmCli = command === "npm" && Boolean(process.env.npm_execpath);
  const executable = useNpmCli ? process.execPath : command;
  const commandArguments = useNpmCli
    ? [process.env.npm_execpath as string, ...args]
    : [...args];
  const result = spawnSync(executable, commandArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: options?.timeout ?? 30_000,
    windowsHide: true,
  });
  if (
    result.status !== 0 &&
    !options?.acceptedStatuses?.includes(result.status ?? Number.NaN)
  ) {
    throw new Error(
      `Compatibility command failed safely: ${command} ${args.join(" ")} (exit ${result.status ?? "unknown"})`,
    );
  }
  return result.stdout.trim();
}

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter(
          (entry) =>
            ![".git", ".local", ".next", "node_modules"].includes(entry.name),
        )
        .map((entry) => {
          const path = join(root, entry.name);
          return entry.isDirectory() ? files(path) : Promise.resolve([path]);
        }),
    )
  ).flat();
}

describe.sequential("Feature 004 dependency and infrastructure gate", () => {
  it("uses the exact reviewed runtime, package versions, and licenses", async () => {
    expect(process.versions.node).toMatch(/^24[.]18[.]/);

    const webPackage = JSON.parse(
      await readFile(resolve(repositoryRoot, "web/package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    for (const [packageName, reviewed] of Object.entries(reviewedPackages)) {
      const declared =
        webPackage.dependencies[packageName] ??
        webPackage.devDependencies[packageName];
      expect(declared, packageName).toBe(reviewed.version);

      const installedPackage = JSON.parse(
        await readFile(
          resolve(
            repositoryRoot,
            "node_modules",
            ...packageName.split("/"),
            "package.json",
          ),
          "utf8",
        ),
      ) as { version: string; license: string };
      expect(installedPackage.version, packageName).toBe(reviewed.version);
      expect(installedPackage.license, packageName).toBe(reviewed.license);
    }
  });

  it("keeps one root lockfile and has no npm high or critical advisory", async () => {
    const lockfiles = (await files(repositoryRoot)).filter(
      (path) =>
        !path.includes(`${join("node_modules", "")}`) &&
        path.endsWith("package-lock.json"),
    );
    expect(lockfiles.map((path) => relative(repositoryRoot, path))).toEqual([
      "package-lock.json",
    ]);

    const audit = JSON.parse(
      run("npm", ["audit", "--json", "--package-lock-only"], {
        timeout: 180_000,
        // npm exits 1 when moderate advisories remain; this gate asserts the
        // reviewed high/critical boundary from the JSON report below.
        acceptedStatuses: [1],
      }),
    ) as {
      metadata: {
        vulnerabilities: { high: number; critical: number };
      };
    };
    expect(audit.metadata.vulnerabilities.high).toBe(0);
    expect(audit.metadata.vulnerabilities.critical).toBe(0);
  }, 190_000);

  it("loads the strict parser JSON Schema and keeps reviewed packages server-only", async () => {
    const schema = JSON.parse(
      await readFile(
        resolve(
          repositoryRoot,
          "spec-kit/specs/004-cv-upload-parse-review/contracts/cv-parser-output.schema.json",
        ),
        "utf8",
      ),
    ) as {
      $schema: string;
      additionalProperties: boolean;
      required: string[];
      properties: { schemaVersion: { const: string } };
    };
    expect(schema.$schema).toContain("2020-12");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.schemaVersion.const).toBe("cv-draft-v1");
    expect(schema.required).toEqual([
      "schemaVersion",
      "scalars",
      "experiences",
      "education",
      "skills",
      "socialLinks",
    ]);

    const packagePattern =
      /(?:from\s+|import\s*\(|require\s*\()["'](?:@aws-sdk\/client-s3|pdfjs-dist|mammoth|yauzl|fast-xml-parser|openai)(?:\/|["'])/u;
    for (const boundary of ["src/app", "src/frontend", "src/shared"]) {
      for (const path of await files(resolve(process.cwd(), boundary))) {
        if (![".ts", ".tsx", ".js", ".mjs"].includes(extname(path))) continue;
        expect(await readFile(path, "utf8"), path).not.toMatch(packagePattern);
      }
    }
  });

  it("pins the reviewed scanner and worker base images with private topology", async () => {
    const composeSource = await readFile(
      resolve(repositoryRoot, "compose.yaml"),
      "utf8",
    );
    const dockerfile = await readFile(
      resolve(repositoryRoot, "web/Dockerfile.cv-worker"),
      "utf8",
    );
    expect(composeSource).toContain(
      `clamav/clamav:1.4_base@${reviewedClamAvDigest}`,
    );
    expect(dockerfile).toContain(
      `node:24.18.0-alpine3.23@${reviewedWorkerBaseDigest}`,
    );
    expect(composeSource).not.toMatch(/clamav:[\s\S]*?ports:/u);

    const compose = JSON.parse(
      run("docker", ["compose", "config", "--format", "json"]),
    ) as {
      services: Record<
        string,
        {
          environment?: Record<string, string>;
          group_add?: string[];
          volumes?: Array<{ target: string }>;
        }
      >;
    };
    const worker = compose.services["cv-worker"];
    const scanner = compose.services.clamav;
    expect(worker.environment?.DATABASE_URL?.includes("@postgres:5432/")).toBe(
      true,
    );
    expect(worker.environment?.CV_STORAGE_LOCAL_ROOT).toBe(
      "/app/.local/cv-storage",
    );
    expect(worker.environment?.CV_CLAMD_SOCKET_PATH).toBe(
      "/run/clamav/clamd.sock",
    );
    expect(worker.environment?.IMAGE_SEARCH_STORAGE_LOCAL_ROOT).toBe(
      "/app/.local/image-search-storage",
    );
    expect(
      worker.volumes?.some(
        (volume) => volume.target === "/app/.local/image-search-storage",
      ) ?? false,
    ).toBe(false);
    expect(worker.group_add).toContain("101");
    expect(
      worker.volumes?.some((volume) => volume.target === "/run/clamav"),
    ).toBe(true);
    expect(
      scanner.volumes?.some((volume) => volume.target === "/run/clamav"),
    ).toBe(true);
    for (const serviceName of ["web", "email", "email-worker"]) {
      expect(
        compose.services[serviceName]?.volumes?.some(
          (volume) => volume.target === "/run/clamav",
        ) ?? false,
      ).toBe(false);
    }
  });

  it("proves the live Unix socket mode/group and absence of scanner TCP exposure", () => {
    expect(
      run("docker", [
        "compose",
        "exec",
        "-T",
        "clamav",
        "sh",
        "-c",
        "clamd --version && stat -c '%a:%u:%g:%F' /run/clamav/clamd.sock && clamdscan --config-file=/etc/clamav/clamd.conf --no-summary /tmp/.clamd-health",
      ]),
    ).toMatch(/ClamAV 1[.]4[.]5[\s\S]*660:100:101:socket[\s\S]*OK/u);
    run("docker", [
      "compose",
      "exec",
      "-T",
      "clamav",
      "sh",
      "-c",
      "! grep -qiE ':(0CEE|1CBD) ' /proc/net/tcp /proc/net/tcp6 2>/dev/null",
    ]);
    expect(run("docker", ["port", "smarthire-clamav-1"])).toBe("");

    const inspected = JSON.parse(
      run("docker", ["inspect", "smarthire-clamav-1"]),
    ) as Array<{
      HostConfig: {
        Memory: number;
        PortBindings: Record<string, unknown>;
      };
    }>;
    expect(inspected[0].HostConfig.Memory).toBe(4 * 1024 * 1024 * 1024);
    expect(inspected[0].HostConfig.PortBindings).toEqual({});
  }, 60_000);

  it("passes the container-native probe on the running worker service", () => {
    expect(
      run(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          "cv-worker",
          "node",
          "scripts/run-cv-worker.mjs",
          "--probe",
        ],
        { timeout: 90_000 },
      ),
    ).toContain(
      "CV worker probe passed for PostgreSQL, private storage, and Unix-socket scanner access.",
    );
    expect(
      run("docker", [
        "compose",
        "exec",
        "-T",
        "cv-worker",
        "node",
        "--version",
      ]),
    ).toBe("v24.18.0");
  }, 120_000);

  it("has no unreviewed high or critical container vulnerability", () => {
    for (const image of [
      `clamav/clamav:1.4_base@${reviewedClamAvDigest}`,
      "smarthire-cv-worker:local",
    ]) {
      run(
        "docker",
        [
          "scout",
          "cves",
          "--only-severity",
          "critical,high",
          "--exit-code",
          image,
        ],
        { timeout: 180_000 },
      );
    }
  }, 360_000);
});
