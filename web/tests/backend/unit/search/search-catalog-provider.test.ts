import { afterEach, describe, expect, it } from "vitest";
import {
  configureSearchCatalogRuntimeObservability,
  type SearchCatalogRuntimeMetric,
} from "@/backend/observability/search-catalog-runtime-metrics";
import { jobSearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";
import {
  buildSearchCatalogSnapshot,
  isRuntimeCatalogSupported,
  PrismaSearchCatalogProvider,
  type LoadedSearchCatalog,
} from "@/backend/services/search/catalogs/search-catalog-provider";

function loadedCatalog(
  version: string,
  payload: unknown = { ...jobSearchCatalogIndex.catalog, version },
  status: "DRAFT" | "PUBLISHED" | "RETIRED" = "PUBLISHED",
): LoadedSearchCatalog {
  const catalog = jobSearchCatalogIndex.catalog;
  const titles = catalog.titleDefinitions ?? [];
  return {
    row: {
      id: `catalog-${version}`,
      version,
      status,
      isActive: status === "PUBLISHED",
      revision: 1,
      catalogPayload: payload,
    },
    relations: {
      occupations: catalog.occupations.map((occupation) => ({
        occupationId: occupation.occupationId,
        labelVi: occupation.labels.vi,
        labelEn: occupation.labels.en,
      })),
      titles: titles.map((title) => ({
        titleId: title.titleId,
        occupationId: title.occupationId,
        canonicalVi: title.canonical.vi,
        canonicalEn: title.canonical.en,
        facetIds: title.facetIds,
      })),
      translations: titles.flatMap((title) => [
        { titleId: title.titleId, locale: "VI", value: title.canonical.vi },
        { titleId: title.titleId, locale: "EN", value: title.canonical.en },
      ]),
      aliases: [],
      facets: catalog.facets.map((facet) => ({ facetId: facet.facetId })),
      titleFacets: titles.flatMap((title) =>
        title.facetIds.map((facetId) => ({ titleId: title.titleId, facetId })),
      ),
    },
  };
}

describe("PrismaSearchCatalogProvider", () => {
  afterEach(() => configureSearchCatalogRuntimeObservability());

  it("loads one immutable database snapshot and deduplicates concurrent cold loads", async () => {
    let loads = 0;
    const provider = new PrismaSearchCatalogProvider({
      ttlMs: 60_000,
      loader: async () => {
        loads += 1;
        await Promise.resolve();
        return loadedCatalog("catalog-a");
      },
    });

    const [first, second] = await Promise.all([
      provider.getActiveSnapshot(),
      provider.getActiveSnapshot(),
    ]);

    expect(loads).toBe(1);
    expect(first.source).toBe("DATABASE");
    expect(first.version).toBe("catalog-a");
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.index.catalog)).toBe(true);
  });

  it("switches only new requests after invalidation while old snapshots remain stable", async () => {
    let activeVersion = "catalog-a";
    const provider = new PrismaSearchCatalogProvider({
      loader: async () => loadedCatalog(activeVersion),
    });

    const inFlightSnapshot = await provider.getActiveSnapshot();
    activeVersion = "catalog-b";
    provider.invalidate();
    const newSnapshot = await provider.getActiveSnapshot();

    expect(inFlightSnapshot.version).toBe("catalog-a");
    expect(newSnapshot.version).toBe("catalog-b");
    expect(inFlightSnapshot.index.version).toBe("catalog-a");

    activeVersion = "catalog-a";
    provider.invalidate();
    const rollbackSnapshot = await provider.getActiveSnapshot();
    expect(rollbackSnapshot.version).toBe("catalog-a");
  });

  it("does not reuse an in-flight old active load after publish invalidation", async () => {
    let calls = 0;
    let releaseOld: ((value: LoadedSearchCatalog) => void) | undefined;
    const provider = new PrismaSearchCatalogProvider({
      loader: async () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<LoadedSearchCatalog>((resolve) => {
            releaseOld = resolve;
          });
        }
        return loadedCatalog("catalog-b");
      },
    });

    const oldRequest = provider.getActiveSnapshot();
    await Promise.resolve();
    provider.invalidate();
    const newRequest = provider.getActiveSnapshot();
    const newSnapshot = await newRequest;
    releaseOld?.(loadedCatalog("catalog-a"));
    const oldSnapshot = await oldRequest;

    expect(calls).toBe(2);
    expect(newSnapshot.version).toBe("catalog-b");
    expect(oldSnapshot.version).toBe("catalog-a");
    expect((await provider.getActiveSnapshot()).version).toBe("catalog-b");
  });

  it("rejects an invalid active catalog and falls back atomically with bounded metrics", async () => {
    const metrics: SearchCatalogRuntimeMetric[] = [];
    configureSearchCatalogRuntimeObservability({
      emit: (metric) => metrics.push(metric),
    });
    const provider = new PrismaSearchCatalogProvider({
      loader: async () => loadedCatalog("catalog-invalid", { version: 7 }),
    });

    const snapshot = await provider.getActiveSnapshot();

    expect(snapshot.source).toBe("STATIC_FALLBACK");
    expect(snapshot.version).toBe(jobSearchCatalogIndex.version);
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "INVALID_CATALOG",
          reason: "SCHEMA_INVALID",
          catalogVersion: "catalog-invalid",
        }),
        expect.objectContaining({
          outcome: "STATIC_FALLBACK",
          source: "STATIC_FALLBACK",
        }),
      ]),
    );
    expect(JSON.stringify(metrics)).not.toContain("catalog-invalid-query");
  });

  it("rejects duplicate and cross-occupation normalized aliases instead of last-write-wins", async () => {
    const metrics: SearchCatalogRuntimeMetric[] = [];
    configureSearchCatalogRuntimeObservability({
      emit: (metric) => metrics.push(metric),
    });
    const occupations = jobSearchCatalogIndex.catalog.occupations;
    const invalid = loadedCatalog("catalog-collision");
    const collision = {
      ...invalid,
      relations: {
        ...invalid.relations,
        aliases: [
          {
            targetType: "OCCUPATION",
            targetId: occupations[0]!.occupationId,
            normalizedPhrase: "it",
          },
          {
            targetType: "OCCUPATION",
            targetId: occupations[1]!.occupationId,
            normalizedPhrase: "it",
          },
        ],
      },
    } satisfies LoadedSearchCatalog;
    const provider = new PrismaSearchCatalogProvider({
      loader: async () => collision,
    });

    const snapshot = await provider.getActiveSnapshot();

    expect(snapshot.source).toBe("STATIC_FALLBACK");
    expect(metrics).toContainEqual(
      expect.objectContaining({
        outcome: "INVALID_CATALOG",
        reason: "RELATIONAL_MISMATCH",
      }),
    );
  });

  it("falls back deterministically when the database loader is unavailable", async () => {
    const metrics: SearchCatalogRuntimeMetric[] = [];
    configureSearchCatalogRuntimeObservability({
      emit: (metric) => metrics.push(metric),
    });
    const provider = new PrismaSearchCatalogProvider({
      loader: async () => {
        throw new Error("database unavailable");
      },
    });

    const snapshot = await provider.getActiveSnapshot();

    expect(snapshot).toMatchObject({
      source: "STATIC_FALLBACK",
      version: jobSearchCatalogIndex.version,
      revision: 0,
    });
    expect(metrics).toContainEqual(
      expect.objectContaining({
        outcome: "DATABASE_LOAD_FAILURE",
        reason: "DATABASE_UNAVAILABLE",
      }),
    );
  });

  it("does not serve a draft through an explicit runtime version request", async () => {
    const provider = new PrismaSearchCatalogProvider({
      loader: async () => loadedCatalog("catalog-draft", undefined, "DRAFT"),
    });

    await expect(provider.getSnapshot("catalog-draft")).resolves.toBeNull();
  });

  it("reloads an explicit immutable version after targeted invalidation", async () => {
    let loads = 0;
    const provider = new PrismaSearchCatalogProvider({
      loader: async (version) => {
        loads += 1;
        return loadedCatalog(version ?? "catalog-a");
      },
    });

    await provider.getSnapshot("catalog-a");
    await provider.getSnapshot("catalog-a");
    provider.invalidate("catalog-a");
    const reloaded = await provider.getSnapshot("catalog-a");

    expect(loads).toBe(2);
    expect(reloaded?.version).toBe("catalog-a");
  });

  it("marks admin runtime support false for a static fallback even when versions match", async () => {
    const databaseSnapshot = buildSearchCatalogSnapshot(
      loadedCatalog("catalog-a"),
    );
    const fallbackSnapshot = new PrismaSearchCatalogProvider({
      loader: async () => null,
    });

    expect(isRuntimeCatalogSupported("catalog-a", databaseSnapshot)).toBe(true);
    const snapshot = await fallbackSnapshot.getActiveSnapshot();
    expect(isRuntimeCatalogSupported(snapshot.version, snapshot)).toBe(false);
  });
});
