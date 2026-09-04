import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@/backend/generated/prisma/client";
import type { JobSearchProfile } from "@/shared/contracts/search/job-search-intent";
import { searchMappingReviewTitleOpenKey } from "@/shared/utils/search/search-mapping-review-key";

export type JobSearchProjectionData = Readonly<{
  jobPostingId: string;
  titleIds: string[];
  occupationIds: string[];
  facetIds: string[];
  canonicalTitleVi: string | null;
  canonicalTitleEn: string | null;
  normalizedTitle: string;
  normalizedAliases: string[];
  normalizedSkills: string[];
  profileSource: JobSearchProfile["source"];
  profileConfidence: number;
  translationStatus: JobSearchProfile["translationStatus"];
  mappingSource: JobSearchProfile["mappingSource"];
  mappingConfidence: number;
  catalogVersion: string;
}>;

export type SearchMappingReviewContext = Readonly<{
  originalTitle?: string | null;
  industryCode?: string | null;
  categoryIds?: readonly (string | null | undefined)[];
  sampleJobId?: string | null;
}>;

type SearchMappingReviewDatabase = Pick<
  Prisma.TransactionClient,
  "jobSearchProjection" | "searchCatalogVersion" | "searchMappingReview"
>;

export const searchMappingReviewRequiredStatuses = new Set<
  JobSearchProfile["translationStatus"]
>(["REQUIRES_REVIEW", "AMBIGUOUS", "UNMAPPED"]);

function normalizedContext(context: SearchMappingReviewContext = {}) {
  const industryCode = context.industryCode?.trim().toLowerCase() || null;
  const categoryIds = [
    ...new Set(
      (context.categoryIds ?? [])
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  return { industryCode, categoryIds };
}

export function searchMappingReviewOpenKey(
  profile: JobSearchProfile,
  context: SearchMappingReviewContext,
) {
  if (profile.titleIds.length === 1 && profile.canonicalTitleEn) {
    return searchMappingReviewTitleOpenKey(
      profile.catalogVersion,
      profile.canonicalTitleEn,
    );
  }
  const scope = normalizedContext(context);
  const scopeValue = JSON.stringify({
    title: profile.normalizedTitle,
    industryCode: scope.industryCode,
    categoryIds: scope.categoryIds,
  });
  const digest = createHash("sha256").update(scopeValue).digest("hex");
  return `search-mapping:${profile.catalogVersion}:${profile.normalizedTitle.slice(0, 120)}:${digest.slice(0, 16)}`.slice(
    0,
    240,
  );
}

function reviewContextPayload(
  jobPostingId: string,
  profile: JobSearchProfile,
  context: SearchMappingReviewContext,
) {
  const scope = normalizedContext(context);
  return {
    schemaVersion: "search-mapping-review-context-v1",
    catalogVersion: profile.catalogVersion,
    scope,
    sampleJobIds: [jobPostingId].filter(Boolean).slice(0, 8),
    occupationIds: profile.occupationIds.slice(0, 16),
    facetIds: profile.facetIds.slice(0, 16),
    skillSignals: profile.normalizedSkills.slice(0, 16),
    profileSource: profile.source,
    translationStatus: profile.translationStatus,
  } satisfies Prisma.JsonObject;
}

function suggestedTranslationVi(profile: JobSearchProfile) {
  if (!profile.canonicalTitleVi || !profile.canonicalTitleEn) {
    return profile.canonicalTitleVi;
  }
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .trim()
      .toLocaleLowerCase();
  return normalize(profile.canonicalTitleVi) ===
    normalize(profile.canonicalTitleEn)
    ? null
    : profile.canonicalTitleVi;
}

export async function ensureSearchMappingReview(
  db: Pick<
    Prisma.TransactionClient,
    "searchCatalogVersion" | "searchMappingReview"
  >,
  jobPostingId: string,
  profile: JobSearchProfile,
  context: SearchMappingReviewContext = {},
) {
  if (!searchMappingReviewRequiredStatuses.has(profile.translationStatus))
    return null;
  const catalogVersion = await db.searchCatalogVersion.findUnique({
    where: { version: profile.catalogVersion },
    select: { id: true },
  });
  if (!catalogVersion) {
    throw new Error("SEARCH_CATALOG_VERSION_UNAVAILABLE");
  }
  const title = context.originalTitle?.trim() || profile.normalizedTitle;
  const openKey = searchMappingReviewOpenKey(profile, context);
  const reviewPayload = {
    catalogVersionId: catalogVersion.id,
    openKey,
    originalTitle: title.slice(0, 160),
    normalizedTitle: profile.normalizedTitle.slice(0, 160),
    context: reviewContextPayload(jobPostingId, profile, context),
    suggestedTitleId:
      profile.titleIds.length === 1 ? profile.titleIds[0] : null,
    suggestedTranslationVi: suggestedTranslationVi(profile),
    suggestedTranslationEn: profile.canonicalTitleEn,
    suggestedOccupationId:
      profile.occupationIds.length === 1 ? profile.occupationIds[0] : null,
    suggestedFacetIds: profile.facetIds.slice(0, 16),
    suggestedSkillSignals: profile.normalizedSkills.slice(0, 16),
    confidence: Math.max(0, Math.min(1, profile.mappingConfidence)),
  } satisfies Prisma.SearchMappingReviewCreateInput;

  const existing = await db.searchMappingReview.findUnique({
    where: { openKey },
    select: { id: true, status: true },
  });
  if (existing) {
    await db.searchMappingReview.update({
      where: { id: existing.id },
      data: {
        context: reviewPayload.context,
        suggestedTitleId: reviewPayload.suggestedTitleId,
        suggestedTranslationVi: reviewPayload.suggestedTranslationVi,
        suggestedTranslationEn: reviewPayload.suggestedTranslationEn,
        suggestedOccupationId: reviewPayload.suggestedOccupationId,
        suggestedFacetIds: reviewPayload.suggestedFacetIds,
        suggestedSkillSignals: reviewPayload.suggestedSkillSignals,
        confidence: reviewPayload.confidence,
        updatedAt: new Date(),
      },
    });
    return existing;
  }
  try {
    return await db.searchMappingReview.create({ data: reviewPayload });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return db.searchMappingReview.findUnique({
        where: { openKey },
        select: { id: true, status: true },
      });
    }
    throw error;
  }
}

export function jobSearchProjectionData(
  jobPostingId: string,
  profile: JobSearchProfile,
): JobSearchProjectionData {
  return {
    jobPostingId,
    titleIds: [...new Set(profile.titleIds)],
    occupationIds: [...new Set(profile.occupationIds)],
    facetIds: [...new Set(profile.facetIds)],
    canonicalTitleVi: profile.canonicalTitleVi,
    canonicalTitleEn: profile.canonicalTitleEn,
    normalizedTitle: profile.normalizedTitle,
    normalizedAliases: [...new Set(profile.normalizedAliases)],
    normalizedSkills: [...new Set(profile.normalizedSkills)],
    profileSource: profile.source,
    profileConfidence: profile.confidence,
    translationStatus: profile.translationStatus,
    mappingSource: profile.mappingSource,
    mappingConfidence: profile.mappingConfidence,
    catalogVersion: profile.catalogVersion,
  };
}

export function jobSearchProjectionNeedsRefresh(
  existing:
    | Pick<
        JobSearchProjectionData,
        | "occupationIds"
        | "facetIds"
        | "titleIds"
        | "canonicalTitleVi"
        | "canonicalTitleEn"
        | "normalizedTitle"
        | "normalizedAliases"
        | "normalizedSkills"
        | "profileSource"
        | "profileConfidence"
        | "translationStatus"
        | "mappingSource"
        | "mappingConfidence"
        | "catalogVersion"
      >
    | null
    | undefined,
  next: JobSearchProjectionData,
) {
  if (!existing) return true;
  return (
    JSON.stringify(existing.titleIds) !== JSON.stringify(next.titleIds) ||
    existing.normalizedTitle !== next.normalizedTitle ||
    existing.canonicalTitleVi !== next.canonicalTitleVi ||
    existing.canonicalTitleEn !== next.canonicalTitleEn ||
    JSON.stringify(existing.normalizedAliases) !==
      JSON.stringify(next.normalizedAliases) ||
    existing.profileSource !== next.profileSource ||
    existing.profileConfidence !== next.profileConfidence ||
    existing.translationStatus !== next.translationStatus ||
    existing.mappingSource !== next.mappingSource ||
    existing.mappingConfidence !== next.mappingConfidence ||
    existing.catalogVersion !== next.catalogVersion ||
    JSON.stringify(existing.occupationIds) !==
      JSON.stringify(next.occupationIds) ||
    JSON.stringify(existing.facetIds) !== JSON.stringify(next.facetIds) ||
    JSON.stringify(existing.normalizedSkills) !==
      JSON.stringify(next.normalizedSkills)
  );
}

export async function upsertJobSearchProjection(
  db: SearchMappingReviewDatabase,
  jobPostingId: string,
  profile: JobSearchProfile,
  reviewContext: SearchMappingReviewContext = {},
) {
  // Keep the rollout forward-compatible: application writes may reach a
  // database before migration 082 is deployed. The repository can continue
  // using its legacy taxonomy fallback until the projection is available;
  // all other database errors must still surface.
  if (process.env.SEARCH_PROFILE_PROJECTION === "0") return null;
  const data = jobSearchProjectionData(jobPostingId, profile);
  try {
    const projection = await db.jobSearchProjection.upsert({
      where: { jobPostingId },
      create: data,
      update: {
        titleIds: data.titleIds,
        occupationIds: data.occupationIds,
        facetIds: data.facetIds,
        canonicalTitleVi: data.canonicalTitleVi,
        canonicalTitleEn: data.canonicalTitleEn,
        normalizedTitle: data.normalizedTitle,
        normalizedAliases: data.normalizedAliases,
        normalizedSkills: data.normalizedSkills,
        profileSource: data.profileSource,
        profileConfidence: data.profileConfidence,
        translationStatus: data.translationStatus,
        mappingSource: data.mappingSource,
        mappingConfidence: data.mappingConfidence,
        catalogVersion: data.catalogVersion,
      },
    });
    await ensureSearchMappingReview(db, jobPostingId, profile, reviewContext);
    return projection;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2021"
    ) {
      return null;
    }
    throw error;
  }
}
