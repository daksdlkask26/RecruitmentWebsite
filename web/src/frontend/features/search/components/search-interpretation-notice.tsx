"use client";

import type { SearchInterpretation } from "@/shared/contracts/search/search-interpretation";
import { ArrowRight, Languages, Search, SpellCheck } from "lucide-react";
import styles from "./search-interpretation-notice.module.css";

export type SearchInterpretationCopy = Readonly<{
  searchResultsFor: string;
  includingRelatedTerm: string;
  searchLiteral: string;
  didYouMean: string;
  searchSuggested: string;
  undo?: string;
  literalMode: string;
  enableSmartSearch: string;
  interpretedAsOccupation: string;
  correctionHint: string;
  matchedFacets: string;
}>;

function format(template: string, values: Readonly<Record<string, string>>) {
  return template.replace(/\{(\w+)\}/gu, (_, key: string) => values[key] ?? "");
}

export function SearchInterpretationNotice({
  interpretation,
  locale,
  copy,
  onSearchLiteral,
  onAcceptSuggestion,
  onEnableSmartSearch,
  onUndo,
}: Readonly<{
  interpretation?: SearchInterpretation;
  locale: "vi" | "en";
  copy: SearchInterpretationCopy;
  onSearchLiteral?: () => void;
  onAcceptSuggestion?: () => void;
  onEnableSmartSearch?: () => void;
  onUndo?: () => void;
}>) {
  if (!interpretation?.originalQuery.trim()) return null;
  const hasMeaningfulExplanation =
    interpretation.mode === "LITERAL" ||
    Boolean(interpretation.correction) ||
    Boolean(interpretation.matchedTitle) ||
    Boolean(interpretation.matchedOccupation) ||
    Boolean(interpretation.matchedFacets?.length) ||
    Boolean(interpretation.structuredFilters?.length) ||
    interpretation.reason === "ALIAS_EXPANDED" ||
    interpretation.reason === "TYPO_CORRECTED" ||
    interpretation.reason === "TYPO_AND_ALIAS" ||
    Boolean(interpretation.appliedTerms.length);
  if (!hasMeaningfulExplanation) return null;

  const titleLabel = interpretation.matchedTitle
    ? locale === "vi"
      ? interpretation.matchedTitle.labelVi
      : interpretation.matchedTitle.labelEn
    : undefined;
  const occupationLabel = interpretation.matchedOccupation
    ? locale === "vi"
      ? interpretation.matchedOccupation.labelVi
      : interpretation.matchedOccupation.labelEn
    : interpretation.correction?.to;
  const matchedLabel = titleLabel ?? occupationLabel;
  const isMediumSuggestion = interpretation.confidence === "MEDIUM";
  const isHighConfidenceCorrection =
    interpretation.confidence === "HIGH" && Boolean(interpretation.correction);
  const isLiteral = interpretation.mode === "LITERAL";
  const showLiteralAction =
    !isLiteral && interpretation.canSearchLiteral && Boolean(onSearchLiteral);
  const showUndoAction = !isLiteral && Boolean(onUndo) && Boolean(copy.undo);

  let message: string;
  let actionLabel: string | undefined;
  let action: (() => void) | undefined;

  if (isLiteral) {
    message = format(copy.literalMode, { query: interpretation.originalQuery });
    actionLabel = copy.enableSmartSearch;
    action = onEnableSmartSearch;
  } else if (isMediumSuggestion && matchedLabel) {
    message = format(copy.didYouMean, { query: matchedLabel });
    actionLabel = format(copy.searchSuggested, { query: matchedLabel });
    action = onAcceptSuggestion;
  } else if (
    (interpretation.matchedTitle || interpretation.matchedOccupation) &&
    matchedLabel
  ) {
    message = isHighConfidenceCorrection
      ? format(copy.searchResultsFor, { query: matchedLabel })
      : format(copy.interpretedAsOccupation, {
          original: interpretation.originalQuery,
          occupation: matchedLabel,
        });
    actionLabel = showLiteralAction
      ? format(copy.searchLiteral, { query: interpretation.originalQuery })
      : undefined;
    action = showLiteralAction ? onSearchLiteral : undefined;
  } else {
    message = format(copy.searchResultsFor, {
      query:
        interpretation.effectiveQuery ||
        interpretation.normalizedQuery ||
        interpretation.originalQuery,
    });
    actionLabel = showLiteralAction
      ? format(copy.searchLiteral, { query: interpretation.originalQuery })
      : undefined;
    action = showLiteralAction ? onSearchLiteral : undefined;
  }

  const correctionHint =
    !isLiteral && interpretation.correction
      ? format(copy.correctionHint, { query: interpretation.correction.from })
      : undefined;
  const facets = (interpretation.matchedFacets ?? []).slice(0, 4);
  const IndicatorIcon = isLiteral
    ? Search
    : interpretation.correction || isMediumSuggestion
      ? SpellCheck
      : Languages;

  return (
    <aside
      className={styles.notice}
      data-mode={interpretation.mode.toLowerCase()}
      data-confidence={interpretation.confidence?.toLowerCase()}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.indicator} aria-hidden="true">
        <IndicatorIcon size={18} strokeWidth={2.25} />
      </span>
      <div className={styles.content}>
        <p className={styles.message}>{message}</p>
        {correctionHint ? (
          <p className={styles.detail}>{correctionHint}</p>
        ) : null}
        {facets.length ? (
          <div className={styles.facets} aria-label={copy.matchedFacets}>
            <span className={styles.facetLabel}>{copy.matchedFacets}</span>
            {facets.map((facet) => (
              <span className={styles.facet} key={facet.facetId}>
                {locale === "vi" ? facet.labelVi : facet.labelEn}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className={styles.actions}>
        {actionLabel && action ? (
          <button className={styles.action} type="button" onClick={action}>
            <span>{actionLabel}</span>
            <ArrowRight size={16} strokeWidth={2.25} aria-hidden="true" />
          </button>
        ) : null}
        {showUndoAction ? (
          <button
            className={`${styles.action} ${styles.undoAction}`}
            type="button"
            onClick={onUndo}
          >
            {copy.undo}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
