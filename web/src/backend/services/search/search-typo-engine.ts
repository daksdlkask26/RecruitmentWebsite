import "server-only";

import {
  normalizeSearchText,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";
import { classifySearchToken, compactSearchToken } from "./search-token-policy";
import type {
  CompiledSearchPhrase,
  SearchCatalogIndex,
} from "./catalogs/job-search-catalog-index";
import type { SearchConfidence } from "@/shared/contracts/search/search-interpretation";

/**
 * Bounded edit-distance helpers are shared by token correction and the
 * suggestion service.  Distances are calculated over Unicode code points so a
 * Vietnamese character is never split in the middle of a correction.
 */
export function damerauLevenshtein(left: string, right: string) {
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

export function typoThreshold(length: number) {
  if (length < 4) return 0;
  if (length <= 7) return 1;
  return 2;
}

function compact(value: string) {
  return compactSearchToken(value);
}

function fuzzyNgrams(value: string) {
  const normalized = compact(value);
  if (!normalized) return [];
  const grams = new Set<string>();
  for (const size of [2, 3]) {
    if (normalized.length < size) continue;
    for (let index = 0; index <= normalized.length - size; index += 1) {
      grams.add(normalized.slice(index, index + size));
    }
  }
  return [...grams];
}

function isFuzzyCandidate(input: string, candidate: string) {
  const inputKey = compact(input);
  const candidateKey = compact(candidate);
  if (inputKey.length < 4 || candidateKey.length < 4) return false;
  const distance = damerauLevenshtein(inputKey, candidateKey);
  const threshold = typoThreshold(
    Math.max(inputKey.length, candidateKey.length),
  );
  return (
    distance > 0 &&
    distance <= threshold &&
    distance / Math.max(inputKey.length, candidateKey.length) <= 0.34
  );
}

function confidenceFor(
  distance: number,
  secondDistance?: number,
): SearchConfidence {
  return !secondDistance || secondDistance - distance >= 2 ? "HIGH" : "MEDIUM";
}

/**
 * These are intentionally protected by the shared token policy.  They are
 * short or commonly valid words where a one-edit match (for example
 * `recta`→`react`) would be more harmful than a literal search.
 */
const protectedTypoTokens = new Set([
  "recta",
  "qwertyuiop",
  "digital",
  "capital",
  "heritage",
]);

const protectedLocationPhrases = [
  "da nang",
  "ha noi",
  "ho chi minh",
  "ho chi minh city",
  "hai phong",
  "can tho",
  "binh duong",
  "dong nai",
  "ba ria vung tau",
] as const;

type VocabularyEntry = Readonly<{
  token: string;
  phrase: CompiledSearchPhrase;
}>;

type TypoVocabulary = Readonly<{
  exactTokens: ReadonlyMap<string, readonly VocabularyEntry[]>;
  fuzzyByGram: ReadonlyMap<string, readonly VocabularyEntry[]>;
  phrases: readonly VocabularyEntry[];
}>;

const vocabularyCache = new WeakMap<SearchCatalogIndex, TypoVocabulary>();
const verifiedTitleDeletionCache = new WeakMap<
  SearchCatalogIndex,
  ReadonlyMap<string, CompiledSearchPhrase | null>
>();

function semanticKey(entry: VocabularyEntry) {
  const phrase = entry.phrase;
  if (phrase.titleId) return `title:${phrase.titleId}`;
  if (phrase.skillId) return `skill:${phrase.skillId}`;
  if (phrase.occupationId) return `occupation:${phrase.occupationId}`;
  if (phrase.facetId) return `facet:${phrase.facetId}`;
  if (phrase.roleIds.length) return `role:${phrase.roleIds.join(",")}`;
  return `phrase:${phrase.normalizedPhrase}`;
}

function semanticPriority(entry: VocabularyEntry) {
  switch (entry.phrase.kind) {
    case "TITLE_CANONICAL":
    case "TITLE_ALIAS":
    case "TITLE_ABBREVIATION":
      return 50;
    case "CANONICAL":
    case "ALIAS":
    case "IRREGULAR_ALIAS":
    case "ABBREVIATION":
    case "RELATED_TITLE":
      return 40;
    case "SKILL":
      return 30;
    case "FACET":
      return 20;
    case "GENERIC_ROLE":
      return 10;
    case "TITLE_EXCLUDED":
      return -10;
  }
}

function isVocabularyToken(token: string) {
  const normalized = compact(token);
  if (Array.from(normalized).length < 3) return false;
  const kind = classifySearchToken(token);
  return kind === "SAFE_WORD";
}

function buildVocabulary(index: SearchCatalogIndex): TypoVocabulary {
  const exact = new Map<string, VocabularyEntry[]>();
  const fuzzy = new Map<string, VocabularyEntry[]>();
  const phrases: VocabularyEntry[] = [];
  const allPhrases = [
    ...index.occupationPhrases(),
    ...index.skillPhrases(),
    ...index.facetPhrases(),
    ...index.titlePhrases(),
    ...index.genericPhrases(),
  ];
  const seen = new Set<string>();
  for (const phrase of allPhrases) {
    const phraseTokens = searchTextTokens(phrase.normalizedPhrase);
    for (const token of phraseTokens) {
      if (!isVocabularyToken(token)) continue;
      const normalizedToken = compact(token);
      const key = `${normalizedToken}\u0000${phrase.titleId ?? ""}\u0000${phrase.skillId ?? ""}\u0000${phrase.occupationId ?? ""}\u0000${phrase.facetId ?? ""}\u0000${phrase.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = {
        token: normalizedToken,
        phrase,
      } satisfies VocabularyEntry;
      const exactEntries = exact.get(normalizedToken) ?? [];
      exactEntries.push(entry);
      exact.set(normalizedToken, exactEntries);
      for (const gram of fuzzyNgrams(normalizedToken)) {
        const fuzzyEntries = fuzzy.get(gram) ?? [];
        fuzzyEntries.push(entry);
        fuzzy.set(gram, fuzzyEntries);
      }
    }
    // Keep full phrases as a separate bounded list for verified orthographic
    // and Telex matching, including phrases made entirely of generic tokens.
    if (phraseTokens.length && phrase.language === "vi") {
      phrases.push({ token: compact(phrase.normalizedPhrase), phrase });
    }
  }
  return Object.freeze({
    exactTokens: exact,
    fuzzyByGram: fuzzy,
    phrases: Object.freeze(phrases),
  });
}

function vocabularyFor(index: SearchCatalogIndex) {
  const cached = vocabularyCache.get(index);
  if (cached) return cached;
  const vocabulary = buildVocabulary(index);
  vocabularyCache.set(index, vocabulary);
  return vocabulary;
}

function verifiedTitleDeletionVocabulary(index: SearchCatalogIndex) {
  const cached = verifiedTitleDeletionCache.get(index);
  if (cached) return cached;

  const mutations = new Map<string, CompiledSearchPhrase | null>();
  for (const title of index.catalog.titleDefinitions ?? []) {
    if (title.translationStatus !== "HUMAN_VERIFIED") continue;
    for (const phrase of [title.canonical.en, ...title.aliases.en]) {
      const normalizedPhrase = normalizeSearchText(phrase, 160);
      const characters = Array.from(normalizedPhrase);
      for (const [index, character] of characters.entries()) {
        if (/\s/u.test(character)) continue;
        const mutated = normalizeSearchText(
          characters
            .filter((_, characterIndex) => characterIndex !== index)
            .join(""),
          160,
        );
        const key = compact(mutated);
        if (!key || key === compact(normalizedPhrase)) continue;
        const compiled = {
          phrase,
          normalizedPhrase,
          compactPhrase: compact(normalizedPhrase),
          ...(title.occupationId ? { occupationId: title.occupationId } : {}),
          titleId: title.titleId,
          kind: "TITLE_CANONICAL" as const,
          language: "en" as const,
          facetIds: title.facetIds,
          roleIds: [],
          weight: 100,
        } satisfies CompiledSearchPhrase;
        const previous = mutations.get(key);
        if (previous && previous.titleId !== title.titleId) {
          mutations.set(key, null);
        } else if (!mutations.has(key)) {
          mutations.set(key, compiled);
        }
      }
    }
  }
  const frozen = new Map(mutations);
  verifiedTitleDeletionCache.set(index, frozen);
  return frozen;
}

function orthographicKey(value: string) {
  return compact(normalizeSearchText(value)).replace(/y/gu, "i");
}

function isOrthographicMatch(left: string, right: string) {
  const leftKey = orthographicKey(left);
  const rightKey = orthographicKey(right);
  return (
    Boolean(leftKey) && leftKey === rightKey && compact(left) !== compact(right)
  );
}

function exactOrthographicPhrase(
  query: string,
  vocabulary: TypoVocabulary,
): { query: string; phrase: CompiledSearchPhrase } | undefined {
  const matches = vocabulary.phrases.filter((entry) =>
    isOrthographicMatch(query, entry.phrase.normalizedPhrase),
  );
  if (!matches.length) return undefined;
  const keys = new Set(matches.map(semanticKey));
  if (keys.size !== 1) return undefined;
  const best = matches.sort(
    (left, right) =>
      right.phrase.weight - left.phrase.weight ||
      left.phrase.normalizedPhrase.localeCompare(right.phrase.normalizedPhrase),
  )[0];
  return best
    ? { query: best.phrase.normalizedPhrase, phrase: best.phrase }
    : undefined;
}

function telexCleanupToken(value: string) {
  const token = value.toLocaleLowerCase();
  if (Array.from(token).length < 4) return undefined;
  const marker = token.at(-1);
  if (!marker || !"sfrxj".includes(marker)) return undefined;
  const base = token.slice(0, -1);
  if (!/[aeiouy]/u.test(base)) return undefined;
  const collapsed = base.replace(/([aeiou])\1+/gu, "$1");
  return collapsed === base ? base : collapsed;
}

function telexPhraseCorrection(
  rawQuery: string,
  index: SearchCatalogIndex,
  vocabulary: TypoVocabulary,
) {
  const rawTokens = rawQuery.trim().split(/\s+/u).filter(Boolean);
  if (!rawTokens.length) return undefined;
  const cleanedTokens = rawTokens.map(telexCleanupToken);
  if (
    !cleanedTokens.some((token, index) => token && token !== rawTokens[index])
  ) {
    return undefined;
  }
  const cleanedQuery = normalizeSearchText(
    cleanedTokens.map((token, index) => token ?? rawTokens[index]).join(" "),
  );
  if (!cleanedQuery || cleanedQuery === normalizeSearchText(rawQuery)) {
    return undefined;
  }
  const exactMatches = [
    ...index.exactOccupationPhraseMatches(cleanedQuery),
    ...index.exactTitlePhraseMatches(cleanedQuery),
    ...index.exactSkillPhraseMatches(cleanedQuery),
  ];
  const unique = new Map<string, CompiledSearchPhrase>();
  for (const match of exactMatches) {
    unique.set(
      `${match.titleId ?? ""}\u0000${match.skillId ?? ""}\u0000${match.occupationId ?? ""}\u0000${match.normalizedPhrase}`,
      match,
    );
  }
  if (!unique.size) return undefined;
  const keys = new Set(
    [...unique.values()].map((match) => {
      if (match.titleId) return `title:${match.titleId}`;
      if (match.skillId) return `skill:${match.skillId}`;
      if (match.occupationId) return `occupation:${match.occupationId}`;
      return `phrase:${match.normalizedPhrase}`;
    }),
  );
  if (keys.size !== 1) return undefined;
  // `vocabulary` is intentionally part of this function's contract so a
  // future catalog can add a Vietnamese phrase without changing the engine;
  // only Vietnamese/verified phrases are eligible for Telex cleanup.
  if (
    !vocabulary.phrases.some(
      (entry) => entry.phrase.normalizedPhrase === cleanedQuery,
    )
  ) {
    return undefined;
  }
  return {
    correctedQuery: cleanedQuery,
    phrase: [...unique.values()][0],
    confidence: "HIGH" as const,
    distance: 1,
    kind: "TELEX" as const,
  };
}

function isLocationToken(tokens: readonly string[], tokenIndex: number) {
  return protectedLocationPhrases.some((phrase) => {
    const phraseTokens = searchTextTokens(phrase);
    for (
      let start = 0;
      start <= tokens.length - phraseTokens.length;
      start += 1
    ) {
      const end = start + phraseTokens.length;
      if (
        tokenIndex >= start &&
        tokenIndex < end &&
        tokens.slice(start, end).join(" ") === phrase
      ) {
        return true;
      }
    }
    return false;
  });
}

function candidateEntries(token: string, vocabulary: TypoVocabulary) {
  const candidates = new Map<string, VocabularyEntry>();
  for (const gram of fuzzyNgrams(token)) {
    for (const entry of vocabulary.fuzzyByGram.get(gram) ?? []) {
      const key = `${entry.token}\u0000${semanticKey(entry)}\u0000${entry.phrase.normalizedPhrase}\u0000${entry.phrase.kind}`;
      candidates.set(key, entry);
      if (candidates.size >= 4096) break;
    }
    if (candidates.size >= 4096) break;
  }
  return [...candidates.values()];
}

function bestTokenCandidate(
  token: string,
  vocabulary: TypoVocabulary,
):
  | { entry: VocabularyEntry; confidence: SearchConfidence; distance: number }
  | undefined {
  const normalizedToken = compact(normalizeSearchText(token));
  if (
    !normalizedToken ||
    normalizedToken.length < 4 ||
    protectedTypoTokens.has(normalizedToken) ||
    classifySearchToken(normalizedToken) !== "SAFE_WORD"
  ) {
    return undefined;
  }
  const candidates = candidateEntries(normalizedToken, vocabulary)
    .filter((entry) => isFuzzyCandidate(normalizedToken, entry.token))
    .map((entry) => ({
      entry,
      distance: damerauLevenshtein(normalizedToken, entry.token),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.entry.token.localeCompare(right.entry.token) ||
        semanticKey(left.entry).localeCompare(semanticKey(right.entry)),
    );
  if (!candidates.length) return undefined;
  const bestDistance = candidates[0]!.distance;
  const best = candidates.filter(
    (candidate) => candidate.distance === bestDistance,
  );
  // Prefer a standalone vocabulary term over a token that only appears inside
  // a long title.  This keeps `accountnat` anchored on Accountant instead of
  // arbitrarily selecting one of many `* Accountant` titles.
  const standalone = best.filter(
    (candidate) =>
      searchTextTokens(candidate.entry.phrase.normalizedPhrase).length === 1 &&
      semanticPriority(candidate.entry) >= 30,
  );
  const exactStandalone = best.filter(
    (candidate) =>
      compact(candidate.entry.phrase.normalizedPhrase) ===
        candidate.entry.token && semanticPriority(candidate.entry) >= 30,
  );
  const pool = exactStandalone.length
    ? exactStandalone
    : standalone.length
      ? standalone
      : best;
  const highestPriority = Math.max(
    ...pool.map((candidate) => semanticPriority(candidate.entry)),
  );
  const prioritized = pool.filter(
    (candidate) => semanticPriority(candidate.entry) === highestPriority,
  );
  const shortestPhraseTokenCount = Math.min(
    ...prioritized.map(
      (candidate) =>
        searchTextTokens(candidate.entry.phrase.normalizedPhrase).length,
    ),
  );
  const scoped = prioritized.filter(
    (candidate) =>
      searchTextTokens(candidate.entry.phrase.normalizedPhrase).length ===
      shortestPhraseTokenCount,
  );
  const semanticKeys = new Set(
    scoped.map((candidate) => semanticKey(candidate.entry)),
  );
  const secondDistance = candidates.find(
    (candidate) => candidate.distance > bestDistance,
  )?.distance;
  const confidence =
    semanticKeys.size === 1
      ? confidenceFor(bestDistance, secondDistance)
      : "MEDIUM";
  return {
    entry: scoped[0]!.entry,
    confidence,
    distance: bestDistance,
  };
}

export type SearchTypoResolution = Readonly<{
  from: string;
  to: string;
  correctedQuery: string;
  confidence: SearchConfidence;
  distance: number;
  kind: "TOKEN" | "TELEX" | "ORTHOGRAPHIC";
  matchedPhrase?: CompiledSearchPhrase;
}>;

function verifiedTitleDeletionCorrection(
  normalizedQuery: string,
  index: SearchCatalogIndex,
): SearchTypoResolution | undefined {
  const matchedPhrase = verifiedTitleDeletionVocabulary(index).get(
    compact(normalizedQuery),
  );
  if (!matchedPhrase) return undefined;
  return {
    from: normalizedQuery,
    to: matchedPhrase.normalizedPhrase,
    correctedQuery: matchedPhrase.normalizedPhrase,
    confidence: "HIGH",
    distance: 1,
    kind: "TOKEN",
    matchedPhrase,
  };
}

/**
 * Resolve only bounded, catalog-backed corrections.  A MEDIUM result is
 * returned as a suggestion for the UI, while callers decide whether it is
 * safe to add to retrieval (the resolver only auto-adds HIGH results).
 */
export function resolveSearchTypo(
  rawQuery: string,
  index: SearchCatalogIndex,
): SearchTypoResolution | undefined {
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) return undefined;
  const verifiedTitleDeletion = verifiedTitleDeletionCorrection(
    normalizedQuery,
    index,
  );
  if (verifiedTitleDeletion) return verifiedTitleDeletion;
  const vocabulary = vocabularyFor(index);

  const orthographic = exactOrthographicPhrase(normalizedQuery, vocabulary);
  if (orthographic) {
    return {
      from: normalizedQuery,
      to: orthographic.query,
      correctedQuery: orthographic.query,
      confidence: "HIGH",
      distance: 0,
      kind: "ORTHOGRAPHIC",
      matchedPhrase: orthographic.phrase,
    };
  }

  const telex = telexPhraseCorrection(rawQuery, index, vocabulary);
  if (telex) {
    return {
      from: normalizedQuery,
      to: telex.correctedQuery,
      correctedQuery: telex.correctedQuery,
      confidence: telex.confidence,
      distance: telex.distance,
      kind: telex.kind,
      matchedPhrase: telex.phrase,
    };
  }

  const tokens = searchTextTokens(normalizedQuery);
  if (!tokens.length || tokens.length > 16) return undefined;
  const hasGenericRoleToken = tokens.some(
    (token) => classifySearchToken(token) === "GENERIC_ROLE",
  );
  const correctedTokens = [...tokens];
  const selected: Array<{
    index: number;
    candidate: NonNullable<ReturnType<typeof bestTokenCandidate>>;
  }> = [];
  for (const [tokenIndex, token] of tokens.entries()) {
    if (isLocationToken(tokens, tokenIndex)) continue;
    if (vocabulary.exactTokens.has(compact(token))) continue;
    const candidate = bestTokenCandidate(token, vocabulary);
    if (!candidate) continue;
    selected.push({ index: tokenIndex, candidate });
    correctedTokens[tokenIndex] = candidate.entry.token;
  }
  if (!selected.length) return undefined;
  if (
    hasGenericRoleToken &&
    selected.every(
      ({ candidate }) =>
        candidate.entry.phrase.kind === "GENERIC_ROLE" ||
        (!candidate.entry.phrase.titleId &&
          !candidate.entry.phrase.occupationId &&
          !candidate.entry.phrase.skillId),
    )
  ) {
    return undefined;
  }

  const correctedQuery = normalizeSearchText(correctedTokens.join(" "));
  if (!correctedQuery || correctedQuery === normalizedQuery) return undefined;
  const confidence = selected.every(
    ({ candidate }) => candidate.confidence === "HIGH",
  )
    ? "HIGH"
    : "MEDIUM";
  const first = selected[0]!;
  let to = correctedQuery;
  if (tokens.length === 1) {
    const phrase = first.candidate.entry.phrase;
    if (phrase.titleId) {
      const title = index.titleById(phrase.titleId);
      if (title) to = normalizeSearchText(title.canonical.en);
    } else if (phrase.skillId) {
      to = phrase.normalizedPhrase;
    } else if (phrase.occupationId) {
      to = phrase.normalizedPhrase;
    }
  }
  return {
    from: normalizedQuery,
    to,
    correctedQuery: to === correctedQuery ? correctedQuery : to,
    confidence,
    distance: selected.reduce(
      (sum, { candidate }) => sum + candidate.distance,
      0,
    ),
    kind: "TOKEN",
    matchedPhrase: first.candidate.entry.phrase,
  };
}
