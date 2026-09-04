import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import type { AdminAuthority } from "@/backend/security/admin-request-boundary";
import {
  PrismaAdminCommandRepository,
  AdminCommandConflict,
} from "@/backend/repositories/admin/prisma-admin-command-repository";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import { PrivilegedRationaleService } from "@/backend/admin/rationales/privileged-rationale-service";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import {
  searchMappingReviewCommandSchema,
  searchMappingReviewListQuerySchema,
} from "@/shared/contracts/admin/search-mapping-review";

const ADMIN_STATE_DEFINITION_VERSION = "search-state-v1" as const;
const auditActions = {
  APPROVE: "admin.search_mapping_review_approved",
  REJECT: "admin.search_mapping_review_rejected",
  MERGE: "admin.search_mapping_review_merged",
  INTENTIONAL_UNTRANSLATED:
    "admin.search_mapping_review_intentional_untranslated",
} as const;

function searchAliasId(input: {
  catalogVersionId: string;
  targetType: string;
  targetId: string;
  normalizedPhrase: string;
}) {
  const digest = createHash("sha256")
    .update(
      `${input.catalogVersionId}\u0000${input.targetType}\u0000${input.targetId}\u0000${input.normalizedPhrase}`,
    )
    .digest("hex");
  return `search-alias-${digest}`;
}

function searchTitleTranslationId(input: {
  catalogVersionId: string;
  titleId: string;
  locale: "VI" | "EN";
}) {
  const digest = createHash("sha256")
    .update(
      `${input.catalogVersionId}\u0000${input.titleId}\u0000${input.locale}`,
    )
    .digest("hex");
  return `search-title-translation-${digest}`;
}

function searchDraftVersion(sourceVersion: string, reviewId: string) {
  const digest = createHash("sha256")
    .update(`${sourceVersion}\u0000${reviewId}`)
    .digest("hex");
  // SearchCatalogVersion.version is globally unique and capped at 64 chars.
  // Hash the complete review identity so multiple reviews in one run cannot
  // collide on the shared `search-review-<run>-...` prefix.
  return `draft-${digest.slice(0, 58)}`;
}

type AdminDb = typeof prisma | Prisma.TransactionClient;

type ReviewRow = {
  id: string;
  catalogVersionId: string;
  openKey: string | null;
  originalTitle: string;
  normalizedTitle: string;
  context: Prisma.JsonValue;
  suggestedTitleId: string | null;
  suggestedTranslationVi: string | null;
  suggestedTranslationEn: string | null;
  suggestedOccupationId: string | null;
  suggestedFacetIds: string[];
  suggestedSkillSignals: string[];
  confidence: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "MERGED" | "DEDUPLICATED";
  version: number;
  decisionReason: string | null;
  resultCatalogVersionId: string | null;
  reviewedByAdminUserId: string | null;
  reviewedAt: Date | null;
  deduplicatedIntoReviewId: string | null;
  deduplicatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function project(row: ReviewRow) {
  return {
    id: row.id,
    catalogVersionId: row.catalogVersionId,
    openKey: row.openKey,
    originalTitle: row.originalTitle,
    normalizedTitle: row.normalizedTitle,
    context: row.context,
    suggestedTitleId: row.suggestedTitleId,
    suggestedTranslationVi: row.suggestedTranslationVi,
    suggestedTranslationEn: row.suggestedTranslationEn,
    suggestedOccupationId: row.suggestedOccupationId,
    suggestedFacetIds: row.suggestedFacetIds,
    suggestedSkillSignals: row.suggestedSkillSignals,
    confidence: row.confidence,
    status: row.status,
    version: row.version,
    decisionReason: row.decisionReason,
    resultCatalogVersionId: row.resultCatalogVersionId,
    reviewedByAdminUserId: row.reviewedByAdminUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    deduplicatedIntoReviewId: row.deduplicatedIntoReviewId,
    deduplicatedAt: row.deduplicatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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

function reviewWhere(input: {
  q?: string;
  status?: "PENDING" | "APPROVED" | "REJECTED" | "MERGED" | "DEDUPLICATED";
  catalogScope?: "ACTIVE" | "ALL";
  activeCatalogVersionId?: string;
}): Prisma.SearchMappingReviewWhereInput {
  return {
    ...(input.catalogScope !== "ALL"
      ? {
          catalogVersionId:
            input.activeCatalogVersionId ?? "__NO_ACTIVE_CATALOG__",
        }
      : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.q
      ? {
          OR: [
            { originalTitle: { contains: input.q, mode: "insensitive" } },
            { normalizedTitle: { contains: input.q, mode: "insensitive" } },
            { suggestedTitleId: { contains: input.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

async function copyCatalogToDraft(
  db: Prisma.TransactionClient,
  source: {
    id: string;
    version: string;
    status: "DRAFT" | "PUBLISHED" | "RETIRED";
    revision: number;
    catalogPayload: Prisma.JsonValue | null;
  },
  reviewId: string,
) {
  if (source.status === "DRAFT") return source;

  const existingDraft = await db.searchCatalogVersion.findFirst({
    where: {
      parentVersion: source.version,
      status: "DRAFT",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (existingDraft) return existingDraft;

  const draftVersion = searchDraftVersion(source.version, reviewId);
  const draft = await db.searchCatalogVersion.create({
    data: {
      id: `search-catalog-draft-${reviewId}`.slice(0, 180),
      version: draftVersion,
      status: "DRAFT",
      isActive: false,
      parentVersion: source.version,
      changeReason: `Draft created from mapping review ${reviewId}.`,
      catalogPayload:
        source.catalogPayload &&
        typeof source.catalogPayload === "object" &&
        !Array.isArray(source.catalogPayload)
          ? {
              ...(source.catalogPayload as Prisma.JsonObject),
              version: draftVersion,
            }
          : undefined,
    },
  });

  const [occupations, titles, translations, aliases, facets, titleFacets] =
    await Promise.all([
      db.searchOccupation.findMany({ where: { catalogVersionId: source.id } }),
      db.searchJobTitle.findMany({ where: { catalogVersionId: source.id } }),
      db.searchJobTitleTranslation.findMany({
        where: { catalogVersionId: source.id },
      }),
      db.searchAlias.findMany({ where: { catalogVersionId: source.id } }),
      db.searchFacet.findMany({ where: { catalogVersionId: source.id } }),
      db.searchTitleFacet.findMany({ where: { catalogVersionId: source.id } }),
    ]);

  await db.searchOccupation.createMany({
    data: occupations.map((row) => ({
      catalogVersionId: draft.id,
      occupationId: row.occupationId,
      labelVi: row.labelVi,
      labelEn: row.labelEn,
      aliasesVi: row.aliasesVi,
      aliasesEn: row.aliasesEn,
      sortOrder: row.sortOrder,
    })),
  });
  await db.searchJobTitle.createMany({
    data: titles.map((row) => ({
      catalogVersionId: draft.id,
      titleId: row.titleId,
      occupationId: row.occupationId,
      canonicalVi: row.canonicalVi,
      canonicalEn: row.canonicalEn,
      aliasesVi: row.aliasesVi,
      aliasesEn: row.aliasesEn,
      abbreviations: row.abbreviations,
      excludedTerms: row.excludedTerms,
      skillSignals: row.skillSignals,
      facetIds: row.facetIds,
      translationStatus: row.translationStatus,
      mappingSource: row.mappingSource,
      mappingConfidence: row.mappingConfidence,
      reviewReason: row.reviewReason,
    })),
  });
  await db.searchJobTitleTranslation.createMany({
    data: translations.map((row) => ({
      catalogVersionId: draft.id,
      titleId: row.titleId,
      locale: row.locale,
      value: row.value,
      status: row.status,
      source: row.source,
      confidence: row.confidence,
      reviewReason: row.reviewReason,
    })),
  });
  await db.searchAlias.createMany({
    data: aliases.map((row) => ({
      catalogVersionId: draft.id,
      targetType: row.targetType,
      targetId: row.targetId,
      phrase: row.phrase,
      normalizedPhrase: row.normalizedPhrase,
      locale: row.locale,
      source: row.source,
      confidence: row.confidence,
    })),
  });
  await db.searchFacet.createMany({
    data: facets.map((row) => ({
      catalogVersionId: draft.id,
      facetId: row.facetId,
      kind: row.kind,
      labelVi: row.labelVi,
      labelEn: row.labelEn,
    })),
  });
  await db.searchTitleFacet.createMany({
    data: titleFacets.map((row) => ({
      catalogVersionId: draft.id,
      titleId: row.titleId,
      facetId: row.facetId,
      required: row.required,
    })),
  });
  return draft;
}

export class SearchMappingReviewAdminService {
  async list(authority: AdminAuthority, raw: unknown) {
    await assertActiveGrant(authority, prisma);
    const input = searchMappingReviewListQuerySchema.parse(raw);
    const active =
      input.catalogScope === "ALL"
        ? null
        : await prisma.searchCatalogVersion.findFirst({
            where: { isActive: true, status: "PUBLISHED" },
            select: { id: true, version: true },
          });
    const where = reviewWhere({
      ...input,
      activeCatalogVersionId: active?.id,
    });
    const [total, rows] = await Promise.all([
      prisma.searchMappingReview.count({ where }),
      prisma.searchMappingReview.findMany({
        where,
        orderBy: [
          { status: "asc" },
          { confidence: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        skip: (input.page - 1) * input.perPage,
        take: input.perPage,
      }),
    ]);
    return {
      data: rows.map(project),
      total,
      meta: {
        calculatedAt: new Date().toISOString(),
        stateDefinitionVersion: ADMIN_STATE_DEFINITION_VERSION,
        catalogScope: input.catalogScope,
        activeCatalogVersion: active?.version ?? null,
      },
    };
  }

  async detail(authority: AdminAuthority, id: string) {
    await assertActiveGrant(authority, prisma);
    const row = await prisma.searchMappingReview.findUnique({ where: { id } });
    if (!row) throw new Error("TARGET_UNAVAILABLE");
    return project(row);
  }

  async command(
    authority: AdminAuthority,
    id: string,
    raw: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const command = searchMappingReviewCommandSchema.parse(raw);
    await assertActiveGrant(authority, prisma);
    return new PrismaAdminCommandRepository().execute(
      {
        actorUserId: authority.userId,
        actorSessionId: authority.sessionId,
        grantId: authority.grantId,
        commandKind: `SEARCH_MAPPING_REVIEW_${command.command}`,
        targetReference: id,
        idempotencyKey,
        normalizedBody: { id, expectedVersion, command },
      },
      async (tx, correlationId) => {
        await assertActiveGrant(authority, tx);
        const row = await tx.searchMappingReview.findUnique({ where: { id } });
        if (!row) throw new Error("TARGET_UNAVAILABLE");
        if (row.version !== expectedVersion)
          throw new AdminCommandConflict("STALE_CONFLICT", row.version);
        if (row.status !== "PENDING") throw new Error("INVALID_STATE");

        const now = new Date();
        let resultCatalogVersionId: string | null = null;
        let draftVersion: string | null = null;
        let parentCatalogVersion: string | null = null;
        let resolvedMapping: {
          titleId: string;
          translationVi: string;
          translationEn: string;
          occupationId: string | null;
          facetIds: string[];
        } | null = null;
        if (
          command.command === "APPROVE" ||
          command.command === "MERGE" ||
          command.command === "INTENTIONAL_UNTRANSLATED"
        ) {
          const source = await tx.searchCatalogVersion.findUnique({
            where: { id: row.catalogVersionId },
          });
          if (!source) throw new Error("TARGET_UNAVAILABLE");
          parentCatalogVersion = source.version;
          const draft = await copyCatalogToDraft(tx, source, id);
          resultCatalogVersionId = draft.id;
          draftVersion = draft.version;

          if (command.command === "APPROVE") {
            const titleId = command.titleId ?? row.suggestedTitleId;
            if (!titleId) throw new Error("TITLE_MAPPING_REQUIRED");
            const title = await tx.searchJobTitle.findFirst({
              where: { catalogVersionId: draft.id, titleId },
            });
            if (!title) throw new Error("TARGET_UNAVAILABLE");
            const canonicalVi =
              command.translationVi ??
              row.suggestedTranslationVi ??
              title.canonicalVi;
            const canonicalEn =
              command.translationEn ??
              row.suggestedTranslationEn ??
              title.canonicalEn;
            const occupationId =
              command.occupationId ??
              row.suggestedOccupationId ??
              title.occupationId;
            const facetIds = command.facetIds ?? row.suggestedFacetIds;
            resolvedMapping = {
              titleId,
              translationVi: canonicalVi,
              translationEn: canonicalEn,
              occupationId,
              facetIds,
            };
            await tx.searchJobTitle.update({
              where: { id: title.id },
              data: {
                canonicalVi,
                canonicalEn,
                occupationId,
                facetIds,
                translationStatus: "HUMAN_VERIFIED",
                mappingSource: "MANUAL_REVIEW",
                mappingConfidence: 1,
                reviewReason: null,
              },
            });
            for (const [locale, value] of [
              ["VI", canonicalVi],
              ["EN", canonicalEn],
            ] as const) {
              await tx.searchJobTitleTranslation.upsert({
                where: {
                  catalogVersionId_titleId_locale: {
                    catalogVersionId: draft.id,
                    titleId,
                    locale,
                  },
                },
                create: {
                  id: searchTitleTranslationId({
                    catalogVersionId: draft.id,
                    titleId,
                    locale,
                  }),
                  catalogVersionId: draft.id,
                  titleId,
                  locale,
                  value,
                  status: "HUMAN_VERIFIED",
                  source: "MANUAL_REVIEW",
                  confidence: 1,
                  reviewReason: null,
                },
                update: {
                  value,
                  status: "HUMAN_VERIFIED",
                  source: "MANUAL_REVIEW",
                  confidence: 1,
                  reviewReason: null,
                },
              });
            }

            const draftPayload = await tx.searchCatalogVersion.findUnique({
              where: { id: draft.id },
              select: { catalogPayload: true },
            });
            if (
              !draftPayload?.catalogPayload ||
              typeof draftPayload.catalogPayload !== "object" ||
              Array.isArray(draftPayload.catalogPayload)
            ) {
              throw new Error("CATALOG_INVALID_RUNTIME");
            }
            const payload = draftPayload.catalogPayload as Prisma.JsonObject;
            const definitions = Array.isArray(payload.titleDefinitions)
              ? payload.titleDefinitions
              : [];
            let matchedDefinition = false;
            const nextDefinitions = definitions.map((definition) => {
              if (
                !definition ||
                typeof definition !== "object" ||
                Array.isArray(definition) ||
                definition.titleId !== titleId
              )
                return definition;
              matchedDefinition = true;
              return {
                ...(definition as Prisma.JsonObject),
                occupationId,
                canonical: { vi: canonicalVi, en: canonicalEn },
                facetIds,
                translationStatus: "HUMAN_VERIFIED",
                mappingSource: "MANUAL_REVIEW",
                mappingConfidence: 1,
                reviewReason: null,
                status: "HUMAN_VERIFIED",
              };
            });
            if (!matchedDefinition) throw new Error("TARGET_UNAVAILABLE");
            await tx.searchCatalogVersion.update({
              where: { id: draft.id },
              data: {
                catalogPayload: {
                  ...payload,
                  titleDefinitions: nextDefinitions,
                },
              },
            });
          } else if (command.command === "INTENTIONAL_UNTRANSLATED") {
            const titleId = command.titleId ?? row.suggestedTitleId;
            if (!titleId) throw new Error("TITLE_MAPPING_REQUIRED");
            const title = await tx.searchJobTitle.findFirst({
              where: { catalogVersionId: draft.id, titleId },
            });
            if (!title) throw new Error("TARGET_UNAVAILABLE");
            const canonicalEn =
              command.translationEn ??
              row.suggestedTranslationEn ??
              title.canonicalEn;
            if (!canonicalEn.trim()) throw new Error("TITLE_MAPPING_REQUIRED");
            const occupationId =
              command.occupationId ??
              row.suggestedOccupationId ??
              title.occupationId;
            const facetIds = command.facetIds ?? row.suggestedFacetIds;
            resolvedMapping = {
              titleId,
              translationVi: canonicalEn,
              translationEn: canonicalEn,
              occupationId,
              facetIds,
            };
            await tx.searchJobTitle.update({
              where: { id: title.id },
              data: {
                canonicalVi: canonicalEn,
                canonicalEn,
                aliasesVi: [],
                occupationId,
                facetIds,
                translationStatus: "INTENTIONAL_UNTRANSLATED",
                mappingSource: "MANUAL_REVIEW",
                mappingConfidence: 1,
                reviewReason: command.explanation,
              },
            });
            for (const [locale, value] of [
              ["VI", canonicalEn],
              ["EN", canonicalEn],
            ] as const) {
              await tx.searchJobTitleTranslation.upsert({
                where: {
                  catalogVersionId_titleId_locale: {
                    catalogVersionId: draft.id,
                    titleId,
                    locale,
                  },
                },
                create: {
                  id: searchTitleTranslationId({
                    catalogVersionId: draft.id,
                    titleId,
                    locale,
                  }),
                  catalogVersionId: draft.id,
                  titleId,
                  locale,
                  value,
                  status: "INTENTIONAL_UNTRANSLATED",
                  source: "MANUAL_REVIEW",
                  confidence: 1,
                  reviewReason: command.explanation,
                },
                update: {
                  value,
                  status: "INTENTIONAL_UNTRANSLATED",
                  source: "MANUAL_REVIEW",
                  confidence: 1,
                  reviewReason: command.explanation,
                },
              });
            }

            const draftPayload = await tx.searchCatalogVersion.findUnique({
              where: { id: draft.id },
              select: { catalogPayload: true },
            });
            if (
              !draftPayload?.catalogPayload ||
              typeof draftPayload.catalogPayload !== "object" ||
              Array.isArray(draftPayload.catalogPayload)
            ) {
              throw new Error("CATALOG_INVALID_RUNTIME");
            }
            const payload = draftPayload.catalogPayload as Prisma.JsonObject;
            const definitions = Array.isArray(payload.titleDefinitions)
              ? payload.titleDefinitions
              : [];
            let matchedDefinition = false;
            const nextDefinitions = definitions.map((definition) => {
              if (
                !definition ||
                typeof definition !== "object" ||
                Array.isArray(definition) ||
                definition.titleId !== titleId
              )
                return definition;
              matchedDefinition = true;
              const existingAliases =
                definition.aliases &&
                typeof definition.aliases === "object" &&
                !Array.isArray(definition.aliases)
                  ? (definition.aliases as Prisma.JsonObject)
                  : {};
              const aliasesEn = Array.isArray(existingAliases.en)
                ? existingAliases.en.filter(
                    (value): value is string => typeof value === "string",
                  )
                : [];
              return {
                ...(definition as Prisma.JsonObject),
                occupationId,
                canonical: { vi: canonicalEn, en: canonicalEn },
                aliases: { vi: [], en: aliasesEn },
                facetIds,
                translationStatus: "INTENTIONAL_UNTRANSLATED",
                mappingSource: "MANUAL_REVIEW",
                mappingConfidence: 1,
                reviewReason: command.explanation,
                status: "INTENTIONAL_UNTRANSLATED",
              };
            });
            if (!matchedDefinition) throw new Error("TARGET_UNAVAILABLE");
            await tx.searchCatalogVersion.update({
              where: { id: draft.id },
              data: {
                catalogPayload: {
                  ...payload,
                  titleDefinitions: nextDefinitions,
                },
              },
            });
          } else {
            const targetTitle = await tx.searchJobTitle.findFirst({
              where: {
                catalogVersionId: draft.id,
                titleId: command.targetTitleId,
              },
            });
            if (!targetTitle) throw new Error("TARGET_UNAVAILABLE");

            const mergedPhrase = row.originalTitle.trim();
            const normalizedMergedPhrase = normalizeSearchText(
              mergedPhrase,
              160,
            );
            if (!normalizedMergedPhrase)
              throw new Error("TITLE_MAPPING_REQUIRED");

            const appendAlias = (values: readonly string[]) => {
              if (
                values.some(
                  (value) =>
                    normalizeSearchText(value, 160) === normalizedMergedPhrase,
                )
              )
                return [...values];
              return [...values.slice(0, 63), mergedPhrase];
            };
            const aliasesVi = appendAlias(targetTitle.aliasesVi);
            const aliasesEn = appendAlias(targetTitle.aliasesEn);
            await tx.searchJobTitle.update({
              where: { id: targetTitle.id },
              data: { aliasesVi, aliasesEn },
            });

            const existingAlias = await tx.searchAlias.findFirst({
              where: {
                catalogVersionId: draft.id,
                targetType: "TITLE",
                targetId: command.targetTitleId,
                normalizedPhrase: normalizedMergedPhrase,
                locale: null,
              },
            });
            if (!existingAlias) {
              await tx.searchAlias.create({
                data: {
                  id: searchAliasId({
                    catalogVersionId: draft.id,
                    targetType: "TITLE",
                    targetId: command.targetTitleId,
                    normalizedPhrase: normalizedMergedPhrase,
                  }),
                  catalogVersionId: draft.id,
                  targetType: "TITLE",
                  targetId: command.targetTitleId,
                  phrase: mergedPhrase,
                  normalizedPhrase: normalizedMergedPhrase,
                  locale: null,
                  source: "MANUAL_REVIEW",
                  confidence: 1,
                },
              });
            }

            const draftPayload = await tx.searchCatalogVersion.findUnique({
              where: { id: draft.id },
              select: { catalogPayload: true },
            });
            if (
              !draftPayload?.catalogPayload ||
              typeof draftPayload.catalogPayload !== "object" ||
              Array.isArray(draftPayload.catalogPayload)
            ) {
              throw new Error("CATALOG_INVALID_RUNTIME");
            }
            const payload = draftPayload.catalogPayload as Prisma.JsonObject;
            const definitions = Array.isArray(payload.titleDefinitions)
              ? payload.titleDefinitions
              : [];
            let matchedDefinition = false;
            const nextDefinitions = definitions.map((definition) => {
              if (
                !definition ||
                typeof definition !== "object" ||
                Array.isArray(definition) ||
                definition.titleId !== command.targetTitleId
              )
                return definition;
              matchedDefinition = true;
              const existingAliases =
                definition.aliases &&
                typeof definition.aliases === "object" &&
                !Array.isArray(definition.aliases)
                  ? (definition.aliases as Prisma.JsonObject)
                  : {};
              const payloadAliases = (key: "vi" | "en") => {
                const values = Array.isArray(existingAliases[key])
                  ? existingAliases[key].filter(
                      (value): value is string => typeof value === "string",
                    )
                  : [];
                return appendAlias(values);
              };
              return {
                ...(definition as Prisma.JsonObject),
                aliases: {
                  vi: payloadAliases("vi"),
                  en: payloadAliases("en"),
                },
              };
            });
            if (!matchedDefinition) throw new Error("TARGET_UNAVAILABLE");
            await tx.searchCatalogVersion.update({
              where: { id: draft.id },
              data: {
                catalogPayload: {
                  ...payload,
                  titleDefinitions: nextDefinitions,
                },
              },
            });
          }
        }

        const nextStatus =
          command.command === "APPROVE" ||
          command.command === "INTENTIONAL_UNTRANSLATED"
            ? "APPROVED"
            : command.command === "MERGE"
              ? "MERGED"
              : "REJECTED";
        const updated = await tx.searchMappingReview.updateMany({
          where: { id, version: expectedVersion, status: "PENDING" },
          data: {
            status: nextStatus,
            version: { increment: 1 },
            decisionReason: command.explanation,
            reviewedByAdminUserId: authority.userId,
            reviewedAt: now,
            openKey: null,
            resultCatalogVersionId,
            updatedAt: now,
            ...(resolvedMapping
              ? {
                  suggestedTitleId: resolvedMapping.titleId,
                  suggestedTranslationVi: resolvedMapping.translationVi,
                  suggestedTranslationEn: resolvedMapping.translationEn,
                  suggestedOccupationId: resolvedMapping.occupationId,
                  suggestedFacetIds: resolvedMapping.facetIds,
                }
              : {}),
          },
        });
        if (updated.count !== 1)
          throw new AdminCommandConflict("STALE_CONFLICT");

        await new PrismaAuditRepository(tx).append({
          occurredAt: now,
          actorType: "user",
          actorUserId: authority.userId,
          actorSessionId: authority.sessionId,
          action: auditActions[command.command],
          targetType: "search_mapping_review",
          targetId: id,
          result: "SUCCESS",
          correlationId,
          context: {
            priorState: row.status,
            resultingState: nextStatus,
            targetVersion: expectedVersion + 1,
            parentCatalogVersionId: row.catalogVersionId,
            ...(parentCatalogVersion ? { parentCatalogVersion } : {}),
            ...(resultCatalogVersionId ? { resultCatalogVersionId } : {}),
            ...(draftVersion ? { draftVersion } : {}),
            ...(command.command === "MERGE"
              ? { targetTitleId: command.targetTitleId }
              : {}),
            beforeReference: {
              reviewId: id,
              status: row.status,
              version: expectedVersion,
              openKey: row.openKey,
            },
            afterReference: {
              reviewId: id,
              status: nextStatus,
              version: expectedVersion + 1,
              ...(resultCatalogVersionId ? { resultCatalogVersionId } : {}),
              ...(draftVersion ? { draftVersion } : {}),
            },
            reasonCategory: command.reasonCategory,
            outcome:
              command.command === "INTENTIONAL_UNTRANSLATED"
                ? "SEARCH_MAPPING_REVIEW_INTENTIONAL_UNTRANSLATED"
                : "SEARCH_MAPPING_REVIEW_DECIDED",
          },
        });
        await new PrivilegedRationaleService().create(tx, {
          correlationId,
          explanation: command.explanation,
          actionAt: now,
        });

        return {
          id,
          status: nextStatus,
          version: expectedVersion + 1,
          resultCatalogVersionId,
          draftVersion,
        };
      },
    );
  }
}
