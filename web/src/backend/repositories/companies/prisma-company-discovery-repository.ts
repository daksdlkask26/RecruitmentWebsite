import "server-only";

import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import { candidateVisibleJobWhere } from "@/backend/repositories/jobs/candidate-visible-job-policy";
import {
  normalizeSearchText,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import {
  classifySearchToken,
  escapePostgresRegex,
} from "@/backend/services/search/search-token-policy";
import {
  companyLocationRegions,
  companyLocationSearchTerms,
} from "@/shared/utils/locations/company-location";
import {
  companySearchProjection,
  resolveSearchQuery,
} from "@/backend/services/search/search-query-resolver";
import type {
  SearchInterpretation,
  SearchMode,
} from "@/shared/contracts/search/search-interpretation";

const publicCompanyWhere = {
  verifiedAt: { not: null },
  verificationState: "ACTIVE" as const,
  verificationInactiveAt: null,
  moderationState: "ACTIVE" as const,
};

const publicCompanySelect = {
  id: true,
  slug: true,
  displayName: true,
  logoUrl: true,
  publicDescription: true,
  publicLocation: true,
  foundedYear: true,
  industry: true,
} as const;

const publicCompanySearchSelect = {
  ...publicCompanySelect,
  legalName: true,
} as const;

const vietnameseAccentGroups = [
  ["áàảãạăắằẳẵặâấầẩẫậ", "a"],
  ["đ", "d"],
  ["éèẻẽẹêếềểễệ", "e"],
  ["íìỉĩị", "i"],
  ["óòỏõọôốồổỗộơớờởỡợ", "o"],
  ["úùủũụưứừửữự", "u"],
  ["ýỳỷỹỵ", "y"],
] as const;
const vietnameseAccentSource = vietnameseAccentGroups
  .map(([source]) => source)
  .join("");
const vietnameseAccentTarget = vietnameseAccentGroups
  .map(([source, target]) => target.repeat(Array.from(source).length))
  .join("");
const companyLegalPrefixPatternSql =
  "^(cong ty trach nhiem huu han|cong ty co phan|cong ty|cty tnhh|cty cp|cty|tnhh|co phan|joint stock company) +";
const companyLegalSuffixPatternSql =
  " +(jsc|ltd|limited|corporation|corp|joint stock company)$";

function normalizedTextProjection(value: Prisma.Sql) {
  const normalized = Prisma.sql`translate(lower(COALESCE(${value}, '')), ${vietnameseAccentSource}, ${vietnameseAccentTarget})`;
  return Prisma.sql`btrim(regexp_replace(${normalized}, '[^[:alnum:]]+', ' ', 'g'))`;
}

function normalizedCompanyProjection(value: Prisma.Sql) {
  const normalized = normalizedTextProjection(value);
  return Prisma.sql`btrim(regexp_replace(regexp_replace(${normalized}, ${companyLegalPrefixPatternSql}, ''), ${companyLegalSuffixPatternSql}, ''))`;
}

function normalizedCompanyFields(alias: string, projected: boolean) {
  const prefix = projected ? "projected" : "normalized";
  const expression = projected
    ? normalizedCompanyProjection
    : normalizedTextProjection;
  return {
    displayName: expression(Prisma.raw(`${alias}."displayName"`)),
    legalName: expression(Prisma.raw(`${alias}."legalName"`)),
    slug: expression(
      Prisma.sql`replace(lower(${Prisma.raw(`${alias}."slug"`)}), '-', ' ')`,
    ),
    prefix,
  };
}

type RankedCompanyRow = Readonly<{
  id: string;
  score: number;
  totalCount?: number;
}>;

export type PublicCompanyRow = Awaited<
  ReturnType<PrismaCompanyDiscoveryRepository["findById"]>
>;

export type CompanySearchSuggestionRow = Readonly<{
  id: string;
  displayName: string;
  industry: string | null;
  publicLocation: string | null;
}>;

export interface CompanyDiscoveryRepository {
  list(input: {
    q?: string;
    searchMode?: SearchMode;
    location?: string;
    page: number;
    limit: number;
  }): Promise<{
    items: Array<{
      id: string;
      slug: string;
      displayName: string;
      logoUrl: string | null;
      publicDescription: string | null;
      publicLocation: string | null;
      industry: string | null;
      openPositionCount: number;
    }>;
    total: number;
    locations?: string[];
    searchInterpretation?: SearchInterpretation;
  }>;
  findById(companyId: string): Promise<{
    id: string;
    slug: string;
    displayName: string;
    logoUrl: string | null;
    publicDescription: string | null;
    publicLocation: string | null;
    foundedYear: number | null;
    industry: string | null;
    activeEmployeeCount: number;
    activeOwnerCount: number;
    openPositionCount: number;
  } | null>;
}

function companyColumn(alias: string, column: string) {
  return Prisma.raw(`${alias}."${column}"`);
}

function publicCompanySql(alias: string) {
  return Prisma.sql`
    ${companyColumn(alias, "verifiedAt")} IS NOT NULL
    AND ${companyColumn(alias, "verificationState")} = 'ACTIVE'::"CompanyVerificationState"
    AND ${companyColumn(alias, "verificationInactiveAt")} IS NULL
    AND ${companyColumn(alias, "moderationState")} = 'ACTIVE'::"CompanyModerationState"
  `;
}

function companyProjection(alias: string, projected: boolean) {
  const fields = normalizedCompanyFields(alias, projected);
  const location = normalizedTextProjection(
    companyColumn(alias, "publicLocation"),
  );
  const industry = normalizedTextProjection(companyColumn(alias, "industry"));
  const description = normalizedTextProjection(
    companyColumn(alias, "publicDescription"),
  );
  return { ...fields, location, industry, description };
}

function companySearchValue(value: string, literal: boolean) {
  return literal
    ? normalizeSearchText(value, 160)
    : companySearchProjection(value);
}

function companyTokenMatch(field: Prisma.Sql, token: string) {
  const kind = classifySearchToken(token);
  if (kind === "STOPWORD") return Prisma.sql`FALSE`;
  if (kind === "SAFE_WORD") {
    const compact = token.replace(/\s+/gu, "");
    const compactMatch =
      compact.length >= 4
        ? Prisma.sql`OR replace(${field}, ' ', '') LIKE ${`%${compact}%`}`
        : Prisma.empty;
    return Prisma.sql`(${field} LIKE ${`%${token}%`} ${compactMatch})`;
  }
  return Prisma.sql`${field} ~ ${`(^|[[:space:]])${escapePostgresRegex(token)}([[:space:]]|$)`}`;
}

function variantMatchSql(
  variant: { value: string },
  fields: ReturnType<typeof companyProjection>,
  literal: boolean,
) {
  const value = companySearchValue(variant.value, literal);
  const tokens = searchTextTokens(value);
  if (!tokens.length) return Prisma.sql`FALSE`;
  const searchable = [
    fields.displayName,
    fields.legalName,
    fields.slug,
    fields.description,
    fields.location,
    fields.industry,
  ];
  const tokenMatches = tokens.map(
    (token) =>
      Prisma.sql`(${Prisma.join(
        searchable.map((field) => companyTokenMatch(field, token)),
        " OR ",
      )})`,
  );
  return Prisma.sql`(${Prisma.join(tokenMatches, " AND ")})`;
}

function companyNameTokenMatchSql(
  value: string,
  fields: ReturnType<typeof companyProjection>,
) {
  const tokens = searchTextTokens(value);
  if (!tokens.length) return Prisma.sql`FALSE`;
  const nameFields = [fields.displayName, fields.legalName];
  const matches = nameFields.map(
    (field) =>
      Prisma.sql`(${Prisma.join(
        tokens.map((token) => companyTokenMatch(field, token)),
        " AND ",
      )})`,
  );
  return Prisma.sql`(${Prisma.join(matches, " OR ")})`;
}

function hasBoundarySensitiveToken(value: string) {
  return searchTextTokens(value).some((token) => {
    const kind = classifySearchToken(token);
    return kind !== "SAFE_WORD" && kind !== "STOPWORD";
  });
}

function companyFieldQueryMatchSql(field: Prisma.Sql, value: string) {
  const tokens = searchTextTokens(value);
  if (!tokens.length) return Prisma.sql`FALSE`;
  return Prisma.sql`(${Prisma.join(
    tokens.map((token) => companyTokenMatch(field, token)),
    " AND ",
  )})`;
}

function companyPrefixMatchSql(field: Prisma.Sql, value: string) {
  if (!hasBoundarySensitiveToken(value)) {
    return Prisma.sql`${field} LIKE ${`${value}%`}`;
  }
  return Prisma.sql`${field} ~ ${`^${escapePostgresRegex(value)}([[:space:]]|$)`}`;
}

function companyContainsMatchSql(field: Prisma.Sql, value: string) {
  return hasBoundarySensitiveToken(value)
    ? companyFieldQueryMatchSql(field, value)
    : Prisma.sql`${field} LIKE ${`%${value}%`}`;
}

function companyVariantScoreSql(
  variant: { value: string; source: string },
  fields: ReturnType<typeof companyProjection>,
  literal: boolean,
) {
  const value = companySearchValue(variant.value, literal);
  if (!value) return Prisma.sql`0::double precision`;
  const nameTokens = companyNameTokenMatchSql(value, fields);
  const compactLocationMatch = hasBoundarySensitiveToken(value)
    ? Prisma.sql`FALSE`
    : Prisma.sql`replace(${fields.location}, ' ', '') LIKE ${`%${value.replace(/\s+/gu, "")}%`}`;
  const base = Prisma.sql`CASE
    WHEN ${fields.displayName} = ${value} THEN 100::double precision
    WHEN ${fields.legalName} = ${value} THEN 95::double precision
    WHEN ${fields.slug} = ${value} THEN 90::double precision
    WHEN ${companyPrefixMatchSql(fields.displayName, value)} OR ${companyPrefixMatchSql(fields.legalName, value)} THEN 80::double precision
    WHEN ${nameTokens} THEN 70::double precision
    WHEN ${companyContainsMatchSql(fields.industry, value)} THEN 40::double precision
    WHEN ${companyContainsMatchSql(fields.location, value)} OR ${compactLocationMatch} THEN 25::double precision
    WHEN ${companyContainsMatchSql(fields.description, value)} THEN 10::double precision
    ELSE 0::double precision
  END`;
  return variant.source === "TYPO_CORRECTION"
    ? Prisma.sql`(${base}) * 0.85`
    : base;
}

function companySearchQueryParts(
  input: Readonly<{ searchMode: SearchMode }>,
  variants: readonly { value: string; source: string }[],
  locationTerms: readonly string[],
) {
  const literal = input.searchMode === "LITERAL";
  const cRaw = companyProjection("c", false);
  const cProjected = companyProjection("c", true);
  const pRaw: ReturnType<typeof companyProjection> = {
    displayName: Prisma.raw('p."normalizedDisplayName"'),
    legalName: Prisma.raw('p."normalizedLegalName"'),
    slug: Prisma.raw('p."normalizedSlug"'),
    location: Prisma.raw('p."normalizedLocation"'),
    industry: Prisma.raw('p."normalizedIndustry"'),
    description: Prisma.raw('p."normalizedDescription"'),
    prefix: "normalized",
  };
  const pProjected: ReturnType<typeof companyProjection> = {
    displayName: Prisma.raw('p."projectedDisplayName"'),
    legalName: Prisma.raw('p."projectedLegalName"'),
    slug: Prisma.raw('p."projectedSlug"'),
    location: Prisma.raw('p."normalizedLocation"'),
    industry: Prisma.raw('p."normalizedIndustry"'),
    description: Prisma.raw('p."normalizedDescription"'),
    prefix: "projected",
  };
  const variantMatches = variants.map((variant) =>
    variantMatchSql(variant, literal ? pRaw : pProjected, literal),
  );
  const locationMatches = locationTerms
    .map((term) => normalizeSearchText(term, 160))
    .filter(Boolean)
    .map((term) => Prisma.sql`p."normalizedLocation" LIKE ${`%${term}%`}`);
  const matchWhere = variantMatches.length
    ? Prisma.sql`(${Prisma.join(variantMatches, " OR ")})`
    : Prisma.sql`TRUE`;
  const locationWhere = locationMatches.length
    ? Prisma.sql`AND (${Prisma.join(locationMatches, " OR ")})`
    : Prisma.empty;
  const scoreFields = literal ? pRaw : pProjected;
  const score = Prisma.sql`GREATEST(${Prisma.join(
    variants.map((variant) =>
      companyVariantScoreSql(variant, scoreFields, literal),
    ),
    ", ",
  )})`;
  const cte = Prisma.sql`
    WITH public_companies AS (
      SELECT
        c."id",
        c."displayName" AS "displayName",
        c."publicLocation" AS "publicLocation",
        ${cRaw.displayName} AS "normalizedDisplayName",
        ${cRaw.legalName} AS "normalizedLegalName",
        ${cRaw.slug} AS "normalizedSlug",
        ${cProjected.displayName} AS "projectedDisplayName",
        ${cProjected.legalName} AS "projectedLegalName",
        ${cProjected.slug} AS "projectedSlug",
        ${cRaw.description} AS "normalizedDescription",
        ${cRaw.location} AS "normalizedLocation",
        ${cRaw.industry} AS "normalizedIndustry"
      FROM "Company" c
      WHERE ${publicCompanySql("c")}
    )
  `;
  return { cte, matchWhere, locationWhere, score };
}

async function findCompanyCorrectionTerms(rawQuery: string) {
  const query = companySearchProjection(rawQuery);
  if (searchTextTokens(query).join("").length < 4) return [];
  const fields = companyProjection("c", true);
  const rows = await prisma.$queryRaw<
    Array<{
      displayName: string;
    }>
  >(Prisma.sql`
    SELECT c."displayName"
    FROM "Company" c
    WHERE ${publicCompanySql("c")}
      AND similarity(${fields.displayName}, ${query}) >= 0.35
    ORDER BY similarity(${fields.displayName}, ${query}) DESC, c."id" ASC
    LIMIT 8
  `);
  // The schema has no verified brand-alias relation yet. Keep correction
  // candidates scoped to the public display name until that relation exists;
  // legal names, slugs, industries, and locations remain retrieval fields.
  return rows.map((row) => row.displayName);
}

async function searchCompanyIds(
  input: Readonly<{
    q: string;
    searchMode: SearchMode;
    location?: string;
    page: number;
    limit: number;
  }>,
  variants: readonly { value: string; source: string }[],
  locationTerms: readonly string[],
) {
  const { cte, matchWhere, locationWhere, score } = companySearchQueryParts(
    input,
    variants,
    locationTerms,
  );
  const rows = await prisma.$queryRaw<RankedCompanyRow[]>(Prisma.sql`
    ${cte}
    SELECT p."id", ${score} AS score, COUNT(*) OVER()::int AS "totalCount"
    FROM public_companies p
    WHERE ${matchWhere} ${locationWhere}
    ORDER BY score DESC, p."displayName" ASC, p."id" ASC
    LIMIT ${input.limit}
    OFFSET ${(input.page - 1) * input.limit}
  `);
  return rows;
}

async function searchCompanyLocations(
  input: Readonly<{ searchMode: SearchMode }>,
  variants: readonly { value: string; source: string }[],
  locationTerms: readonly string[],
) {
  const { cte, matchWhere, locationWhere } = companySearchQueryParts(
    input,
    variants,
    locationTerms,
  );
  return prisma.$queryRaw<Array<{ publicLocation: string | null }>>(Prisma.sql`
    ${cte}
    SELECT DISTINCT p."publicLocation" AS "publicLocation"
    FROM public_companies p
    WHERE ${matchWhere} ${locationWhere}
      AND p."publicLocation" IS NOT NULL
    ORDER BY p."publicLocation" ASC
    LIMIT 2_000
  `);
}

export class PrismaCompanyDiscoveryRepository implements CompanyDiscoveryRepository {
  async list(input: {
    q?: string;
    searchMode?: SearchMode;
    location?: string;
    page: number;
    limit: number;
  }) {
    const hasKeyword = Boolean(input.q?.trim());
    const searchMode = input.searchMode ?? "SMART";
    const correctionTerms =
      hasKeyword && searchMode !== "LITERAL"
        ? await findCompanyCorrectionTerms(input.q ?? "")
        : [];
    const resolved = resolveSearchQuery(
      input.q ?? "",
      "COMPANIES",
      "en",
      searchMode,
      {
        correctionTerms,
      },
    );
    const variants = resolved.variants.length
      ? resolved.variants
      : [
          {
            value: "",
            source: "ORIGINAL" as const,
            confidence: "HIGH" as const,
          },
        ];
    const locationTerms = companyLocationSearchTerms(input.location);
    const filters = locationTerms.length
      ? [
          {
            OR: locationTerms.map((term) => ({
              publicLocation: {
                contains: term,
                mode: "insensitive" as const,
              },
            })),
          },
        ]
      : [];
    const where = filters.length
      ? { ...publicCompanyWhere, AND: filters }
      : publicCompanyWhere;
    const now = new Date();
    const ranked = hasKeyword
      ? await searchCompanyIds(
          {
            q: input.q ?? "",
            searchMode,
            location: input.location,
            page: input.page,
            limit: input.limit,
          },
          variants,
          locationTerms,
        )
      : [];
    const itemsPromise = hasKeyword
      ? prisma.company.findMany({
          where: {
            ...publicCompanyWhere,
            id: { in: ranked.map((row) => row.id) },
          },
          select: {
            ...publicCompanySearchSelect,
            _count: {
              select: {
                jobPostings: { where: candidateVisibleJobWhere(now) },
              },
            },
          },
        })
      : prisma.company.findMany({
          where,
          select: {
            ...publicCompanySearchSelect,
            _count: {
              select: {
                jobPostings: { where: candidateVisibleJobWhere(now) },
              },
            },
          },
          orderBy: [{ displayName: "asc" as const }, { id: "asc" as const }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
    const locationRowsPromise = hasKeyword
      ? searchCompanyLocations({ searchMode }, variants, locationTerms)
      : prisma.company.findMany({
          where,
          select: { publicLocation: true },
          distinct: ["publicLocation"],
          orderBy: { publicLocation: "asc" },
          take: 2_000,
        });
    const [items, total, locationRows] = await Promise.all([
      itemsPromise,
      hasKeyword
        ? Promise.resolve(ranked[0]?.totalCount ?? 0)
        : prisma.company.count({ where }),
      locationRowsPromise,
    ]);
    const locations = companyLocationRegions(
      locationRows.map((row) => row.publicLocation),
    ).slice(0, 200);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const orderedItems = hasKeyword
      ? ranked.flatMap((row) => {
          const item = itemById.get(row.id);
          return item ? [item] : [];
        })
      : items;
    return {
      items: orderedItems.map(
        ({
          _count,
          id,
          slug,
          displayName,
          logoUrl,
          publicDescription,
          publicLocation,
          industry,
        }) => ({
          id,
          slug,
          displayName,
          logoUrl,
          publicDescription,
          publicLocation,
          industry,
          openPositionCount: _count?.jobPostings ?? 0,
        }),
      ),
      total,
      locations,
      searchInterpretation: resolved.interpretation,
    };
  }

  async suggest(
    rawQuery: string,
    limit = 8,
  ): Promise<CompanySearchSuggestionRow[]> {
    const query = companySearchProjection(rawQuery);
    const compactQuery = query.replace(/\s+/gu, "");
    if (compactQuery.length < 2) return [];
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 8);
    const fields = companyProjection("c", true);
    const compactDisplayName = Prisma.sql`replace(${fields.displayName}, ' ', '')`;
    const compactIndustry = Prisma.sql`replace(${fields.industry}, ' ', '')`;
    const compactLocation = Prisma.sql`replace(${fields.location}, ' ', '')`;
    const rows = await prisma.$queryRaw<
      CompanySearchSuggestionRow[]
    >(Prisma.sql`
      SELECT c."id", c."displayName", c."industry", c."publicLocation"
      FROM "Company" c
      WHERE ${publicCompanySql("c")}
        AND (
          ${fields.displayName} LIKE ${`%${query}%`}
          OR ${compactDisplayName} LIKE ${`%${compactQuery}%`}
          OR ${fields.industry} LIKE ${`%${query}%`}
          OR ${compactIndustry} LIKE ${`%${compactQuery}%`}
          OR ${fields.location} LIKE ${`%${query}%`}
          OR ${compactLocation} LIKE ${`%${compactQuery}%`}
          OR similarity(${fields.displayName}, ${query}) >= 0.25
          OR similarity(${fields.industry}, ${query}) >= 0.3
          OR similarity(${fields.location}, ${query}) >= 0.3
        )
      ORDER BY GREATEST(
        similarity(${fields.displayName}, ${query}),
        similarity(${fields.industry}, ${query}) * 0.72,
        similarity(${fields.location}, ${query}) * 0.72
      ) DESC, c."displayName" ASC, c."id" ASC
      LIMIT ${boundedLimit * 3}
    `);
    return rows.slice(0, boundedLimit * 3);
  }

  async findById(companyId: string) {
    const now = new Date();
    const company = await prisma.company.findFirst({
      where: { id: companyId, ...publicCompanyWhere },
      select: {
        ...publicCompanySelect,
        _count: {
          select: {
            jobPostings: { where: candidateVisibleJobWhere(now) },
          },
        },
      },
    });
    if (!company) return null;
    const [activeEmployeeCount, activeOwnerCount] = await Promise.all([
      prisma.companyMembership.count({
        where: {
          companyId: company.id,
          status: "ACTIVE",
          removedAt: null,
        },
      }),
      prisma.companyMembership.count({
        where: {
          companyId: company.id,
          role: "OWNER",
          status: "ACTIVE",
          removedAt: null,
        },
      }),
    ]);
    const { _count, ...publicFields } = company;
    return {
      ...publicFields,
      activeEmployeeCount,
      activeOwnerCount,
      openPositionCount: _count?.jobPostings ?? 0,
    };
  }
}

export { publicCompanyWhere };
