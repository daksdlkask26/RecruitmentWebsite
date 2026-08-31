"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  jobSearchResponseSchema,
  type JobSearchResponse,
} from "@/shared/contracts/jobs/discovery";
import {
  JobSearchForm,
  type JobFilterTrigger,
  type JobSearchCriteria,
} from "./job-search-form";
import { JobResultsList } from "./job-results-list";
import { JobSearchEmptyState } from "./job-search-empty-state";
import { JobsWorkspaceNav } from "./jobs-workspace";
import type { JobSearchTaxonomy } from "@/shared/contracts/jobs/taxonomy";
import { JOB_SEARCH_CRITERIA_CHANGED_EVENT } from "./job-search-events";

const scalarCriteriaNames = [
  "q",
  "searchBy",
  "location",
  "careerPath",
  "salaryMin",
  "salaryMax",
  "salaryNegotiable",
  "salaryCurrency",
  "salaryPeriod",
  "postedWithinDays",
  "sort",
  "limit",
] as const;

const arrayCriteriaNames = [
  "district",
  "categoryFamily",
  "categoryId",
  "categoryTitle",
  "employmentType",
  "experienceLevel",
  "workArrangement",
  "skills",
] as const;

type HistoryMode = "none" | "replace" | "push";

export type JobsLiveCopy = Readonly<{
  locale: "vi" | "en";
  kicker: string;
  title: string;
  intro: string;
  jobs: string;
  openRoles: string;
  filters: string;
  results: string;
  loadFailed: string;
  opportunities: string;
  showing: string;
  of: string;
  tryAgain: string;
  retry: string;
  firstPage: string;
  previousPage: string;
  nextPage: string;
  lastPage: string;
  page: string;
  perPage: string;
  resultPages: string;
  empty: string;
  emptyCopy: string;
  resetSearch: string;
  emptyPage: string;
  emptyPageCopy: string;
  clear: string;
}>;

function one(value: string | string[] | number | undefined) {
  return Array.isArray(value) ? value[0] : value?.toString();
}

const defaultCriteriaValues: Record<string, string> = {
  searchBy: "BOTH",
  sort: "RELEVANCE",
  salaryCurrency: "VND",
  salaryPeriod: "MONTH",
  limit: "20",
};

function hasActiveSearchCriteria(criteria: JobSearchCriteria) {
  return Object.entries(criteria).some(([name, rawValue]) => {
    const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
      .filter((value): value is string | number => value !== undefined)
      .map(String)
      .filter(Boolean);
    if (!values.length) return false;

    const defaultValue = defaultCriteriaValues[name];
    return values.some((value) => value !== defaultValue);
  });
}

export function criteriaFromSearchParams(
  params: URLSearchParams,
): JobSearchCriteria {
  const criteria: JobSearchCriteria = {};
  for (const name of scalarCriteriaNames) {
    const value = params.get(name);
    if (value) criteria[name] = value;
  }
  for (const name of arrayCriteriaNames) {
    const values = params.getAll(name).filter(Boolean);
    if (values.length) criteria[name] = values;
  }
  return criteria;
}

function criteriaFromInitial(
  initialCriteria: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(initialCriteria)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(name, item);
    } else if (value) {
      params.append(name, value);
    }
  }
  return criteriaFromSearchParams(params);
}

export function jobSearchParams(criteria: JobSearchCriteria, page: number) {
  const params = new URLSearchParams();
  for (const name of scalarCriteriaNames) {
    const value = one(criteria[name]);
    if (!value || (name === "sort" && value === "RELEVANCE")) continue;
    params.set(name, value);
  }
  for (const name of arrayCriteriaNames) {
    const values = criteria[name];
    for (const value of Array.isArray(values)
      ? values
      : values
        ? [values]
        : []) {
      if (value) params.append(name, String(value));
    }
  }
  if (page > 1) params.set("page", String(page));
  return params;
}

function pageFromSearchParams(params: URLSearchParams) {
  const value = Number(params.get("page") ?? "1");
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function pageNumbers(currentPage: number, totalPages: number) {
  if (totalPages <= 5)
    return Array.from({ length: totalPages }, (_, index) => index + 1);

  const first = Math.max(1, currentPage - 1);
  const last = Math.min(totalPages, Math.max(currentPage + 1, 3));
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function urlFor(criteria: JobSearchCriteria, page: number) {
  const search = jobSearchParams(criteria, page).toString();
  return search ? `/jobs?${search}` : "/jobs";
}

export function LiveJobSearchExperience({
  initialCriteria,
  initialResult,
  initialError,
  copy,
  taxonomy,
}: Readonly<{
  initialCriteria: Record<string, string | string[] | undefined>;
  initialResult: JobSearchResponse | null;
  initialError: string | null;
  copy: JobsLiveCopy;
  taxonomy?: JobSearchTaxonomy;
}>) {
  const [criteria, setCriteria] = useState<JobSearchCriteria>(() =>
    criteriaFromInitial(initialCriteria),
  );
  const [page, setPage] = useState(() => {
    return initialResult?.page ?? pageFromSearchParams(new URLSearchParams());
  });
  const [result, setResult] = useState<JobSearchResponse | null>(initialResult);
  const [error, setError] = useState<string | null>(
    initialError ? copy.tryAgain : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const requestId = useRef(0);
  const abortController = useRef<AbortController | null>(null);
  const debounceTimer = useRef<number | null>(null);

  const updateUrl = useCallback(
    (nextCriteria: JobSearchCriteria, nextPage: number, mode: HistoryMode) => {
      if (mode === "none") return;
      const url = urlFor(nextCriteria, nextPage);
      window.history[mode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        url,
      );
      window.dispatchEvent(new Event(JOB_SEARCH_CRITERIA_CHANGED_EVENT));
    },
    [],
  );

  const cancelPendingRequest = useCallback(() => {
    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    requestId.current += 1;
    abortController.current?.abort();
    abortController.current = null;
    setIsLoading(false);
  }, []);

  const fetchJobs = useCallback(
    async (
      nextCriteria: JobSearchCriteria,
      nextPage: number,
      historyMode: HistoryMode,
    ) => {
      abortController.current?.abort();
      const controller = new AbortController();
      abortController.current = controller;
      const currentRequestId = ++requestId.current;

      setIsLoading(true);
      setError(null);
      setPage(nextPage);
      updateUrl(nextCriteria, nextPage, historyMode);

      try {
        const response = await fetch(
          `/api/jobs?${jobSearchParams(nextCriteria, nextPage)}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        const payload: unknown = await response.json();
        const parsed = jobSearchResponseSchema.safeParse(payload);
        if (!response.ok || !parsed.success)
          throw new Error("Job search failed");
        if (currentRequestId !== requestId.current) return;
        setResult(parsed.data);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        if (currentRequestId !== requestId.current) return;
        setError(copy.tryAgain);
      } finally {
        if (currentRequestId === requestId.current) {
          abortController.current = null;
          setIsLoading(false);
        }
      }
    },
    [copy.tryAgain, updateUrl],
  );

  const runCriteriaChange = useCallback(
    (nextCriteria: JobSearchCriteria, trigger: JobFilterTrigger) => {
      cancelPendingRequest();
      setCriteria(nextCriteria);
      setPage(1);
      setError(null);
      updateUrl(nextCriteria, 1, "replace");

      if (trigger === "debounced") {
        debounceTimer.current = window.setTimeout(() => {
          debounceTimer.current = null;
          void fetchJobs(nextCriteria, 1, "none");
        }, 400);
        return;
      }
      void fetchJobs(nextCriteria, 1, "none");
    },
    [cancelPendingRequest, fetchJobs, updateUrl],
  );

  const clearFilters = useCallback(() => {
    runCriteriaChange({}, "immediate");
  }, [runCriteriaChange]);

  const goToPage = useCallback(
    (nextPage: number) => {
      if (nextPage === page || nextPage < 1) return;
      cancelPendingRequest();
      void fetchJobs(criteria, nextPage, "push");
    },
    [cancelPendingRequest, criteria, fetchJobs, page],
  );

  const retry = useCallback(() => {
    cancelPendingRequest();
    void fetchJobs(criteria, page, "none");
  }, [cancelPendingRequest, criteria, fetchJobs, page]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextCriteria = criteriaFromSearchParams(params);
      const nextPage = pageFromSearchParams(params);
      cancelPendingRequest();
      setCriteria(nextCriteria);
      setPage(nextPage);
      setError(null);
      void fetchJobs(nextCriteria, nextPage, "none");
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      cancelPendingRequest();
    };
  }, [cancelPendingRequest, fetchJobs]);

  const hasResults = Boolean(result?.items.length);
  const isNoMatch = Boolean(
    result && result.total === 0 && result.items.length === 0,
  );
  const isEmptyPage = Boolean(
    result && result.total > 0 && result.items.length === 0,
  );
  const isEmptyView = Boolean(
    !error && !isLoading && (isNoMatch || isEmptyPage),
  );
  const hasResettableCriteria = hasActiveSearchCriteria(criteria);
  const total = result?.total;
  const resultSummary =
    total === undefined ? "" : `${total} ${copy.opportunities}`;
  const pageSize = Number(one(criteria.limit) ?? "20") || 20;
  const resultStart = result && result.total ? (page - 1) * pageSize + 1 : 0;
  const resultEnd = result ? Math.min(page * pageSize, result.total) : 0;
  const sort = one(criteria.sort) || "RELEVANCE";
  const sortOptions = [
    [
      "RELEVANCE",
      "Phù hợp nhất với hồ sơ của bạn",
      "Best match for your profile",
    ],
    ["NEWEST", "Ngày đăng", "Date posted"],
    ["UPDATED", "Ngày cập nhật", "Date updated"],
    ["URGENT", "Cần tuyển gấp", "Urgent hiring first"],
  ] as const;
  const activeSort =
    sortOptions.find(([value]) => value === sort) ?? sortOptions[0];
  const emptyPageAction =
    page > 1
      ? { label: copy.firstPage, onClick: () => goToPage(1) }
      : { label: copy.retry, onClick: retry };

  return (
    <>
      <div className="jobs-fixed-region">
        <JobsWorkspaceNav activeTab="search" />
        <header className="jobs-workspace-heading jobs-workspace-heading--wide">
          <div className="jobs-workspace-heading-content">
            <p className="workspace-kicker">{copy.kicker}</p>
            <h1 id="workspace-page-title">{copy.title}</h1>
            <p className="page-heading-copy">{copy.intro}</p>
          </div>
          {total !== undefined ? (
            <span
              className="job-count-badge"
              aria-label={`${total} ${copy.jobs}`}
              aria-live="polite"
              aria-atomic="true"
            >
              <strong>{total}</strong>
              <span>{isLoading ? copy.results : copy.openRoles}</span>
            </span>
          ) : null}
        </header>
      </div>

      <div className="jobs-grid">
        <aside className="job-filter-column" aria-label={copy.filters}>
          <JobSearchForm
            criteria={criteria}
            onCriteriaChange={runCriteriaChange}
            onClear={clearFilters}
            resultCount={total}
            isLoading={isLoading}
            taxonomy={taxonomy}
          />
        </aside>

        <section
          className="job-results"
          aria-labelledby="job-results-heading"
          aria-busy={isLoading}
        >
          {!isEmptyView ? (
            <div
              className="job-results-toolbar"
              aria-label={
                copy.locale === "vi"
                  ? "Tùy chọn sắp xếp kết quả"
                  : "Search result sorting"
              }
            >
              <div className="job-results-sort">
                <span>
                  {copy.locale === "vi" ? "Sắp xếp theo:" : "Sort by:"}
                </span>
                <button
                  type="button"
                  aria-expanded={sortMenuOpen}
                  aria-haspopup="listbox"
                  onClick={() => setSortMenuOpen((open) => !open)}
                >
                  {copy.locale === "vi" ? activeSort[1] : activeSort[2]}
                  <svg
                    className="job-results-sort-chevron"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
                  </svg>
                </button>
                {sortMenuOpen ? (
                  <div
                    className="job-results-sort-menu"
                    role="listbox"
                    aria-label={
                      copy.locale === "vi"
                        ? "Các tùy chọn sắp xếp"
                        : "Sort options"
                    }
                  >
                    {sortOptions.map(([value, vietnamese, english]) => (
                      <button
                        key={value}
                        type="button"
                        role="option"
                        aria-selected={sort === value}
                        onClick={() => {
                          setSortMenuOpen(false);
                          runCriteriaChange(
                            { ...criteria, sort: value },
                            "immediate",
                          );
                        }}
                      >
                        <span>
                          {copy.locale === "vi" ? vietnamese : english}
                        </span>
                        {sort === value ? (
                          <strong
                            aria-label={
                              copy.locale === "vi" ? "Đang chọn" : "Selected"
                            }
                          >
                            ✓
                          </strong>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <header className="job-results-header">
            <p className="panel-kicker" id="job-results-heading">
              {error ? copy.loadFailed : copy.results}
            </p>
            {resultSummary ? (
              <p
                className="job-results-summary"
                aria-live="polite"
                aria-atomic="true"
              >
                {isLoading
                  ? `${resultSummary} · ${copy.results}`
                  : resultSummary}
              </p>
            ) : null}
          </header>
          <div
            className={`job-results-live-content${isLoading ? "is-refreshing" : ""}`}
          >
            {isLoading ? (
              <div className="job-results-loading" aria-hidden="true">
                <span />
              </div>
            ) : null}

            {error ? (
              <div className="job-panel job-feedback" role="alert">
                <h3>{copy.loadFailed}</h3>
                <p>{error}</p>
                <button
                  className="job-secondary-link"
                  type="button"
                  onClick={retry}
                >
                  {copy.retry}
                </button>
              </div>
            ) : null}

            {hasResults && result ? (
              <>
                <JobResultsList jobs={result.items} />
                {result.totalPages > 1 ? (
                  <nav
                    className="job-pagination job-pagination--compact"
                    aria-label={copy.resultPages}
                  >
                    <div className="job-pagination-summary">
                      <span>
                        {copy.showing}{" "}
                        <strong>
                          {resultStart}–{resultEnd}
                        </strong>{" "}
                        {copy.of} <strong>{result.total}</strong> {copy.jobs}
                      </span>
                      <span
                        className="job-pagination-divider"
                        aria-hidden="true"
                      />
                      <label>
                        {copy.perPage}
                        <select
                          value={String(pageSize)}
                          onChange={(event) =>
                            runCriteriaChange(
                              { ...criteria, limit: event.target.value },
                              "immediate",
                            )
                          }
                        >
                          {[10, 20, 50].map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button
                      className="job-pagination-control"
                      type="button"
                      disabled={page === 1}
                      aria-label={copy.firstPage}
                      title={copy.firstPage}
                      onClick={() => goToPage(1)}
                    >
                      <span aria-hidden="true">«</span>
                      <span className="job-pagination-control-label">
                        {copy.firstPage}
                      </span>
                    </button>
                    <button
                      className="job-pagination-control"
                      type="button"
                      disabled={page === 1}
                      aria-label={copy.previousPage}
                      title={copy.previousPage}
                      onClick={() => goToPage(page - 1)}
                    >
                      <span aria-hidden="true">‹</span>
                      <span className="job-pagination-control-label">
                        {copy.previousPage}
                      </span>
                    </button>
                    <div className="job-pagination-pages">
                      <ol>
                        {pageNumbers(page, result.totalPages).map((number) => (
                          <li key={number}>
                            <button
                              className={`job-pagination-page${
                                number === page ? "is-current" : ""
                              }`}
                              type="button"
                              aria-current={
                                number === page ? "page" : undefined
                              }
                              aria-label={`${copy.page} ${number}`}
                              onClick={() => goToPage(number)}
                            >
                              {number}
                            </button>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <button
                      className="job-pagination-control"
                      type="button"
                      disabled={page === result.totalPages}
                      aria-label={copy.nextPage}
                      title={copy.nextPage}
                      onClick={() => goToPage(page + 1)}
                    >
                      <span className="job-pagination-control-label">
                        {copy.nextPage}
                      </span>
                      <span aria-hidden="true">›</span>
                    </button>
                    <button
                      className="job-pagination-control"
                      type="button"
                      disabled={page === result.totalPages}
                      aria-label={copy.lastPage}
                      title={copy.lastPage}
                      onClick={() => goToPage(result.totalPages)}
                    >
                      <span className="job-pagination-control-label">
                        {copy.lastPage}
                      </span>
                      <span aria-hidden="true">»</span>
                    </button>
                    <p className="job-pagination-progress" aria-live="polite">
                      {copy.page} {page} / {result.totalPages}
                    </p>
                  </nav>
                ) : null}
              </>
            ) : isNoMatch ? (
              <JobSearchEmptyState
                headingId="job-search-empty-heading"
                title={copy.empty}
                description={copy.emptyCopy}
                action={
                  hasResettableCriteria
                    ? { label: copy.resetSearch, onClick: clearFilters }
                    : undefined
                }
              />
            ) : isEmptyPage ? (
              <JobSearchEmptyState
                headingId="job-search-empty-heading"
                title={copy.emptyPage}
                description={copy.emptyPageCopy}
                action={emptyPageAction}
              />
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
