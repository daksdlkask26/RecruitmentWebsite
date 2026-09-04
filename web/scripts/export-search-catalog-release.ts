import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  searchCatalogSchema,
  type SearchCatalog,
} from "../src/shared/contracts/search/job-search-intent";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

function valueFor(name: string) {
  const prefix = `${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) || undefined;
}

function outputTarget(value: string) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function releaseSnapshot(
  source: SearchCatalog,
  version: string,
  titleCatalogVersion: string,
): SearchCatalog {
  const occupations = source.occupations.map((occupation) => ({
    ...occupation,
    version,
  }));
  const occupationsById = new Map(
    occupations.map((occupation) => [occupation.occupationId, occupation]),
  );

  return searchCatalogSchema.parse({
    ...source,
    version,
    occupations,
    ...(source.titleDefinitions
      ? {
          titleDefinitions: source.titleDefinitions.map((title) => ({
            ...title,
            ...(title.occupationId
              ? (() => {
                  const occupation = occupationsById.get(title.occupationId);
                  if (!occupation) return {};
                  return {
                    // A review can change the selected occupation while an
                    // old context payload still carries the previous
                    // industry's categories. The owner is authoritative for
                    // this metadata in a new immutable release.
                    industryCode: occupation.industryCode,
                    categoryIds: [...occupation.categoryIds],
                    facetIds: title.facetIds.filter((facetId) =>
                      occupation.supportedFacetIds.includes(facetId),
                    ),
                  };
                })()
              : {}),
            catalogVersion: titleCatalogVersion,
          })),
        }
      : {}),
  });
}

async function main() {
  const version = valueFor("--version");
  const titleCatalogVersion = valueFor("--title-version");
  const output = valueFor("--output");
  const expectedSourceVersion = valueFor("--expected-source-version");

  if (!version || !titleCatalogVersion || !output) {
    throw new Error(
      "RELEASE_EXPORT_ARGUMENTS_REQUIRED (use --version=, --title-version=, and --output=)",
    );
  }

  const { prisma } = await import("../src/backend/database/prisma");
  try {
    const active = await prisma.searchCatalogVersion.findFirst({
      where: { isActive: true, status: "PUBLISHED" },
      select: {
        id: true,
        version: true,
        revision: true,
        catalogPayload: true,
      },
    });
    if (!active) throw new Error("ACTIVE_PUBLISHED_CATALOG_REQUIRED");
    if (expectedSourceVersion && active.version !== expectedSourceVersion) {
      throw new Error(
        `SOURCE_CATALOG_VERSION_GUARD_FAILED (expected ${expectedSourceVersion}, found ${active.version})`,
      );
    }
    if (!active.catalogPayload) {
      throw new Error("ACTIVE_CATALOG_PAYLOAD_REQUIRED");
    }

    const source = searchCatalogSchema.parse(active.catalogPayload);
    const release = releaseSnapshot(source, version, titleCatalogVersion);
    const target = outputTarget(output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(release, null, 2)}\n`, "utf8");

    const statusCounts = Object.fromEntries(
      [
        ...new Set(
          (release.titleDefinitions ?? []).map(
            (title) => title.translationStatus,
          ),
        ),
      ]
        .sort()
        .map((status) => [
          status,
          (release.titleDefinitions ?? []).filter(
            (title) => title.translationStatus === status,
          ).length,
        ]),
    );
    console.log(
      `SEARCH_CATALOG_RELEASE_EXPORTED\n${JSON.stringify(
        {
          output: target,
          sourceCatalog: {
            id: active.id,
            version: active.version,
            revision: active.revision,
          },
          releaseVersion: release.version,
          titleCatalogVersion,
          occupations: release.occupations.length,
          titles: release.titleDefinitions?.length ?? 0,
          facets: release.facets.length,
          skills: release.skills.length,
          titleStatusCounts: statusCounts,
        },
        null,
        2,
      )}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `SEARCH_CATALOG_RELEASE_EXPORT_FAILED\n${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
