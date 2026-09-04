import type { JobSearchIntent } from "@/shared/contracts/search/job-search-intent";
import type { SearchInterpretation } from "@/shared/contracts/search/search-interpretation";

export type SavedSearchVersionState =
  | "CURRENT"
  | "LEGACY"
  | "STALE"
  | "AMBIGUOUS"
  | "MEANING_CHANGED";

export type SavedSearchVersionAssessment = Readonly<{
  state: SavedSearchVersionState;
  catalogChanged: boolean;
  resolverChanged: boolean;
  meaningChanged: boolean;
  needsReview: boolean;
}>;

type SavedSearchSnapshot = Readonly<{
  catalogVersion?: string;
  resolverVersion?: string;
  searchIntent?: JobSearchIntent;
}>;

function intentSignature(intent: JobSearchIntent | undefined) {
  if (!intent) return null;
  return JSON.stringify({
    language: intent.language,
    titleCandidates: intent.titleCandidates.map((candidate) => ({
      titleId: candidate.titleId,
      matchKind: candidate.matchKind,
    })),
    occupationCandidates: intent.occupationCandidates.map((candidate) => ({
      occupationId: candidate.occupationId,
      matchKind: candidate.matchKind,
    })),
    requiredFacetIds: [...intent.requiredFacetIds].sort(),
    preferredFacetIds: [...intent.preferredFacetIds].sort(),
    excludedFacetIds: [...intent.excludedFacetIds].sort(),
    skills: [...intent.skills].sort(),
    retainedTerms: [...intent.retainedTerms].sort(),
    corrections: intent.corrections.map((correction) => ({
      from: correction.from,
      to: correction.to,
    })),
    ambiguous: intent.ambiguous,
  });
}

export function assessSavedSearchVersion(input: {
  saved: SavedSearchSnapshot;
  currentCatalogVersion?: string;
  currentResolverVersion?: string;
  currentInterpretation?: SearchInterpretation;
}): SavedSearchVersionAssessment {
  const catalogChanged = Boolean(
    input.saved.catalogVersion &&
    input.currentCatalogVersion &&
    input.saved.catalogVersion !== input.currentCatalogVersion,
  );
  const resolverChanged = Boolean(
    input.saved.resolverVersion &&
    input.currentResolverVersion &&
    input.saved.resolverVersion !== input.currentResolverVersion,
  );
  const savedIntent = input.saved.searchIntent;
  const currentIntent = input.currentInterpretation?.searchIntent;
  const meaningChanged = Boolean(
    savedIntent &&
    currentIntent &&
    intentSignature(savedIntent) !== intentSignature(currentIntent),
  );
  const ambiguous = Boolean(
    input.saved.searchIntent?.ambiguous ||
    input.currentInterpretation?.ambiguous ||
    input.currentInterpretation?.searchIntent?.ambiguous,
  );
  const legacy = !input.saved.catalogVersion && !input.saved.resolverVersion;
  const state: SavedSearchVersionState = ambiguous
    ? "AMBIGUOUS"
    : meaningChanged
      ? "MEANING_CHANGED"
      : catalogChanged || resolverChanged
        ? "STALE"
        : legacy
          ? "LEGACY"
          : "CURRENT";
  return {
    state,
    catalogChanged,
    resolverChanged,
    meaningChanged,
    needsReview:
      state === "AMBIGUOUS" ||
      state === "MEANING_CHANGED" ||
      state === "STALE" ||
      state === "LEGACY",
  };
}
