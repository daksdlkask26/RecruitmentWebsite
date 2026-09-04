import "server-only";

import {
  normalizeSearchText,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import {
  jobSearchProfileSchema,
  type BilingualJobTitleDefinition,
  type JobSearchProfile,
} from "@/shared/contracts/search/job-search-intent";
import {
  jobSearchCatalogIndex,
  type CompiledSearchPhrase,
  type SearchCatalogIndex,
} from "./catalogs/job-search-catalog-index";
import { searchCatalogProvider } from "./catalogs/search-catalog-provider";

export type JobSearchProfileInput = Readonly<{
  title: string;
  industryCode?: string | null;
  categoryFamily?: string | null;
  categoryIds?: readonly (string | null | undefined)[];
  skills?: readonly (string | null | undefined)[];
  description?: string | readonly string[] | null;
}>;

export type JobSearchProfileOptions = Readonly<{
  index?: SearchCatalogIndex;
  reviewed?: boolean;
}>;

type Candidate = Readonly<{
  occupationId: string;
  phrase: CompiledSearchPhrase;
  exact: boolean;
  fuzzy: boolean;
  score: number;
}>;

type TitleCandidate = Readonly<{
  title: BilingualJobTitleDefinition;
  phrase: CompiledSearchPhrase;
  exact: boolean;
  fuzzy: boolean;
  score: number;
}>;

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}

function canonicalIndustryCode(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "other" ? "r29" : normalized || null;
}

function normalizedCategoryIds(input: JobSearchProfileInput) {
  return (input.categoryIds ?? [])
    .map((categoryId) => categoryId?.trim().toLowerCase())
    .filter((categoryId): categoryId is string => Boolean(categoryId));
}

function isCategoryCompatible(
  occupationId: string,
  input: JobSearchProfileInput,
  index: SearchCatalogIndex,
) {
  const occupation = index.occupationById(occupationId);
  if (!occupation) return false;
  const industryCode = canonicalIndustryCode(
    input.industryCode ?? input.categoryFamily,
  );
  if (industryCode && industryCode !== occupation.industryCode) return false;
  const categoryIds = normalizedCategoryIds(input);
  return (
    !categoryIds.length ||
    categoryIds.some((categoryId) =>
      occupation.categoryIds.includes(categoryId),
    )
  );
}

function phraseOccursInTitle(title: string, phrase: string) {
  if (!title || !phrase) return false;
  if (compact(title) === compact(phrase)) return true;
  const titleTokens = searchTextTokens(title);
  const phraseTokens = searchTextTokens(phrase);
  if (phraseTokens.length > titleTokens.length) return false;
  return titleTokens.some(
    (_, start) =>
      start + phraseTokens.length <= titleTokens.length &&
      titleTokens.slice(start, start + phraseTokens.length).join(" ") ===
        phrase,
  );
}

function damerauLevenshtein(left: string, right: string) {
  const source = Array.from(left);
  const target = Array.from(right);
  const distance = Array.from({ length: source.length + 1 }, () =>
    Array<number>(target.length + 1).fill(0),
  );
  for (let row = 0; row <= source.length; row += 1) distance[row][0] = row;
  for (let column = 0; column <= target.length; column += 1)
    distance[0][column] = column;
  for (let row = 1; row <= source.length; row += 1) {
    for (let column = 1; column <= target.length; column += 1) {
      const substitution = source[row - 1] === target[column - 1] ? 0 : 1;
      distance[row][column] = Math.min(
        distance[row - 1][column] + 1,
        distance[row][column - 1] + 1,
        distance[row - 1][column - 1] + substitution,
      );
      if (
        row > 1 &&
        column > 1 &&
        source[row - 1] === target[column - 2] &&
        source[row - 2] === target[column - 1]
      ) {
        distance[row][column] = Math.min(
          distance[row][column],
          distance[row - 2][column - 2] + 1,
        );
      }
    }
  }
  return distance[source.length][target.length];
}

function fuzzyThreshold(length: number) {
  if (length < 4) return 0;
  if (length <= 7) return 1;
  return 2;
}

function fuzzyPhraseMatch(title: string, phrase: string) {
  const left = compact(title);
  const right = compact(phrase);
  if (left.length < 4 || right.length < 4) return null;
  const distance = damerauLevenshtein(left, right);
  const threshold = fuzzyThreshold(Math.max(left.length, right.length));
  if (
    distance === 0 ||
    distance > threshold ||
    distance / Math.max(left.length, right.length) > 0.34
  ) {
    return null;
  }
  return distance;
}

function isFallbackPhraseKind(kind: CompiledSearchPhrase["kind"]) {
  return (
    kind === "ALIAS" || kind === "ABBREVIATION" || kind === "IRREGULAR_ALIAS"
  );
}

function titlePhraseScore(phrase: CompiledSearchPhrase) {
  return (
    (phrase.kind === "TITLE_CANONICAL"
      ? 500
      : phrase.kind === "TITLE_ALIAS"
        ? 420
        : 350) +
    phrase.weight +
    phrase.compactPhrase.length
  );
}

function descriptionText(description: JobSearchProfileInput["description"]) {
  return Array.isArray(description)
    ? description.join(" ")
    : (description ?? "");
}

function titleFacetIds(title: string, index: SearchCatalogIndex) {
  const normalizedTitle = normalizeSearchText(title);
  return [
    ...new Set(
      index
        .facetPhrases()
        .filter((phrase) =>
          phraseOccursInTitle(normalizedTitle, phrase.normalizedPhrase),
        )
        .flatMap((phrase) => (phrase.facetId ? [phrase.facetId] : [])),
    ),
  ].sort();
}

function profileTitleMetadata(title: BilingualJobTitleDefinition | undefined) {
  if (!title) {
    return {
      titleIds: [],
      canonicalTitleVi: null,
      canonicalTitleEn: null,
      normalizedAliases: [],
      translationStatus: "UNMAPPED" as const,
      mappingSource: "MANUAL_REVIEW" as const,
      mappingConfidence: 0,
      reviewReason: null,
    };
  }
  return {
    titleIds: [title.titleId],
    canonicalTitleVi: title.canonical.vi,
    canonicalTitleEn: title.canonical.en,
    normalizedAliases: [
      ...new Set(
        [
          title.canonical.vi,
          title.canonical.en,
          ...title.aliases.vi,
          ...title.aliases.en,
          ...title.abbreviations,
        ]
          .map((phrase) => normalizeSearchText(phrase, 160))
          .filter(Boolean),
      ),
    ].slice(0, 64),
    translationStatus: title.translationStatus,
    mappingSource: title.mappingSource,
    mappingConfidence: title.mappingConfidence,
    reviewReason: title.reviewReason,
  };
}

/**
 * A manually reviewed catalog entry is the authoritative correction for an
 * exact static job title.  Static JobPosting rows can retain a legacy
 * industry/category classification, so this narrow override must only apply
 * to an exact whole-title match with explicit human provenance.  Inferred,
 * fuzzy, or merely curated entries continue to obey taxonomy boundaries.
 */
function isHumanReviewedExactTitleOverride(title: BilingualJobTitleDefinition) {
  return (
    title.translationStatus === "HUMAN_VERIFIED" &&
    title.mappingSource === "MANUAL_REVIEW"
  );
}

const titleStatusPriority: Record<
  JobSearchProfile["translationStatus"],
  number
> = {
  HUMAN_VERIFIED: 0,
  AUTO_HIGH_CONFIDENCE: 1,
  INTENTIONAL_UNTRANSLATED: 2,
  REQUIRES_REVIEW: 3,
  AMBIGUOUS: 4,
  UNMAPPED: 5,
};

function mostConservativeTitleStatus(candidates: readonly TitleCandidate[]) {
  return candidates.reduce<JobSearchProfile["translationStatus"]>(
    (current, candidate) =>
      titleStatusPriority[candidate.title.translationStatus] >
      titleStatusPriority[current]
        ? candidate.title.translationStatus
        : current,
    "HUMAN_VERIFIED",
  );
}

function profileResult(input: {
  title: string;
  normalizedSkills: readonly string[];
  occupationIds: readonly string[];
  facetIds: readonly string[];
  source: JobSearchProfile["source"];
  confidence: number;
  index: SearchCatalogIndex;
  titleDefinition?: BilingualJobTitleDefinition;
  titleIds?: readonly string[];
  canonicalTitleVi?: string | null;
  canonicalTitleEn?: string | null;
  normalizedAliases?: readonly string[];
  translationStatus?: JobSearchProfile["translationStatus"];
  mappingSource?: JobSearchProfile["mappingSource"];
  mappingConfidence?: number;
  reviewReason?: string | null;
}): JobSearchProfile {
  const metadata = input.titleDefinition
    ? profileTitleMetadata(input.titleDefinition)
    : undefined;
  return jobSearchProfileSchema.parse({
    titleIds: [...new Set(input.titleIds ?? metadata?.titleIds ?? [])].slice(
      0,
      16,
    ),
    occupationIds: [...new Set(input.occupationIds)].slice(0, 16),
    facetIds: [...new Set(input.facetIds)].slice(0, 16),
    normalizedTitle: normalizeSearchText(input.title),
    canonicalTitleVi:
      input.canonicalTitleVi ?? metadata?.canonicalTitleVi ?? null,
    canonicalTitleEn:
      input.canonicalTitleEn ?? metadata?.canonicalTitleEn ?? null,
    normalizedAliases: [
      ...new Set(input.normalizedAliases ?? metadata?.normalizedAliases ?? []),
    ].slice(0, 64),
    normalizedSkills: [...new Set(input.normalizedSkills)].slice(0, 64),
    source: input.source,
    confidence: input.confidence,
    translationStatus:
      input.translationStatus ?? metadata?.translationStatus ?? "UNMAPPED",
    mappingSource:
      input.mappingSource ?? metadata?.mappingSource ?? "MANUAL_REVIEW",
    mappingConfidence:
      input.mappingConfidence ?? metadata?.mappingConfidence ?? 0,
    reviewReason: input.reviewReason ?? metadata?.reviewReason ?? null,
    catalogVersion: input.index.version,
  });
}

function exactTitleCandidates(
  title: string,
  input: JobSearchProfileInput,
  index: SearchCatalogIndex,
) {
  const normalizedTitle = normalizeSearchText(title);
  const matches = index
    .titlePhrases()
    .filter((phrase) =>
      phraseOccursInTitle(normalizedTitle, phrase.normalizedPhrase),
    )
    .filter((phrase) => phrase.titleId)
    .map((phrase): TitleCandidate | undefined => {
      const definition = index.titleById(phrase.titleId!);
      return definition
        ? ({
            title: definition,
            phrase,
            exact: true as const,
            fuzzy: false as const,
            score: titlePhraseScore(phrase),
          } satisfies TitleCandidate)
        : undefined;
    })
    .filter((candidate): candidate is TitleCandidate => Boolean(candidate));
  const compatible = matches.filter(
    (candidate) =>
      !candidate.title.occupationId ||
      isCategoryCompatible(candidate.title.occupationId, input, index),
  );
  const hasTaxonomyConstraint = Boolean(
    canonicalIndustryCode(input.industryCode ?? input.categoryFamily) ||
    normalizedCategoryIds(input).length,
  );
  const candidates =
    compatible.length || hasTaxonomyConstraint ? compatible : matches;
  const wholeTitle = candidates.filter(
    (candidate) =>
      compact(candidate.phrase.normalizedPhrase) === compact(normalizedTitle),
  );
  const wholeMatches = matches.filter(
    (candidate) =>
      compact(candidate.phrase.normalizedPhrase) === compact(normalizedTitle),
  );
  const reviewedWholeMatches = wholeMatches.filter((candidate) =>
    isHumanReviewedExactTitleOverride(candidate.title),
  );
  // A single approved exact mapping may intentionally correct a stale
  // JobPosting taxonomy.  Keep ambiguity conservative if multiple approved
  // definitions happen to share the same phrase.
  const selected =
    reviewedWholeMatches.length === 1
      ? reviewedWholeMatches
      : wholeTitle.length
        ? wholeTitle
        : candidates;
  return selected.sort(
    (left, right) =>
      right.score - left.score ||
      left.title.titleId.localeCompare(right.title.titleId),
  );
}

function fuzzyTitleCandidates(
  title: string,
  input: JobSearchProfileInput,
  index: SearchCatalogIndex,
) {
  const normalizedTitle = normalizeSearchText(title);
  const candidates: TitleCandidate[] = [];
  for (const phrase of index.fuzzyTitlePhraseCandidates(normalizedTitle)) {
    if (!phrase.titleId) continue;
    const definition = index.titleById(phrase.titleId);
    if (
      !definition ||
      (definition.occupationId &&
        !isCategoryCompatible(definition.occupationId, input, index))
    ) {
      continue;
    }
    const distance = fuzzyPhraseMatch(normalizedTitle, phrase.normalizedPhrase);
    if (distance === null) continue;
    candidates.push({
      title: definition,
      phrase,
      exact: false,
      fuzzy: true,
      score: titlePhraseScore(phrase) - distance * 40,
    });
  }
  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.title.titleId.localeCompare(right.title.titleId),
  );
}

function exactCandidates(
  title: string,
  input: JobSearchProfileInput,
  index: SearchCatalogIndex,
) {
  const normalizedTitle = normalizeSearchText(title);
  const matches = index
    .occupationPhrases()
    .filter((phrase) =>
      phraseOccursInTitle(normalizedTitle, phrase.normalizedPhrase),
    )
    .filter((phrase) => phrase.occupationId)
    .map(
      (phrase) =>
        ({
          occupationId: phrase.occupationId!,
          phrase,
          exact: true,
          fuzzy: false,
          score:
            (phrase.kind === "CANONICAL"
              ? 500
              : phrase.kind === "RELATED_TITLE"
                ? 400
                : 300) +
            phrase.weight +
            phrase.compactPhrase.length,
        }) satisfies Candidate,
    );
  const compatible = matches.filter((candidate) =>
    isCategoryCompatible(candidate.occupationId, input, index),
  );
  const hasTaxonomyConstraint = Boolean(
    canonicalIndustryCode(input.industryCode ?? input.categoryFamily) ||
    normalizedCategoryIds(input).length,
  );
  const candidates =
    compatible.length || hasTaxonomyConstraint ? compatible : matches;
  const wholeTitle = candidates.filter(
    (candidate) =>
      compact(candidate.phrase.normalizedPhrase) === compact(normalizedTitle),
  );
  return (wholeTitle.length ? wholeTitle : candidates).sort(
    (left, right) =>
      right.score - left.score ||
      left.occupationId.localeCompare(right.occupationId),
  );
}

function fuzzyCandidates(
  title: string,
  input: JobSearchProfileInput,
  index: SearchCatalogIndex,
) {
  const normalizedTitle = normalizeSearchText(title);
  const candidates: Candidate[] = [];
  for (const phrase of index.fuzzyOccupationPhraseCandidates(normalizedTitle)) {
    if (
      !phrase.occupationId ||
      !isCategoryCompatible(phrase.occupationId, input, index)
    )
      continue;
    const distance = fuzzyPhraseMatch(normalizedTitle, phrase.normalizedPhrase);
    if (distance === null) continue;
    candidates.push({
      occupationId: phrase.occupationId,
      phrase,
      exact: false,
      fuzzy: true,
      score: 300 + phrase.weight - distance * 40 + phrase.compactPhrase.length,
    });
  }
  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.occupationId.localeCompare(right.occupationId),
  );
}

function skillCandidates(
  input: JobSearchProfileInput,
  index: SearchCatalogIndex,
) {
  const skillText = normalizeSearchText(
    [
      ...(input.skills ?? []).filter(
        (skill): skill is string => typeof skill === "string",
      ),
      descriptionText(input.description),
    ].join(" "),
    4000,
  );
  if (!skillText) return [];
  const candidates = index.occupations
    .map((occupation) => ({
      occupationId: occupation.occupationId,
      score: occupation.skills.filter((skill) => {
        const normalizedSkill = normalizeSearchText(skill, 100);
        return phraseOccursInTitle(skillText, normalizedSkill);
      }).length,
    }))
    .filter((candidate) => candidate.score > 0)
    .filter((candidate) =>
      isCategoryCompatible(candidate.occupationId, input, index),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.occupationId.localeCompare(right.occupationId),
    );
  return candidates;
}

export function buildJobSearchProfile(
  input: JobSearchProfileInput,
  options: JobSearchProfileOptions = {},
): JobSearchProfile {
  const index = options.index ?? jobSearchCatalogIndex;
  const title = input.title.trim();
  const normalizedSkills = [...(input.skills ?? [])]
    .filter((skill): skill is string => typeof skill === "string")
    .map((skill) => normalizeSearchText(skill, 100))
    .filter(Boolean);
  if (!title) {
    return profileResult({
      title,
      normalizedSkills,
      occupationIds: [],
      facetIds: [],
      source: "UNMAPPED",
      confidence: 0,
      index,
    });
  }

  const exactTitles = exactTitleCandidates(title, input, index);
  const exactTitleIds = [
    ...new Set(exactTitles.map((candidate) => candidate.title.titleId)),
  ];
  if (exactTitles.length && exactTitles[0]) {
    const best = exactTitles[0];
    const occupationIds = [
      ...new Set(
        exactTitles.flatMap((candidate) =>
          candidate.title.occupationId ? [candidate.title.occupationId] : [],
        ),
      ),
    ];
    const status = mostConservativeTitleStatus(exactTitles);
    const profileSource = !best.title.occupationId
      ? "UNMAPPED"
      : options.reviewed
        ? "REVIEWED"
        : best.phrase.kind === "TITLE_CANONICAL"
          ? "EXPLICIT"
          : "AUTO_HIGH_CONFIDENCE";
    return profileResult({
      title,
      normalizedSkills,
      occupationIds,
      facetIds: [
        ...titleFacetIds(title, index),
        ...exactTitles.flatMap((candidate) => candidate.title.facetIds),
        ...exactTitles.flatMap((candidate) => candidate.phrase.facetIds),
      ],
      source: profileSource,
      confidence: best.title.mappingConfidence || (best.exact ? 1 : 0.86),
      titleDefinition: best.title,
      titleIds: exactTitleIds,
      translationStatus: status,
      mappingSource: best.title.mappingSource,
      mappingConfidence: best.title.mappingConfidence,
      reviewReason: best.title.reviewReason,
      index,
    });
  }

  const exact = exactCandidates(title, input, index);
  const exactOccupationIds = [
    ...new Set(exact.map((candidate) => candidate.occupationId)),
  ];
  const facets = [
    ...titleFacetIds(title, index),
    ...exact.flatMap((candidate) => candidate.phrase.facetIds),
  ];
  if (exactOccupationIds.length === 1) {
    const best = exact[0];
    return profileResult({
      title,
      normalizedSkills,
      occupationIds: exactOccupationIds,
      facetIds: facets,
      source: options.reviewed
        ? "REVIEWED"
        : isFallbackPhraseKind(best.phrase.kind)
          ? "AUTO_HIGH_CONFIDENCE"
          : "EXPLICIT",
      confidence: options.reviewed
        ? 1
        : isFallbackPhraseKind(best.phrase.kind)
          ? 0.9
          : 1,
      mappingSource: isFallbackPhraseKind(best.phrase.kind)
        ? "TAXONOMY_INFERENCE"
        : "EXACT_CANONICAL",
      mappingConfidence: options.reviewed
        ? 1
        : isFallbackPhraseKind(best.phrase.kind)
          ? 0.9
          : 1,
      reviewReason:
        "No title-level bilingual definition matched this occupation phrase.",
      index,
    });
  }
  if (exactOccupationIds.length > 1) {
    return profileResult({
      title,
      normalizedSkills,
      occupationIds: exactOccupationIds,
      facetIds: facets,
      source: "UNMAPPED",
      confidence: 0.5,
      index,
    });
  }

  const fuzzyTitles = fuzzyTitleCandidates(title, input, index);
  const fuzzyTitleIds = [
    ...new Set(fuzzyTitles.map((candidate) => candidate.title.titleId)),
  ];
  if (fuzzyTitleIds.length === 1 && fuzzyTitles[0]) {
    const best = fuzzyTitles[0];
    return profileResult({
      title,
      normalizedSkills,
      occupationIds: best.title.occupationId ? [best.title.occupationId] : [],
      facetIds: [
        ...titleFacetIds(title, index),
        ...best.title.facetIds,
        ...best.phrase.facetIds,
      ],
      source: options.reviewed ? "REVIEWED" : "AUTO_HIGH_CONFIDENCE",
      confidence: options.reviewed ? 1 : 0.86,
      titleDefinition: best.title,
      titleIds: fuzzyTitleIds,
      index,
    });
  }

  const skills = skillCandidates(input, index);
  if (
    skills.length === 1 ||
    (skills.length > 1 && skills[0].score > skills[1].score)
  ) {
    const occupation = index.occupationById(skills[0].occupationId);
    return profileResult({
      title,
      normalizedSkills,
      occupationIds: [skills[0].occupationId],
      facetIds: [
        ...titleFacetIds(title, index),
        ...(occupation?.defaultFacetIds ?? []),
      ],
      source: options.reviewed ? "REVIEWED" : "AUTO_HIGH_CONFIDENCE",
      confidence: options.reviewed ? 1 : 0.78,
      mappingSource: "TAXONOMY_INFERENCE",
      mappingConfidence: options.reviewed ? 1 : 0.78,
      reviewReason:
        "Occupation inferred from skills; title-level mapping remains unavailable.",
      index,
    });
  }

  const fuzzy = fuzzyCandidates(title, input, index);
  const fuzzyOccupationIds = [
    ...new Set(fuzzy.map((candidate) => candidate.occupationId)),
  ];
  if (fuzzyOccupationIds.length === 1) {
    return profileResult({
      title,
      normalizedSkills,
      occupationIds: fuzzyOccupationIds,
      facetIds: titleFacetIds(title, index),
      source: options.reviewed ? "REVIEWED" : "AUTO_HIGH_CONFIDENCE",
      confidence: options.reviewed ? 1 : 0.86,
      mappingSource: "FUZZY_VERIFIED_ALIAS",
      mappingConfidence: options.reviewed ? 1 : 0.86,
      reviewReason:
        "Occupation inferred from a fuzzy title match without a title-level definition.",
      index,
    });
  }

  return profileResult({
    title,
    normalizedSkills,
    occupationIds: [],
    facetIds: titleFacetIds(title, index),
    source: options.reviewed ? "REVIEWED" : "UNMAPPED",
    confidence: 0,
    mappingSource: "MANUAL_REVIEW",
    mappingConfidence: 0,
    reviewReason: "No reliable title, occupation, or skill mapping was found.",
    index,
  });
}

/** Build a projection against the immutable catalog captured for this request. */
export async function buildRuntimeJobSearchProfile(
  input: JobSearchProfileInput,
  options: Omit<JobSearchProfileOptions, "index"> = {},
) {
  const snapshot = await searchCatalogProvider.getActiveSnapshot();
  return buildJobSearchProfile(input, { ...options, index: snapshot.index });
}
