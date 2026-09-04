import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../src/backend/generated/prisma/client";
import { normalizeSearchText } from "../src/backend/services/jobs/search-normalization";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

type PrismaDatabase = typeof import("../src/backend/database/prisma").prisma;
type ReviewRow = Prisma.SearchMappingReviewGetPayload<{
  select: {
    id: true;
    catalogVersionId: true;
    openKey: true;
    originalTitle: true;
    normalizedTitle: true;
    context: true;
    suggestedTitleId: true;
    suggestedTranslationVi: true;
    suggestedTranslationEn: true;
    suggestedOccupationId: true;
    suggestedFacetIds: true;
    suggestedSkillSignals: true;
    confidence: true;
    status: true;
    version: true;
    decisionReason: true;
    resultCatalogVersionId: true;
    reviewedByAdminUserId: true;
    reviewedAt: true;
    createdAt: true;
    updatedAt: true;
  };
}>;
type TitleRow = {
  catalogVersionId: string;
  titleId: string;
  canonicalVi: string;
  canonicalEn: string;
  aliasesVi: string[];
  aliasesEn: string[];
  mappingSource: string;
  translationStatus: string;
};

type ApprovedReviewRow = {
  id: string;
  suggestedTitleId: string | null;
  resultCatalogVersionId: string | null;
  status: "APPROVED" | "MERGED";
};

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmed = args.has("--confirm-deduplication");
const expectedActiveVersion = valueFor("--expected-active-version");
const outputPath = valueFor("--output");
let database: PrismaDatabase | undefined;

function valueFor(name: string) {
  const prefix = `${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) || undefined;
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function boundedUnion(values: readonly string[], maximum: number) {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, maximum);
}

function groupKey(row: ReviewRow) {
  const titleId = row.suggestedTitleId?.trim();
  if (titleId) return `${row.catalogVersionId}\u0000title\u0000${titleId}`;
  return `${row.catalogVersionId}\u0000unmapped\u0000${normalizeSearchText(
    row.normalizedTitle || row.originalTitle,
    160,
  )}`;
}

function contextRichness(row: ReviewRow) {
  const context = jsonObject(row.context);
  return (
    (typeof context.sampleJobId === "string" ? 100 : 0) +
    stringArray(context.sampleJobIds).length * 10 +
    stringArray(context.categoryIds).length * 4 +
    stringArray(context.skillSignals).length * 2 +
    stringArray(context.facetIds).length * 2 +
    JSON.stringify(context).length / 10000
  );
}

function compareRows(left: ReviewRow, right: ReviewRow) {
  const richnessDifference = contextRichness(right) - contextRichness(left);
  if (richnessDifference !== 0) return richnessDifference;
  const createdDifference =
    left.createdAt.getTime() - right.createdAt.getTime();
  if (createdDifference !== 0) return createdDifference;
  return left.id.localeCompare(right.id);
}

function mergedContext(rows: readonly ReviewRow[]) {
  const contexts = rows.map((row) => jsonObject(row.context));
  const first = contexts[0] ?? {};
  const sampleJobIds = boundedUnion(
    contexts.flatMap((context) => [
      ...stringArray(context.sampleJobIds),
      ...(typeof context.sampleJobId === "string" ? [context.sampleJobId] : []),
    ]),
    8,
  );
  const next: Record<string, unknown> = { ...first };
  const scalarKeys = ["industryCode", "occupationId"] as const;
  for (const key of scalarKeys) {
    const value = contexts.find(
      (context) => typeof context[key] === "string",
    )?.[key];
    if (typeof value === "string") next[key] = value;
  }
  const listKeys = ["categoryIds", "skillSignals", "facetIds"] as const;
  for (const key of listKeys) {
    const values = boundedUnion(
      contexts.flatMap((context) => stringArray(context[key])),
      16,
    );
    if (values.length > 0) next[key] = values;
  }
  if (sampleJobIds.length > 0) {
    next.sampleJobId = sampleJobIds[0];
    next.sampleJobIds = sampleJobIds;
  }
  next.deduplication = {
    policy: "title-id-v1",
    sourceReviewCount: rows.length,
  };
  return next as Prisma.InputJsonValue;
}

function operationReason(
  kind: "DUPLICATE" | "STALE_INTENTIONAL" | "CARRY_FORWARD",
) {
  return kind === "DUPLICATE"
    ? "System queue deduplication consolidated equivalent title mappings into one pending review."
    : kind === "STALE_INTENTIONAL"
      ? "Queue item retired because the catalog already marks this title INTENTIONAL_UNTRANSLATED."
      : "Queue item retired because an exact HUMAN_VERIFIED MANUAL_REVIEW catalog mapping already resolves the title.";
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
  const { PrismaAuditRepository } =
    await import("../src/backend/repositories/audit/prisma-audit-repository");
  database = prisma;
  const active = await prisma.searchCatalogVersion.findFirst({
    where: { isActive: true, status: "PUBLISHED" },
    select: { id: true, version: true },
  });
  const deduplicationColumns = await prisma.$queryRaw<
    Array<{ column_name: string }>
  >`
    SELECT "column_name"
    FROM "information_schema"."columns"
    WHERE "table_schema" = 'public'
      AND "table_name" = 'SearchMappingReview'
      AND "column_name" IN ('deduplicatedIntoReviewId', 'deduplicatedAt')
  `;
  const deduplicationEnum = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "pg_type" AS type
      JOIN "pg_enum" AS enum_value ON enum_value."enumtypid" = type."oid"
      WHERE type."typname" = 'SearchMappingReviewStatus'
        AND enum_value."enumlabel" = 'DEDUPLICATED'
    ) AS "ready"
  `;
  const migrationReady =
    new Set(deduplicationColumns.map((row) => row.column_name)).size === 2 &&
    deduplicationEnum[0]?.ready === true;
  const pending = (await prisma.searchMappingReview.findMany({
    where: { status: "PENDING" },
    orderBy: [{ catalogVersionId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      catalogVersionId: true,
      openKey: true,
      originalTitle: true,
      normalizedTitle: true,
      context: true,
      suggestedTitleId: true,
      suggestedTranslationVi: true,
      suggestedTranslationEn: true,
      suggestedOccupationId: true,
      suggestedFacetIds: true,
      suggestedSkillSignals: true,
      confidence: true,
      status: true,
      version: true,
      decisionReason: true,
      resultCatalogVersionId: true,
      reviewedByAdminUserId: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })) as unknown as ReviewRow[];
  const titleRefs = pending
    .filter((row) => row.suggestedTitleId)
    .map((row) => ({
      catalogVersionId: row.catalogVersionId,
      titleId: row.suggestedTitleId as string,
    }));
  const titles = titleRefs.length
    ? await prisma.searchJobTitle.findMany({
        where: {
          OR: titleRefs.map((reference) => ({
            catalogVersionId: reference.catalogVersionId,
            titleId: reference.titleId,
          })),
        },
        select: {
          catalogVersionId: true,
          titleId: true,
          canonicalVi: true,
          canonicalEn: true,
          aliasesVi: true,
          aliasesEn: true,
          mappingSource: true,
          translationStatus: true,
        },
      })
    : [];
  const titleByKey = new Map<string, TitleRow>(
    titles.map((title) => [
      `${title.catalogVersionId}\u0000${title.titleId}`,
      title,
    ]),
  );

  const activeTitles = active
    ? ((await prisma.searchJobTitle.findMany({
        where: { catalogVersionId: active.id },
        select: {
          catalogVersionId: true,
          titleId: true,
          canonicalVi: true,
          canonicalEn: true,
          aliasesVi: true,
          aliasesEn: true,
          mappingSource: true,
          translationStatus: true,
        },
      })) as unknown as TitleRow[])
    : [];
  const approvedReviews = active
    ? ((await prisma.searchMappingReview.findMany({
        where: {
          status: { in: ["APPROVED", "MERGED"] },
          resultCatalogVersionId: active.id,
          suggestedTitleId: { not: null },
        },
        select: {
          id: true,
          suggestedTitleId: true,
          resultCatalogVersionId: true,
          status: true,
        },
      })) as unknown as ApprovedReviewRow[])
    : [];
  const approvedReviewByTitleId = new Map<string, ApprovedReviewRow>();
  for (const review of approvedReviews) {
    if (
      review.suggestedTitleId &&
      !approvedReviewByTitleId.has(review.suggestedTitleId)
    ) {
      approvedReviewByTitleId.set(review.suggestedTitleId, review);
    }
  }

  const activeHumanReviewedTitles = activeTitles.filter(
    (title) =>
      title.translationStatus === "HUMAN_VERIFIED" &&
      title.mappingSource === "MANUAL_REVIEW",
  );
  const activeHumanReviewedTitleByPhrase = new Map<string, TitleRow>();
  for (const title of activeHumanReviewedTitles) {
    for (const phrase of [
      title.canonicalEn,
      title.canonicalVi,
      ...title.aliasesEn,
      ...title.aliasesVi,
    ]) {
      const normalized = normalizeSearchText(phrase, 160);
      if (normalized && !activeHumanReviewedTitleByPhrase.has(normalized)) {
        activeHumanReviewedTitleByPhrase.set(normalized, title);
      }
    }
  }

  const groups = new Map<string, ReviewRow[]>();
  for (const row of pending) {
    const key = groupKey(row);
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }

  const staleIntentional = pending.filter((row) => {
    if (!row.suggestedTitleId) return false;
    return (
      titleByKey.get(`${row.catalogVersionId}\u0000${row.suggestedTitleId}`)
        ?.translationStatus === "INTENTIONAL_UNTRANSLATED"
    );
  });
  const staleIds = new Set(staleIntentional.map((row) => row.id));
  const carryForward = pending.filter((row) => {
    if (!active || row.catalogVersionId !== active.id) return false;
    const normalized = normalizeSearchText(
      row.normalizedTitle || row.originalTitle,
      160,
    );
    const title = activeHumanReviewedTitleByPhrase.get(normalized);
    return Boolean(title);
  });
  const carryForwardIds = new Set(carryForward.map((row) => row.id));
  const operations: Array<{
    kind: "DUPLICATE" | "STALE_INTENTIONAL" | "CARRY_FORWARD";
    canonicalReviewId: string | null;
    duplicateReviewIds: string[];
    sourceVersions: number[];
    mergedContext?: Prisma.InputJsonValue;
  }> = [];

  for (const rows of groups.values()) {
    const activeRows = rows.filter(
      (row) => !staleIds.has(row.id) && !carryForwardIds.has(row.id),
    );
    if (activeRows.length > 1) {
      const canonical = [...activeRows].sort(compareRows)[0];
      operations.push({
        kind: "DUPLICATE",
        canonicalReviewId: canonical.id,
        duplicateReviewIds: activeRows
          .filter((row) => row.id !== canonical.id)
          .map((row) => row.id),
        sourceVersions: activeRows
          .filter((row) => row.id !== canonical.id)
          .map((row) => row.version),
        mergedContext: mergedContext(activeRows),
      });
    }
  }
  for (const row of carryForward) {
    const normalized = normalizeSearchText(
      row.normalizedTitle || row.originalTitle,
      160,
    );
    const title = activeHumanReviewedTitleByPhrase.get(normalized);
    const approved = title
      ? approvedReviewByTitleId.get(title.titleId)
      : undefined;
    operations.push({
      kind: "CARRY_FORWARD",
      canonicalReviewId: approved?.id ?? null,
      duplicateReviewIds: [row.id],
      sourceVersions: [row.version],
    });
  }
  for (const row of staleIntentional) {
    operations.push({
      kind: "STALE_INTENTIONAL",
      canonicalReviewId: null,
      duplicateReviewIds: [row.id],
      sourceVersions: [row.version],
    });
  }

  const duplicateRows = operations.reduce(
    (count, operation) => count + operation.duplicateReviewIds.length,
    0,
  );
  const canonicalRows = operations.filter(
    (operation) => operation.kind === "DUPLICATE",
  ).length;
  const report: Record<string, unknown> = {
    schemaVersion: "search-mapping-review-queue-reconcile-v1",
    generatedAt: new Date().toISOString(),
    mode: apply ? "APPLY" : "DRY_RUN",
    activeCatalogVersion: active?.version ?? null,
    activeCatalogVersionId: active?.id ?? null,
    pendingBefore: pending.length,
    pendingByCatalogVersion: Object.fromEntries(
      [...new Set(pending.map((row) => row.catalogVersionId))].map(
        (versionId) => [
          versionId,
          pending.filter((row) => row.catalogVersionId === versionId).length,
        ],
      ),
    ),
    duplicateGroups: canonicalRows,
    duplicateRowsToArchive: operations
      .filter((operation) => operation.kind === "DUPLICATE")
      .reduce(
        (count, operation) => count + operation.duplicateReviewIds.length,
        0,
      ),
    staleIntentionalRows: staleIntentional.length,
    carryForwardRows: carryForward.length,
    pendingAfter: Math.max(0, pending.length - duplicateRows),
    activePendingBefore: active
      ? pending.filter((row) => row.catalogVersionId === active.id).length
      : null,
    activePendingAfter: active
      ? pending.filter((row) => row.catalogVersionId === active.id).length -
        operations
          .filter((operation) =>
            operation.duplicateReviewIds.some((id) =>
              pending.some(
                (row) => row.id === id && row.catalogVersionId === active.id,
              ),
            ),
          )
          .reduce(
            (count, operation) => count + operation.duplicateReviewIds.length,
            0,
          )
      : null,
    operationCount: operations.length,
    operations: operations.map((operation) => ({
      kind: operation.kind,
      canonicalReviewId: operation.canonicalReviewId,
      duplicateReviewIds: operation.duplicateReviewIds,
      sourceVersions: operation.sourceVersions,
    })),
    guard: {
      applyRequires: [
        "--apply",
        "--confirm-deduplication",
        "--expected-active-version=<current published version>",
      ],
      expectedActiveVersion: expectedActiveVersion ?? null,
      migration: {
        required: "088_search_mapping_review_deduplication",
        columnsPresent: deduplicationColumns.map((row) => row.column_name),
        enumPresent: deduplicationEnum[0]?.ready === true,
        ready: migrationReady,
      },
      writesPerformed: false,
    },
  };

  if (!apply) {
    await writeReport(report);
    console.log(
      `SEARCH_MAPPING_REVIEW_QUEUE_RECONCILIATION\n${JSON.stringify(report, null, 2)}`,
    );
    return;
  }
  if (!confirmed) throw new Error("DEDUPLICATION_CONFIRMATION_REQUIRED");
  if (!active) throw new Error("ACTIVE_CATALOG_REQUIRED");
  if (!expectedActiveVersion || expectedActiveVersion !== active.version) {
    throw new Error("ACTIVE_CATALOG_VERSION_GUARD_FAILED");
  }
  if (!migrationReady) {
    throw new Error("SEARCH_MAPPING_REVIEW_DEDUPLICATION_MIGRATION_REQUIRED");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const audit = new PrismaAuditRepository(tx);
    for (const operation of operations) {
      if (
        operation.kind === "DUPLICATE" &&
        operation.canonicalReviewId &&
        operation.mergedContext
      ) {
        const canonical = await tx.searchMappingReview.findUnique({
          where: { id: operation.canonicalReviewId },
          select: { id: true, status: true },
        });
        if (!canonical || canonical.status !== "PENDING") {
          throw new Error("QUEUE_CANONICAL_ROW_CHANGED");
        }
        await tx.searchMappingReview.update({
          where: { id: canonical.id },
          data: { context: operation.mergedContext, updatedAt: now },
        });
      }
      if (operation.kind === "CARRY_FORWARD" && operation.canonicalReviewId) {
        const canonical = await tx.searchMappingReview.findUnique({
          where: { id: operation.canonicalReviewId },
          select: { id: true, status: true },
        });
        if (
          !canonical ||
          (canonical.status !== "APPROVED" && canonical.status !== "MERGED")
        ) {
          throw new Error("QUEUE_CARRY_FORWARD_TARGET_CHANGED");
        }
      }
      for (const duplicateId of operation.duplicateReviewIds) {
        const row = await tx.searchMappingReview.findUnique({
          where: { id: duplicateId },
          select: { id: true, status: true, version: true, openKey: true },
        });
        if (!row) throw new Error("QUEUE_ROW_UNAVAILABLE");
        if (row.status === "DEDUPLICATED") continue;
        if (row.status !== "PENDING") throw new Error("QUEUE_ROW_CHANGED");
        const updated = await tx.searchMappingReview.updateMany({
          where: { id: duplicateId, status: "PENDING", version: row.version },
          data: {
            status: "DEDUPLICATED",
            version: { increment: 1 },
            decisionReason: operationReason(operation.kind),
            reviewedByAdminUserId: null,
            reviewedAt: null,
            openKey: null,
            resultCatalogVersionId: null,
            deduplicatedIntoReviewId: operation.canonicalReviewId,
            deduplicatedAt: now,
            updatedAt: now,
          },
        });
        if (updated.count !== 1) throw new Error("QUEUE_ROW_CHANGED");
        await audit.append({
          occurredAt: now,
          actorType: "system",
          actorUserId: null,
          actorSessionId: null,
          action: "admin.search_mapping_review_queue_deduplicated",
          targetType: "search_mapping_review",
          targetId: duplicateId,
          result: "SUCCESS",
          correlationId: randomUUID(),
          context: {
            priorState: "PENDING",
            resultingState: "DEDUPLICATED",
            targetVersion: row.version + 1,
            ...(operation.canonicalReviewId
              ? { deduplicatedIntoReviewId: operation.canonicalReviewId }
              : {}),
            beforeReference: {
              reviewId: duplicateId,
              status: "PENDING",
              version: row.version,
              openKey: row.openKey,
            },
            afterReference: {
              reviewId: duplicateId,
              status: "DEDUPLICATED",
              version: row.version + 1,
            },
            reasonCategory: "DATA_REPAIR",
            outcome:
              operation.kind === "CARRY_FORWARD"
                ? "SEARCH_MAPPING_REVIEW_CARRY_FORWARD_DEDUPLICATED"
                : "SEARCH_MAPPING_REVIEW_QUEUE_DEDUPLICATED",
          },
        });
      }
    }
  });

  report.guard = {
    ...((report.guard as Record<string, unknown>) ?? {}),
    writesPerformed: true,
  };
  report.appliedAt = now.toISOString();
  await writeReport(report);
  console.log(
    `SEARCH_MAPPING_REVIEW_QUEUE_RECONCILIATION\n${JSON.stringify(report, null, 2)}`,
  );
}

main()
  .catch((error) => {
    console.error(
      `SEARCH_MAPPING_REVIEW_QUEUE_RECONCILIATION_FAILED\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  })
  .finally(() => database?.$disconnect());
