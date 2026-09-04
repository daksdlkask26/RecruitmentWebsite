import {
  normalizeSearchText,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import {
  occupationById,
  occupationPhrases,
  type OccupationPhraseMatch,
} from "./occupation-search-index";
import { jobSearchCatalogIndex } from "./job-search-catalog-index";

export const intentionalOtherOccupationTitleReasons: Readonly<
  Record<string, string>
> = Object.freeze({
  "financial analyst":
    "The active corpus uses this title in both Accounting and Banking; keep it literal until an explicit industry filter resolves the intent.",
  "real estate agent":
    "The active corpus uses this title in both Sales and Real Estate; keep it literal until an explicit industry filter resolves the intent.",
  "video editor":
    "The active corpus uses this title in both Design and Media; keep it literal until an explicit industry filter resolves the intent.",
  "visual merchandiser":
    "The active corpus uses this title in both Marketing and Retail; keep it literal until an explicit industry filter resolves the intent.",
});

export type OccupationCoverageInput = Readonly<{
  jobId?: string | null;
  title: string;
  industryCode?: string | null;
  categoryFamily?: string | null;
  categoryIds?: readonly (string | null | undefined)[];
  skills?: readonly (string | null | undefined)[];
  status?: string | null;
  source?: string | null;
  candidateVisible?: boolean;
  intentionalOther?: boolean;
  intentionalOtherReason?: string | null;
}>;

export type OccupationCoverageMatch = Readonly<{
  occupationId: string;
  phrase: string;
  kind: OccupationPhraseMatch["kind"];
}>;

export type OccupationCoverageReport = Readonly<{
  totalJobs: number;
  uniqueTitles: number;
  verifiedTitles: number;
  autoMappedTitles: number;
  ambiguousTitlesCount: number;
  unmappedTitlesCount: number;
  intentionalOtherTitlesCount: number;
  invalidTitles: number;
  candidateVisibleJobs: number;
  candidateVisibleComplete: boolean;
  bySource: readonly {
    source: string;
    totalJobs: number;
    uniqueTitles: number;
    complete: boolean;
  }[];
  facetConflicts: readonly {
    title: string;
    facetIds: readonly string[];
  }[];
  duplicateAliases: readonly {
    normalizedPhrase: string;
    occupationIds: readonly string[];
  }[];
  titleStatuses: readonly {
    title: string;
    status:
      | "VERIFIED"
      | "AUTO_MAPPED_HIGH_CONFIDENCE"
      | "AMBIGUOUS"
      | "UNMAPPED"
      | "INTENTIONAL_OTHER"
      | "INVALID";
    jobIds: readonly string[];
  }[];
  errors: readonly {
    jobId: string | null;
    title: string;
    status: string | null;
    source: string | null;
    code:
      | "EMPTY_TITLE"
      | "UNMAPPED_TITLE"
      | "AMBIGUOUS_TITLE"
      | "CATEGORY_MISMATCH"
      | "FACET_CONFLICT";
  }[];
  totalTitles: number;
  mappedTitles: number;
  unmappedTitles: number;
  intentionalOtherTitles: number;
  intentionalOther: readonly {
    title: string;
    reason: string;
  }[];
  ambiguousTitles: readonly {
    title: string;
    occupationIds: readonly string[];
  }[];
  categoryMismatches: readonly {
    title: string;
    occupationId: string;
    expectedIndustryCode: string | null;
    expectedCategoryIds: readonly string[];
  }[];
  unmapped: readonly string[];
  complete: boolean;
}>;

const phraseKindPriority: Record<OccupationPhraseMatch["kind"], number> = {
  RELATED_TITLE: 5,
  LABEL: 4,
  ALIAS: 2,
  IRREGULAR_ALIAS: 1,
  ABBREVIATION: 0,
};

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}

function phraseOccursInTitle(title: string, phrase: string) {
  const titleTokens = searchTextTokens(title);
  const phraseTokens = searchTextTokens(phrase);
  if (!titleTokens.length || !phraseTokens.length) return false;
  if (phraseTokens.length <= titleTokens.length) {
    for (
      let start = 0;
      start <= titleTokens.length - phraseTokens.length;
      start += 1
    ) {
      if (
        titleTokens.slice(start, start + phraseTokens.length).join(" ") ===
        phrase
      ) {
        return true;
      }
    }
  }
  return phraseTokens.length > 1 && compact(title) === compact(phrase);
}

function phraseCoversWholeTitle(title: string, phrase: string) {
  return compact(title) === compact(phrase);
}

function titleOccupationMatches(title: string): OccupationCoverageMatch[] {
  const normalizedTitle = normalizeSearchText(title);
  const matchingPhrases = occupationPhrases().filter((phrase) =>
    phraseOccursInTitle(normalizedTitle, phrase.normalizedPhrase),
  );
  const wholeTitlePhrases = matchingPhrases.filter((phrase) =>
    phraseCoversWholeTitle(normalizedTitle, phrase.normalizedPhrase),
  );
  const phrasesToScore = wholeTitlePhrases.length
    ? wholeTitlePhrases
    : matchingPhrases;
  const bestByOccupation = new Map<string, OccupationCoverageMatch>();
  for (const phrase of phrasesToScore) {
    const current = bestByOccupation.get(phrase.occupation.occupationId);
    const next: OccupationCoverageMatch = {
      occupationId: phrase.occupation.occupationId,
      phrase: phrase.phrase,
      kind: phrase.kind,
    };
    if (
      !current ||
      phrase.normalizedPhrase.length >
        normalizeSearchText(current.phrase).length ||
      (phrase.normalizedPhrase.length ===
        normalizeSearchText(current.phrase).length &&
        phraseKindPriority[phrase.kind] > phraseKindPriority[current.kind])
    ) {
      bestByOccupation.set(phrase.occupation.occupationId, next);
    }
  }
  return [...bestByOccupation.values()];
}

function intentionalOtherReason(input: OccupationCoverageInput) {
  if (input.intentionalOtherReason?.trim()) {
    return input.intentionalOtherReason.trim();
  }
  return (
    intentionalOtherOccupationTitleReasons[normalizeSearchText(input.title)] ??
    (input.intentionalOther
      ? "Explicitly classified as Other by the active job data policy."
      : null)
  );
}

function canonicalIndustryCode(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "other" ? "r29" : normalized || null;
}

function isCategoryCompatible(
  occupationId: string,
  input: OccupationCoverageInput,
) {
  const occupation = occupationById(occupationId);
  if (!occupation) return false;
  const industryCode = canonicalIndustryCode(
    input.industryCode ?? input.categoryFamily,
  );
  if (industryCode && industryCode !== occupation.industryCode) {
    return false;
  }
  const categoryIds = (input.categoryIds ?? [])
    .map((categoryId) => categoryId?.trim().toLowerCase())
    .filter((categoryId): categoryId is string => Boolean(categoryId));
  return (
    !categoryIds.length ||
    categoryIds.some((categoryId) =>
      occupation.categoryIds.includes(categoryId),
    )
  );
}

function titleFacetIds(title: string) {
  const normalizedTitle = normalizeSearchText(title);
  const ids = new Set<string>();
  for (const phrase of jobSearchCatalogIndex.facetPhrases()) {
    if (phraseOccursInTitle(normalizedTitle, phrase.normalizedPhrase)) {
      if (phrase.facetId) ids.add(phrase.facetId);
    }
  }
  return [...ids].sort();
}

function hasFacetConflict(facetIds: readonly string[]) {
  const facets = new Set(facetIds);
  return facetIds.some((facetId) => {
    const facet = jobSearchCatalogIndex.facetById(facetId);
    return Boolean(
      facet?.conflictFacetIds.some((conflictFacetId) =>
        facets.has(conflictFacetId),
      ),
    );
  });
}

function duplicateCatalogAliases() {
  const aliases = new Map<string, Set<string>>();
  for (const phrase of jobSearchCatalogIndex.occupationPhrases()) {
    const normalizedPhrase = phrase.compactPhrase;
    if (!normalizedPhrase || !phrase.occupationId) continue;
    const occupationIds = aliases.get(normalizedPhrase) ?? new Set<string>();
    occupationIds.add(phrase.occupationId);
    aliases.set(normalizedPhrase, occupationIds);
  }
  return [...aliases.entries()]
    .filter(([, occupationIds]) => occupationIds.size > 1)
    .map(([normalizedPhrase, occupationIds]) => ({
      normalizedPhrase,
      occupationIds: [...occupationIds].sort(),
    }))
    .sort((left, right) =>
      left.normalizedPhrase.localeCompare(right.normalizedPhrase),
    );
}

type CoverageStatus = NonNullable<
  OccupationCoverageReport["titleStatuses"]
>[number]["status"];

function statusPriority(status: CoverageStatus) {
  return {
    INVALID: 6,
    UNMAPPED: 5,
    AMBIGUOUS: 4,
    AUTO_MAPPED_HIGH_CONFIDENCE: 3,
    INTENTIONAL_OTHER: 2,
    VERIFIED: 1,
  }[status];
}

export function auditOccupationSearchCoverage(
  inputs: readonly OccupationCoverageInput[],
  options: Readonly<{ includeBreakdown?: boolean }> = {},
): OccupationCoverageReport {
  const ambiguous = new Map<
    string,
    { title: string; occupationIds: readonly string[] }
  >();
  const categoryMismatches = new Map<
    string,
    {
      title: string;
      occupationId: string;
      expectedIndustryCode: string | null;
      expectedCategoryIds: readonly string[];
    }
  >();
  const unmapped = new Map<string, string>();
  let mappedTitles = 0;
  const intentionalOther = new Map<string, { title: string; reason: string }>();
  const errors: OccupationCoverageReport["errors"] extends readonly (infer T)[]
    ? T[]
    : never[] = [];
  const statusByTitle = new Map<
    string,
    { title: string; status: CoverageStatus; jobIds: Set<string> }
  >();
  const facetConflicts = new Map<
    string,
    { title: string; facetIds: string[] }
  >();

  const setStatus = (
    title: string,
    status: CoverageStatus,
    input: OccupationCoverageInput,
  ) => {
    const key = normalizeSearchText(title);
    const current = statusByTitle.get(key);
    const jobIds = current?.jobIds ?? new Set<string>();
    if (input.jobId?.trim()) jobIds.add(input.jobId.trim());
    if (!current || statusPriority(status) > statusPriority(current.status)) {
      statusByTitle.set(key, { title, status, jobIds });
    }
  };

  for (const input of inputs) {
    const title = input.title.trim();
    if (!title) {
      unmapped.set("", title);
      setStatus(title, "INVALID", input);
      errors.push({
        jobId: input.jobId?.trim() || null,
        title,
        status: input.status?.trim() || null,
        source: input.source?.trim() || null,
        code: "EMPTY_TITLE",
      });
      continue;
    }
    const otherReason = intentionalOtherReason(input);
    if (otherReason) {
      intentionalOther.set(normalizeSearchText(title), {
        title,
        reason: otherReason,
      });
      setStatus(title, "INTENTIONAL_OTHER", input);
      continue;
    }
    const matches = titleOccupationMatches(title);
    const compatible = matches.filter((match) =>
      isCategoryCompatible(match.occupationId, input),
    );
    if (compatible.length) mappedTitles += 1;
    const exactMatch = matches.find(
      (match) => match.kind === "LABEL" || match.kind === "RELATED_TITLE",
    );
    setStatus(
      title,
      compatible.length > 1
        ? "AMBIGUOUS"
        : compatible.length === 0
          ? "UNMAPPED"
          : exactMatch
            ? "VERIFIED"
            : "AUTO_MAPPED_HIGH_CONFIDENCE",
      input,
    );
    if (compatible.length > 1) {
      const occupationIds = compatible
        .map((match) => match.occupationId)
        .sort();
      ambiguous.set(
        `${normalizeSearchText(title)}\u0000${occupationIds.join(",")}`,
        {
          title,
          occupationIds,
        },
      );
      errors.push({
        jobId: input.jobId?.trim() || null,
        title,
        status: input.status?.trim() || null,
        source: input.source?.trim() || null,
        code: "AMBIGUOUS_TITLE",
      });
    }
    for (const match of matches) {
      if (isCategoryCompatible(match.occupationId, input)) continue;
      const occupation = occupationById(match.occupationId);
      if (!occupation) continue;
      const key = `${normalizeSearchText(title)}\u0000${match.occupationId}`;
      categoryMismatches.set(key, {
        title,
        occupationId: match.occupationId,
        expectedIndustryCode: canonicalIndustryCode(input.industryCode),
        expectedCategoryIds: (input.categoryIds ?? [])
          .map((categoryId) => categoryId?.trim().toLowerCase())
          .filter((categoryId): categoryId is string => Boolean(categoryId)),
      });
      errors.push({
        jobId: input.jobId?.trim() || null,
        title,
        status: input.status?.trim() || null,
        source: input.source?.trim() || null,
        code: "CATEGORY_MISMATCH",
      });
    }
    if (!compatible.length) {
      unmapped.set(normalizeSearchText(title), title);
      errors.push({
        jobId: input.jobId?.trim() || null,
        title,
        status: input.status?.trim() || null,
        source: input.source?.trim() || null,
        code: "UNMAPPED_TITLE",
      });
    }
    const facetIds = titleFacetIds(title);
    if (hasFacetConflict(facetIds)) {
      facetConflicts.set(normalizeSearchText(title), { title, facetIds });
      errors.push({
        jobId: input.jobId?.trim() || null,
        title,
        status: input.status?.trim() || null,
        source: input.source?.trim() || null,
        code: "FACET_CONFLICT",
      });
    }
  }

  const totalTitles = inputs.length;
  const unmappedTitles = unmapped.size;
  const titleStatuses = [...statusByTitle.values()].map((entry) => ({
    title: entry.title,
    status: entry.status,
    jobIds: [...entry.jobIds].sort(),
  }));
  const statusCount = (status: CoverageStatus) =>
    titleStatuses.filter((entry) => entry.status === status).length;
  const duplicateAliases = duplicateCatalogAliases();
  const uniqueTitles = statusByTitle.size;
  const candidateVisibleInputs = inputs.filter(
    (input) => input.candidateVisible !== false,
  );
  const candidateVisibleReport =
    options.includeBreakdown === false
      ? null
      : auditOccupationSearchCoverage(candidateVisibleInputs, {
          includeBreakdown: false,
        });
  const bySource =
    options.includeBreakdown === false
      ? []
      : [...new Set(inputs.map((input) => input.source?.trim() || "unknown"))]
          .sort()
          .map((source) => {
            const sourceReport = auditOccupationSearchCoverage(
              inputs.filter(
                (input) => (input.source?.trim() || "unknown") === source,
              ),
              { includeBreakdown: false },
            );
            return {
              source,
              totalJobs: sourceReport.totalJobs,
              uniqueTitles: sourceReport.uniqueTitles,
              complete: sourceReport.complete,
            };
          });
  return {
    totalJobs: inputs.length,
    uniqueTitles,
    verifiedTitles: statusCount("VERIFIED"),
    autoMappedTitles: statusCount("AUTO_MAPPED_HIGH_CONFIDENCE"),
    ambiguousTitlesCount: statusCount("AMBIGUOUS"),
    unmappedTitlesCount: statusCount("UNMAPPED"),
    intentionalOtherTitlesCount: statusCount("INTENTIONAL_OTHER"),
    invalidTitles: statusCount("INVALID"),
    candidateVisibleJobs: candidateVisibleInputs.length,
    candidateVisibleComplete: candidateVisibleReport?.complete ?? false,
    bySource,
    facetConflicts: [...facetConflicts.values()],
    duplicateAliases,
    titleStatuses,
    errors,
    totalTitles,
    mappedTitles,
    unmappedTitles,
    intentionalOtherTitles: intentionalOther.size,
    intentionalOther: [...intentionalOther.values()],
    ambiguousTitles: [...ambiguous.values()],
    categoryMismatches: [...categoryMismatches.values()],
    unmapped: [...unmapped.values()],
    complete:
      unmappedTitles === 0 &&
      categoryMismatches.size === 0 &&
      ambiguous.size === 0 &&
      facetConflicts.size === 0 &&
      duplicateAliases.length === 0 &&
      !titleStatuses.some((entry) => entry.status === "INVALID"),
  };
}
