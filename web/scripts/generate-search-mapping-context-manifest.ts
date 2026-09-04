import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Prisma } from "../src/backend/generated/prisma/client";
import { normalizeSearchText } from "../src/backend/services/jobs/search-normalization";
import {
  searchMappingReviewBatchManifestSchema,
  type SearchMappingReviewBatchItem,
  type SearchMappingReviewBatchManifest,
} from "../src/shared/contracts/admin/search-mapping-review-batch";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

type PrismaDatabase = typeof import("../src/backend/database/prisma").prisma;
type PendingReview = Prisma.SearchMappingReviewGetPayload<{
  select: {
    id: true;
    catalogVersionId: true;
    originalTitle: true;
    normalizedTitle: true;
    context: true;
    suggestedTitleId: true;
    suggestedOccupationId: true;
    suggestedFacetIds: true;
    confidence: true;
    version: true;
  };
}>;

const sourceManifestPath = valueFor("--source-manifest");
const outputPath = valueFor("--output");
const expectedActiveVersion = valueFor("--expected-active-version");
let database: PrismaDatabase | undefined;

function valueFor(name: string) {
  const prefix = `${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) || undefined;
}

function outputFile() {
  if (outputPath) {
    return isAbsolute(outputPath)
      ? outputPath
      : resolve(process.cwd(), outputPath);
  }
  return resolve(
    process.cwd(),
    "..",
    "docs",
    "search-v3",
    "search-mapping-context-manifest.json",
  );
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function contextSummary(row: PendingReview) {
  const context = jsonObject(row.context);
  const scope = jsonObject(context.scope);
  return {
    reviewId: row.id,
    catalogVersionId: row.catalogVersionId,
    source: "STATIC_JOB_POSTING" as const,
    sampleJobIds: stringArray(context.sampleJobIds).slice(0, 8),
    industryCode:
      typeof scope.industryCode === "string" ? scope.industryCode : null,
    categoryIds: stringArray(scope.categoryIds).slice(0, 16),
    contextOccupationIds: stringArray(context.occupationIds).slice(0, 16),
    profileSource:
      typeof context.profileSource === "string" ? context.profileSource : null,
    translationStatus:
      typeof context.translationStatus === "string"
        ? context.translationStatus
        : null,
    reviewVersion: row.version,
  };
}

function itemCandidates(
  source: SearchMappingReviewBatchManifest,
  row: PendingReview,
) {
  if (row.suggestedTitleId) {
    const byId = source.items.filter(
      (item) => item.titleId === row.suggestedTitleId,
    );
    if (byId.length > 0) return byId;
  }
  const normalized = normalizeSearchText(
    row.normalizedTitle || row.originalTitle,
    160,
  );
  return source.items.filter(
    (item) =>
      normalizeSearchText(item.originalTitle, 160) === normalized ||
      normalizeSearchText(item.canonicalEn, 160) === normalized,
  );
}

function withContext(
  item: SearchMappingReviewBatchItem,
  row: PendingReview,
): SearchMappingReviewBatchItem {
  // `reviewId` is the authoritative join for rows whose taxonomy profile did
  // not produce a suggestedTitleId. The command still carries the reviewed
  // title/occupation from the human-confirmed manifest item.
  return { ...item, reviewId: row.id };
}

async function main() {
  if (!sourceManifestPath) throw new Error("SOURCE_MANIFEST_REQUIRED");
  const sourceRaw = JSON.parse(
    await readFile(resolve(process.cwd(), sourceManifestPath), "utf8"),
  );
  const source = searchMappingReviewBatchManifestSchema.parse(sourceRaw);
  if (!source.humanReviewConfirmed || !source.reviewer) {
    throw new Error("SOURCE_MANIFEST_HUMAN_REVIEW_REQUIRED");
  }

  const { prisma } = await import("../src/backend/database/prisma");
  database = prisma;
  const active = await prisma.searchCatalogVersion.findFirst({
    where: { isActive: true, status: "PUBLISHED" },
    select: { id: true, version: true, status: true, isActive: true },
  });
  if (!active) throw new Error("ACTIVE_PUBLISHED_CATALOG_REQUIRED");
  if (expectedActiveVersion && expectedActiveVersion !== active.version) {
    throw new Error(
      `ACTIVE_CATALOG_VERSION_GUARD_FAILED:${active.version}:${expectedActiveVersion}`,
    );
  }

  const pending = (await prisma.searchMappingReview.findMany({
    where: { catalogVersionId: active.id, status: "PENDING" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      catalogVersionId: true,
      originalTitle: true,
      normalizedTitle: true,
      context: true,
      suggestedTitleId: true,
      suggestedOccupationId: true,
      suggestedFacetIds: true,
      confidence: true,
      version: true,
    },
  })) as PendingReview[];

  const errors: string[] = [];
  const matched: Array<{
    item: SearchMappingReviewBatchItem;
    context: ReturnType<typeof contextSummary>;
  }> = [];
  for (const row of pending) {
    const candidates = itemCandidates(source, row);
    if (candidates.length !== 1) {
      errors.push(
        `${row.id}:${row.originalTitle} resolves to ${candidates.length} source manifest items`,
      );
      continue;
    }
    const sourceItem = candidates[0];
    if (!sourceItem.humanApproved || !sourceItem.reviewer) {
      errors.push(
        `${row.id}:${row.originalTitle} lacks item-level reviewer evidence`,
      );
      continue;
    }
    if (sourceItem.reviewer.actorUserId !== source.reviewer.actorUserId) {
      errors.push(
        `${row.id}:${row.originalTitle} reviewer does not match manifest reviewer`,
      );
      continue;
    }
    matched.push({
      item: withContext(sourceItem, row),
      context: contextSummary(row),
    });
  }
  if (errors.length > 0)
    throw new Error(`CONTEXT_MANIFEST_MATCH_FAILED:${errors.join("|")}`);

  const items = matched.map(({ item }) => item);
  const manifest: SearchMappingReviewBatchManifest =
    searchMappingReviewBatchManifestSchema.parse({
      schemaVersion: "search-mapping-review-batch-v1",
      generatedAt: new Date().toISOString(),
      catalogVersion: active.version,
      source: "TAXONOMY_CONTEXT_RULES",
      humanApprovalRequired: true,
      humanReviewConfirmed: source.humanReviewConfirmed,
      reviewer: source.reviewer,
      counts: {
        total: items.length,
        approve: items.filter((item) => item.proposedDecision === "APPROVE")
          .length,
        intentionalUntranslated: items.filter(
          (item) => item.proposedDecision === "INTENTIONAL_UNTRANSLATED",
        ).length,
        merge: items.filter((item) => item.proposedDecision === "MERGE").length,
        reject: items.filter((item) => item.proposedDecision === "REJECT")
          .length,
      },
      provenance: {
        kind: "STATIC_JOB_POSTING_CONTEXT",
        sourceManifestPath,
        activeCatalogVersionId: active.id,
        records: matched.map(({ context }) => context),
      },
      items,
    });

  const target = outputFile();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `SEARCH_MAPPING_CONTEXT_MANIFEST\n${JSON.stringify(
      {
        mode: "DRY_RUN",
        output: target,
        activeCatalog: active,
        sourceManifest: sourceManifestPath,
        pendingActive: pending.length,
        matched: matched.length,
        counts: manifest.counts,
        provenance: matched.map(({ item, context }) => ({
          titleId: item.titleId,
          originalTitle: item.originalTitle,
          proposedDecision: item.proposedDecision,
          ...context,
        })),
        writesPerformed: false,
      },
      null,
      2,
    )}`,
  );
}

main()
  .catch((error) => {
    console.error(
      `SEARCH_MAPPING_CONTEXT_MANIFEST_FAILED\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  })
  .finally(() => database?.$disconnect());
