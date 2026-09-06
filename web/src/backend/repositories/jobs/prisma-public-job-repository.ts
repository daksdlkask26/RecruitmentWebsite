import "server-only";
import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import type {
  NormalizedJobSearch,
  PublicJobState,
} from "@/backend/services/jobs/job-types";
import {
  companySearchProjection,
  type SearchQueryVariant,
} from "@/backend/services/search/search-query-resolver";
import {
  jobSearchCatalogIndex,
  type SearchCatalogIndex,
} from "@/backend/services/search/catalogs/job-search-catalog-index";
import { searchReleaseFlags } from "@/backend/services/search/search-release-flags";
import {
  SEARCH_RANKING_WEIGHTS,
  getSearchRankingSignals,
  searchVariantTitleWeights,
} from "@/backend/services/search/job-search-ranking";
import {
  encodeJobCursor,
  normalizeSearchText,
  normalizedDistrictLocation,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import {
  classifySearchToken,
  escapePostgresRegex,
} from "@/backend/services/search/search-token-policy";
import {
  careerPathSearchTerms,
  careerPathSlugs,
  type CareerPathSlug,
} from "@/shared/contracts/jobs/career-paths";
import {
  candidateVisibleJobSql,
  candidateVisibleJobWhere,
} from "./candidate-visible-job-policy";

const publicInclude = (actorUserId: string | null) =>
  ({
    company: {
      select: {
        slug: true,
        displayName: true,
        logoUrl: true,
        websiteUrl: true,
        publicDescription: true,
        publicLocation: true,
        size: true,
        industry: true,
        address: true,
      },
    },
    skills: {
      orderBy: { position: "asc" as const },
      select: { displayName: true },
    },
    savedBy: actorUserId
      ? { where: { userId: actorUserId }, select: { userId: true }, take: 1 }
      : { where: { userId: "__visitor__" }, select: { userId: true }, take: 0 },
    applications: actorUserId
      ? {
          where: {
            candidateUserId: actorUserId,
            withdrawalOutcome: null,
            stage: { not: "REJECTED" as const },
          },
          select: { id: true, stage: true },
          take: 1,
        }
      : {
          where: { candidateUserId: "__visitor__" },
          select: { id: true, stage: true },
          take: 0,
        },
    applicationAttemptCounters: actorUserId
      ? {
          where: { candidateUserId: actorUserId },
          select: { applicationCount: true },
          take: 1,
        }
      : {
          where: { candidateUserId: "__visitor__" },
          select: { applicationCount: true },
          take: 0,
        },
    reviewAggregate: {
      select: {
        approvedVersionId: true,
        closedAt: true,
        approvedVersion: { select: { snapshot: true, snapshotSha256: true } },
      },
    },
  }) as const;

type StoredPublicJobRow = Prisma.JobPostingGetPayload<{
  include: ReturnType<typeof publicInclude>;
}>;

export type PublicJobRow = Omit<
  StoredPublicJobRow,
  | "reviewAggregate"
  | "applicationAttemptCounters"
  | "industryId"
  | "subIndustryId"
  | "industryCode"
  | "subIndustryCode"
> & {
  // Optional in the repository contract so legacy test/adaptor rows and
  // pre-taxonomy data remain valid during the backfill window.
  industryId?: string | null;
  subIndustryId?: string | null;
  industryCode?: string | null;
  subIndustryCode?: string | null;
  reviewAggregate?: StoredPublicJobRow["reviewAggregate"];
  applicationAttemptCounters?: StoredPublicJobRow["applicationAttemptCounters"];
  score: number;
};

type RankedRow = {
  id: string;
  score: number;
  publishedAt: Date;
  updatedAt: Date;
  urgent: boolean;
  salaryMaximum: string | null;
  totalCount?: number;
};

// PostgreSQL's `lower` is case-insensitive but does not remove Vietnamese
// diacritics.  Keep the search contract accent-insensitive without requiring
// the optional `unaccent` extension (the project only provisions pg_trgm).
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

let searchProjectionAvailability: Promise<boolean> | undefined;

async function isSearchProjectionAvailable() {
  if (process.env.SEARCH_PROFILE_PROJECTION === "0") return false;
  searchProjectionAvailability ??= prisma.$queryRaw<
    Array<{ tableName: string | null }>
  >`
      SELECT to_regclass('public."JobSearchProjection"')::text AS "tableName"
    `
    .then((rows) => Boolean(rows[0]?.tableName))
    .catch(() => false);
  return searchProjectionAvailability;
}

function normalizedCompanyProjection(value: Prisma.Sql) {
  const normalized = Prisma.sql`translate(lower(${value}), ${vietnameseAccentSource}, ${vietnameseAccentTarget})`;
  return Prisma.sql`btrim(regexp_replace(regexp_replace(${normalized}, ${companyLegalPrefixPatternSql}, ''), ${companyLegalSuffixPatternSql}, ''))`;
}

function normalizedCompanyColumn(column: "displayName" | "legalName") {
  const identifier =
    column === "displayName"
      ? Prisma.raw('c."displayName"')
      : Prisma.raw('c."legalName"');
  return normalizedCompanyProjection(identifier);
}

function normalizedCompanySlugColumn() {
  return normalizedCompanyProjection(
    Prisma.sql`replace(lower(c."slug"), '-', ' ')`,
  );
}

function searchProjectionOccupationMatch(occupationId: string) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "JobSearchProjection" sp
    WHERE sp."jobPostingId" = j."id"
      AND ${occupationId} = ANY(sp."occupationIds")
  )`;
}

function searchProjectionTitleMatch(titleId: string) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "JobSearchProjection" sp
    WHERE sp."jobPostingId" = j."id"
      AND ${titleId} = ANY(sp."titleIds")
  )`;
}

function searchProjectionIntentTitleMatch(
  intent: NormalizedJobSearch["searchIntent"],
) {
  const titleIds =
    intent?.titleCandidates?.map((candidate) => candidate.titleId) ?? [];
  if (!titleIds.length) return Prisma.sql`FALSE`;
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "JobSearchProjection" sp
    WHERE sp."jobPostingId" = j."id"
      AND sp."titleIds" && ARRAY[${Prisma.join(titleIds)}]::text[]
  )`;
}

function searchProjectionFacetMatch(facetId: string) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "JobSearchProjection" sp
    WHERE sp."jobPostingId" = j."id"
      AND ${facetId} = ANY(sp."facetIds")
  )`;
}

function companyNameMatches(token: string) {
  const pattern = `%${token}%`;
  const tokenKind = classifySearchToken(token);
  const nameMatch = (column: Prisma.Sql) =>
    tokenKind === "SAFE_WORD"
      ? Prisma.sql`${column} LIKE ${pattern}`
      : tokenKind === "STOPWORD"
        ? Prisma.sql`FALSE`
        : Prisma.sql`${column} ~ ${`(^|[[:space:]])${escapePostgresRegex(token)}([[:space:]]|$)`}`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Company" c
    WHERE c."id" = j."companyId"
      AND (
        ${nameMatch(normalizedCompanyColumn("displayName"))}
        OR ${nameMatch(normalizedCompanyColumn("legalName"))}
        OR ${nameMatch(normalizedCompanySlugColumn())}
      )
  )`;
}

function skillNameMatches(token: string) {
  const tokenKind = classifySearchToken(token);
  if (tokenKind === "STOPWORD") return Prisma.sql`FALSE`;
  const match =
    tokenKind === "SAFE_WORD"
      ? Prisma.sql`s."normalizedName" LIKE ${`%${token}%`}`
      : Prisma.sql`s."normalizedName" ~ ${`(^|[[:space:]])${escapePostgresRegex(token)}([[:space:]]|$)`}`;
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "JobPostingSkill" js
    JOIN "Skill" s ON s."id" = js."skillId"
    WHERE js."jobPostingId" = j."id"
      AND ${match}
  )`;
}

function searchableTokenMatch(column: Prisma.Sql, token: string) {
  const kind = classifySearchToken(token);
  if (kind === "STOPWORD") return Prisma.sql`FALSE`;
  if (kind === "SAFE_WORD") return Prisma.sql`${column} LIKE ${`%${token}%`}`;
  return Prisma.sql`${column} ~ ${`(^|[[:space:]])${escapePostgresRegex(token)}([[:space:]]|$)`}`;
}

function keywordMatches(
  token: string,
  searchBy: NormalizedJobSearch["searchBy"],
  semanticOccupation = false,
  occupationId?: string,
  useSearchProjection = false,
) {
  const tokenKind = classifySearchToken(token);
  const title = searchableTokenMatch(Prisma.raw('j."normalizedTitle"'), token);
  if (searchBy === "TITLE") return title;
  if (searchBy === "COMPANY") return companyNameMatches(token);

  // Generic role words are intentionally scoped to job title/skill signals.
  // Treating `manager`, `developer`, or `nhan vien` as a company-name search
  // forces a correlated company scan for a large candidate pool and adds no
  // useful intent. Named-company queries still retain the BOTH behavior.
  const company =
    tokenKind === "GENERIC_ROLE"
      ? Prisma.sql`FALSE`
      : companyNameMatches(token);

  if (semanticOccupation) {
    // Occupation expansion is a controlled title/skill signal. Company-name
    // projections are deliberately excluded here because they are much more
    // expensive and do not add useful intent once an occupation is known.
    const projection =
      useSearchProjection && occupationId
        ? searchProjectionOccupationMatch(occupationId)
        : Prisma.sql`FALSE`;
    return Prisma.sql`(${Prisma.join(
      [projection, title, skillNameMatches(token)],
      " OR ",
    )})`;
  }

  // Home uses one free-text field labelled "role, skill, or company".  BOTH
  // therefore intentionally covers all three searchable public signals.
  return Prisma.sql`(${Prisma.join([title, company, skillNameMatches(token)], " OR ")})`;
}

function companySimilarity(query: string) {
  return Prisma.sql`COALESCE((
    SELECT GREATEST(
      similarity(${normalizedCompanyColumn("displayName")}, ${query}),
      similarity(${normalizedCompanyColumn("legalName")}, ${query}),
      similarity(${normalizedCompanySlugColumn()}, ${query})
    )
    FROM "Company" c
    WHERE c."id" = j."companyId"
  ), 0::real)`;
}

function occupationCategoryScore(
  variant: SearchQueryVariant,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const occupation = variant.occupationId
    ? catalogIndex.occupationById(variant.occupationId)
    : undefined;
  if (!occupation) return Prisma.sql`0::double precision`;
  const categoryIds = occupation.categoryIds;
  return Prisma.sql`CASE WHEN (
    j."industryCode" = ${occupation.industryCode}
    OR j."industryId" = ${occupation.industryCode}
    OR j."subIndustryCode" IN (${Prisma.join(categoryIds)})
    OR j."subIndustryId" IN (${Prisma.join(categoryIds)})
  ) THEN 70::double precision ELSE 0::double precision END`;
}

function occupationSkillScore(
  variant: SearchQueryVariant,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const occupation = variant.occupationId
    ? catalogIndex.occupationById(variant.occupationId)
    : undefined;
  if (!occupation || !occupation.skills.length) {
    return Prisma.sql`0::double precision`;
  }
  return Prisma.sql`CASE WHEN EXISTS (
    SELECT 1
    FROM "JobPostingSkill" ranked_js
    JOIN "Skill" ranked_skill ON ranked_skill."id" = ranked_js."skillId"
    WHERE ranked_js."jobPostingId" = j."id"
      AND ranked_skill."normalizedName" IN (${Prisma.join(occupation.skills)})
  ) THEN 35::double precision ELSE 0::double precision END`;
}

function occupationProfileVersionScore(
  variant: SearchQueryVariant,
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  if (!useSearchProjection || !variant.occupationId) {
    return Prisma.sql`0::double precision`;
  }
  return Prisma.sql`CASE
    WHEN EXISTS (
      SELECT 1
      FROM "JobSearchProjection" profile
      WHERE profile."jobPostingId" = j."id"
        AND ${variant.occupationId} = ANY(profile."occupationIds")
        AND profile."catalogVersion" = ${catalogIndex.version}
    ) THEN 90::double precision
    WHEN EXISTS (
      SELECT 1
      FROM "JobSearchProjection" profile
      WHERE profile."jobPostingId" = j."id"
        AND ${variant.occupationId} = ANY(profile."occupationIds")
    ) THEN 20::double precision
    ELSE 0::double precision
  END`;
}

function titleProfileVersionScore(
  variant: SearchQueryVariant,
  intent: NormalizedJobSearch["searchIntent"],
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  if (!useSearchProjection) return Prisma.sql`0::double precision`;
  const titleIds = [
    ...(variant.titleId ? [variant.titleId] : []),
    ...(intent?.titleCandidates?.map((candidate) => candidate.titleId) ?? []),
  ];
  const uniqueTitleIds = [...new Set(titleIds)];
  if (!uniqueTitleIds.length) return Prisma.sql`0::double precision`;
  return Prisma.sql`CASE WHEN EXISTS (
    SELECT 1
    FROM "JobSearchProjection" profile
    WHERE profile."jobPostingId" = j."id"
      AND profile."titleIds" && ARRAY[${Prisma.join(uniqueTitleIds)}]::text[]
      AND profile."catalogVersion" = ${catalogIndex.version}
  ) THEN 320::double precision
  WHEN EXISTS (
    SELECT 1
    FROM "JobSearchProjection" profile
    WHERE profile."jobPostingId" = j."id"
      AND profile."titleIds" && ARRAY[${Prisma.join(uniqueTitleIds)}]::text[]
  ) THEN 100::double precision
  ELSE 0::double precision END`;
}

function titleTokenScore(value: string, score = 80) {
  const tokens = searchTextTokens(value);
  if (!tokens.length) return Prisma.sql`0::double precision`;
  const clauses = tokens.map((token) =>
    searchableTokenMatch(Prisma.raw('j."normalizedTitle"'), token),
  );
  return Prisma.sql`CASE WHEN ${Prisma.join(clauses, " AND ")} THEN ${score}::double precision ELSE 0::double precision END`;
}

function companyTokenScore(value: string) {
  const tokens = searchTextTokens(value);
  if (!tokens.length) return Prisma.sql`0::double precision`;
  const columns = [
    normalizedCompanyColumn("displayName"),
    normalizedCompanyColumn("legalName"),
    normalizedCompanySlugColumn(),
  ];
  const matches = columns.map(
    (column) =>
      Prisma.sql`(${Prisma.join(
        tokens.map((token) => searchableTokenMatch(column, token)),
        " AND ",
      )})`,
  );
  return Prisma.sql`CASE WHEN EXISTS (
    SELECT 1
    FROM "Company" c
    WHERE c."id" = j."companyId"
      AND (${Prisma.join(matches, " OR ")})
  ) THEN 70::double precision ELSE 0::double precision END`;
}

function titleContainsTerm(term: string) {
  const normalized = normalizeSearchText(term, 160);
  const tokens = searchTextTokens(normalized);
  if (!tokens.length) return Prisma.sql`FALSE`;
  const matches = tokens.map((token) =>
    searchableTokenMatch(Prisma.raw('j."normalizedTitle"'), token),
  );
  return matches.length === 1
    ? matches[0]
    : Prisma.sql`(${Prisma.join(matches, " AND ")})`;
}

function titleContainsAnyTerm(terms: readonly string[]) {
  const matches = terms.map(titleContainsTerm);
  if (!matches.length) return Prisma.sql`FALSE`;
  return matches.length === 1
    ? matches[0]
    : Prisma.sql`(${Prisma.join(matches, " OR ")})`;
}

function occupationTaxonomyMatch(
  occupationId: string,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const occupation = catalogIndex.occupationById(occupationId);
  if (!occupation) return Prisma.sql`FALSE`;
  const matches: Prisma.Sql[] = [
    Prisma.sql`j."industryCode" = ${occupation.industryCode}`,
    Prisma.sql`j."industryId" = ${occupation.industryCode}`,
  ];
  if (occupation.categoryIds.length) {
    matches.push(
      Prisma.sql`j."subIndustryCode" IN (${Prisma.join(occupation.categoryIds)})`,
      Prisma.sql`j."subIndustryId" IN (${Prisma.join(occupation.categoryIds)})`,
    );
  }
  return Prisma.sql`(${Prisma.join(matches, " OR ")})`;
}

function occupationSkillMatch(
  occupationId: string,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const occupation = catalogIndex.occupationById(occupationId);
  if (!occupation?.skills.length) return Prisma.sql`FALSE`;
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "JobPostingSkill" ranked_js
    JOIN "Skill" ranked_skill ON ranked_skill."id" = ranked_js."skillId"
    WHERE ranked_js."jobPostingId" = j."id"
      AND ranked_skill."normalizedName" IN (${Prisma.join(occupation.skills)})
  )`;
}

function skillTermsForId(
  skillId: string,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const definition = catalogIndex.skills.find(
    (skill) => skill.skillId === skillId,
  );
  return [
    ...new Set(
      (definition?.phrases ?? [])
        .map((phrase) => normalizeSearchText(phrase, 100))
        .filter(Boolean),
    ),
  ];
}

/**
 * A corrected skill must remain a real retrieval signal when it is combined
 * with an occupation/title.  The old occupation-only OR branch could return
 * every job in the occupation and silently discard a query such as
 * `lập trình viên pyhton`.  Keep this predicate strict and catalog-backed;
 * the caller decides whether it is required or merely scored.
 */
function searchIntentSkillMatch(
  intent: NormalizedJobSearch["searchIntent"],
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const skillIds = [...new Set(intent?.skills ?? [])];
  const matches = skillIds.flatMap((skillId) => {
    const terms = skillTermsForId(skillId, catalogIndex);
    if (!terms.length) return [];
    const postingSkill = Prisma.sql`EXISTS (
      SELECT 1
      FROM "JobPostingSkill" intent_js
      JOIN "Skill" intent_skill ON intent_skill."id" = intent_js."skillId"
      WHERE intent_js."jobPostingId" = j."id"
        AND intent_skill."normalizedName" IN (${Prisma.join(terms)})
    )`;
    const projectionSkill = useSearchProjection
      ? Prisma.sql`EXISTS (
          SELECT 1
          FROM "JobSearchProjection" intent_profile
          WHERE intent_profile."jobPostingId" = j."id"
            AND intent_profile."normalizedSkills" && ARRAY[${Prisma.join(terms)}]::text[]
        )`
      : Prisma.sql`FALSE`;
    return [Prisma.sql`(${postingSkill} OR ${projectionSkill})`];
  });
  if (!matches.length) return Prisma.sql`TRUE`;
  return matches.length === 1
    ? matches[0]
    : Prisma.sql`(${Prisma.join(matches, " AND ")})`;
}

function searchIntentSkillScore(
  intent: NormalizedJobSearch["searchIntent"],
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const skillIds = [...new Set(intent?.skills ?? [])];
  const scores = skillIds.flatMap((skillId) => {
    const terms = skillTermsForId(skillId, catalogIndex);
    if (!terms.length) return [];
    const postingSkill = Prisma.sql`EXISTS (
      SELECT 1
      FROM "JobPostingSkill" intent_score_js
      JOIN "Skill" intent_score_skill
        ON intent_score_skill."id" = intent_score_js."skillId"
      WHERE intent_score_js."jobPostingId" = j."id"
        AND intent_score_skill."normalizedName" IN (${Prisma.join(terms)})
    )`;
    const projectionSkill = useSearchProjection
      ? Prisma.sql`EXISTS (
          SELECT 1
          FROM "JobSearchProjection" intent_score_profile
          WHERE intent_score_profile."jobPostingId" = j."id"
            AND intent_score_profile."normalizedSkills" && ARRAY[${Prisma.join(terms)}]::text[]
        )`
      : Prisma.sql`FALSE`;
    return [
      Prisma.sql`CASE WHEN (${postingSkill} OR ${projectionSkill}) THEN 82::double precision ELSE 0::double precision END`,
    ];
  });
  if (!scores.length) return Prisma.sql`0::double precision`;
  return Prisma.sql`(${Prisma.join(scores, " + ")})`;
}

function occupationVariantMatch(
  variant: SearchQueryVariant,
  intent: NormalizedJobSearch["searchIntent"],
  searchBy: NormalizedJobSearch["searchBy"],
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const titleIdentity = variant.titleId
    ? searchProjectionTitleMatch(variant.titleId)
    : searchProjectionIntentTitleMatch(
        useSearchProjection ? intent : undefined,
      );
  if (!variant.occupationId) {
    return useSearchProjection &&
      (variant.titleId || Boolean(intent?.titleCandidates?.length))
      ? titleIdentity
      : Prisma.sql`FALSE`;
  }
  const titleTokens = searchTextTokens(variant.value).filter((token) => {
    const kind = classifySearchToken(token);
    return kind !== "STOPWORD" && kind !== "GENERIC_ROLE";
  });
  const titleSignals = titleTokens.length
    ? Prisma.sql`(${Prisma.join(
        titleTokens.map((token) =>
          searchableTokenMatch(Prisma.raw('j."normalizedTitle"'), token),
        ),
        " AND ",
      )})`
    : Prisma.sql`FALSE`;
  if (searchBy === "TITLE") {
    const titleSignalsMatch =
      useSearchProjection && variant.titleId
        ? Prisma.sql`(${titleIdentity} OR ${titleSignals})`
        : titleSignals;
    const requiredSkills = searchIntentSkillMatch(
      intent,
      useSearchProjection,
      catalogIndex,
    );
    return intent?.skills?.length
      ? Prisma.sql`(${titleSignalsMatch} AND ${requiredSkills})`
      : titleSignalsMatch;
  }

  const matches: Prisma.Sql[] = [
    occupationTaxonomyMatch(variant.occupationId, catalogIndex),
  ];
  if (useSearchProjection) {
    matches.push(searchProjectionOccupationMatch(variant.occupationId));
    if (variant.titleId) matches.push(titleIdentity);
  }
  if (titleTokens.length) matches.push(titleSignals);
  matches.push(occupationSkillMatch(variant.occupationId, catalogIndex));
  if (variant.requiredFacetIds?.length) {
    matches.push(
      allFacetMatches(
        variant.requiredFacetIds,
        useSearchProjection,
        catalogIndex,
      ),
    );
  }
  const occupationSignals = Prisma.sql`(${Prisma.join(matches, " OR ")})`;
  const requiredSkills = searchIntentSkillMatch(
    intent,
    useSearchProjection,
    catalogIndex,
  );
  return intent?.skills?.length
    ? Prisma.sql`(${occupationSignals} AND ${requiredSkills})`
    : occupationSignals;
}

/**
 * Collapse the common occupation retrieval signals before they reach SQL.
 * Resolver expansions often contain several titles for one occupation; each
 * expansion must keep its own title signal, but taxonomy, projection, skill,
 * and facet signals are shared. Repeating those correlated EXISTS clauses for
 * every alias made multi-word searches needlessly expensive.
 */
function groupedOccupationVariantMatch(
  variants: readonly SearchQueryVariant[],
  intent: NormalizedJobSearch["searchIntent"],
  searchBy: NormalizedJobSearch["searchBy"],
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const scope = searchBy ?? "BOTH";
  const groups = new Map<string, SearchQueryVariant[]>();
  const nonOccupationMatches: Prisma.Sql[] = [];
  for (const variant of variants) {
    if (!variant.occupationId) {
      nonOccupationMatches.push(
        occupationVariantMatch(
          variant,
          intent,
          searchBy,
          useSearchProjection,
          catalogIndex,
        ),
      );
      continue;
    }
    const group = groups.get(variant.occupationId) ?? [];
    group.push(variant);
    groups.set(variant.occupationId, group);
  }

  const matches = [...groups.entries()].map(([occupationId, group]) => {
    if (scope === "TITLE") {
      const titleIdentities = [
        ...new Set(group.flatMap((variant) => variant.titleId ?? [])),
      ].map((titleId) => searchProjectionTitleMatch(titleId));
      const titleSignals = group.flatMap((variant) => {
        const tokens = searchTextTokens(variant.value).filter((token) => {
          const kind = classifySearchToken(token);
          return kind !== "STOPWORD" && kind !== "GENERIC_ROLE";
        });
        return tokens.length
          ? [
              Prisma.sql`(${Prisma.join(
                tokens.map((token) =>
                  searchableTokenMatch(
                    Prisma.raw('j."normalizedTitle"'),
                    token,
                  ),
                ),
                " AND ",
              )})`,
            ]
          : [];
      });
      const titleSignalsMatch = Prisma.sql`(${Prisma.join(
        [...titleIdentities, ...titleSignals],
        " OR ",
      )})`;
      const requiredSkills = searchIntentSkillMatch(
        intent,
        useSearchProjection,
        catalogIndex,
      );
      return intent?.skills?.length
        ? Prisma.sql`(${titleSignalsMatch} AND ${requiredSkills})`
        : titleSignalsMatch;
    }

    const shared: Prisma.Sql[] = [
      occupationTaxonomyMatch(occupationId, catalogIndex),
    ];
    if (useSearchProjection) {
      shared.push(searchProjectionOccupationMatch(occupationId));
    }
    if (useSearchProjection) {
      const titleIds = [
        ...new Set(group.flatMap((variant) => variant.titleId ?? [])),
      ];
      shared.push(
        ...titleIds.map((titleId) => searchProjectionTitleMatch(titleId)),
      );
      if (
        group.some((variant) => !variant.titleId) &&
        intent?.titleCandidates?.length
      ) {
        shared.push(searchProjectionIntentTitleMatch(intent));
      }
    }
    shared.push(occupationSkillMatch(occupationId, catalogIndex));

    const titleSignals = group.flatMap((variant) => {
      const tokens = searchTextTokens(variant.value).filter((token) => {
        const kind = classifySearchToken(token);
        return kind !== "STOPWORD" && kind !== "GENERIC_ROLE";
      });
      return tokens.length
        ? [
            Prisma.sql`(${Prisma.join(
              tokens.map((token) =>
                searchableTokenMatch(Prisma.raw('j."normalizedTitle"'), token),
              ),
              " AND ",
            )})`,
          ]
        : [];
    });
    shared.push(...titleSignals);

    const facetSets = new Map<string, readonly string[]>();
    for (const variant of group) {
      const facetIds = variant.requiredFacetIds ?? [];
      if (facetIds.length) facetSets.set(JSON.stringify(facetIds), facetIds);
    }
    for (const facetIds of facetSets.values()) {
      shared.push(allFacetMatches(facetIds, useSearchProjection, catalogIndex));
    }
    const occupationSignals = Prisma.sql`(${Prisma.join(shared, " OR ")})`;
    const requiredSkills = searchIntentSkillMatch(
      intent,
      useSearchProjection,
      catalogIndex,
    );
    return intent?.skills?.length
      ? Prisma.sql`(${occupationSignals} AND ${requiredSkills})`
      : occupationSignals;
  });

  const allMatches = [...matches, ...nonOccupationMatches];
  if (!allMatches.length) return Prisma.sql`FALSE`;
  return allMatches.length === 1
    ? allMatches[0]
    : Prisma.sql`(${Prisma.join(allMatches, " OR ")})`;
}

function retrievalVariants(input: NormalizedJobSearch) {
  const sourceVariants: SearchQueryVariant[] = input.searchVariants?.length
    ? [...input.searchVariants]
    : input.normalizedQuery
      ? [
          {
            value: input.normalizedQuery,
            source: "ORIGINAL",
            confidence: "HIGH",
          },
        ]
      : [];
  const flags = searchReleaseFlags();
  if (!flags.retrievalV2Enabled) return sourceVariants.slice(0, 1);
  const hasResolvedOccupation = sourceVariants.some((variant) =>
    Boolean(variant.occupationId),
  );
  // A high-confidence occupation correction/expansion is the bounded
  // retrieval path. Keeping an unrecognised typo as a free-text OR branch
  // would reintroduce a corpus-wide regex scan before the corrected branch
  // can narrow candidates.
  const variants = hasResolvedOccupation
    ? sourceVariants.filter(
        (variant) => variant.source !== "ORIGINAL" || variant.occupationId,
      )
    : sourceVariants;
  const relaxedVariants = flags.relaxationEnabled
    ? variants
    : variants.filter((variant) => variant.source !== "RELATED_TITLE");
  const selected: SearchQueryVariant[] = [];
  const seenValues = new Set<string>();
  for (const variant of relaxedVariants) {
    const valueKey = normalizeSearchText(variant.value, 160);
    if (!valueKey || seenValues.has(valueKey)) continue;
    selected.push(variant);
    seenValues.add(valueKey);
    if (selected.length >= 6) break;
  }
  return selected;
}

function facetTitleMatch(
  facetId: string,
  useSearchProjection = false,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const facet = catalogIndex.facetById(facetId);
  if (!facet) return Prisma.sql`FALSE`;
  const title = titleContainsAnyTerm(facet.positiveTerms);
  return useSearchProjection
    ? Prisma.sql`(${searchProjectionFacetMatch(facetId)} OR ${title})`
    : title;
}

function allFacetMatches(
  facetIds: readonly string[],
  useSearchProjection = false,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const matches = facetIds.map((facetId) =>
    facetTitleMatch(facetId, useSearchProjection, catalogIndex),
  );
  if (!matches.length) return Prisma.sql`FALSE`;
  return matches.length === 1
    ? matches[0]
    : Prisma.sql`(${Prisma.join(matches, " AND ")})`;
}

/**
 * Add generic intent signals to the SQL score. The resolver supplies facet
 * ids from the catalog, so a contextual title can outrank a broad alias
 * without a branch for any particular occupation.
 */
function facetContextScore(
  variant: SearchQueryVariant,
  intent: NormalizedJobSearch["searchIntent"],
  useSearchProjection = false,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const signals = getSearchRankingSignals(variant, intent);
  const parts: Prisma.Sql[] = [];

  for (const facetId of signals.requiredFacetIds) {
    parts.push(
      Prisma.sql`CASE WHEN ${facetTitleMatch(facetId, useSearchProjection, catalogIndex)} THEN ${SEARCH_RANKING_WEIGHTS.requiredFacet}::double precision ELSE 0::double precision END`,
    );
  }
  if (signals.requiredFacetIds.length) {
    parts.push(
      Prisma.sql`CASE WHEN ${allFacetMatches(signals.requiredFacetIds, useSearchProjection, catalogIndex)} THEN ${SEARCH_RANKING_WEIGHTS.completeRequiredFacets}::double precision ELSE 0::double precision END`,
    );
  }
  for (const facetId of signals.preferredFacetIds) {
    parts.push(
      Prisma.sql`CASE WHEN ${facetTitleMatch(facetId, useSearchProjection, catalogIndex)} THEN ${SEARCH_RANKING_WEIGHTS.preferredFacet}::double precision ELSE 0::double precision END`,
    );
  }
  for (const facetId of signals.excludedFacetIds) {
    parts.push(
      Prisma.sql`CASE WHEN ${facetTitleMatch(facetId, useSearchProjection, catalogIndex)} THEN ${SEARCH_RANKING_WEIGHTS.excludedFacet}::double precision ELSE 0::double precision END`,
    );
  }
  return parts.length
    ? Prisma.sql`(${Prisma.join(parts, " + ")})`
    : Prisma.sql`0::double precision`;
}

function occupationNegativeTermScore(variant: SearchQueryVariant) {
  const negativeTerms = getSearchRankingSignals(variant).negativeTerms;
  if (!negativeTerms.length) return Prisma.sql`0::double precision`;
  const penalties = negativeTerms.map(
    (term) =>
      Prisma.sql`CASE WHEN ${titleContainsTerm(term)} THEN ${SEARCH_RANKING_WEIGHTS.negativeTerm}::double precision ELSE 0::double precision END`,
  );
  return Prisma.sql`(${Prisma.join(penalties, " + ")})`;
}

function variantSharedScore(
  variant: SearchQueryVariant,
  intent: NormalizedJobSearch["searchIntent"],
  scope: NonNullable<NormalizedJobSearch["searchBy"]>,
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const category =
    scope === "COMPANY"
      ? Prisma.sql`0::double precision`
      : occupationCategoryScore(variant, catalogIndex);
  const skill =
    scope === "TITLE" || scope === "COMPANY"
      ? Prisma.sql`0::double precision`
      : occupationSkillScore(variant, catalogIndex);
  const intentSkill =
    scope === "COMPANY"
      ? Prisma.sql`0::double precision`
      : searchIntentSkillScore(intent, useSearchProjection, catalogIndex);
  const profileVersion = occupationProfileVersionScore(
    variant,
    useSearchProjection,
    catalogIndex,
  );
  const titleProfile = titleProfileVersionScore(
    variant,
    intent,
    useSearchProjection,
    catalogIndex,
  );
  const facetContext =
    scope === "COMPANY"
      ? Prisma.sql`0::double precision`
      : facetContextScore(variant, intent, useSearchProjection, catalogIndex);
  const negativeTerms =
    scope === "COMPANY"
      ? Prisma.sql`0::double precision`
      : occupationNegativeTermScore(variant);
  return Prisma.sql`${titleProfile} + ${category} + ${skill} + ${intentSkill} + ${profileVersion} + ${facetContext} + ${negativeTerms}`;
}

function variantVariableScore(
  variant: SearchQueryVariant,
  scope: NonNullable<NormalizedJobSearch["searchBy"]>,
) {
  const value = variant.value;
  const semanticOccupation = Boolean(
    variant.occupationId && scope !== "COMPANY",
  );
  const queryTokens = searchTextTokens(value);
  const genericRoleQuery =
    scope !== "COMPANY" &&
    queryTokens.length > 0 &&
    queryTokens.every((token) => classifySearchToken(token) === "GENERIC_ROLE");
  const narrowTokenQuery =
    scope !== "COMPANY" &&
    queryTokens.length === 1 &&
    ["KNOWN_ABBREVIATION", "SHORT_AMBIGUOUS"].includes(
      classifySearchToken(queryTokens[0]!),
    );
  const companyScoringEnabled =
    scope !== "TITLE" &&
    !semanticOccupation &&
    !genericRoleQuery &&
    !narrowTokenQuery;
  const titleWeights = searchVariantTitleWeights(variant.source);
  const titleExact =
    scope === "COMPANY"
      ? Prisma.sql`0::double precision`
      : Prisma.sql`CASE WHEN j."normalizedTitle" = ${value} THEN ${titleWeights.exact}::double precision ELSE 0::double precision END`;
  const titleStarts =
    scope === "COMPANY"
      ? Prisma.sql`0::double precision`
      : Prisma.sql`CASE WHEN j."normalizedTitle" LIKE ${`${value}%`} THEN ${titleWeights.starts}::double precision ELSE 0::double precision END`;
  const titleTokens =
    scope === "COMPANY"
      ? Prisma.sql`0::double precision`
      : titleTokenScore(value, titleWeights.tokens);
  const titleSimilarity =
    scope === "COMPANY" || genericRoleQuery
      ? Prisma.sql`0::double precision`
      : Prisma.sql`similarity(j."normalizedTitle", ${value}) * ${titleWeights.similarity}`;
  const companyExact = !companyScoringEnabled
    ? Prisma.sql`0::double precision`
    : Prisma.sql`CASE WHEN EXISTS (
          SELECT 1
          FROM "Company" c
          WHERE c."id" = j."companyId"
            AND ${Prisma.join(
              [
                Prisma.sql`${normalizedCompanyColumn("displayName")} = ${value}`,
                Prisma.sql`${normalizedCompanyColumn("legalName")} = ${value}`,
                Prisma.sql`${normalizedCompanySlugColumn()} = ${value}`,
              ],
              " OR ",
            )}
        ) THEN ${scope === "COMPANY" ? 100 : 30}::double precision ELSE 0::double precision END`;
  const companyStarts = !companyScoringEnabled
    ? Prisma.sql`0::double precision`
    : Prisma.sql`CASE WHEN EXISTS (
          SELECT 1
          FROM "Company" c
          WHERE c."id" = j."companyId"
            AND ${Prisma.join(
              [
                Prisma.sql`${normalizedCompanyColumn("displayName")} LIKE ${`${value}%`}`,
                Prisma.sql`${normalizedCompanyColumn("legalName")} LIKE ${`${value}%`}`,
                Prisma.sql`${normalizedCompanySlugColumn()} LIKE ${`${value}%`}`,
              ],
              " OR ",
            )}
        ) THEN ${scope === "COMPANY" ? 80 : 24}::double precision ELSE 0::double precision END`;
  const companyTokens = !companyScoringEnabled
    ? Prisma.sql`0::double precision`
    : companyTokenScore(value);
  const companySimilarityScore = !companyScoringEnabled
    ? Prisma.sql`0::double precision`
    : Prisma.sql`${companySimilarity(value)} * ${scope === "COMPANY" ? 30 : 10}`;
  const description =
    scope === "COMPANY" ||
    scope === "TITLE" ||
    semanticOccupation ||
    genericRoleQuery
      ? Prisma.sql`0::double precision`
      : Prisma.sql`CASE WHEN j."searchDocumentNormalized" LIKE ${`%${value}%`} THEN 10::double precision ELSE 0::double precision END`;
  return Prisma.sql`${titleExact} + ${titleStarts} + ${titleTokens} + ${titleSimilarity} + ${companyExact} + ${companyStarts} + ${companyTokens} + ${companySimilarityScore} + ${description}`;
}

function variantSharedScoreKey(
  variant: SearchQueryVariant,
  intent: NormalizedJobSearch["searchIntent"],
  scope: NonNullable<NormalizedJobSearch["searchBy"]>,
  useSearchProjection: boolean,
) {
  const signals = getSearchRankingSignals(variant, intent);
  return JSON.stringify({
    scope,
    useSearchProjection,
    occupationId: variant.occupationId ?? null,
    titleId: variant.titleId ?? null,
    titleCandidates:
      intent?.titleCandidates?.map((candidate) => candidate.titleId) ?? [],
    requiredFacetIds: signals.requiredFacetIds,
    preferredFacetIds: signals.preferredFacetIds,
    excludedFacetIds: signals.excludedFacetIds,
    negativeTerms: signals.negativeTerms,
    multiplier: variant.source === "TYPO_CORRECTION" ? 0.85 : 1,
  });
}

function groupedVariantScore(
  variants: readonly SearchQueryVariant[],
  searchBy: NormalizedJobSearch["searchBy"],
  intent: NormalizedJobSearch["searchIntent"],
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
) {
  const scope = searchBy ?? "BOTH";
  if (!searchReleaseFlags().rankingV2Enabled) {
    const first = variants[0];
    return first
      ? variantVariableScore(first, scope)
      : Prisma.sql`0::double precision`;
  }
  const groups = new Map<
    string,
    {
      shared: Prisma.Sql;
      variable: Prisma.Sql[];
      multiplier: number;
    }
  >();
  for (const variant of variants) {
    const multiplier = variant.source === "TYPO_CORRECTION" ? 0.85 : 1;
    const key = variantSharedScoreKey(
      variant,
      intent,
      scope,
      useSearchProjection,
    );
    const existing = groups.get(key);
    if (existing) {
      existing.variable.push(variantVariableScore(variant, scope));
      continue;
    }
    groups.set(key, {
      shared: variantSharedScore(
        variant,
        intent,
        scope,
        useSearchProjection,
        catalogIndex,
      ),
      variable: [variantVariableScore(variant, scope)],
      multiplier,
    });
  }
  const scores = [...groups.values()].map((group) => {
    const variable =
      group.variable.length === 1
        ? group.variable[0]
        : Prisma.sql`GREATEST(${Prisma.join(group.variable, ", ")})`;
    const score = Prisma.sql`(${group.shared} + ${variable})`;
    return group.multiplier === 1
      ? score
      : Prisma.sql`${score} * ${group.multiplier}`;
  });
  return scores.length === 1
    ? scores[0]
    : Prisma.sql`GREATEST(${Prisma.join(scores, ", ")})`;
}

export type RankedJobSearchResult = Readonly<{
  orderedJobIds: string[];
  total?: number;
  candidateCount?: number;
  projectionState: "available" | "missing";
  candidateCapReached: boolean;
  nextCursor: string | null;
}>;

export interface PublicJobRepository {
  search(
    input: NormalizedJobSearch,
    actorUserId: string | null,
    now: Date,
  ): Promise<{
    rows: PublicJobRow[];
    total: number;
    candidateCount?: number;
    projectionState?: "available" | "missing";
    candidateCapReached?: boolean;
    nextCursor: string | null;
  }>;
  findPublicBySlug(
    slug: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<PublicJobRow | null>;
  findPublicRelatedCandidates?(
    jobId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<PublicJobRow[]>;
  findPublicDiscoveryCandidates?(
    jobId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<PublicJobRow[]>;
  countCareerPathJobs?(
    now: Date,
  ): Promise<readonly { slug: CareerPathSlug; openJobCount: number }[]>;
  findPublicRecommendationCandidates?(
    actorUserId: string | null,
    now: Date,
  ): Promise<PublicJobRow[]>;
  findPublicActionTarget(
    jobId: string,
    now: Date,
  ): Promise<{
    id: string;
    state: PublicJobState;
    acceptsApplications: boolean;
  } | null>;
}

function publicClauses(
  input: NormalizedJobSearch,
  now: Date,
  useSearchProjection = false,
  options: Readonly<{ coveredByPreselection?: boolean }> = {},
  catalogIndex: SearchCatalogIndex = input.catalogIndex ??
    jobSearchCatalogIndex,
) {
  const coveredByPreselection = Boolean(options.coveredByPreselection);
  const clauses: Prisma.Sql[] = coveredByPreselection
    ? []
    : [candidateVisibleJobSql(now)];
  if (input.companyId && !coveredByPreselection) {
    clauses.push(Prisma.sql`j."companyId" = ${input.companyId}`);
  }
  const variants = retrievalVariants(input);
  if (variants.length && !coveredByPreselection) {
    const variantClauses = variants.map((variant) => {
      const variantValue =
        input.searchBy === "COMPANY"
          ? companySearchProjection(variant.value)
          : variant.value;
      const tokens = searchTextTokens(variantValue);
      const semanticOccupation = Boolean(
        variant.occupationId && input.searchBy !== "COMPANY",
      );
      const semanticTitle = Boolean(
        variant.titleId &&
        variant.matchedSpan &&
        normalizeSearchText(variant.matchedSpan) ===
          normalizeSearchText(variant.value) &&
        input.searchBy !== "COMPANY",
      );
      const match =
        semanticOccupation || semanticTitle
          ? [
              occupationVariantMatch(
                variant,
                input.searchIntent,
                input.searchBy,
                useSearchProjection,
                catalogIndex,
              ),
            ]
          : tokens.map((token) =>
              keywordMatches(
                token,
                input.searchBy,
                false,
                undefined,
                useSearchProjection,
              ),
            );
      return match.length > 1
        ? Prisma.sql`(${Prisma.join(match, " AND ")})`
        : (match[0] ?? Prisma.sql`FALSE`);
    });
    clauses.push(
      variantClauses.length > 1
        ? Prisma.sql`(${Prisma.join(variantClauses, " OR ")})`
        : variantClauses[0],
    );
  }
  if (input.normalizedLocation && !coveredByPreselection) {
    const locationMatches = searchTextTokens(input.normalizedLocation).map(
      (token) =>
        searchableTokenMatch(Prisma.raw('j."normalizedLocation"'), token),
    );
    if (locationMatches.length) {
      clauses.push(Prisma.sql`(${Prisma.join(locationMatches, " AND ")})`);
    }
  }
  const normalizedDistricts = input.normalizedDistricts ?? [];
  if (normalizedDistricts.length) {
    const districtClauses = input.normalizedLocation
      ? normalizedDistricts.map(
          (district) =>
            Prisma.sql`j."normalizedLocation" = ${normalizedDistrictLocation(input.normalizedLocation, district)}`,
        )
      : normalizedDistricts.map(
          (district) =>
            Prisma.sql`j."normalizedLocation" LIKE ${`%${district}%`}`,
        );
    clauses.push(Prisma.sql`(${Prisma.join(districtClauses, " OR ")})`);
  }
  if (input.categoryFamily?.length) {
    const categoryFamilyCodes = [
      ...new Set(
        input.categoryFamily.flatMap((category) =>
          category === "r29" || category === "other"
            ? ["r29", "other"]
            : [category],
        ),
      ),
    ];
    const categoryMatches: Prisma.Sql[] = [
      Prisma.sql`j."industryCode" IN (${Prisma.join(categoryFamilyCodes)})`,
      Prisma.sql`j."industryId" IN (${Prisma.join(categoryFamilyCodes)})`,
      Prisma.sql`EXISTS (
        SELECT 1
        FROM "JobPostReviewAggregate" aggregate
        JOIN "JobPostReviewVersion" version
          ON version."id" = aggregate."approvedVersionId"
        WHERE aggregate."publicJobPostingId" = j."id"
          AND (
            version."snapshot" ->> 'categoryFamily' IN (${Prisma.join(categoryFamilyCodes)})
            OR version."snapshot" ->> 'industryCode' IN (${Prisma.join(categoryFamilyCodes)})
          )
      )`,
    ];
    clauses.push(Prisma.sql`(${Prisma.join(categoryMatches, " OR ")})`);
  }
  if (input.categoryIds?.length) {
    const roleMatches: Prisma.Sql[] = [
      Prisma.sql`j."subIndustryCode" IN (${Prisma.join(input.categoryIds)})`,
      Prisma.sql`j."subIndustryId" IN (${Prisma.join(input.categoryIds)})`,
      Prisma.sql`EXISTS (
        SELECT 1
        FROM "JobPostReviewAggregate" aggregate
        JOIN "JobPostReviewVersion" version
          ON version."id" = aggregate."approvedVersionId"
        WHERE aggregate."publicJobPostingId" = j."id"
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              COALESCE(version."snapshot" -> 'categoryIds', '[]'::jsonb)
            ) AS selected_category(id)
            WHERE selected_category.id IN (${Prisma.join(input.categoryIds)})
          )
      )`,
    ];
    clauses.push(Prisma.sql`(${Prisma.join(roleMatches, " OR ")})`);
  }
  if (input.normalizedRoleTitles?.length) {
    clauses.push(
      Prisma.sql`j."normalizedTitle" IN (${Prisma.join(input.normalizedRoleTitles)})`,
    );
  }
  if (input.employmentType.length) {
    clauses.push(
      Prisma.sql`j."employmentType"::text IN (${Prisma.join(input.employmentType)})`,
    );
  }
  if (input.experienceLevel.length) {
    clauses.push(
      Prisma.sql`j."experienceLevel"::text IN (${Prisma.join(input.experienceLevel)})`,
    );
  }
  if (input.workArrangement.length) {
    clauses.push(
      Prisma.sql`j."workArrangement"::text IN (${Prisma.join(input.workArrangement)})`,
    );
  }
  if (input.careerPath) {
    const terms = careerPathSearchTerms[input.careerPath];
    clauses.push(
      Prisma.sql`(${Prisma.join(
        terms.map(
          (term) =>
            Prisma.sql`j."searchDocumentNormalized" LIKE ${`%${term}%`}`,
        ),
        " OR ",
      )})`,
    );
  }
  for (const skill of input.normalizedSkills) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "JobPostingSkill" js
      JOIN "Skill" s ON s."id" = js."skillId"
      WHERE js."jobPostingId" = j."id" AND s."normalizedName" = ${skill}
    )`);
  }
  if (input.salaryMin !== undefined || input.salaryMax !== undefined) {
    clauses.push(
      Prisma.sql`j."salaryCurrency" = ${input.salaryCurrency} AND j."salaryPeriod"::text = ${input.salaryPeriod}`,
    );
    if (input.salaryMin !== undefined) {
      clauses.push(Prisma.sql`j."salaryMax" >= ${input.salaryMin}`);
    }
    if (input.salaryMax !== undefined) {
      clauses.push(Prisma.sql`j."salaryMin" <= ${input.salaryMax}`);
    }
  }
  if (input.salaryNegotiable) {
    // Keep search results aligned with formatSalary(): only listings without
    // a complete public numeric range are presented as "Negotiable".
    clauses.push(Prisma.sql`(j."salaryMin" IS NULL OR j."salaryMax" IS NULL)`);
  }
  if (input.postedWithinDays !== undefined) {
    const cutoff = new Date(
      now.getTime() - input.postedWithinDays * 86_400_000,
    );
    clauses.push(Prisma.sql`j."publishedAt" >= ${cutoff}`);
  }
  return clauses;
}

const MAX_SEARCH_PRESELECT_CANDIDATES = 5_000;

type SearchPreselection = Readonly<{
  sql: Prisma.Sql;
  /** Whether the broad branch is deliberately capped at the candidate budget. */
  capApplied: boolean;
}>;

function exactTitlePreselection(
  input: NormalizedJobSearch,
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex,
) {
  if (input.searchBy === "COMPANY") return null;
  const variants = retrievalVariants(input);
  const exactTitleIds = new Set<string>();
  const exactTitleValues = new Set<string>();
  for (const variant of variants) {
    // ORIGINAL can carry a title identity discovered by the resolver (also
    // when a high-confidence token correction was applied).  A related title
    // is intentionally not treated as exact: it belongs to the relaxed tier.
    if (
      variant.titleId &&
      variant.source !== "RELATED_TITLE" &&
      variant.confidence === "HIGH"
    ) {
      exactTitleIds.add(variant.titleId);
      exactTitleValues.add(normalizeSearchText(variant.value, 160));
    }
  }
  for (const match of catalogIndex.exactTitlePhraseMatches(
    input.normalizedQuery,
  )) {
    if (match.titleId) exactTitleIds.add(match.titleId);
  }
  if (!exactTitleIds.size && !exactTitleValues.size) return null;

  const clauses: Prisma.Sql[] = [];
  if (useSearchProjection) {
    clauses.push(
      ...[...exactTitleIds].map((titleId) =>
        searchProjectionTitleMatch(titleId),
      ),
    );
  }
  clauses.push(
    ...[...exactTitleValues]
      .filter(Boolean)
      .map((value) => Prisma.sql`j."normalizedTitle" = ${value}`),
  );
  return clauses.length === 1
    ? clauses[0]
    : Prisma.sql`(${Prisma.join(clauses, " OR ")})`;
}

function searchPreselection(
  input: NormalizedJobSearch,
  now: Date,
  useSearchProjection: boolean,
  catalogIndex: SearchCatalogIndex = input.catalogIndex ??
    jobSearchCatalogIndex,
): SearchPreselection | null {
  const variants = retrievalVariants(input);
  if (!variants.length) return null;

  const variantIsSemantic = (variant: SearchQueryVariant) => {
    const semanticOccupation = Boolean(
      variant.occupationId && input.searchBy !== "COMPANY",
    );
    const semanticTitle = Boolean(
      variant.titleId &&
      variant.matchedSpan &&
      normalizeSearchText(variant.matchedSpan) ===
        normalizeSearchText(variant.value) &&
      input.searchBy !== "COMPANY",
    );
    return semanticOccupation || semanticTitle;
  };
  const semanticVariants = variants.filter((variant) => {
    const variantValue =
      input.searchBy === "COMPANY"
        ? companySearchProjection(variant.value)
        : variant.value;
    return variantIsSemantic(variant) && searchTextTokens(variantValue).length;
  });
  const variantClauses: Prisma.Sql[] = semanticVariants.length
    ? [
        groupedOccupationVariantMatch(
          semanticVariants,
          input.searchIntent,
          input.searchBy,
          useSearchProjection,
          catalogIndex,
        ),
      ]
    : [];

  variantClauses.push(
    ...variants
      .filter((variant) => !variantIsSemantic(variant))
      .flatMap((variant) => {
        const variantValue =
          input.searchBy === "COMPANY"
            ? companySearchProjection(variant.value)
            : variant.value;
        const tokens = searchTextTokens(variantValue);
        if (!tokens.length) return [];
        const matches = tokens.map((token) =>
          keywordMatches(
            token,
            input.searchBy,
            false,
            undefined,
            useSearchProjection,
          ),
        );
        return [
          matches.length > 1
            ? Prisma.sql`(${Prisma.join(matches, " AND ")})`
            : matches[0],
        ];
      }),
  );
  if (!variantClauses.length) return null;

  const extraClauses: Prisma.Sql[] = [];
  if (input.companyId) {
    extraClauses.push(Prisma.sql`j."companyId" = ${input.companyId}`);
  }
  if (input.normalizedLocation) {
    const locationMatches = searchTextTokens(input.normalizedLocation).map(
      (token) =>
        searchableTokenMatch(Prisma.raw('j."normalizedLocation"'), token),
    );
    if (locationMatches.length) {
      extraClauses.push(Prisma.sql`(${Prisma.join(locationMatches, " AND ")})`);
    }
  }
  const textClause =
    variantClauses.length > 1
      ? Prisma.sql`(${Prisma.join(variantClauses, " OR ")})`
      : variantClauses[0];
  const broadPool = Prisma.sql`
      SELECT broad."id"
      FROM (
        SELECT j."id"
        FROM "JobPosting" j
        WHERE ${candidateVisibleJobSql(now)}
          AND ${Prisma.join([...extraClauses, textClause], " AND ")}
        ORDER BY j."publishedAt" DESC, j."id" ASC
        LIMIT ${MAX_SEARCH_PRESELECT_CANDIDATES}
      ) AS broad
    `;
  const exactTitle = exactTitlePreselection(
    input,
    useSearchProjection,
    catalogIndex,
  );
  if (!exactTitle) {
    return { sql: broadPool, capApplied: true };
  }
  const exactPool = Prisma.sql`
      SELECT j."id"
      FROM "JobPosting" j
      WHERE ${candidateVisibleJobSql(now)}
        AND ${Prisma.join([...extraClauses, exactTitle], " AND ")}
    `;
  // Exact title identity is an uncapped tier.  Union it with the bounded
  // broad pool so a stale/large corpus cannot hide an exact result merely
  // because it was published before the 5,000-row freshness window.
  return {
    sql: Prisma.sql`
      SELECT DISTINCT "id"
      FROM (
        ${exactPool}
        UNION ALL
        ${broadPool}
      ) AS search_preselection
    `,
    capApplied: true,
  };
}

function cursorClause(
  input: NormalizedJobSearch,
  scoreExpression: Prisma.Sql,
  now: Date,
): Prisma.Sql | null {
  const cursor = input.cursor;
  if (!cursor) return null;
  const publishedAt = new Date(cursor.publishedAt);
  if (input.sort === "RELEVANCE") {
    return Prisma.sql`(
      ${scoreExpression} < ${cursor.score ?? 0} OR
      (${scoreExpression} = ${cursor.score ?? 0} AND (j."publishedAt" < ${publishedAt} OR
        (j."publishedAt" = ${publishedAt} AND j."id" > ${cursor.id})))
    )`;
  }
  if (input.sort === "SALARY_DESC") {
    return cursor.salaryMaximum === null
      ? Prisma.sql`(j."salaryMax" IS NULL AND (j."publishedAt" < ${publishedAt} OR (j."publishedAt" = ${publishedAt} AND j."id" > ${cursor.id})))`
      : Prisma.sql`(
          j."salaryMax" < ${cursor.salaryMaximum}::decimal OR j."salaryMax" IS NULL OR
          (j."salaryMax" = ${cursor.salaryMaximum}::decimal AND
            (j."publishedAt" < ${publishedAt} OR (j."publishedAt" = ${publishedAt} AND j."id" > ${cursor.id})))
        )`;
  }
  if (input.sort === "UPDATED") {
    return Prisma.sql`(j."updatedAt" < ${publishedAt} OR (j."updatedAt" = ${publishedAt} AND j."id" > ${cursor.id}))`;
  }
  if (input.sort === "URGENT") {
    const urgent = Prisma.sql`CASE WHEN j."applicationDeadline" IS NOT NULL AND j."applicationDeadline" > ${now} AND j."applicationDeadline" <= ${new Date(now.getTime() + 14 * 86_400_000)} THEN 1 ELSE 0 END`;
    const cursorUrgent = cursor.urgent ? 1 : 0;
    return Prisma.sql`(
      ${urgent} < ${cursorUrgent}
      OR (${urgent} = ${cursorUrgent} AND (j."publishedAt" < ${publishedAt} OR (j."publishedAt" = ${publishedAt} AND j."id" > ${cursor.id})))
    )`;
  }
  return Prisma.sql`(j."publishedAt" < ${publishedAt} OR (j."publishedAt" = ${publishedAt} AND j."id" > ${cursor.id}))`;
}

export class PrismaPublicJobRepository implements PublicJobRepository {
  async searchOrderedIds(
    input: NormalizedJobSearch,
    now: Date,
    options: Readonly<{ includeTotal?: boolean }> = {},
  ): Promise<RankedJobSearchResult> {
    const catalogIndex = input.catalogIndex ?? jobSearchCatalogIndex;
    const useSearchProjection = await isSearchProjectionAvailable();
    const preselection = searchPreselection(
      input,
      now,
      useSearchProjection,
      catalogIndex,
    );
    const clauses = publicClauses(
      input,
      now,
      useSearchProjection,
      { coveredByPreselection: Boolean(preselection) },
      catalogIndex,
    );
    const query =
      input.searchBy === "COMPANY"
        ? companySearchProjection(input.normalizedQuery)
        : input.normalizedQuery;
    const scoreVariants = retrievalVariants(input).filter(
      (variant) => variant.value,
    );
    const fallbackVariant: SearchQueryVariant = {
      value: query,
      source: "ORIGINAL",
      confidence: "HIGH",
    };
    const score =
      query && input.sort === "RELEVANCE"
        ? groupedVariantScore(
            scoreVariants.length ? scoreVariants : [fallbackVariant],
            input.searchBy,
            input.searchIntent,
            useSearchProjection,
            catalogIndex,
          )
        : Prisma.sql`0::double precision`;
    const cursor = cursorClause(input, score, now);
    const urgent = Prisma.sql`CASE WHEN j."applicationDeadline" IS NOT NULL AND j."applicationDeadline" > ${now} AND j."applicationDeadline" <= ${new Date(now.getTime() + 14 * 86_400_000)} THEN 1 ELSE 0 END`;
    const offset = cursor
      ? Prisma.empty
      : Prisma.sql`OFFSET ${((input.page ?? 1) - 1) * input.limit}`;
    const where = clauses.length
      ? Prisma.join(clauses, " AND ")
      : Prisma.sql`TRUE`;
    const order =
      input.sort === "SALARY_DESC"
        ? Prisma.sql`j."salaryMax" DESC NULLS LAST, j."publishedAt" DESC, j."id" ASC`
        : input.sort === "UPDATED"
          ? Prisma.sql`j."updatedAt" DESC, j."id" ASC`
          : input.sort === "URGENT"
            ? Prisma.sql`${urgent} DESC, j."publishedAt" DESC, j."id" ASC`
            : input.sort === "NEWEST"
              ? Prisma.sql`j."publishedAt" DESC, j."id" ASC`
              : Prisma.sql`score DESC, j."publishedAt" DESC, j."id" ASC`;

    const includeWindowTotal = Boolean(
      options.includeTotal && !cursor && !preselection,
    );
    const from = preselection
      ? Prisma.sql`FROM "JobPosting" j
          INNER JOIN (${preselection.sql}) search_pool
            ON search_pool."id" = j."id"`
      : Prisma.sql`FROM "JobPosting" j`;
    const rankedPromise = prisma.$queryRaw<RankedRow[]>(Prisma.sql`
      SELECT j."id", ${score} AS score, j."publishedAt" AS "publishedAt",
             j."updatedAt" AS "updatedAt", (${urgent} = 1) AS urgent,
             j."salaryMax"::text AS "salaryMaximum"
             ${includeWindowTotal ? Prisma.sql`, COUNT(*) OVER()::int AS "totalCount"` : Prisma.empty}
      ${from}
      WHERE ${where} ${cursor ? Prisma.sql`AND ${cursor}` : Prisma.empty}
      ORDER BY ${order}
      LIMIT ${input.limit + 1}
      ${offset}
    `);
    const totalPromise =
      options.includeTotal && !includeWindowTotal
        ? preselection
          ? prisma.$queryRaw<Array<{ count: number; candidateCount: number }>>(
              Prisma.sql`
                WITH search_pool AS MATERIALIZED (${preselection.sql})
                SELECT COUNT(*)::int AS count,
                  (SELECT COUNT(*)::int FROM search_pool) AS "candidateCount"
                FROM "JobPosting" j
                INNER JOIN search_pool
                  ON search_pool."id" = j."id"
                WHERE ${where}
              `,
            )
          : prisma.$queryRaw<Array<{ count: number; candidateCount: number }>>(
              Prisma.sql`
                SELECT COUNT(*)::int AS count,
                  COUNT(*)::int AS "candidateCount"
                FROM "JobPosting" j
                WHERE ${where}
              `,
            )
        : Promise.resolve(undefined);
    const [ranked, counts] = await Promise.all([rankedPromise, totalPromise]);
    const hasMore = ranked.length > input.limit;
    const page = ranked.slice(0, input.limit);
    const last = hasMore ? page.at(-1) : undefined;
    const candidateCount = counts?.[0]?.candidateCount ?? ranked[0]?.totalCount;
    return {
      orderedJobIds: page.map((row) => row.id),
      total: ranked[0]?.totalCount ?? counts?.[0]?.count ?? undefined,
      candidateCount,
      projectionState: useSearchProjection ? "available" : "missing",
      candidateCapReached: Boolean(
        preselection &&
        preselection.capApplied &&
        candidateCount !== undefined &&
        candidateCount >= MAX_SEARCH_PRESELECT_CANDIDATES,
      ),
      nextCursor: last
        ? encodeJobCursor({
            v: 1,
            sort: input.sort,
            score: input.sort === "RELEVANCE" ? Number(last.score) : undefined,
            salaryMaximum:
              input.sort === "SALARY_DESC" ? last.salaryMaximum : undefined,
            publishedAt: new Date(
              input.sort === "UPDATED" ? last.updatedAt : last.publishedAt,
            ).toISOString(),
            urgent: input.sort === "URGENT" ? last.urgent : undefined,
            id: last.id,
          })
        : null,
    };
  }

  async search(
    input: NormalizedJobSearch,
    actorUserId: string | null,
    now: Date,
  ) {
    const ranked = await this.searchOrderedIds(input, now, {
      includeTotal: true,
    });
    const entities = await prisma.jobPosting.findMany({
      where: { id: { in: ranked.orderedJobIds } },
      include: publicInclude(actorUserId),
    });
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const rows = ranked.orderedJobIds
      .map((id) => {
        const entity = byId.get(id);
        return entity ? ({ ...entity, score: 0 } as PublicJobRow) : null;
      })
      .filter((row): row is PublicJobRow => row !== null);
    return {
      rows,
      total: ranked.total ?? 0,
      ...(ranked.candidateCount === undefined
        ? {}
        : { candidateCount: ranked.candidateCount }),
      projectionState: ranked.projectionState,
      candidateCapReached: ranked.candidateCapReached,
      nextCursor: ranked.nextCursor,
    };
  }

  /**
   * Home shows the same career-path counts as /jobs?careerPath=... .
   * Counting each path through the full search service caused one ranked
   * query, one entity projection, and one catalog lookup per path. Keep the
   * visibility policy identical while evaluating all counters in one query.
   */
  async countCareerPathJobs(now: Date) {
    const values = careerPathSlugs.flatMap((slug) =>
      careerPathSearchTerms[slug].map((term) => Prisma.sql`(${slug}, ${term})`),
    );
    const rows = await prisma.$queryRaw<
      Array<{ slug: string; openJobCount: number }>
    >(Prisma.sql`
      WITH career_paths("slug", "term") AS (
        VALUES ${Prisma.join(values, ", ")}
      )
      SELECT career_paths."slug" AS "slug",
             COUNT(DISTINCT j."id")::int AS "openJobCount"
      FROM career_paths
      JOIN "JobPosting" j
        ON ${candidateVisibleJobSql(now)}
       AND j."searchDocumentNormalized" LIKE '%' || career_paths."term" || '%'
      GROUP BY career_paths."slug"
    `);
    const counts = new Map(
      rows.map((row) => [row.slug as CareerPathSlug, Number(row.openJobCount)]),
    );
    return careerPathSlugs.map((slug) => ({
      slug,
      openJobCount: counts.get(slug) ?? 0,
    }));
  }

  async findPublicBySlug(slug: string, actorUserId: string | null, now: Date) {
    const row = await prisma.jobPosting.findFirst({
      where: {
        slug,
        OR: [
          {
            reviewAggregate: null,
            status: { in: ["ACTIVE", "CLOSED", "EXPIRED"] },
          },
          {
            reviewAggregate: {
              is: {
                approvedVersionId: { not: null },
                closedAt: null,
                visibilityState: "PUBLISHED",
              },
            },
            // A closed managed job remains readable as public history, but is
            // excluded from discovery by the ACTIVE-only discovery queries.
            status: { in: ["ACTIVE", "CLOSED"] },
          },
        ],
        approvedAt: { not: null },
        publishedAt: { not: null, lte: now },
        company: {
          verifiedAt: { not: null },
          verificationState: "ACTIVE",
          verificationInactiveAt: null,
        },
      },
      include: publicInclude(actorUserId),
    });
    return row ? ({ ...row, score: 0 } as PublicJobRow) : null;
  }

  async findPublicRelatedCandidates(
    jobId: string,
    actorUserId: string | null,
    now: Date,
  ) {
    const rows = await prisma.jobPosting.findMany({
      where: {
        ...candidateVisibleJobWhere(now),
        id: { not: jobId },
      },
      take: 100,
      include: publicInclude(actorUserId),
    });
    return rows.map((row) => ({ ...row, score: 0 }) as PublicJobRow);
  }
  async findPublicDiscoveryCandidates(
    jobId: string,
    actorUserId: string | null,
    now: Date,
  ) {
    const rows = await prisma.jobPosting.findMany({
      where: {
        ...candidateVisibleJobWhere(now),
        id: { not: jobId },
      },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 160,
      include: publicInclude(actorUserId),
    });
    return rows.map((row) => ({ ...row, score: 0 }) as PublicJobRow);
  }

  async findPublicRecommendationCandidates(
    actorUserId: string | null,
    now: Date,
  ) {
    const rows = await prisma.jobPosting.findMany({
      where: candidateVisibleJobWhere(now),
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      include: publicInclude(actorUserId),
    });
    return rows.map((row) => ({ ...row, score: 0 }) as PublicJobRow);
  }

  async findPublicActionTarget(jobId: string, now: Date) {
    const row = await prisma.jobPosting.findFirst({
      where: {
        id: jobId,
        status: { in: ["ACTIVE", "CLOSED", "EXPIRED"] },
        approvedAt: { not: null },
        publishedAt: { not: null, lte: now },
        company: {
          verifiedAt: { not: null },
          verificationState: "ACTIVE",
          verificationInactiveAt: null,
        },
        OR: [
          { reviewAggregate: null },
          {
            reviewAggregate: {
              is: {
                approvedVersionId: { not: null },
                closedAt: null,
                visibilityState: "PUBLISHED",
              },
            },
          },
        ],
      },
      select: { id: true, status: true, applicationDeadline: true },
    });
    if (!row) return null;
    const expired = Boolean(
      row.applicationDeadline && row.applicationDeadline <= now,
    );
    const state: PublicJobState = expired
      ? "EXPIRED"
      : row.status === "ACTIVE"
        ? "ACTIVE"
        : row.status === "CLOSED"
          ? "CLOSED"
          : "EXPIRED";
    return { id: row.id, state, acceptsApplications: state === "ACTIVE" };
  }
}
