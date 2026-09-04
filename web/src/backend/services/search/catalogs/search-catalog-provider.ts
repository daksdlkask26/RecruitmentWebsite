import "server-only";

import { prisma } from "@/backend/database/prisma";
import { emitSearchCatalogRuntimeMetric } from "@/backend/observability/search-catalog-runtime-metrics";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import {
  searchCatalogSchema,
  type SearchCatalog,
} from "@/shared/contracts/search/job-search-intent";
import {
  compileSearchCatalogIndex,
  type SearchCatalogIndex,
} from "./job-search-catalog-index";
import { jobSearchCatalogIndex } from "./job-search-catalog-index";
import { searchReleaseFlags } from "../search-release-flags";

export type SearchCatalogSnapshot = Readonly<{
  catalog: SearchCatalog;
  index: SearchCatalogIndex;
  version: string;
  revision: number;
  source: "DATABASE" | "STATIC_FALLBACK";
  loadedAt: string;
}>;

export function isRuntimeCatalogSupported(
  catalogVersion: string,
  snapshot: SearchCatalogSnapshot,
) {
  return snapshot.source === "DATABASE" && catalogVersion === snapshot.version;
}

export interface SearchCatalogProvider {
  getActiveSnapshot(): Promise<SearchCatalogSnapshot>;
  getSnapshot(version: string): Promise<SearchCatalogSnapshot | null>;
  invalidate(version?: string): void;
}

export type SearchCatalogVersionRow = Readonly<{
  id: string;
  version: string;
  status: string;
  isActive: boolean;
  revision: number;
  catalogPayload: unknown;
}>;

export type SearchCatalogRelationalRows = Readonly<{
  occupations: readonly {
    occupationId: string;
    labelVi: string;
    labelEn: string;
  }[];
  titles: readonly {
    titleId: string;
    occupationId: string | null;
    canonicalVi: string;
    canonicalEn: string;
    facetIds: readonly string[];
  }[];
  translations: readonly {
    titleId: string;
    locale: string;
    value: string;
  }[];
  aliases: readonly {
    targetType: string;
    targetId: string;
    normalizedPhrase: string;
  }[];
  facets: readonly { facetId: string }[];
  titleFacets: readonly { titleId: string; facetId: string }[];
}>;

export type LoadedSearchCatalog = Readonly<{
  row: SearchCatalogVersionRow;
  relations: SearchCatalogRelationalRows;
}>;

type CatalogLoader = (version?: string) => Promise<LoadedSearchCatalog | null>;

type CacheEntry = Readonly<{
  snapshot: SearchCatalogSnapshot;
  expiresAt: number;
}>;

const DEFAULT_TTL_MS = 60_000;
const ACTIVE_CACHE_KEY = "__active__";

class InvalidCatalogError extends Error {
  constructor(
    readonly reason:
      | "MISSING_PAYLOAD"
      | "RELATIONAL_MISMATCH"
      | "SCHEMA_INVALID"
      | "VERSION_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "InvalidCatalogError";
  }
}

function immutableFallbackSnapshot(): SearchCatalogSnapshot {
  return Object.freeze({
    catalog: jobSearchCatalogIndex.catalog,
    index: jobSearchCatalogIndex,
    version: jobSearchCatalogIndex.version,
    revision: 0,
    source: "STATIC_FALLBACK" as const,
    loadedAt: new Date(0).toISOString(),
  });
}

function assertRelationalMirror(
  catalog: SearchCatalog,
  row: SearchCatalogVersionRow,
  relations: SearchCatalogRelationalRows,
  options: Readonly<{ allowDraft?: boolean }> = {},
) {
  const titles = catalog.titleDefinitions ?? [];
  const occupationsById = new Map(
    catalog.occupations.map((occupation) => [
      occupation.occupationId,
      occupation,
    ]),
  );
  const titlesById = new Map(titles.map((title) => [title.titleId, title]));
  const facetsById = new Set(catalog.facets.map((facet) => facet.facetId));

  if (row.status === "DRAFT" && !options.allowDraft) {
    throw new InvalidCatalogError(
      "VERSION_UNAVAILABLE",
      `Draft catalog ${row.version} cannot serve runtime requests.`,
    );
  }
  if (catalog.version !== row.version) {
    throw new InvalidCatalogError(
      "RELATIONAL_MISMATCH",
      `Catalog payload version ${catalog.version} does not match row ${row.version}.`,
    );
  }

  const occupationIds = new Set(
    relations.occupations.map((occupation) => occupation.occupationId),
  );
  if (
    occupationIds.size !== relations.occupations.length ||
    occupationIds.size !== catalog.occupations.length ||
    catalog.occupations.some(
      (occupation) =>
        !occupationIds.has(occupation.occupationId) ||
        !relations.occupations.some(
          (stored) =>
            stored.occupationId === occupation.occupationId &&
            stored.labelVi === occupation.labels.vi &&
            stored.labelEn === occupation.labels.en,
        ),
    )
  ) {
    throw new InvalidCatalogError(
      "RELATIONAL_MISMATCH",
      `Occupation rows do not mirror catalog ${row.version}.`,
    );
  }

  const titleIds = new Set(relations.titles.map((title) => title.titleId));
  if (
    titleIds.size !== relations.titles.length ||
    titleIds.size !== titles.length ||
    titles.some((title) => {
      const stored = relations.titles.find(
        (candidate) => candidate.titleId === title.titleId,
      );
      return (
        !stored ||
        stored.occupationId !== title.occupationId ||
        stored.canonicalVi !== title.canonical.vi ||
        stored.canonicalEn !== title.canonical.en ||
        JSON.stringify([...stored.facetIds].sort()) !==
          JSON.stringify([...title.facetIds].sort())
      );
    })
  ) {
    throw new InvalidCatalogError(
      "RELATIONAL_MISMATCH",
      `Title rows do not mirror catalog ${row.version}.`,
    );
  }

  const translationKeys = new Set(
    relations.translations.map(
      (translation) => `${translation.titleId}:${translation.locale}`,
    ),
  );
  if (
    relations.translations.length !== titles.length * 2 ||
    translationKeys.size !== relations.translations.length ||
    titles.some((title) => {
      const vi = relations.translations.find(
        (translation) =>
          translation.titleId === title.titleId && translation.locale === "VI",
      );
      const en = relations.translations.find(
        (translation) =>
          translation.titleId === title.titleId && translation.locale === "EN",
      );
      return (
        !vi ||
        !en ||
        vi.value !== title.canonical.vi ||
        en.value !== title.canonical.en
      );
    })
  ) {
    throw new InvalidCatalogError(
      "RELATIONAL_MISMATCH",
      `Translation rows do not mirror catalog ${row.version}.`,
    );
  }

  const facetIds = new Set(relations.facets.map((facet) => facet.facetId));
  if (
    facetIds.size !== relations.facets.length ||
    facetIds.size !== catalog.facets.length ||
    [...facetIds].some((facetId) => !facetsById.has(facetId))
  ) {
    throw new InvalidCatalogError(
      "RELATIONAL_MISMATCH",
      `Facet rows do not mirror catalog ${row.version}.`,
    );
  }

  for (const titleFacet of relations.titleFacets) {
    if (
      !titlesById.has(titleFacet.titleId) ||
      !facetsById.has(titleFacet.facetId)
    ) {
      throw new InvalidCatalogError(
        "RELATIONAL_MISMATCH",
        `Dangling title-facet reference in catalog ${row.version}.`,
      );
    }
  }
  const aliasOwners = new Map<string, Set<string>>();
  const aliasRows = new Set<string>();
  for (const alias of relations.aliases) {
    const normalizedPhrase = normalizeSearchText(alias.normalizedPhrase, 160);
    const owner = `${alias.targetType}:${alias.targetId}`;
    const rowKey = `${normalizedPhrase}\u0000${owner}`;
    if (
      !alias.normalizedPhrase ||
      !["TITLE", "OCCUPATION"].includes(alias.targetType) ||
      (alias.targetType === "TITLE" && !titlesById.has(alias.targetId)) ||
      (alias.targetType === "OCCUPATION" &&
        !occupationsById.has(alias.targetId)) ||
      aliasRows.has(rowKey)
    ) {
      throw new InvalidCatalogError(
        "RELATIONAL_MISMATCH",
        `Dangling alias reference in catalog ${row.version}.`,
      );
    }
    aliasRows.add(rowKey);
    const owners = aliasOwners.get(normalizedPhrase) ?? new Set<string>();
    owners.add(owner);
    aliasOwners.set(normalizedPhrase, owners);
  }
  for (const [phrase, owners] of aliasOwners) {
    if (owners.size < 2) continue;
    const occupationIds = new Set(
      [...owners].map((owner) => {
        const [targetType, targetId] = owner.split(":", 2);
        return targetType === "OCCUPATION"
          ? targetId
          : titlesById.get(targetId)?.occupationId;
      }),
    );
    const compactPhrase = phrase.replace(/\s+/gu, "");
    const sharedOccupation =
      occupationIds.size === 1 && [...occupationIds].every(Boolean);
    if (compactPhrase.length <= 2 || !sharedOccupation) {
      throw new InvalidCatalogError(
        "RELATIONAL_MISMATCH",
        `Alias collision requires explicit disambiguation: ${phrase}.`,
      );
    }
  }
}

export function buildSearchCatalogSnapshot(
  loaded: LoadedSearchCatalog,
  options: Readonly<{ allowDraft?: boolean }> = {},
): SearchCatalogSnapshot {
  if (!loaded.row.catalogPayload) {
    throw new InvalidCatalogError(
      "MISSING_PAYLOAD",
      `Catalog ${loaded.row.version} has no immutable payload.`,
    );
  }
  const parsed = searchCatalogSchema.safeParse(loaded.row.catalogPayload);
  if (!parsed.success) {
    throw new InvalidCatalogError(
      "SCHEMA_INVALID",
      `Catalog ${loaded.row.version} failed schema validation.`,
    );
  }
  assertRelationalMirror(parsed.data, loaded.row, loaded.relations, options);
  const index = compileSearchCatalogIndex(parsed.data);
  return Object.freeze({
    catalog: index.catalog,
    index,
    version: loaded.row.version,
    revision: loaded.row.revision,
    source: "DATABASE" as const,
    loadedAt: new Date().toISOString(),
  });
}

async function loadCatalogFromDatabase(version?: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.searchCatalogVersion.findFirst({
      where: version ? { version } : { isActive: true, status: "PUBLISHED" },
      select: {
        id: true,
        version: true,
        status: true,
        isActive: true,
        revision: true,
        catalogPayload: true,
      },
    });
    if (!row) return null;
    if (!version && (!row.isActive || row.status !== "PUBLISHED")) return null;
    const [occupations, titles, translations, aliases, facets, titleFacets] =
      await Promise.all([
        tx.searchOccupation.findMany({
          where: { catalogVersionId: row.id },
          select: { occupationId: true, labelVi: true, labelEn: true },
        }),
        tx.searchJobTitle.findMany({
          where: { catalogVersionId: row.id },
          select: {
            titleId: true,
            occupationId: true,
            canonicalVi: true,
            canonicalEn: true,
            facetIds: true,
          },
        }),
        tx.searchJobTitleTranslation.findMany({
          where: { catalogVersionId: row.id },
          select: { titleId: true, locale: true, value: true },
        }),
        tx.searchAlias.findMany({
          where: { catalogVersionId: row.id },
          select: { targetType: true, targetId: true, normalizedPhrase: true },
        }),
        tx.searchFacet.findMany({
          where: { catalogVersionId: row.id },
          select: { facetId: true },
        }),
        tx.searchTitleFacet.findMany({
          where: { catalogVersionId: row.id },
          select: { titleId: true, facetId: true },
        }),
      ]);
    return {
      row,
      relations: {
        occupations,
        titles,
        translations,
        aliases,
        facets,
        titleFacets,
      },
    } satisfies LoadedSearchCatalog;
  });
}

export type SearchCatalogProviderOptions = Readonly<{
  loader?: CatalogLoader;
  ttlMs?: number;
  fallbackSnapshot?: SearchCatalogSnapshot;
}>;

export class PrismaSearchCatalogProvider implements SearchCatalogProvider {
  private readonly loader: CatalogLoader;
  private readonly ttlMs: number;
  private readonly fallbackSnapshot: SearchCatalogSnapshot;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<
    string,
    Readonly<{
      generation: number;
      promise: Promise<SearchCatalogSnapshot | null>;
    }>
  >();
  private invalidationGeneration = 0;

  constructor(options: SearchCatalogProviderOptions = {}) {
    this.loader = options.loader ?? loadCatalogFromDatabase;
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
    this.fallbackSnapshot =
      options.fallbackSnapshot ?? immutableFallbackSnapshot();
  }

  private cached(key: string) {
    const entry = this.cache.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) this.cache.delete(key);
      return undefined;
    }
    emitSearchCatalogRuntimeMetric({
      event: "search_catalog_runtime",
      outcome: "CACHE_HIT",
      source: entry.snapshot.source,
      requestedVersion: key === ACTIVE_CACHE_KEY ? undefined : key,
      catalogVersion: entry.snapshot.version,
    });
    return entry.snapshot;
  }

  private async load(version?: string) {
    const key = version ?? ACTIVE_CACHE_KEY;
    if (!searchReleaseFlags().databaseCatalogEnabled) {
      emitSearchCatalogRuntimeMetric({
        event: "search_catalog_runtime",
        outcome: version ? "DATABASE_LOAD_FAILURE" : "STATIC_FALLBACK",
        source: "STATIC_FALLBACK",
        ...(version ? { requestedVersion: version } : {}),
        catalogVersion: this.fallbackSnapshot.version,
        reason: "FEATURE_DISABLED",
      });
      return version ? null : this.fallbackSnapshot;
    }
    const generation = this.invalidationGeneration;
    const cached = this.cached(key);
    if (cached) return cached;
    const running = this.pending.get(key);
    if (running?.generation === generation) return running.promise;
    const request = this.loader(version)
      .then((loaded) => {
        if (!loaded) {
          if (version) {
            emitSearchCatalogRuntimeMetric({
              event: "search_catalog_runtime",
              outcome: "DATABASE_LOAD_FAILURE",
              source: "STATIC_FALLBACK",
              requestedVersion: version,
              reason: "VERSION_UNAVAILABLE",
            });
            return null;
          }
          emitSearchCatalogRuntimeMetric({
            event: "search_catalog_runtime",
            outcome: "STATIC_FALLBACK",
            source: "STATIC_FALLBACK",
            catalogVersion: this.fallbackSnapshot.version,
            reason: "VERSION_UNAVAILABLE",
          });
          return this.fallbackSnapshot;
        }
        try {
          const snapshot = buildSearchCatalogSnapshot(loaded);
          if (generation === this.invalidationGeneration) {
            this.cache.set(key, {
              snapshot,
              expiresAt: Date.now() + this.ttlMs,
            });
          }
          emitSearchCatalogRuntimeMetric({
            event: "search_catalog_runtime",
            outcome: "DATABASE_LOAD_SUCCESS",
            source: "DATABASE",
            requestedVersion: version,
            catalogVersion: snapshot.version,
          });
          return snapshot;
        } catch (error) {
          const reason =
            error instanceof InvalidCatalogError
              ? error.reason
              : "SCHEMA_INVALID";
          emitSearchCatalogRuntimeMetric({
            event: "search_catalog_runtime",
            outcome: "INVALID_CATALOG",
            source: "STATIC_FALLBACK",
            requestedVersion: version,
            catalogVersion: loaded.row.version,
            reason,
          });
          if (version) return null;
          emitSearchCatalogRuntimeMetric({
            event: "search_catalog_runtime",
            outcome: "STATIC_FALLBACK",
            source: "STATIC_FALLBACK",
            catalogVersion: this.fallbackSnapshot.version,
            reason,
          });
          return this.fallbackSnapshot;
        }
      })
      .catch(() => {
        emitSearchCatalogRuntimeMetric({
          event: "search_catalog_runtime",
          outcome: "DATABASE_LOAD_FAILURE",
          source: "STATIC_FALLBACK",
          requestedVersion: version,
          catalogVersion: this.fallbackSnapshot.version,
          reason: "DATABASE_UNAVAILABLE",
        });
        if (version) return null;
        return this.fallbackSnapshot;
      })
      .finally(() => {
        const current = this.pending.get(key);
        if (current?.promise === request) this.pending.delete(key);
      });
    this.pending.set(key, { generation, promise: request });
    return request;
  }

  getActiveSnapshot(): Promise<SearchCatalogSnapshot> {
    return this.load().then((snapshot) => snapshot ?? this.fallbackSnapshot);
  }

  getSnapshot(version: string): Promise<SearchCatalogSnapshot | null> {
    const normalizedVersion = version.trim();
    return normalizedVersion
      ? this.load(normalizedVersion)
      : Promise.resolve(null);
  }

  invalidate(version?: string) {
    this.invalidationGeneration += 1;
    if (version?.trim()) {
      this.cache.delete(version.trim());
      const active = this.cache.get(ACTIVE_CACHE_KEY);
      if (active?.snapshot.version === version.trim())
        this.cache.delete(ACTIVE_CACHE_KEY);
    } else {
      this.cache.clear();
    }
    emitSearchCatalogRuntimeMetric({
      event: "search_catalog_runtime",
      outcome: "CACHE_INVALIDATED",
      source: "DATABASE",
      ...(version?.trim() ? { requestedVersion: version.trim() } : {}),
      reason: "EXPLICIT_INVALIDATION",
    });
  }
}

export const searchCatalogProvider: SearchCatalogProvider =
  new PrismaSearchCatalogProvider();
