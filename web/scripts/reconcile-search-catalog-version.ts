import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { jobSearchCatalogIndex } from "../src/backend/services/search/catalogs/job-search-catalog-index";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const prepareDraft = args.has("--prepare-draft");
const confirmed = args.has("--confirm-catalog-sync");
const expectedActiveVersion = valueFor("--expected-active-version");
const outputPath = valueFor("--output");
let database:
  | typeof import("../src/backend/database/prisma").prisma
  | undefined;

function valueFor(name: string) {
  const prefix = `${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) || undefined;
}

async function writeReport(report: Record<string, unknown>) {
  if (!outputPath) return;
  const target = isAbsolute(outputPath)
    ? outputPath
    : resolve(process.cwd(), outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const { prisma } = await import("../src/backend/database/prisma");
  database = prisma;
  const expectedVersion = jobSearchCatalogIndex.catalog.version;
  const [active, candidate] = await Promise.all([
    prisma.searchCatalogVersion.findFirst({
      where: { isActive: true, status: "PUBLISHED" },
      select: { id: true, version: true, revision: true },
    }),
    prisma.searchCatalogVersion.findUnique({
      where: { version: expectedVersion },
      select: {
        id: true,
        version: true,
        status: true,
        isActive: true,
        revision: true,
      },
    }),
  ]);
  const drift = !active || active.version !== expectedVersion;
  const report: Record<string, unknown> = {
    schemaVersion: "search-catalog-version-reconcile-v1",
    generatedAt: new Date().toISOString(),
    mode: prepareDraft && apply ? "PREPARE_DRAFT" : "DRY_RUN",
    expectedCatalogVersion: expectedVersion,
    activeCatalog: active,
    candidate,
    drift,
    activationPerformed: false,
    publishRequired: drift,
    guard: {
      expectedActiveVersion: expectedActiveVersion ?? null,
      writesPerformed: false,
      activationForbidden: true,
    },
  };

  if (!prepareDraft || !apply) {
    await writeReport(report);
    console.log(
      `SEARCH_CATALOG_VERSION_RECONCILIATION\n${JSON.stringify(report, null, 2)}`,
    );
    return;
  }
  if (!confirmed) throw new Error("CATALOG_SYNC_CONFIRMATION_REQUIRED");
  if (!active) throw new Error("ACTIVE_CATALOG_REQUIRED");
  if (!expectedActiveVersion || expectedActiveVersion !== active.version) {
    throw new Error("ACTIVE_CATALOG_VERSION_GUARD_FAILED");
  }
  if (candidate?.status === "PUBLISHED" && !candidate.isActive) {
    throw new Error("INACTIVE_PUBLISHED_CANDIDATE_REQUIRES_LIFECYCLE");
  }
  // A retired candidate is immutable history. Re-running bootstrap for the
  // same semantic version would silently mutate its relational mirror, so a
  // version drift must be resolved by preparing a new release version and
  // publishing it through the authenticated lifecycle.
  if (candidate?.status === "RETIRED") {
    throw new Error("RETIRED_CATALOG_CANDIDATE_REQUIRES_NEW_RELEASE");
  }
  if (candidate?.status === "PUBLISHED" && candidate.isActive) {
    if (candidate.version !== active.version) {
      throw new Error("MULTIPLE_ACTIVE_CATALOGS");
    }
    await writeReport(report);
    console.log(
      `SEARCH_CATALOG_VERSION_RECONCILIATION\n${JSON.stringify(report, null, 2)}`,
    );
    return;
  }

  const child = await execFileAsync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/bootstrap-search-catalog.ts",
      "--apply",
    ],
    { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 },
  );
  report.bootstrapOutput = child.stdout.trim();
  report.bootstrapErrorOutput = child.stderr.trim() || null;
  report.activationPerformed = false;
  report.guard = {
    ...((report.guard as Record<string, unknown>) ?? {}),
    writesPerformed: true,
  };
  report.preparedAt = new Date().toISOString();
  await writeReport(report);
  console.log(
    `SEARCH_CATALOG_VERSION_RECONCILIATION\n${JSON.stringify(report, null, 2)}`,
  );
}

main()
  .catch((error) => {
    console.error(
      `SEARCH_CATALOG_VERSION_RECONCILIATION_FAILED\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  })
  .finally(() => database?.$disconnect());
