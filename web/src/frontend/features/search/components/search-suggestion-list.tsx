"use client";

import type {
  SearchSuggestion,
  SearchSuggestionScope,
} from "@/shared/contracts/search/search-suggestions";
import {
  Briefcase,
  Building2,
  ChevronRight,
  Layers,
  MapPin,
  Sparkles,
  Tag,
} from "lucide-react";

type SearchSuggestionListDensity = "comfortable" | "compact";

function labelFor(
  suggestion: SearchSuggestion,
  locale: "vi" | "en",
): { primary: string; secondary?: string } {
  return {
    primary: locale === "vi" ? suggestion.labelVi : suggestion.labelEn,
    secondary:
      locale === "vi"
        ? suggestion.secondaryLabelVi
        : suggestion.secondaryLabelEn,
  };
}

function typeLabel(
  scope: SearchSuggestionScope,
  type: SearchSuggestion["type"],
  locale: "vi" | "en",
) {
  if (scope === "JOBS") {
    if (type === "OCCUPATION")
      return locale === "vi" ? "Nghề nghiệp" : "Occupation";
    if (type === "TITLE") return locale === "vi" ? "Chức danh" : "Job title";
    return locale === "vi" ? "Kỹ năng" : "Skill";
  }
  if (type === "COMPANY") return locale === "vi" ? "Công ty" : "Company";
  if (type === "INDUSTRY") return locale === "vi" ? "Ngành" : "Industry";
  return locale === "vi" ? "Địa điểm" : "Location";
}

function iconFor(scope: SearchSuggestionScope, type: SearchSuggestion["type"]) {
  if (scope === "COMPANIES") {
    if (type === "COMPANY") return Building2;
    if (type === "INDUSTRY") return Layers;
    return MapPin;
  }
  if (type === "OCCUPATION") return Briefcase;
  if (type === "TITLE") return Tag;
  return Sparkles;
}

export function SearchSuggestionList({
  id,
  scope,
  locale,
  suggestions,
  activeIndex,
  onSelect,
  onActiveChange,
  density = "comfortable",
}: Readonly<{
  id: string;
  scope: SearchSuggestionScope;
  locale: "vi" | "en";
  suggestions: readonly SearchSuggestion[];
  activeIndex: number;
  onSelect: (suggestion: SearchSuggestion) => void;
  onActiveChange: (index: number) => void;
  density?: SearchSuggestionListDensity;
}>) {
  if (!suggestions.length) return null;
  const isCompact = density === "compact";
  return (
    <div
      id={id}
      className={`search-suggestion-list search-suggestion-list--${density}`}
      role="listbox"
    >
      {suggestions.map((suggestion, index) => {
        const label = labelFor(suggestion, locale);
        const SuggestionIcon = iconFor(scope, suggestion.type);
        return (
          <button
            id={`${id}-option-${index}`}
            key={`${suggestion.type}:${suggestion.id}`}
            className="search-suggestion-option"
            data-suggestion-type={suggestion.type.toLowerCase()}
            type="button"
            role="option"
            aria-selected={activeIndex === index}
            onMouseEnter={() => onActiveChange(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(suggestion)}
          >
            <span className="search-suggestion-option-leading">
              {!isCompact ? (
                <span
                  className="search-suggestion-option-icon"
                  aria-hidden="true"
                >
                  <SuggestionIcon size={17} strokeWidth={2} />
                </span>
              ) : null}
              <span className="search-suggestion-option-copy">
                <strong>{label.primary}</strong>
                {label.secondary ? <small>{label.secondary}</small> : null}
              </span>
            </span>
            <span className="search-suggestion-option-meta">
              <span className="search-suggestion-option-type">
                {typeLabel(scope, suggestion.type, locale)}
              </span>
              {!isCompact ? (
                <ChevronRight
                  className="search-suggestion-option-chevron"
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function localizedSuggestionLabel(
  suggestion: SearchSuggestion,
  locale: "vi" | "en",
) {
  return locale === "vi" ? suggestion.labelVi : suggestion.labelEn;
}
