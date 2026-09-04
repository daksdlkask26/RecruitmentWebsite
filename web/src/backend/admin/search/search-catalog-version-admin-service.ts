import "server-only";

import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import type { AdminAuthority } from "@/backend/security/admin-request-boundary";
import {
  AdminCommandConflict,
  PrismaAdminCommandRepository,
} from "@/backend/repositories/admin/prisma-admin-command-repository";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import { PrivilegedRationaleService } from "@/backend/admin/rationales/privileged-rationale-service";
import {
  buildSearchCatalogSnapshot,
  isRuntimeCatalogSupported,
  searchCatalogProvider,
} from "@/backend/services/search/catalogs/search-catalog-provider";
import {
  searchCatalogVersionCommandSchema,
  searchCatalogVersionListQuerySchema,
} from "@/shared/contracts/admin/search-catalog-version";

const ADMIN_STATE_DEFINITION_VERSION = "search-catalog-state-v1" as const;

const auditActions = {
  PUBLISH: "admin.search_catalog_version_published",
  ROLLBACK: "admin.search_catalog_version_rolled_back",
  RETIRE: "admin.search_catalog_version_retired",
} as const;

type AdminDb = typeof prisma | Prisma.TransactionClient;
type CatalogStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

type CatalogVersionRow = {
  id: string;
  version: string;
  status: CatalogStatus;
  isActive: boolean;
  revision: number;
  parentVersion: string | null;
  changeReason: string | null;
  createdByAdminUserId: string | null;
  publishedByAdminUserId: string | null;
  retiredByAdminUserId: string | null;
  publishedAt: Date | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function assertActiveGrant(authority: AdminAuthority, db: AdminDb) {
  const grant = await db.platformAdministratorGrant.findFirst({
    where: {
      id: authority.grantId,
      userId: authority.userId,
      state: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      user: { state: "ACTIVE", deletedAt: null },
      sessionPolicy: { is: { designatedSessionId: authority.sessionId } },
    },
    select: { id: true },
  });
  if (!grant) throw new Error("ACTION_BLOCKED");
}

function whereFor(input: {
  q?: string;
  status?: CatalogStatus;
}): Prisma.SearchCatalogVersionWhereInput {
  return {
    ...(input.status ? { status: input.status } : {}),
    ...(input.q
      ? {
          OR: [
            { id: { contains: input.q, mode: "insensitive" } },
            { version: { contains: input.q, mode: "insensitive" } },
            { parentVersion: { contains: input.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

async function counts(db: AdminDb, catalogVersionId: string) {
  const [
    occupations,
    titles,
    translations,
    aliases,
    facets,
    titleFacets,
    reviews,
  ] = await Promise.all([
    db.searchOccupation.count({ where: { catalogVersionId } }),
    db.searchJobTitle.count({ where: { catalogVersionId } }),
    db.searchJobTitleTranslation.count({ where: { catalogVersionId } }),
    db.searchAlias.count({ where: { catalogVersionId } }),
    db.searchFacet.count({ where: { catalogVersionId } }),
    db.searchTitleFacet.count({ where: { catalogVersionId } }),
    db.searchMappingReview.count({ where: { catalogVersionId } }),
  ]);
  return {
    occupations,
    titles,
    translations,
    aliases,
    facets,
    titleFacets,
    reviews,
  };
}

async function project(db: AdminDb, row: CatalogVersionRow) {
  const runtime = await searchCatalogProvider.getActiveSnapshot();
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    isActive: row.isActive,
    revision: row.revision,
    parentVersion: row.parentVersion,
    changeReason: row.changeReason,
    createdByAdminUserId: row.createdByAdminUserId,
    publishedByAdminUserId: row.publishedByAdminUserId,
    retiredByAdminUserId: row.retiredByAdminUserId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    counts: await counts(db, row.id),
    runtimeSupported: isRuntimeCatalogSupported(row.version, runtime),
    runtimeCatalogVersion: runtime.version,
  };
}

async function validatePublishable(db: Prisma.TransactionClient, id: string) {
  const row = await db.searchCatalogVersion.findUnique({
    where: { id },
    select: {
      id: true,
      version: true,
      status: true,
      isActive: true,
      revision: true,
      catalogPayload: true,
    },
  });
  if (!row) throw new Error("TARGET_UNAVAILABLE");
  const [occupations, titles, translations, aliases, facets, titleFacets] =
    await Promise.all([
      db.searchOccupation.findMany({
        where: { catalogVersionId: id },
        select: { occupationId: true, labelVi: true, labelEn: true },
      }),
      db.searchJobTitle.findMany({
        where: { catalogVersionId: id },
        select: {
          titleId: true,
          occupationId: true,
          canonicalVi: true,
          canonicalEn: true,
          facetIds: true,
        },
      }),
      db.searchJobTitleTranslation.findMany({
        where: { catalogVersionId: id },
        select: { titleId: true, locale: true, value: true },
      }),
      db.searchAlias.findMany({
        where: { catalogVersionId: id },
        select: { targetType: true, targetId: true, normalizedPhrase: true },
      }),
      db.searchFacet.findMany({
        where: { catalogVersionId: id },
        select: { facetId: true },
      }),
      db.searchTitleFacet.findMany({
        where: { catalogVersionId: id },
        select: { titleId: true, facetId: true },
      }),
    ]);
  try {
    buildSearchCatalogSnapshot(
      {
        row,
        relations: {
          occupations,
          titles,
          translations,
          aliases,
          facets,
          titleFacets,
        },
      },
      { allowDraft: true },
    );
  } catch (error) {
    const invalid = new Error("CATALOG_INVALID_RUNTIME") as Error & {
      details?: unknown;
    };
    invalid.details = {
      reason: error instanceof Error ? error.message : "validation_failed",
    };
    throw invalid;
  }
  const incomplete = titles
    .filter((title) => {
      const vi = translations.find(
        (translation) =>
          translation.titleId === title.titleId &&
          translation.locale === "VI" &&
          translation.value.trim(),
      );
      const en = translations.find(
        (translation) =>
          translation.titleId === title.titleId &&
          translation.locale === "EN" &&
          translation.value.trim(),
      );
      return !vi || !en;
    })
    .map((title) => title.titleId);
  if (incomplete.length) {
    const error = new Error("CATALOG_INCOMPLETE") as Error & {
      details?: unknown;
    };
    error.details = { missingTranslationTitleIds: incomplete.slice(0, 20) };
    throw error;
  }
}

async function previewDiff(db: AdminDb, row: CatalogVersionRow) {
  if (!row.parentVersion) {
    return {
      versionId: row.id,
      parentVersion: null,
      changedTitles: 0,
      addedTitles: 0,
      removedTitles: 0,
      changedTranslations: 0,
      estimatedAffectedJobs: 0,
    };
  }
  const parent = await db.searchCatalogVersion.findUnique({
    where: { version: row.parentVersion },
    select: { id: true },
  });
  if (!parent) throw new Error("TARGET_UNAVAILABLE");
  const [
    currentTitles,
    parentTitles,
    currentTranslations,
    parentTranslations,
    affectedJobs,
  ] = await Promise.all([
    db.searchJobTitle.findMany({
      where: { catalogVersionId: row.id },
      select: {
        titleId: true,
        occupationId: true,
        canonicalVi: true,
        canonicalEn: true,
        facetIds: true,
        translationStatus: true,
      },
    }),
    db.searchJobTitle.findMany({
      where: { catalogVersionId: parent.id },
      select: {
        titleId: true,
        occupationId: true,
        canonicalVi: true,
        canonicalEn: true,
        facetIds: true,
        translationStatus: true,
      },
    }),
    db.searchJobTitleTranslation.findMany({
      where: { catalogVersionId: row.id },
      select: { titleId: true, locale: true, value: true, status: true },
    }),
    db.searchJobTitleTranslation.findMany({
      where: { catalogVersionId: parent.id },
      select: { titleId: true, locale: true, value: true, status: true },
    }),
    db.jobSearchProjection.count({
      where: { catalogVersion: row.parentVersion },
    }),
  ]);
  const stable = (value: unknown) => JSON.stringify(value);
  const parentTitleMap = new Map(
    parentTitles.map((title) => [title.titleId, title]),
  );
  const currentTitleMap = new Map(
    currentTitles.map((title) => [title.titleId, title]),
  );
  const addedTitles = currentTitles.filter(
    (title) => !parentTitleMap.has(title.titleId),
  ).length;
  const removedTitles = parentTitles.filter(
    (title) => !currentTitleMap.has(title.titleId),
  ).length;
  const changedTitles = currentTitles.filter((title) => {
    const previous = parentTitleMap.get(title.titleId);
    return previous && stable(previous) !== stable(title);
  }).length;
  const parentTranslationMap = new Map(
    parentTranslations.map((translation) => [
      `${translation.titleId}:${translation.locale}`,
      translation,
    ]),
  );
  const changedTranslations = currentTranslations.filter((translation) => {
    const previous = parentTranslationMap.get(
      `${translation.titleId}:${translation.locale}`,
    );
    return previous && stable(previous) !== stable(translation);
  }).length;
  return {
    versionId: row.id,
    parentVersion: row.parentVersion,
    changedTitles,
    addedTitles,
    removedTitles,
    changedTranslations,
    estimatedAffectedJobs: affectedJobs,
  };
}

export class SearchCatalogVersionAdminService {
  async list(authority: AdminAuthority, raw: unknown) {
    await assertActiveGrant(authority, prisma);
    const input = searchCatalogVersionListQuerySchema.parse(raw);
    const where = whereFor(input);
    const [total, rows] = await Promise.all([
      prisma.searchCatalogVersion.count({ where }),
      prisma.searchCatalogVersion.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.perPage,
        take: input.perPage,
      }),
    ]);
    return {
      data: await Promise.all(rows.map((row) => project(prisma, row))),
      total,
      meta: {
        calculatedAt: new Date().toISOString(),
        stateDefinitionVersion: ADMIN_STATE_DEFINITION_VERSION,
      },
    };
  }

  async detail(authority: AdminAuthority, id: string) {
    await assertActiveGrant(authority, prisma);
    const row = await prisma.searchCatalogVersion.findUnique({ where: { id } });
    if (!row) throw new Error("TARGET_UNAVAILABLE");
    return project(prisma, row);
  }

  async preview(authority: AdminAuthority, id: string) {
    await assertActiveGrant(authority, prisma);
    const row = await prisma.searchCatalogVersion.findUnique({ where: { id } });
    if (!row) throw new Error("TARGET_UNAVAILABLE");
    return previewDiff(prisma, row);
  }

  async command(
    authority: AdminAuthority,
    id: string,
    raw: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const command = searchCatalogVersionCommandSchema.parse(raw);
    await assertActiveGrant(authority, prisma);
    const result = await new PrismaAdminCommandRepository().execute(
      {
        actorUserId: authority.userId,
        actorSessionId: authority.sessionId,
        grantId: authority.grantId,
        commandKind: `SEARCH_CATALOG_VERSION_${command.command}`,
        targetReference: id,
        idempotencyKey,
        normalizedBody: { id, expectedVersion, command },
      },
      async (tx, correlationId) => {
        await assertActiveGrant(authority, tx);
        const row = await tx.searchCatalogVersion.findUnique({ where: { id } });
        if (!row) throw new Error("TARGET_UNAVAILABLE");
        if (row.revision !== expectedVersion)
          throw new AdminCommandConflict("STALE_CONFLICT", row.revision);

        const now = new Date();
        if (command.command === "PUBLISH") {
          if (row.status !== "DRAFT") throw new Error("INVALID_STATE");
        } else if (command.command === "ROLLBACK") {
          if (row.status === "DRAFT") throw new Error("INVALID_STATE");
        } else if (row.status !== "PUBLISHED" || row.isActive) {
          throw new Error("INVALID_STATE");
        }

        if (command.command === "PUBLISH" || command.command === "ROLLBACK") {
          // Validate the exact immutable payload and every relational mirror
          // before changing the single active pointer. A bad rollback target
          // is just as unsafe as a bad draft publish.
          await validatePublishable(tx, row.id);
          await tx.searchCatalogVersion.updateMany({
            where: { isActive: true, id: { not: id } },
            data: {
              isActive: false,
              status: "RETIRED",
              retiredAt: now,
              retiredByAdminUserId: authority.userId,
              updatedAt: now,
            },
          });
        }

        const next = await tx.searchCatalogVersion.updateMany({
          where: {
            id,
            revision: expectedVersion,
            ...(command.command === "PUBLISH"
              ? { status: "DRAFT" as const }
              : command.command === "ROLLBACK"
                ? { status: { in: ["PUBLISHED", "RETIRED"] as const } }
                : { status: "PUBLISHED" as const, isActive: false }),
          },
          data:
            command.command === "RETIRE"
              ? {
                  status: "RETIRED",
                  isActive: false,
                  retiredAt: now,
                  retiredByAdminUserId: authority.userId,
                  revision: { increment: 1 },
                  updatedAt: now,
                }
              : {
                  status: "PUBLISHED",
                  isActive: true,
                  publishedAt: row.publishedAt ?? now,
                  publishedByAdminUserId:
                    row.publishedByAdminUserId ?? authority.userId,
                  retiredAt: null,
                  retiredByAdminUserId: null,
                  revision: { increment: 1 },
                  updatedAt: now,
                },
        });
        if (next.count !== 1) throw new AdminCommandConflict("STALE_CONFLICT");

        await new PrismaAuditRepository(tx).append({
          occurredAt: now,
          actorType: "user",
          actorUserId: authority.userId,
          actorSessionId: authority.sessionId,
          action: auditActions[command.command],
          targetType: "search_catalog_version",
          targetId: id,
          result: "SUCCESS",
          correlationId,
          context: {
            reasonCategory: command.reasonCategory,
            priorState: row.status,
            resultingState:
              command.command === "RETIRE" ? "RETIRED" : "PUBLISHED",
            targetVersion: expectedVersion + 1,
            runtimeCatalogVersion: row.version,
            runtimeSupported: command.command !== "RETIRE",
            outcome: `SEARCH_CATALOG_VERSION_${command.command}`,
          },
        });
        await new PrivilegedRationaleService().create(tx, {
          correlationId,
          explanation: command.explanation,
          actionAt: now,
        });
        return {
          id,
          version: expectedVersion + 1,
          catalogVersion: row.version,
          status: command.command === "RETIRE" ? "RETIRED" : "PUBLISHED",
          isActive: command.command !== "RETIRE",
          revision: expectedVersion + 1,
          runtimeSupported: command.command !== "RETIRE",
        };
      },
    );
    // The transaction has committed, so new requests must resolve the newly
    // active immutable snapshot. In-flight requests retain their captured
    // index because they pass it through the complete search pipeline.
    searchCatalogProvider.invalidate();
    return result;
  }
}
