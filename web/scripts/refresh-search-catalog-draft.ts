import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { jobSearchCatalogIndex } from "../src/backend/services/search/catalogs/job-search-catalog-index";
import { searchCatalogSchema } from "../src/shared/contracts/search/job-search-intent";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmed = args.has("--confirm-catalog-sync");

function valueFor(name: string) {
  const prefix = `${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) || undefined;
}

async function writeReport(report: Record<string, unknown>) {
  const output = valueFor("--output");
  if (!output) return;
  const target = isAbsolute(output) ? output : resolve(process.cwd(), output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const expectedActiveVersion = valueFor("--expected-active-version");
  const expectedDraftVersion = valueFor("--version");
  const catalog = jobSearchCatalogIndex.catalog;
  if (expectedDraftVersion && expectedDraftVersion !== catalog.version) {
    throw new Error(
      `STATIC_CATALOG_VERSION_GUARD_FAILED (expected ${expectedDraftVersion}, found ${catalog.version})`,
    );
  }

  const { prisma } = await import("../src/backend/database/prisma");
  try {
    const [active, draft] = await Promise.all([
      prisma.searchCatalogVersion.findFirst({
        where: { isActive: true, status: "PUBLISHED" },
        select: { id: true, version: true, revision: true },
      }),
      prisma.searchCatalogVersion.findUnique({
        where: { version: catalog.version },
        select: {
          id: true,
          version: true,
          status: true,
          isActive: true,
          revision: true,
          parentVersion: true,
          catalogPayload: true,
        },
      }),
    ]);
    if (!active) throw new Error("ACTIVE_PUBLISHED_CATALOG_REQUIRED");
    if (expectedActiveVersion && active.version !== expectedActiveVersion) {
      throw new Error(
        `ACTIVE_CATALOG_VERSION_GUARD_FAILED (expected ${expectedActiveVersion}, found ${active.version})`,
      );
    }
    if (!draft) throw new Error("TARGET_DRAFT_CATALOG_REQUIRED");
    if (draft.status !== "DRAFT" || draft.isActive) {
      throw new Error("TARGET_MUST_BE_INACTIVE_DRAFT");
    }
    if (draft.parentVersion !== active.version) {
      throw new Error("DRAFT_PARENT_VERSION_GUARD_FAILED");
    }

    const currentPayload = draft.catalogPayload
      ? searchCatalogSchema.parse(draft.catalogPayload)
      : null;
    const changed =
      !currentPayload ||
      JSON.stringify(currentPayload) !== JSON.stringify(catalog);
    const report: Record<string, unknown> = {
      schemaVersion: "search-catalog-draft-refresh-v1",
      generatedAt: new Date().toISOString(),
      mode: apply ? "APPLY" : "DRY_RUN",
      activeCatalog: active,
      draftCatalog: {
        id: draft.id,
        version: draft.version,
        status: draft.status,
        isActive: draft.isActive,
        revision: draft.revision,
        parentVersion: draft.parentVersion,
      },
      sourceStaticVersion: catalog.version,
      payloadChanged: changed,
      writesPerformed: false,
      guard: {
        expectedActiveVersion: expectedActiveVersion ?? null,
        draftOnly: true,
        publishedCatalogsUntouched: true,
      },
    };

    if (!apply || !changed) {
      await writeReport(report);
      console.log(
        `SEARCH_CATALOG_DRAFT_REFRESH\n${JSON.stringify(report, null, 2)}`,
      );
      return;
    }
    if (!confirmed) throw new Error("CATALOG_SYNC_CONFIRMATION_REQUIRED");

    await prisma.$transaction(async (tx) => {
      const current = await tx.searchCatalogVersion.findUnique({
        where: { id: draft.id },
        select: {
          version: true,
          status: true,
          isActive: true,
          revision: true,
          parentVersion: true,
        },
      });
      if (
        !current ||
        current.version !== catalog.version ||
        current.status !== "DRAFT" ||
        current.isActive ||
        current.parentVersion !== active.version
      ) {
        throw new Error("DRAFT_CHANGED_OR_NO_LONGER_SAFE");
      }
      await tx.searchCatalogVersion.update({
        where: { id: draft.id },
        data: {
          catalogPayload: catalog,
          revision: { increment: 1 },
          changeReason: `Release payload normalized from active catalog ${active.version}.`,
        },
      });
    });
    report.writesPerformed = true;
    report.updatedAt = new Date().toISOString();
    await writeReport(report);
    console.log(
      `SEARCH_CATALOG_DRAFT_REFRESH\n${JSON.stringify(report, null, 2)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `SEARCH_CATALOG_DRAFT_REFRESH_FAILED\n${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
