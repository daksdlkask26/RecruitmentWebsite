import "server-only";

import type {
  SearchInterpretation,
  SearchMode,
  SearchInterpretationReason,
  SearchConfidence,
} from "@/shared/contracts/search/search-interpretation";

export type SearchResolutionObservability = Readonly<{
  emit: (metric: SearchResolutionMetric) => void;
}>;

export type SearchResolutionMetric = Readonly<{
  event: "search_resolution";
  context: "JOBS" | "COMPANIES";
  mode: SearchMode;
  reason: SearchInterpretationReason;
  confidence?: SearchConfidence;
  usedFallback: boolean;
  autoCorrected: boolean;
  ambiguous: boolean;
  variantCount: number;
  matchedOccupation: boolean;
  matchedTitle: boolean;
  matchedFacetCount: number;
  resultCount: number;
  candidateCount?: number;
  candidateSetSizeClass: "unknown" | "lt_100" | "lt_1k" | "lt_5k" | "gte_5k";
  zeroResult: boolean;
  correctionMode: "none" | "suggested" | "auto";
  literalOverride: boolean;
  projectionState: "unknown" | "available" | "missing" | "stale";
  candidateCapReached: boolean;
  durationClass: "lt_250ms" | "lt_1s" | "lt_2s" | "gte_2s";
  resolverVersion?: string;
  catalogVersion?: string;
}>;

function durationClass(
  durationMs: number,
): SearchResolutionMetric["durationClass"] {
  return durationMs < 250
    ? "lt_250ms"
    : durationMs < 1_000
      ? "lt_1s"
      : durationMs < 2_000
        ? "lt_2s"
        : "gte_2s";
}

function candidateSetSizeClass(
  candidateCount: number | undefined,
): SearchResolutionMetric["candidateSetSizeClass"] {
  if (candidateCount === undefined) return "unknown";
  return candidateCount < 100
    ? "lt_100"
    : candidateCount < 1_000
      ? "lt_1k"
      : candidateCount < 5_000
        ? "lt_5k"
        : "gte_5k";
}

const defaultSearchResolutionObservability: SearchResolutionObservability = {
  // The composition root replaces this in a running server. Keep direct
  // console output strictly as a development fallback for isolated scripts.
  emit: (metric) => {
    if (process.env.NODE_ENV !== "production")
      console.info("search_resolution", metric);
  },
};
let searchResolutionObservability = defaultSearchResolutionObservability;

export function configureSearchResolutionObservability(
  adapter?: SearchResolutionObservability,
) {
  searchResolutionObservability =
    adapter ?? defaultSearchResolutionObservability;
}

export function buildSearchResolutionMetric(input: {
  context: SearchResolutionMetric["context"];
  interpretation: SearchInterpretation;
  variantCount: number;
  resultCount: number;
  durationMs: number;
  candidateCount?: number;
  projectionState?: SearchResolutionMetric["projectionState"];
  candidateCapReached?: boolean;
}): SearchResolutionMetric {
  const interpretation = input.interpretation;
  return {
    event: "search_resolution",
    context: input.context,
    mode: interpretation.mode,
    reason: interpretation.reason,
    ...(interpretation.confidence
      ? { confidence: interpretation.confidence }
      : {}),
    usedFallback: Boolean(interpretation.usedFallback),
    autoCorrected: Boolean(interpretation.autoCorrected),
    ambiguous: Boolean(interpretation.ambiguous),
    variantCount: Math.max(0, Math.min(8, Math.trunc(input.variantCount))),
    matchedOccupation: Boolean(interpretation.matchedOccupation),
    matchedTitle: Boolean(interpretation.matchedTitle),
    matchedFacetCount: interpretation.matchedFacets?.length ?? 0,
    resultCount: Math.max(0, Math.trunc(input.resultCount)),
    ...(input.candidateCount === undefined
      ? {}
      : { candidateCount: Math.max(0, Math.trunc(input.candidateCount)) }),
    candidateSetSizeClass: candidateSetSizeClass(input.candidateCount),
    zeroResult: input.resultCount <= 0,
    correctionMode: interpretation.correction
      ? interpretation.autoCorrected
        ? "auto"
        : "suggested"
      : "none",
    literalOverride: interpretation.mode === "LITERAL",
    projectionState: input.projectionState ?? "unknown",
    candidateCapReached: Boolean(input.candidateCapReached),
    durationClass: durationClass(Math.max(0, input.durationMs)),
    ...(interpretation.resolverVersion
      ? { resolverVersion: interpretation.resolverVersion }
      : {}),
    ...(interpretation.catalogVersion
      ? { catalogVersion: interpretation.catalogVersion }
      : {}),
  };
}

/** Emits only bounded dimensions and version identifiers; never raw search text. */
export function emitSearchResolutionMetric(input: {
  context: SearchResolutionMetric["context"];
  interpretation: SearchInterpretation;
  variantCount: number;
  resultCount: number;
  durationMs: number;
  candidateCount?: number;
  projectionState?: SearchResolutionMetric["projectionState"];
  candidateCapReached?: boolean;
}) {
  searchResolutionObservability.emit(buildSearchResolutionMetric(input));
}
