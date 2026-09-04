import { config } from "dotenv";
import { resolve } from "node:path";
import { normalizeSearchText } from "../src/backend/services/jobs/search-normalization";
import { jobSearchCatalogIndex } from "../src/backend/services/search/catalogs/job-search-catalog-index";
import { searchMappingReviewTitleOpenKey } from "../src/shared/utils/search/search-mapping-review-key";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

type PrismaDatabase = typeof import("../src/backend/database/prisma").prisma;

const catalog = jobSearchCatalogIndex.catalog;
const version = catalog.version;
const dryRun = !process.argv.includes("--apply");
let database: PrismaDatabase | undefined;

function idPart(value: string) {
  return normalizeSearchText(value, 180)
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 120);
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}-${parts.map(idPart).join("-")}`.slice(0, 180);
}

function normalized(value: string) {
  return normalizeSearchText(value, 160);
}

function aliasId(
  targetType: string,
  targetId: string,
  phrase: string,
  locale: string,
) {
  return stableId(
    "search-alias",
    version,
    targetType,
    targetId,
    locale,
    normalized(phrase),
  );
}

function needsReview(status: string) {
  return ["REQUIRES_REVIEW", "AMBIGUOUS", "UNMAPPED"].includes(status);
}

async function main() {
  const { prisma } = await import("../src/backend/database/prisma");
  database = prisma;
  const [existingVersion, activeVersion] = await Promise.all([
    prisma.searchCatalogVersion.findUnique({ where: { version } }),
    prisma.searchCatalogVersion.findFirst({
      where: { isActive: true },
      select: { id: true, version: true },
    }),
  ]);
  const titles = catalog.titleDefinitions ?? [];
  const reviewTitles = titles.filter((title) =>
    needsReview(title.translationStatus),
  );
  const report = {
    mode: dryRun ? "DRY_RUN" : "APPLY",
    version,
    occupations: catalog.occupations.length,
    titles: titles.length,
    facets: catalog.facets.length,
    titleFacets: titles.reduce(
      (count, title) => count + title.facetIds.length,
      0,
    ),
    reviewTitles: reviewTitles.length,
    activeVersion: activeVersion?.version ?? null,
  };

  if (dryRun) {
    console.log(`SEARCH_CATALOG_BOOTSTRAP\n${JSON.stringify(report, null, 2)}`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const row = existingVersion
      ? existingVersion
      : await tx.searchCatalogVersion.create({
          data: {
            id: stableId("search-catalog-version", version),
            version,
            // Bootstrapping must never bypass the catalog lifecycle. When an
            // active version already exists, the imported snapshot is a draft
            // and can only become active through the authenticated publish
            // command (which validates the immutable payload and writes audit
            // evidence). A first catalog may be published atomically because
            // there is no previous runtime snapshot to retire.
            status: activeVersion ? "DRAFT" : "PUBLISHED",
            isActive: !activeVersion,
            parentVersion: activeVersion?.version ?? null,
            changeReason: activeVersion
              ? `Release bootstrap from active catalog ${activeVersion.version}.`
              : "Initial operational bootstrap from the validated search catalog.",
            catalogPayload: catalog,
          },
        });
    const catalogVersionId = row.id;

    // A bootstrap may run after the lifecycle row already exists (for
    // example, on a database created by the pre-runtime implementation).
    // Populate the immutable payload only when it is missing; a published
    // version must never be silently replaced by a different payload.
    if (!row.catalogPayload) {
      await tx.searchCatalogVersion.update({
        where: { id: row.id },
        data: { catalogPayload: catalog },
      });
    }

    for (const [sortOrder, occupation] of catalog.occupations.entries()) {
      await tx.searchOccupation.upsert({
        where: {
          catalogVersionId_occupationId: {
            catalogVersionId,
            occupationId: occupation.occupationId,
          },
        },
        create: {
          id: stableId("search-occupation", version, occupation.occupationId),
          catalogVersionId,
          occupationId: occupation.occupationId,
          labelVi: occupation.labels.vi,
          labelEn: occupation.labels.en,
          aliasesVi: occupation.aliases
            .filter((alias) => alias.language === "vi")
            .map((alias) => alias.phrase),
          aliasesEn: occupation.aliases
            .filter((alias) => alias.language === "en")
            .map((alias) => alias.phrase),
          sortOrder,
        },
        update: {
          labelVi: occupation.labels.vi,
          labelEn: occupation.labels.en,
          aliasesVi: occupation.aliases
            .filter((alias) => alias.language === "vi")
            .map((alias) => alias.phrase),
          aliasesEn: occupation.aliases
            .filter((alias) => alias.language === "en")
            .map((alias) => alias.phrase),
          sortOrder,
        },
      });
    }

    for (const facet of catalog.facets) {
      await tx.searchFacet.upsert({
        where: {
          catalogVersionId_facetId: {
            catalogVersionId,
            facetId: facet.facetId,
          },
        },
        create: {
          id: stableId("search-facet", version, facet.facetId),
          catalogVersionId,
          facetId: facet.facetId,
          kind: facet.kind,
          labelVi: facet.labels.vi,
          labelEn: facet.labels.en,
        },
        update: {
          kind: facet.kind,
          labelVi: facet.labels.vi,
          labelEn: facet.labels.en,
        },
      });
    }

    for (const title of titles) {
      await tx.searchJobTitle.upsert({
        where: {
          catalogVersionId_titleId: {
            catalogVersionId,
            titleId: title.titleId,
          },
        },
        create: {
          id: stableId("search-title", version, title.titleId),
          catalogVersionId,
          titleId: title.titleId,
          occupationId: title.occupationId,
          canonicalVi: title.canonical.vi,
          canonicalEn: title.canonical.en,
          aliasesVi: title.aliases.vi,
          aliasesEn: title.aliases.en,
          abbreviations: title.abbreviations,
          excludedTerms: title.excludedTerms,
          skillSignals: title.skillSignals,
          facetIds: title.facetIds,
          translationStatus: title.translationStatus,
          mappingSource: title.mappingSource,
          mappingConfidence: title.mappingConfidence,
          reviewReason: title.reviewReason,
        },
        update: {
          occupationId: title.occupationId,
          canonicalVi: title.canonical.vi,
          canonicalEn: title.canonical.en,
          aliasesVi: title.aliases.vi,
          aliasesEn: title.aliases.en,
          abbreviations: title.abbreviations,
          excludedTerms: title.excludedTerms,
          skillSignals: title.skillSignals,
          facetIds: title.facetIds,
          translationStatus: title.translationStatus,
          mappingSource: title.mappingSource,
          mappingConfidence: title.mappingConfidence,
          reviewReason: title.reviewReason,
        },
      });

      for (const [locale, value] of [
        ["VI", title.canonical.vi],
        ["EN", title.canonical.en],
      ] as const) {
        await tx.searchJobTitleTranslation.upsert({
          where: {
            catalogVersionId_titleId_locale: {
              catalogVersionId,
              titleId: title.titleId,
              locale,
            },
          },
          create: {
            id: stableId(
              "search-title-translation",
              version,
              title.titleId,
              locale,
            ),
            catalogVersionId,
            titleId: title.titleId,
            locale,
            value,
            status: title.translationStatus,
            source: title.mappingSource,
            confidence: title.mappingConfidence,
            reviewReason: title.reviewReason,
          },
          update: {
            value,
            status: title.translationStatus,
            source: title.mappingSource,
            confidence: title.mappingConfidence,
            reviewReason: title.reviewReason,
          },
        });
      }

      for (const [locale, phrases] of [
        ["VI", title.aliases.vi],
        ["EN", title.aliases.en],
      ] as const) {
        for (const phrase of phrases) {
          const aliasKey = aliasId("TITLE", title.titleId, phrase, locale);
          await tx.searchAlias.upsert({
            where: { id: aliasKey },
            create: {
              id: aliasKey,
              catalogVersionId,
              targetType: "TITLE",
              targetId: title.titleId,
              phrase,
              normalizedPhrase: normalized(phrase),
              locale,
              source: title.mappingSource,
              confidence: title.mappingConfidence,
            },
            update: {
              phrase,
              normalizedPhrase: normalized(phrase),
              source: title.mappingSource,
              confidence: title.mappingConfidence,
            },
          });
        }
      }
      for (const phrase of title.abbreviations) {
        const aliasKey = aliasId("TITLE", title.titleId, phrase, "NEUTRAL");
        await tx.searchAlias.upsert({
          where: { id: aliasKey },
          create: {
            id: aliasKey,
            catalogVersionId,
            targetType: "TITLE",
            targetId: title.titleId,
            phrase,
            normalizedPhrase: normalized(phrase),
            source: title.mappingSource,
            confidence: title.mappingConfidence,
          },
          update: {
            phrase,
            normalizedPhrase: normalized(phrase),
            source: title.mappingSource,
            confidence: title.mappingConfidence,
          },
        });
      }
      for (const facetId of title.facetIds) {
        await tx.searchTitleFacet.upsert({
          where: {
            catalogVersionId_titleId_facetId: {
              catalogVersionId,
              titleId: title.titleId,
              facetId,
            },
          },
          create: {
            id: stableId("search-title-facet", version, title.titleId, facetId),
            catalogVersionId,
            titleId: title.titleId,
            facetId,
          },
          update: {},
        });
      }
      if (needsReview(title.translationStatus)) {
        const reviewId = stableId(
          "search-mapping-review",
          version,
          title.titleId,
        );
        const context = {
          industryCode: title.industryCode,
          categoryIds: title.categoryIds,
          occupationId: title.occupationId,
          skillSignals: title.skillSignals,
          facetIds: title.facetIds,
        };
        const existingReview = await tx.searchMappingReview.findUnique({
          where: { id: reviewId },
          select: { id: true, status: true },
        });
        if (!existingReview) {
          await tx.searchMappingReview.create({
            data: {
              id: reviewId,
              catalogVersionId,
              openKey: searchMappingReviewTitleOpenKey(
                version,
                title.canonical.en,
              ),
              originalTitle: title.canonical.en,
              normalizedTitle: normalized(title.canonical.en),
              context,
              suggestedTitleId: title.titleId,
              suggestedTranslationVi: title.canonical.vi,
              suggestedTranslationEn: title.canonical.en,
              suggestedOccupationId: title.occupationId,
              suggestedFacetIds: title.facetIds,
              suggestedSkillSignals: title.skillSignals,
              confidence: title.mappingConfidence,
            },
          });
        } else if (existingReview.status === "PENDING") {
          await tx.searchMappingReview.update({
            where: { id: existingReview.id },
            data: {
              context,
              suggestedTitleId: title.titleId,
              suggestedTranslationVi: title.canonical.vi,
              suggestedTranslationEn: title.canonical.en,
              suggestedOccupationId: title.occupationId,
              suggestedFacetIds: title.facetIds,
              suggestedSkillSignals: title.skillSignals,
              confidence: title.mappingConfidence,
            },
          });
        }
      }
    }
  });

  console.log(`SEARCH_CATALOG_BOOTSTRAP\n${JSON.stringify(report, null, 2)}`);
}

main()
  .catch((error) => {
    console.error(
      `SEARCH_CATALOG_BOOTSTRAP_FAILED\n${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => database?.$disconnect());
