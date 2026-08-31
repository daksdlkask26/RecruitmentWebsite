import "server-only";
import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import type {
  NormalizedJobSearch,
  PublicJobState,
} from "@/backend/services/jobs/job-types";
import {
  encodeJobCursor,
  normalizedDistrictLocation,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import { careerPathSearchTerms } from "@/shared/contracts/jobs/career-paths";
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

function normalizedCompanyColumn(column: "displayName" | "legalName") {
  const identifier =
    column === "displayName"
      ? Prisma.raw('c."displayName"')
      : Prisma.raw('c."legalName"');
  return Prisma.sql`translate(lower(${identifier}), ${vietnameseAccentSource}, ${vietnameseAccentTarget})`;
}

function companyNameMatches(token: string) {
  const pattern = `%${token}%`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Company" c
    WHERE c."id" = j."companyId"
      AND (
        ${normalizedCompanyColumn("displayName")} LIKE ${pattern}
        OR ${normalizedCompanyColumn("legalName")} LIKE ${pattern}
      )
  )`;
}

function skillNameMatches(token: string) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "JobPostingSkill" js
    JOIN "Skill" s ON s."id" = js."skillId"
    WHERE js."jobPostingId" = j."id"
      AND s."normalizedName" LIKE ${`%${token}%`}
  )`;
}

function keywordMatches(
  token: string,
  searchBy: NormalizedJobSearch["searchBy"],
) {
  const title = Prisma.sql`j."normalizedTitle" LIKE ${`%${token}%`}`;
  if (searchBy === "TITLE") return title;
  const company = companyNameMatches(token);
  if (searchBy === "COMPANY") return company;

  // Home uses one free-text field labelled "role, skill, or company".  BOTH
  // therefore intentionally covers all three searchable public signals.
  return Prisma.sql`(${Prisma.join([title, company, skillNameMatches(token)], " OR ")})`;
}

function fuzzyKeywordMatches(
  token: string,
  searchBy: NormalizedJobSearch["searchBy"],
) {
  const title = Prisma.sql`j."normalizedTitle" % ${token}`;
  if (searchBy === "TITLE") return title;
  const company = Prisma.sql`EXISTS (
    SELECT 1 FROM "Company" c
    WHERE c."id" = j."companyId"
      AND translate(lower(c."displayName"), ${vietnameseAccentSource}, ${vietnameseAccentTarget}) % ${token}
  )`;
  if (searchBy === "COMPANY") return company;
  return Prisma.sql`(${Prisma.join([title, company, Prisma.sql`j."searchDocumentNormalized" % ${token}`], " OR ")})`;
}

function companySimilarity(query: string) {
  return Prisma.sql`COALESCE((
    SELECT GREATEST(
      similarity(${normalizedCompanyColumn("displayName")}, ${query}),
      similarity(${normalizedCompanyColumn("legalName")}, ${query})
    )
    FROM "Company" c
    WHERE c."id" = j."companyId"
  ), 0::real)`;
}

function variantScore(variant: string, searchBy: NormalizedJobSearch["searchBy"]) {
  const titleExact = Prisma.sql`CASE WHEN j."normalizedTitle" = ${variant} THEN 100::double precision ELSE 0::double precision END`;
  const title = Prisma.sql`similarity(j."normalizedTitle", ${variant}) * 3`;
  const document = Prisma.sql`similarity(j."searchDocumentNormalized", ${variant})`;
  const company = searchBy === "TITLE" ? Prisma.empty : Prisma.sql`+ ${companySimilarity(variant)} * 2`;
  return Prisma.sql`${titleExact} + ${title} + ${document} ${company}`;
}

export type RankedJobSearchResult = Readonly<{
  orderedJobIds: string[];
  total?: number;
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

function publicClauses(input: NormalizedJobSearch, now: Date) {
  const clauses: Prisma.Sql[] = [candidateVisibleJobSql(now)];
  if (input.companyId) {
    clauses.push(Prisma.sql`j."companyId" = ${input.companyId}`);
  }
  const variants = input.searchVariants?.length
    ? input.searchVariants
    : input.normalizedQuery
      ? [{ value: input.normalizedQuery, source: "ORIGINAL" as const }]
      : [];
  if (variants.length) {
    const variantClauses = variants.map((variant) => {
      const tokens = searchTextTokens(variant.value);
      const match = tokens.map((token) =>
        variant.source === "TYPO_CORRECTION" && token.length >= 4
          ? fuzzyKeywordMatches(token, input.searchBy)
          : keywordMatches(token, input.searchBy),
      );
      return match.length > 1 ? Prisma.sql`(${Prisma.join(match, " AND ")})` : match[0];
    });
    clauses.push(variantClauses.length > 1 ? Prisma.sql`(${Prisma.join(variantClauses, " OR ")})` : variantClauses[0]);
  }
  if (input.normalizedLocation) {
    const locationMatches = searchTextTokens(input.normalizedLocation).map(
      (token) => Prisma.sql`j."normalizedLocation" LIKE ${`%${token}%`}`,
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
    const clauses = publicClauses(input, now);
    const query = input.normalizedQuery;
    const scoreVariants = (input.searchVariants ?? [])
      .map((variant) => variant.value)
      .filter(Boolean);
    const score = query
      ? Prisma.sql`GREATEST(${Prisma.join(
          (scoreVariants.length ? scoreVariants : [query]).map((variant) => variantScore(variant, input.searchBy)),
          ", ",
        )})`
      : Prisma.sql`0::double precision`;
    const cursor = cursorClause(input, score, now);
    const urgent = Prisma.sql`CASE WHEN j."applicationDeadline" IS NOT NULL AND j."applicationDeadline" > ${now} AND j."applicationDeadline" <= ${new Date(now.getTime() + 14 * 86_400_000)} THEN 1 ELSE 0 END`;
    const offset = cursor
      ? Prisma.empty
      : Prisma.sql`OFFSET ${((input.page ?? 1) - 1) * input.limit}`;
    const where = Prisma.join(clauses, " AND ");
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

    const rankedPromise = prisma.$queryRaw<RankedRow[]>(Prisma.sql`
      SELECT j."id", ${score} AS score, j."publishedAt" AS "publishedAt",
             j."updatedAt" AS "updatedAt", (${urgent} = 1) AS urgent,
             j."salaryMax"::text AS "salaryMaximum"
      FROM "JobPosting" j
      WHERE ${where} ${cursor ? Prisma.sql`AND ${cursor}` : Prisma.empty}
      ORDER BY ${order}
      LIMIT ${input.limit + 1}
      ${offset}
    `);
    const totalPromise = options.includeTotal
      ? prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
          SELECT COUNT(*)::int AS count FROM "JobPosting" j WHERE ${where}
        `)
      : Promise.resolve(undefined);
    const [ranked, counts] = await Promise.all([rankedPromise, totalPromise]);
    const hasMore = ranked.length > input.limit;
    const page = ranked.slice(0, input.limit);
    const last = hasMore ? page.at(-1) : undefined;
    return {
      orderedJobIds: page.map((row) => row.id),
      total: counts?.[0]?.count ?? undefined,
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
      nextCursor: ranked.nextCursor,
    };
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
