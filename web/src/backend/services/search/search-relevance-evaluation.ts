import {
  jobSearchCatalogIndex,
  type SearchCatalogIndex,
} from "./catalogs/job-search-catalog-index";
import { searchCatalogProvider } from "./catalogs/search-catalog-provider";
import { resolveSearchQuery } from "./search-query-resolver";
import { rankSearchCandidates } from "./job-search-ranking";

export const SEARCH_RELEVANCE_CORPUS_VERSION =
  "2026-09-03.catalog-coverage-v2" as const;

type RelevanceCase = Readonly<{
  name: string;
  query: string;
  locale?: "en" | "vi";
  expectedTitleId?: string;
  expectedTitleIds?: readonly string[];
  ambiguous?: boolean;
  expectedNoMatch?: boolean;
}>;

function titleIdForEnglish(value: string) {
  return jobSearchCatalogIndex.catalog.titleDefinitions?.find(
    (title) => title.canonical.en === value,
  )?.titleId;
}

const seoTitleId = titleIdForEnglish("SEO Specialist");
const chiefAccountantTitleId = titleIdForEnglish("Chief Accountant");
const frontendTitleId = titleIdForEnglish("Frontend Developer");
const accountingTitleIds = (
  jobSearchCatalogIndex.catalog.titleDefinitions ?? []
)
  .filter(
    (title) =>
      title.occupationId === "occ-r04-accountant" ||
      title.occupationId === "occ-r04-accounting-finance",
  )
  .map((title) => title.titleId);
const salesTitleIds = (jobSearchCatalogIndex.catalog.titleDefinitions ?? [])
  .filter(
    (title) => title.occupationId === "occ-r01-sales-business-development",
  )
  .map((title) => title.titleId);

const SEARCH_RELEVANCE_CASES: readonly RelevanceCase[] = [
  {
    name: "exact title",
    query: "SEO Specialist",
    expectedTitleId: seoTitleId,
  },
  {
    name: "transposed title typo",
    query: "SEO Specilist",
    expectedTitleId: seoTitleId,
  },
  {
    name: "shared bilingual title stays ambiguous",
    query: "Chuyên viên SEO",
    locale: "vi",
    ambiguous: true,
  },
  {
    name: "accounting title",
    query: "Chief Accountant",
    expectedTitleId: chiefAccountantTitleId,
  },
  {
    name: "compound title",
    query: "Frontend Developer",
    expectedTitleId: frontendTitleId,
  },
  {
    name: "Vietnamese accounting alias",
    query: "kế toán",
    locale: "vi",
    expectedTitleIds: accountingTitleIds,
  },
  {
    name: "unaccented Vietnamese accounting alias",
    query: "ke toan",
    locale: "vi",
    expectedTitleIds: accountingTitleIds,
  },
  {
    name: "compact Vietnamese accounting alias",
    query: "ketoan",
    locale: "vi",
    expectedTitleIds: accountingTitleIds,
  },
  {
    name: "accounting typo",
    query: "accountnat",
    locale: "en",
    expectedTitleIds: accountingTitleIds,
  },
  {
    name: "frontend typo",
    query: "frotend developer",
    locale: "en",
    expectedTitleId: frontendTitleId,
  },
  {
    name: "search intent prefix keeps accounting target",
    query: "tuyển dụng kế toán",
    locale: "vi",
    expectedTitleIds: accountingTitleIds,
  },
  {
    name: "search intent prefix keeps sales target",
    query: "việc làm nhân viên kinh doanh",
    locale: "vi",
    expectedTitleIds: salesTitleIds,
  },
  {
    name: "title plus skill keeps both signals",
    query: "frontend developer react",
    locale: "en",
    expectedTitleId: frontendTitleId,
  },
  {
    name: "seniority intent keeps title identity",
    query: "senior frontend developer",
    locale: "en",
    expectedTitleId: frontendTitleId,
  },
  {
    name: "SEO Vietnamese ambiguity",
    query: "chuyên viên SEO",
    locale: "vi",
    expectedTitleIds: [
      titleIdForEnglish("SEO Executive"),
      titleIdForEnglish("SEO Specialist"),
    ].filter((value): value is string => Boolean(value)),
    ambiguous: true,
  },
  {
    name: "nonsense does not fabricate a title",
    query: "qwertyuiop",
    locale: "en",
    expectedNoMatch: true,
  },
];

export const SEARCH_RELEVANCE_CORPUS = SEARCH_RELEVANCE_CASES.filter(
  (item): item is RelevanceCase =>
    Boolean(
      item.expectedTitleId ||
      item.expectedTitleIds?.length ||
      item.ambiguous ||
      item.expectedNoMatch,
    ),
);

type CatalogCoverageFailure = Readonly<{
  titleId: string;
  canonical: string;
  locale: "en" | "vi";
  query: string;
}>;

function catalogCoverage(catalogIndex: SearchCatalogIndex): Readonly<{
  total: number;
  matched: number;
  failures: readonly CatalogCoverageFailure[];
}> {
  const failures: CatalogCoverageFailure[] = [];
  let total = 0;
  let matched = 0;
  for (const title of catalogIndex.catalog.titleDefinitions ?? []) {
    for (const locale of ["en", "vi"] as const) {
      const query = title.canonical[locale];
      total += 1;
      const resolved = resolveSearchQuery(query, "JOBS", locale, "SMART", {
        catalogIndex,
      });
      const found =
        resolved.variants.some(
          (variant) => variant.titleId === title.titleId,
        ) ||
        resolved.intent?.titleCandidates?.some(
          (candidate) => candidate.titleId === title.titleId,
        ) ||
        (title.occupationId
          ? resolved.variants.some(
              (variant) => variant.occupationId === title.occupationId,
            ) ||
            resolved.intent?.occupationCandidates?.some(
              (candidate) => candidate.occupationId === title.occupationId,
            )
          : false);
      if (found) matched += 1;
      else if (failures.length < 100) {
        failures.push({
          titleId: title.titleId,
          canonical: title.canonical[locale],
          locale,
          query,
        });
      }
    }
  }
  return { total, matched, failures };
}

function titleCandidatePosition(
  ranked: readonly { id: string }[],
  titleId: string,
) {
  const seen = new Set<string>();
  const titleIds = ranked.flatMap((candidate) => {
    const candidateTitleId = candidate.id.split(":", 1)[0];
    if (!candidateTitleId || seen.has(candidateTitleId)) return [];
    seen.add(candidateTitleId);
    return [candidateTitleId];
  });
  const index = titleIds.indexOf(titleId);
  return index < 0 ? undefined : index + 1;
}

export type SearchRelevanceEvaluation = Readonly<{
  corpusVersion: string;
  caseCount: number;
  catalogCoverageTotal: number;
  catalogCoverageMatched: number;
  catalogCoverageRate: number;
  catalogCoverageFailures: readonly CatalogCoverageFailure[];
  recallAt10: number;
  precisionAt10: number;
  mrr: number;
  ndcgAt10: number;
  wrongCorrectionRate: number;
  zeroResultRate: number;
  maxExpectedRank: number | null;
  failedCases: readonly string[];
  passed: boolean;
}>;

export function evaluateJobSearchRelevance(
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
): SearchRelevanceEvaluation {
  const coverage = catalogCoverage(catalogIndex);
  let relevantCases = 0;
  let topTenHits = 0;
  let precisionSlots = 0;
  let reciprocalRank = 0;
  let discountedGain = 0;
  let wrongCorrections = 0;
  let zeroResults = 0;
  let maxExpectedRank = 0;
  const failedCases: string[] = [];

  const candidates = (catalogIndex.catalog.titleDefinitions ?? []).flatMap(
    (title) => [
      { id: `${title.titleId}:en`, title: title.canonical.en },
      { id: `${title.titleId}:vi`, title: title.canonical.vi },
    ],
  );

  for (const testCase of SEARCH_RELEVANCE_CORPUS) {
    const resolved = resolveSearchQuery(
      testCase.query,
      "JOBS",
      testCase.locale ?? "en",
      "SMART",
      { catalogIndex },
    );
    const ranked = rankSearchCandidates(
      candidates,
      resolved.variants,
      resolved.intent,
      catalogIndex,
    );
    if (testCase.expectedNoMatch) {
      const hasMappedSignal = Boolean(
        resolved.interpretation.matchedTitle ||
        resolved.interpretation.matchedOccupation ||
        resolved.interpretation.matchedFacets?.length ||
        resolved.intent?.titleCandidates?.length ||
        resolved.intent?.occupationCandidates?.length,
      );
      if (hasMappedSignal) failedCases.push(testCase.name);
      continue;
    }
    if (testCase.ambiguous) {
      const expectedIds = new Set(
        testCase.expectedTitleIds?.filter(Boolean) ?? [],
      );
      const resolvedIds = new Set(
        resolved.intent?.titleCandidates?.map(
          (candidate) => candidate.titleId,
        ) ?? [],
      );
      if (!resolved.intent?.ambiguous && !resolved.interpretation.ambiguous) {
        failedCases.push(testCase.name);
      } else if (
        expectedIds.size > 0 &&
        [...expectedIds].some((titleId) => !resolvedIds.has(titleId))
      ) {
        failedCases.push(testCase.name);
      }
      continue;
    }
    relevantCases += 1;
    const rankedTitleCount = new Set(
      ranked.map((candidate) => candidate.id.split(":", 1)[0]),
    ).size;
    precisionSlots += Math.max(1, Math.min(10, rankedTitleCount));
    const expectedIds = [
      ...(testCase.expectedTitleId ? [testCase.expectedTitleId] : []),
      ...(testCase.expectedTitleIds ?? []),
    ];
    const ranks = expectedIds
      .map((titleId) => titleCandidatePosition(ranked, titleId))
      .filter((rank): rank is number => rank !== undefined);
    const rank = ranks.length ? Math.min(...ranks) : undefined;
    if (rank === undefined) {
      zeroResults += 1;
      failedCases.push(testCase.name);
      continue;
    }
    maxExpectedRank = Math.max(maxExpectedRank, rank);
    if (rank <= 10) {
      topTenHits += 1;
      discountedGain += 1 / Math.log2(rank + 1);
    }
    reciprocalRank += rank <= 10 ? 1 / rank : 0;
    if (resolved.interpretation.correction) {
      const correctionTarget =
        resolved.interpretation.correction.to.toLocaleLowerCase();
      const expectedTitles = expectedIds
        .map((titleId) => catalogIndex.titleById(titleId))
        .filter((title): title is NonNullable<typeof title> => Boolean(title));
      const occupationIds = new Set(
        expectedTitles
          .map((title) => title.occupationId)
          .filter((occupationId): occupationId is string =>
            Boolean(occupationId),
          ),
      );
      const occupationLabels = [...occupationIds]
        .map((occupationId) => catalogIndex.occupationById(occupationId))
        .filter((occupation): occupation is NonNullable<typeof occupation> =>
          Boolean(occupation),
        )
        .flatMap((occupation) => [occupation.labels.en, occupation.labels.vi]);
      const correctionIsExpected = [
        ...expectedTitles.flatMap((title) => [
          title.canonical.en,
          title.canonical.vi,
        ]),
        ...occupationLabels,
      ].some((label) => label.toLocaleLowerCase() === correctionTarget);
      if (!correctionIsExpected) wrongCorrections += 1;
    }
    if (rank > 3) failedCases.push(testCase.name);
  }

  const divisor = Math.max(relevantCases, 1);
  const wrongCorrectionRate = wrongCorrections / divisor;
  const catalogCoverageRate =
    coverage.total > 0 ? coverage.matched / coverage.total : 0;
  return {
    corpusVersion: SEARCH_RELEVANCE_CORPUS_VERSION,
    caseCount: SEARCH_RELEVANCE_CORPUS.length,
    catalogCoverageTotal: coverage.total,
    catalogCoverageMatched: coverage.matched,
    catalogCoverageRate,
    catalogCoverageFailures: coverage.failures,
    recallAt10: topTenHits / divisor,
    precisionAt10: topTenHits / Math.max(precisionSlots, 1),
    mrr: reciprocalRank / divisor,
    ndcgAt10: discountedGain / divisor,
    wrongCorrectionRate,
    zeroResultRate: zeroResults / divisor,
    maxExpectedRank: maxExpectedRank || null,
    failedCases,
    passed:
      failedCases.length === 0 &&
      catalogCoverageRate === 1 &&
      topTenHits === relevantCases &&
      reciprocalRank / divisor >= 0.9 &&
      discountedGain / divisor >= 0.85 &&
      wrongCorrectionRate <= 0.02 &&
      zeroResults === 0,
  };
}

/** Evaluate against the same active snapshot used by live Job Search. */
export async function evaluateRuntimeJobSearchRelevance() {
  const snapshot = await searchCatalogProvider.getActiveSnapshot();
  return evaluateJobSearchRelevance(snapshot.index);
}
