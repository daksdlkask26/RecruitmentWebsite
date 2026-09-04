"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { CompanyAvatar } from "@/frontend/features/jobs/components/company-avatar";
import { JobResultsList } from "@/frontend/features/jobs/components/job-results-list";
import { SearchInterpretationNotice } from "@/frontend/features/search/components/search-interpretation-notice";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import {
  companyJobSearchResponseSchema,
  type CompanyDetail,
} from "@/shared/contracts/company";
import type { SearchMode } from "@/shared/contracts/search/search-interpretation";
import { CompanyPagination } from "./company-pagination";
import { CompanyLocationSelect } from "./company-list-screen";
import { getCompanyCopy } from "./i18n/company-copy";
import styles from "./candidate-company-screen.module.css";

const DEFAULT_JOB_PAGE_SIZE = 20;

function jobSearchParams(
  keyword: string,
  location: string,
  page: number,
  limit: number,
  searchMode: SearchMode,
) {
  const params = new URLSearchParams();
  if (keyword.trim()) params.set("q", keyword.trim());
  if (location) params.set("location", location);
  if (searchMode !== "SMART") params.set("searchMode", searchMode);
  if (page > 1) params.set("page", String(page));
  if (limit !== DEFAULT_JOB_PAGE_SIZE) params.set("limit", String(limit));
  return params;
}

function valueOrUnavailable(
  value: string | number | null | undefined,
  fallback: string,
) {
  return value === null || value === undefined || value === ""
    ? fallback
    : value;
}

export function CompanyDetailScreen({
  initialCompany,
  initialKeyword = "",
  initialSearchMode = "SMART",
  initialLocation = "",
  initialLimit = DEFAULT_JOB_PAGE_SIZE,
}: {
  initialCompany: CompanyDetail;
  initialKeyword?: string;
  initialSearchMode?: SearchMode;
  initialLocation?: string;
  initialLimit?: number;
}) {
  const locale = useWorkspaceLocale();
  const copy = getCompanyCopy(locale);
  const [company, setCompany] = useState(initialCompany);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [searchMode, setSearchMode] = useState<SearchMode>(initialSearchMode);
  const [location, setLocation] = useState(initialLocation);
  const [jobPage, setJobPage] = useState(initialCompany.jobPage);
  const [jobLimit, setJobLimit] = useState(initialLimit);
  const [jobTotal, setJobTotal] = useState(initialCompany.jobTotal);
  const [jobTotalPages, setJobTotalPages] = useState(
    initialCompany.jobTotalPages,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();
  const locations = useMemo(
    () =>
      [
        ...new Set(
          [initialLocation, ...initialCompany.jobs.map((job) => job.location)]
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ].sort(),
    [initialCompany.jobs, initialLocation],
  );

  function loadJobs(
    nextPage: number,
    nextKeyword: string,
    nextLocation: string,
    historyMode: "replace" | "push",
    nextLimit = jobLimit,
    nextSearchMode = searchMode,
  ) {
    const params = jobSearchParams(
      nextKeyword,
      nextLocation,
      nextPage,
      nextLimit,
      nextSearchMode,
    );
    const query = params.toString();
    const path = `/company/${encodeURIComponent(company.companyId)}`;
    setError(null);
    setCompany((current) => ({ ...current, searchInterpretation: undefined }));
    const nextUrl = query ? `${path}?${query}` : path;
    if (historyMode === "push") window.history.pushState(null, "", nextUrl);
    else window.history.replaceState(null, "", nextUrl);
    startTransition(() => {
      void fetch(
        `/api/companies/${encodeURIComponent(company.companyId)}/jobs${
          query ? `?${query}` : ""
        }`,
        { headers: { Accept: "application/json" } },
      )
        .then(async (response) => {
          const body: unknown = await response.json();
          if (!response.ok) throw new Error(copy.jobsLoadError);
          return companyJobSearchResponseSchema.parse(body);
        })
        .then((result) => {
          setCompany((current) => ({
            ...current,
            jobs: result.items,
            ...(result.searchInterpretation
              ? { searchInterpretation: result.searchInterpretation }
              : { searchInterpretation: undefined }),
          }));
          setJobPage(result.page);
          setJobTotal(result.total);
          setJobTotalPages(result.totalPages);
        })
        .catch(() => setError(copy.jobsLoadError));
    });
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadJobs(1, keyword, location, "replace");
  }

  function clearFilters() {
    setKeyword("");
    setLocation("");
    setSearchMode("SMART");
    loadJobs(1, "", "", "replace", jobLimit, "SMART");
  }

  function searchLiterally() {
    setSearchMode("LITERAL");
    loadJobs(1, keyword, location, "replace", jobLimit, "LITERAL");
  }

  function enableSmartSearch() {
    setSearchMode("SMART");
    loadJobs(1, keyword, location, "replace", jobLimit, "SMART");
  }

  function acceptSuggestion() {
    const suggestion = company.searchInterpretation?.effectiveQuery;
    if (!suggestion) return;
    setKeyword(suggestion);
    setSearchMode("SMART");
    loadJobs(1, suggestion, location, "replace", jobLimit, "SMART");
  }

  return (
    <main className={styles.page} aria-labelledby="company-detail-title">
      <Link className={styles.backLink} href="/company">
        ← {copy.backToCompanies}
      </Link>
      <header className={styles.detailHeader}>
        <div className={styles.detailIdentity}>
          <CompanyAvatar
            name={company.name}
            imageUrl={company.logoUrl}
            size="lg"
          />
          <div>
            <p className={styles.eyebrow}>{copy.verifiedCompany}</p>
            <h1 className={styles.detailTitle} id="company-detail-title">
              {company.name}
            </h1>
            <p>{valueOrUnavailable(company.location, copy.unavailable)}</p>
          </div>
        </div>
      </header>
      <p className={styles.detailIntro}>{company.description}</p>
      <dl className={styles.metadata} aria-label={copy.companyInformation}>
        <div className={styles.metadataItem}>
          <dt>{copy.founded}</dt>
          <dd>{valueOrUnavailable(company.foundedYear, copy.unavailable)}</dd>
        </div>
        <div className={styles.metadataItem}>
          <dt>{copy.companySize}</dt>
          <dd>{company.sizeRange}</dd>
        </div>
        <div className={styles.metadataItem}>
          <dt>{copy.employees}</dt>
          <dd>{company.activeEmployeeCount || copy.unavailable}</dd>
        </div>
        <div className={styles.metadataItem}>
          <dt>{copy.industry}</dt>
          <dd>{valueOrUnavailable(company.industry, copy.unavailable)}</dd>
        </div>
      </dl>

      <section
        className={styles.panel}
        aria-labelledby="team-opportunities-title"
      >
        <div className={styles.panelHeader}>
          <div>
            <h2 id="team-opportunities-title">{copy.joinTeam}</h2>
            <p>{copy.teamDescription}</p>
          </div>
        </div>
        {company.teamRoles.length ? (
          <div className={styles.teamLinks}>
            {company.teamRoles.map((role) => (
              <Link
                key={role}
                className={styles.teamLink}
                href={`/company/${encodeURIComponent(company.companyId)}/apply?role=${role}`}
              >
                {copy.applyAs(copy.roleLabel(role))}
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.empty} role="status">
            {copy.teamApplicationUnavailable}
          </p>
        )}
      </section>

      <section
        className={styles.panel}
        aria-labelledby="company-jobs-title"
        aria-busy={loading}
      >
        <div className={styles.panelHeader}>
          <div>
            <h2 id="company-jobs-title">{copy.openPositions}</h2>
            <p>{copy.ordinaryJobsDescription}</p>
          </div>
        </div>
        <form
          className={styles.searchForm}
          onSubmit={search}
          role="search"
          aria-label={copy.jobSearchLabel}
        >
          <label className={styles.field}>
            {copy.keyword}
            <input
              className={styles.input}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={copy.jobSearchPlaceholder}
            />
          </label>
          <label className={styles.field}>
            {copy.location}
            <CompanyLocationSelect
              value={location}
              options={locations}
              label={copy.location}
              allLocationsLabel={copy.allLocations}
              onChange={setLocation}
            />
          </label>
          <button
            className={`${styles.button} ${styles.searchButton}`}
            type="submit"
            disabled={loading}
          >
            {loading ? copy.searching : copy.search}
          </button>
          <button
            className={`${styles.button} ${styles.secondary} ${styles.searchButton}`}
            type="button"
            onClick={clearFilters}
            disabled={loading}
          >
            {copy.clear}
          </button>
        </form>
        {!loading ? (
          <SearchInterpretationNotice
            interpretation={company.searchInterpretation}
            locale={locale}
            copy={copy}
            onSearchLiteral={searchLiterally}
            onAcceptSuggestion={acceptSuggestion}
            onEnableSmartSearch={enableSmartSearch}
          />
        ) : null}
        <p className={styles.resultNote} role="status" aria-live="polite">
          {error ?? copy.positionsShown(jobTotal)}
        </p>
        {company.jobs.length ? (
          <div className={styles.jobList}>
            <JobResultsList jobs={company.jobs} />
          </div>
        ) : (
          <div className={styles.empty} role="status">
            <Building2 size={28} aria-hidden="true" />
            <strong>{copy.noMatchingPositions}</strong>
            <span>{copy.noMatchingPositionsDescription}</span>
          </div>
        )}
        <CompanyPagination
          page={jobPage}
          total={jobTotal}
          totalPages={jobTotalPages}
          pageSize={jobLimit}
          itemLabel={copy.jobUnit}
          ariaLabel={copy.jobResultPages}
          disabled={loading}
          onPageChange={(nextPage) =>
            loadJobs(nextPage, keyword, location, "push")
          }
          onPageSizeChange={(nextLimit) => {
            setJobLimit(nextLimit);
            loadJobs(1, keyword, location, "replace", nextLimit);
          }}
        />
      </section>
    </main>
  );
}
