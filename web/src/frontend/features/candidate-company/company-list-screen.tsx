"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Code2,
  ChevronDown,
  MapPin,
  Search,
} from "lucide-react";
import { PageHeader } from "@/frontend/components/layout/page-header";
import { CompanyAvatar } from "@/frontend/features/jobs/components/company-avatar";
import { SearchInterpretationNotice } from "@/frontend/features/search/components/search-interpretation-notice";
import {
  SearchSuggestionList,
  localizedSuggestionLabel,
} from "@/frontend/features/search/components/search-suggestion-list";
import { useSearchSuggestions } from "@/frontend/features/search/client/use-search-suggestions";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import type { CompanyCard } from "@/shared/contracts/company";
import type {
  SearchInterpretation,
  SearchMode,
} from "@/shared/contracts/search/search-interpretation";
import { companyLocationRegion } from "@/shared/utils/locations/company-location";
import { CompanyPagination } from "./company-pagination";
import styles from "./candidate-company-screen.module.css";
import { getCompanyCopy, type CompanyCopy } from "./i18n/company-copy";

const COMPANY_SEARCH_DEBOUNCE_MS = 800;

function companyListSearchHref(
  query: string,
  location: string,
  limit: number,
  searchMode: SearchMode = "SMART",
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (location) params.set("location", location);
  if (searchMode !== "SMART") params.set("searchMode", searchMode);
  if (limit !== 24) params.set("limit", String(limit));
  const search = params.toString();
  return search ? `/company?${search}` : "/company";
}

export function CompanyLocationSelect({
  value,
  options,
  label,
  allLocationsLabel,
  triggerLabel = label,
  onChange,
}: {
  value: string;
  options: readonly string[];
  label: string;
  allLocationsLabel: string;
  triggerLabel?: string;
  onChange: (value: string) => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusFirstOptionOnOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const optionItems = [
    { value: "", label: allLocationsLabel },
    ...options.map((option) => ({ value: option, label: option })),
  ];
  const selectedOption =
    optionItems.find((option) => option.value === value) ?? optionItems[0];

  useEffect(() => {
    if (!open) return;

    if (focusFirstOptionOnOpen.current) {
      focusFirstOptionOnOpen.current = false;
      optionRefs.current[0]?.focus();
    }

    function closeWhenOutside(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !fieldRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const handleChange = () => onChange(trigger.value);
    trigger.addEventListener("change", handleChange);
    return () => trigger.removeEventListener("change", handleChange);
  }, [onChange]);

  const closeMenu = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    closeMenu();
  };

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  return (
    <div
      ref={fieldRef}
      className={`${styles.companySearchField} ${styles.locationField}`}
    >
      <span className="sr-only">{label}</span>
      <MapPin size={19} aria-hidden="true" />
      <input type="hidden" name="location" value={value} readOnly />
      <button
        ref={triggerRef}
        className={`${styles.locationTrigger}${
          open ? ` ${styles.locationTriggerOpen}` : ""
        }`}
        type="button"
        role="combobox"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="company-location-options"
        value={value}
        onClick={() => setOpen((current) => !current)}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) focusFirstOptionOnOpen.current = true;
            setOpen(true);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span
          className={
            value ? styles.locationValue : styles.locationValuePlaceholder
          }
        >
          {selectedOption?.label ?? allLocationsLabel}
        </span>
        <ChevronDown
          className={`${styles.selectChevron}${
            open ? ` ${styles.selectChevronOpen}` : ""
          }`}
          size={18}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          id="company-location-options"
          className={styles.locationMenu}
          role="listbox"
          aria-label={label}
        >
          {optionItems.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value || "all-locations"}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                className={`${styles.locationOption}${
                  isSelected ? ` ${styles.locationOptionSelected}` : ""
                }`}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => selectOption(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption((index + 1) % optionItems.length);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption(
                      (index - 1 + optionItems.length) % optionItems.length,
                    );
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    focusOption(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    focusOption(optionItems.length - 1);
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectOption(option.value);
                  }
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <Check size={16} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CompanySearchForm({
  copy,
  initialQuery,
  initialSearchMode,
  initialLocation,
  initialLimit,
  hasFilters,
  locationOptions,
}: {
  copy: CompanyCopy;
  initialQuery: string;
  initialSearchMode: SearchMode;
  initialLocation: string;
  initialLimit: number;
  hasFilters: boolean;
  locationOptions: readonly string[];
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedLocation, setSelectedLocation] = useState(initialLocation);
  const [isPending, startTransition] = useTransition();
  const locale = useWorkspaceLocale();
  const suggestions = useSearchSuggestions("COMPANIES", searchQuery);

  const selectCompanySuggestion = (
    suggestion: Parameters<typeof localizedSuggestionLabel>[0],
  ) => {
    setSearchQuery(localizedSuggestionLabel(suggestion, locale));
    suggestions.setOpen(false);
  };

  const handleSuggestionKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Escape") {
      if (suggestions.open) {
        event.preventDefault();
        suggestions.setOpen(false);
        suggestions.setActiveIndex(-1);
      }
      return;
    }
    if (event.key === "Tab") {
      suggestions.setOpen(false);
      suggestions.setActiveIndex(-1);
      return;
    }
    if (!suggestions.open || !suggestions.suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      suggestions.setActiveIndex(
        (suggestions.activeIndex + 1) % suggestions.suggestions.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      suggestions.setActiveIndex(
        suggestions.activeIndex <= 0
          ? suggestions.suggestions.length - 1
          : suggestions.activeIndex - 1,
      );
    } else if (event.key === "Enter" && suggestions.activeIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions.suggestions[suggestions.activeIndex];
      if (suggestion) selectCompanySuggestion(suggestion);
    }
  };

  useEffect(() => {
    const nextQuery = searchQuery.trim();
    if (
      nextQuery === initialQuery.trim() &&
      selectedLocation === initialLocation
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      startTransition(() => {
        router.replace(
          companyListSearchHref(
            nextQuery,
            selectedLocation,
            initialLimit,
            initialSearchMode,
          ),
          { scroll: false },
        );
      });
    }, COMPANY_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    initialLimit,
    initialLocation,
    initialQuery,
    initialSearchMode,
    router,
    searchQuery,
    selectedLocation,
    startTransition,
  ]);

  return (
    <form
      className={`${styles.companySearch}${
        isPending ? ` ${styles.companySearchPending}` : ""
      }`}
      action="/company"
      method="get"
      role="search"
      aria-busy={isPending}
    >
      <div className={styles.companySearchField}>
        <label className="sr-only" htmlFor="company-search-query">
          {copy.searchCompanies}
        </label>
        <Search size={19} aria-hidden="true" />
        <input
          id="company-search-query"
          className={`${styles.input} ${styles.searchInput}`}
          name="q"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={copy.companySearchPlaceholder}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.open && suggestions.suggestions.length > 0}
          aria-controls="company-search-suggestions"
          aria-activedescendant={
            suggestions.activeIndex >= 0
              ? `company-search-suggestions-option-${suggestions.activeIndex}`
              : undefined
          }
          onFocus={() => {
            if (suggestions.suggestions.length) suggestions.setOpen(true);
          }}
          onBlur={() =>
            window.setTimeout(() => {
              suggestions.setOpen(false);
              suggestions.setActiveIndex(-1);
            }, 100)
          }
          onKeyDown={handleSuggestionKeyDown}
        />
        {suggestions.isLoading ? (
          <span className="search-suggestion-loading" aria-hidden="true" />
        ) : null}
        {suggestions.open ? (
          <SearchSuggestionList
            id="company-search-suggestions"
            scope="COMPANIES"
            locale={locale}
            suggestions={suggestions.suggestions}
            activeIndex={suggestions.activeIndex}
            onSelect={selectCompanySuggestion}
            onActiveChange={suggestions.setActiveIndex}
          />
        ) : null}
      </div>
      <CompanyLocationSelect
        value={selectedLocation}
        options={locationOptions}
        label={copy.location}
        allLocationsLabel={copy.allLocations}
        onChange={setSelectedLocation}
      />
      {initialSearchMode !== "SMART" ? (
        <input type="hidden" name="searchMode" value={initialSearchMode} />
      ) : null}
      <div className={styles.searchActions}>
        <button className={styles.button} type="submit">
          <Search size={18} aria-hidden="true" />
          {isPending ? copy.searching : copy.search}
        </button>
        {hasFilters ? (
          <Link
            className={`${styles.button} ${styles.secondary}`}
            href="/company"
          >
            {copy.clear}
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export function CompanyListScreen({
  companies,
  total,
  page = 1,
  totalPages = 1,
  initialQuery = "",
  initialSearchMode = "SMART",
  initialLocation = "",
  initialLimit = 24,
  locations = [],
  searchInterpretation,
}: {
  companies: readonly CompanyCard[];
  total: number;
  page?: number;
  totalPages?: number;
  initialQuery?: string;
  initialSearchMode?: SearchMode;
  initialLocation?: string;
  initialLimit?: number;
  locations?: readonly string[];
  searchInterpretation?: SearchInterpretation;
}) {
  const router = useRouter();
  const locale = useWorkspaceLocale();
  const copy = getCompanyCopy(locale);
  const hasQuery = Boolean(initialQuery.trim());
  const activeLocation = companyLocationRegion(initialLocation) ?? "";
  const hasLocation = Boolean(activeLocation);
  const hasFilters =
    hasQuery || hasLocation || (initialSearchMode === "LITERAL" && hasQuery);
  const normalizedQuery = initialQuery
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
  const locationOptions = [
    ...new Set(
      [
        activeLocation,
        ...locations.map((location) => companyLocationRegion(location)),
      ].filter((location): location is string => Boolean(location)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const pageHref = (nextPage: number, nextLimit = initialLimit) => {
    const params = new URLSearchParams();
    if (hasQuery) params.set("q", initialQuery.trim());
    if (initialSearchMode !== "SMART") {
      params.set("searchMode", initialSearchMode);
    }
    if (hasLocation) params.set("location", activeLocation);
    if (nextPage > 1) params.set("page", String(nextPage));
    if (nextLimit !== 24) params.set("limit", String(nextLimit));
    const query = params.toString();
    return query ? `/company?${query}` : "/company";
  };
  const popularFilters = [
    {
      label: copy.informationTechnology,
      query: "Information Technology",
    },
    { label: copy.manufacturing, query: "Manufacturing" },
    { label: copy.education, query: "Education" },
    { label: copy.salesMarketing, query: "Sales & Marketing" },
  ];
  const popularFilterHref = (query?: string) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (initialSearchMode !== "SMART") {
      params.set("searchMode", initialSearchMode);
    }
    if (hasLocation) params.set("location", activeLocation);
    const popularQuery = params.toString();
    return popularQuery ? `/company?${popularQuery}` : "/company";
  };

  return (
    <main className={styles.page} aria-labelledby="company-list-title">
      <PageHeader
        className={styles.heading}
        eyebrow={copy.candidateWorkspace}
        title={copy.companies}
        subtitle={copy.discoverDescription}
        titleId="company-list-title"
        rightSlot={
          <span className={styles.count} aria-label={copy.companyCount(total)}>
            <Building2 size={16} aria-hidden="true" />
            <strong>{total}</strong>
            <span>{copy.verifiedEmployersLabel}</span>
          </span>
        }
      />
      <section className={styles.searchPanel} aria-label={copy.searchCompanies}>
        <CompanySearchForm
          key={`${initialQuery}\u0000${initialSearchMode}\u0000${activeLocation}\u0000${initialLimit}`}
          copy={copy}
          initialQuery={initialQuery}
          initialSearchMode={initialSearchMode}
          initialLocation={activeLocation}
          initialLimit={initialLimit}
          hasFilters={hasFilters}
          locationOptions={locationOptions}
        />
        <SearchInterpretationNotice
          interpretation={searchInterpretation}
          locale={locale}
          copy={copy}
          onSearchLiteral={
            searchInterpretation?.canSearchLiteral
              ? () =>
                  router.replace(
                    companyListSearchHref(
                      initialQuery.trim(),
                      activeLocation,
                      initialLimit,
                      "LITERAL",
                    ),
                    { scroll: false },
                  )
              : undefined
          }
          onAcceptSuggestion={
            searchInterpretation?.effectiveQuery
              ? () =>
                  router.replace(
                    companyListSearchHref(
                      searchInterpretation.effectiveQuery,
                      activeLocation,
                      initialLimit,
                      "SMART",
                    ),
                    { scroll: false },
                  )
              : undefined
          }
          onEnableSmartSearch={() =>
            router.replace(
              companyListSearchHref(
                initialQuery.trim(),
                activeLocation,
                initialLimit,
                "SMART",
              ),
              { scroll: false },
            )
          }
        />
        <div className={styles.popularFilters} aria-label={copy.popular}>
          <span className={styles.popularLabel}>{copy.popular}:</span>
          {popularFilters.map((filter) => {
            const isActive =
              normalizedQuery === filter.query.toLocaleLowerCase();
            return (
              <Link
                key={filter.query}
                className={`${styles.popularChip}${
                  isActive ? ` ${styles.popularChipActive}` : ""
                }`}
                href={popularFilterHref(isActive ? undefined : filter.query)}
                aria-current={isActive ? "page" : undefined}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
      </section>
      {companies.length ? (
        <div className={styles.grid} role="list" aria-label={copy.companies}>
          {companies.map((company) => (
            <article
              key={company.companyId}
              className={styles.cardItem}
              role="listitem"
            >
              <Link
                className={styles.card}
                href={`/company/${encodeURIComponent(company.companyId)}`}
              >
                <div className={styles.cardTop}>
                  <CompanyAvatar
                    name={company.name}
                    imageUrl={company.logoUrl}
                    size="lg"
                  />
                  <span className={styles.verifiedBadge}>
                    <CheckCircle2 size={14} aria-hidden="true" />
                    {copy.verified}
                  </span>
                </div>
                <div className={styles.cardContent}>
                  <h2>{company.name}</h2>
                  {company.industry || company.location ? (
                    <div className={styles.cardMeta}>
                      {company.industry ? (
                        <span className={styles.metaChip}>
                          <Code2 size={14} aria-hidden="true" />
                          <span className={styles.metaChipLabel}>
                            {company.industry}
                          </span>
                        </span>
                      ) : null}
                      {company.location ? (
                        <span className={styles.metaChip}>
                          <MapPin size={14} aria-hidden="true" />
                          <span className={styles.metaChipLabel}>
                            {company.location}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.openRoles}>
                    {copy.openRoles(company.openPositionCount ?? 0)}
                  </span>
                  <span className={styles.arrow}>
                    {copy.viewCompany}
                    <ArrowRight size={17} aria-hidden="true" />
                  </span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty} role="status">
          <Building2 size={30} aria-hidden="true" />
          <strong>
            {hasFilters ? copy.noMatchingCompanies : copy.noCompanies}
          </strong>
          <span>
            {hasFilters
              ? copy.noMatchingCompaniesDescription
              : copy.noCompaniesDescription}
          </span>
        </div>
      )}
      <CompanyPagination
        page={page}
        total={total}
        totalPages={totalPages}
        pageSize={initialLimit}
        itemLabel={copy.verifiedEmployersLabel}
        ariaLabel={copy.companies}
        hrefForPage={pageHref}
        onPageSizeChange={(nextLimit) => {
          window.location.assign(pageHref(1, nextLimit));
        }}
      />
    </main>
  );
}
