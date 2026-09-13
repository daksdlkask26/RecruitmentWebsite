"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BriefcaseBusiness, Check, ChevronDown } from "lucide-react";
import { EmptyState } from "@/frontend/components/ui/empty-state";
import { PageHeader } from "@/frontend/components/layout/page-header";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import {
  applicationCopy,
  applicationErrorMessage,
} from "@/frontend/features/candidate-applications/i18n/application-copy";
import { getCompanyCopy } from "@/frontend/features/candidate-company/i18n/company-copy";

import { NOTIFICATION_CHANGED_EVENT } from "@/frontend/features/notifications/client/use-notification-context-read";
import { CompanyAvatar } from "@/frontend/features/jobs/components/company-avatar";
import { ANALYTICS_PLATFORM_TIME_ZONE } from "@/shared/contracts/analytics";
import {
  candidateApplicationListQuerySchema,
  candidateApplicationListResponseSchema,
  type CandidateApplicationSummary,
} from "@/shared/contracts/candidate-applications";
import {
  ApplicationStatusBadge,
  type ApplicationListStatus,
} from "./application-status-badge";

const APPLICATION_REFRESH_INTERVAL_MS = 60_000;

function formatDate(value: string, locale: "en" | "vi") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: ANALYTICS_PLATFORM_TIME_ZONE,
  }).format(new Date(value));
}

type ApplicationFilterValue =
  | "ALL"
  | "APPLICATION_SUBMITTED"
  | "UNDER_REVIEW"
  | "INTERVIEW"
  | "OUTCOME"
  | "WITHDRAWN";
type ApplicationSortValue = "SUBMITTED_DESC" | "SUBMITTED_ASC";
type ApplicationFilterCounts = Record<ApplicationFilterValue, number>;

type ApplicationFilterOption = {
  value: ApplicationFilterValue;
  label: string;
  count: number | null;
  isTerminal?: boolean;
};

function readListState() {
  if (typeof window === "undefined")
    return {
      filter: undefined,
      sort: undefined,
      cursor: null,
      cursorInvalid: false,
    } as const;
  const params = new URLSearchParams(window.location.search);
  const parsed = candidateApplicationListQuerySchema.safeParse({
    ...(params.has("cursor") ? { cursor: params.get("cursor") } : {}),
    ...(params.has("filter") ? { filter: params.get("filter") } : {}),
    ...(params.has("sort") ? { sort: params.get("sort") } : {}),
  });
  return parsed.success
    ? {
        filter: params.has("filter") ? parsed.data.filter : undefined,
        sort: params.has("sort") ? parsed.data.sort : undefined,
        cursor: parsed.data.cursor ?? null,
        cursorInvalid: false,
      }
    : {
        filter: undefined,
        sort: undefined,
        cursor: null,
        cursorInvalid: params.has("cursor"),
      };
}

function applicationFilterFor(
  application: CandidateApplicationSummary,
): Exclude<ApplicationFilterValue, "ALL"> {
  if (application.publicOutcome === "WITHDRAWN") return "WITHDRAWN";
  if (application.publicStage === "APPLICATION_SUBMITTED")
    return "APPLICATION_SUBMITTED";
  if (application.publicStage === "UNDER_REVIEW") return "UNDER_REVIEW";
  if (application.publicStage === "INTERVIEW") return "INTERVIEW";
  return "OUTCOME";
}

function fallbackFilterCounts(
  applications: readonly CandidateApplicationSummary[],
): ApplicationFilterCounts {
  const counts: ApplicationFilterCounts = {
    ALL: applications.length,
    APPLICATION_SUBMITTED: 0,
    UNDER_REVIEW: 0,
    INTERVIEW: 0,
    OUTCOME: 0,
    WITHDRAWN: 0,
  };
  for (const application of applications)
    counts[applicationFilterFor(application)] += 1;
  return counts;
}

function ApplicationFilterDropdown({
  label,
  terminalLabel,
  countLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  terminalLabel: string;
  countLabel: (count: number) => string;
  options: readonly ApplicationFilterOption[];
  value: ApplicationFilterValue;
  onChange: (value: ApplicationFilterValue) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0]!;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const activeOption = options[activeIndex] ?? selectedOption;
  const menuId = "candidate-application-filter-options";
  const activeOptionId = `${menuId}-${activeOption.value.toLowerCase().replaceAll("_", "-")}`;

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  function closeMenu(restoreFocus = true) {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function chooseOption(nextValue: ApplicationFilterValue) {
    onChange(nextValue);
    closeMenu();
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      setActiveIndex(selectedIndex);
      setIsOpen(true);
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current === 0 ? options.length - 1 : current - 1,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseOption(activeOption.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  }

  return (
    <div className="candidate-application-filter__control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="candidate-application-filter__trigger"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-label={`${label}: ${selectedOption.label}${selectedOption.count === null ? "" : `, ${countLabel(selectedOption.count)}`}`}
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
            return;
          }
          setActiveIndex(selectedIndex);
          setIsOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="candidate-application-filter__trigger-copy">
          <span className="candidate-application-filter__trigger-label">
            {selectedOption.label}
          </span>
          <span
            className="candidate-application-filter__count"
            aria-hidden="true"
          >
            {selectedOption.count}
          </span>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          className="candidate-application-filter__menu"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={activeOptionId}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {option.isTerminal ? (
                <div
                  className="candidate-application-filter__terminal-group"
                  aria-hidden="true"
                >
                  <span className="candidate-application-filter__divider" />
                  <span className="candidate-application-filter__group-label">
                    {terminalLabel}
                  </span>
                </div>
              ) : null}
              <button
                id={`${menuId}-${option.value.toLowerCase().replaceAll("_", "-")}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                aria-label={`${option.label}${option.count === null ? "" : `, ${countLabel(option.count)}`}`}
                className={[
                  "candidate-application-filter__option",
                  option.isTerminal
                    ? "candidate-application-filter__option--terminal-start"
                    : "",
                  index === activeIndex
                    ? "candidate-application-filter__option--active"
                    : "",
                  option.value === value
                    ? "candidate-application-filter__option--selected"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => chooseOption(option.value)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="candidate-application-filter__option-label">
                  {option.label}
                </span>
                <span className="candidate-application-filter__option-end">
                  <span
                    className="candidate-application-filter__count"
                    aria-hidden="true"
                  >
                    {option.count === null ? "" : option.count}
                  </span>
                  {option.value === value ? <Check aria-hidden="true" /> : null}
                </span>
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function applicationStatus(
  application: CandidateApplicationSummary,
): ApplicationListStatus {
  return application.publicOutcome === "WITHDRAWN"
    ? "WITHDRAWN"
    : application.canonicalStage;
}

function ApplicationListCard({
  application,
  index,
  locale,
}: {
  application: CandidateApplicationSummary;
  index: number;
  locale: "en" | "vi";
}) {
  const copy = applicationCopy(locale).applicationsList;
  const status = applicationStatus(application);

  return (
    <article
      className="candidate-application-list-card"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="candidate-application-list-card__top">
        <div className="candidate-application-list-card__main">
          <CompanyAvatar
            name={application.companyName}
            imageUrl={application.companyLogoUrl}
            size="md"
            className="candidate-application-list-card__company-icon"
          />
          <div className="candidate-application-list-card__copy">
            <p className="candidate-application-list-card__company">
              {application.companyName}
            </p>
            <h2>{application.jobTitle}</h2>
            <p className="candidate-application-list-card__meta">
              {application.location}
              <span aria-hidden="true"> · </span>
              {copy.submitted(formatDate(application.submittedAt, locale))}
            </p>
          </div>
        </div>
        <ApplicationStatusBadge
          status={status}
          className="candidate-application-list-card__status"
          label={copy.statuses[status]}
        />
      </div>
      <div className="candidate-application-list-card__footer">
        <time dateTime={application.lastUpdatedAt}>
          {copy.updated(formatDate(application.lastUpdatedAt, locale))}
        </time>
        <Link
          className="candidate-application-list-card__link"
          href={`/jobs/applied/${encodeURIComponent(application.applicationId)}`}
        >
          {copy.viewStatus} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}

export function CandidateApplicationsListPage({
  initialApplications,
  initialCursor,
  initialNextCursor,
  initialHasMore,
  initialTotal,
  initialFilter,
  initialSort,
  initialCounts,
}: {
  initialApplications: readonly CandidateApplicationSummary[];
  initialCursor?: string | null;
  initialNextCursor: string | null;
  initialHasMore?: boolean;
  initialTotal?: number;
  initialFilter?: ApplicationFilterValue;
  initialSort?: ApplicationSortValue;
  initialCounts?: ApplicationFilterCounts;
}) {
  const locale = useWorkspaceLocale();
  const copy = applicationCopy(locale).applicationsList;
  const companyCopy = getCompanyCopy(locale);
  const [applications, setApplications] = useState(() => [
    ...initialApplications,
  ]);
  const browserState = readListState();
  const [filter, setFilter] = useState<ApplicationFilterValue>(
    browserState.filter ?? initialFilter ?? "ALL",
  );
  const [sort, setSort] = useState<ApplicationSortValue>(
    browserState.sort ?? initialSort ?? "SUBMITTED_DESC",
  );
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [hasMore, setHasMore] = useState(
    initialHasMore ?? initialNextCursor !== null,
  );
  const [total, setTotal] = useState(
    initialTotal ?? initialApplications.length,
  );
  const [filterCounts, setFilterCounts] = useState<ApplicationFilterCounts>(
    initialCounts ?? fallbackFilterCounts(initialApplications),
  );
  const [loading, setLoading] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const updateUrl = useCallback(
    (
      nextFilter: ApplicationFilterValue,
      nextSort: ApplicationSortValue,
      nextCursor: string | null,
      historyMode: "push" | "replace",
    ) => {
      const params = new URLSearchParams(window.location.search);
      params.set("filter", nextFilter);
      params.set("sort", nextSort);
      if (nextCursor) params.set("cursor", nextCursor);
      else params.delete("cursor");
      const url = `${window.location.pathname}?${params.toString()}`;
      if (historyMode === "replace") {
        window.history.replaceState(null, "", url);
      } else {
        window.history.pushState(null, "", url);
      }
    },
    [],
  );
  const fetchPage = useCallback(
    async (
      nextFilter: ApplicationFilterValue,
      nextSort: ApplicationSortValue,
      requestedCursor: string | null,
      historyMode: "none" | "push" | "replace" = "none",
      isNextPage = false,
    ) => {
      const urlMatchesRequest = (cursor: string | null) => {
        if (historyMode !== "none") return true;
        const current = readListState();
        return (
          (current.filter ?? "ALL") === nextFilter &&
          (current.sort ?? "SUBMITTED_DESC") === nextSort &&
          current.cursor === cursor
        );
      };
      if (!urlMatchesRequest(requestedCursor)) return;
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setLoadMoreFailed(false);
      setError(null);
      let cursor = requestedCursor;
      let restarted = false;
      try {
        while (true) {
          const params = new URLSearchParams({
            limit: "24",
            filter: nextFilter,
            sort: nextSort,
          });
          if (cursor) params.set("cursor", cursor);
          const response = await fetch(
            `/api/candidate/applications?${params.toString()}`,
            {
              credentials: "same-origin",
              cache: "no-store",
            },
          );
          const body: unknown = await response.json().catch(() => null);
          if (requestId !== requestIdRef.current) return;
          if (!urlMatchesRequest(cursor)) return;
          if (!response.ok) {
            if (cursor && response.status === 400 && !restarted) {
              restarted = true;
              cursor = null;
              updateUrl(nextFilter, nextSort, null, "replace");
              continue;
            }
            throw new Error(copy.loadMoreError);
          }
          const next = candidateApplicationListResponseSchema.parse(body);
          setApplications(next.applications);
          setNextCursor(next.nextCursor);
          setHasMore(next.hasMore);
          setTotal(next.total);
          setFilterCounts(next.counts);
          if (historyMode !== "none" && !restarted) {
            updateUrl(next.filter, next.sort, cursor, historyMode);
          }
          return;
        }
      } catch (caught) {
        if (requestId !== requestIdRef.current) return;
        if (isNextPage) setLoadMoreFailed(true);
        setError(applicationErrorMessage(locale, caught, copy.loadMoreError));
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [copy.loadMoreError, locale, updateUrl],
  );
  const refreshApplications = useCallback(async () => {
    const urlState = readListState();
    const nextFilter = urlState.filter ?? "ALL";
    const nextSort = urlState.sort ?? "SUBMITTED_DESC";
    await fetchPage(
      nextFilter,
      nextSort,
      urlState.cursor,
      urlState.cursorInvalid ? "replace" : "none",
    );
  }, [fetchPage]);
  useEffect(() => {
    let timer: number | undefined;
    let mounted = true;
    const schedule = () => {
      if (!mounted || document.hidden) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await refreshApplications();
        schedule();
      }, APPLICATION_REFRESH_INTERVAL_MS);
    };
    const refreshNow = () => {
      if (!document.hidden) void refreshApplications();
    };
    const visibility = () => {
      if (document.hidden) {
        if (timer) window.clearTimeout(timer);
        return;
      }
      if (timer) window.clearTimeout(timer);
      void refreshApplications();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", refreshNow);
    window.addEventListener(NOTIFICATION_CHANGED_EVENT, refreshNow);
    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener(NOTIFICATION_CHANGED_EVENT, refreshNow);
    };
  }, [refreshApplications]);
  useLayoutEffect(() => {
    let active = true;
    let lastUrl: string | null = null;
    const syncFromUrl = (force = false) => {
      if (!active) return;
      const url = window.location.href;
      if (!force && url === lastUrl) return;
      lastUrl = url;
      const next = readListState();
      const nextFilter = next.filter ?? "ALL";
      const nextSort = next.sort ?? "SUBMITTED_DESC";
      setFilter(nextFilter);
      setSort(nextSort);
      void fetchPage(
        nextFilter,
        nextSort,
        next.cursor,
        next.cursorInvalid ? "replace" : "none",
      );
    };
    let pageShowTimer: number | undefined;
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        pageShowTimer = window.setTimeout(syncFromUrl, 0);
      }
    };
    const handlePopState = (event: PopStateEvent) => {
      if (event.state === null) {
        syncFromUrl(true);
        return;
      }
      window.setTimeout(() => syncFromUrl(true), 0);
    };
    const applyInitialPage = () => {
      setApplications([...initialApplications]);
      setNextCursor(initialNextCursor);
      setHasMore(initialHasMore ?? initialNextCursor !== null);
      setTotal(initialTotal ?? initialApplications.length);
      setFilterCounts(
        initialCounts ?? fallbackFilterCounts(initialApplications),
      );
    };
    window.addEventListener("popstate", handlePopState, true);
    window.addEventListener("pageshow", handlePageShow);
    if (initialCursor !== undefined) {
      const current = readListState();
      const initialMatchesUrl =
        !current.cursorInvalid &&
        (current.filter ?? "ALL") === (initialFilter ?? "ALL") &&
        (current.sort ?? "SUBMITTED_DESC") ===
          (initialSort ?? "SUBMITTED_DESC") &&
        current.cursor === (initialCursor ?? null);
      if (initialMatchesUrl) {
        lastUrl = window.location.href;
        applyInitialPage();
      } else syncFromUrl();
    }
    return () => {
      active = false;
      if (pageShowTimer !== undefined) window.clearTimeout(pageShowTimer);
      window.removeEventListener("popstate", handlePopState, true);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [
    fetchPage,
    initialApplications,
    initialCounts,
    initialCursor,
    initialFilter,
    initialHasMore,
    initialNextCursor,
    initialSort,
    initialTotal,
  ]);
  useEffect(() => {
    if (browserState.cursorInvalid) updateUrl(filter, sort, null, "replace");
  }, [browserState.cursorInvalid, filter, sort, updateUrl]);
  const filters = useMemo<readonly ApplicationFilterOption[]>(
    () => [
      {
        value: "ALL",
        label: copy.filters.all,
        count: filterCounts.ALL,
      },
      {
        value: "APPLICATION_SUBMITTED",
        label: copy.filters.applicationSubmitted,
        count: filterCounts.APPLICATION_SUBMITTED,
      },
      {
        value: "UNDER_REVIEW",
        label: copy.filters.underReview,
        count: filterCounts.UNDER_REVIEW,
      },
      {
        value: "INTERVIEW",
        label: copy.filters.interview,
        count: filterCounts.INTERVIEW,
      },
      {
        value: "OUTCOME",
        label: copy.filters.outcome,
        count: filterCounts.OUTCOME,
        isTerminal: true,
      },
      {
        value: "WITHDRAWN",
        label: copy.filters.withdrawn,
        count: filterCounts.WITHDRAWN,
      },
    ],
    [copy.filters, filterCounts],
  );

  async function loadMore() {
    if (!nextCursor || !hasMore || loading) return;
    await fetchPage(filter, sort, nextCursor, "push", true);
  }

  return (
    <section
      className="candidate-application-flow candidate-application-list-page"
      aria-labelledby="candidate-applications-title"
    >
      <PageHeader
        className="candidate-application-list-page__header"
        eyebrow={copy.eyebrow}
        title={copy.title}
        subtitle={copy.subtitle}
        titleId="candidate-applications-title"
        rightSlot={
          <span className="candidate-application-list-page__actions">
            <Link
              className="candidate-application-list-page__team-link"
              href="/jobs/applied/team"
            >
              {companyCopy.teamApplications}
            </Link>
            <span className="candidate-application-list-page__count">
              {copy.countLabel(total)}
            </span>
          </span>
        }
      />
      <div className="candidate-application-filter">
        <span className="candidate-application-filter__label">
          {copy.filterLabel}
        </span>
        <ApplicationFilterDropdown
          label={copy.filterLabel}
          terminalLabel={copy.filters.terminal}
          countLabel={copy.countLabel}
          options={filters}
          value={filter}
          onChange={(next) => {
            setFilter(next);
            void fetchPage(next, sort, null, "push");
          }}
        />
        <label className="candidate-application-filter__sort">
          <span>{copy.sortLabel}</span>
          <select
            value={sort}
            onChange={(event) => {
              const next = event.target.value as ApplicationSortValue;
              setSort(next);
              void fetchPage(filter, next, null, "push");
            }}
          >
            <option value="SUBMITTED_DESC">{copy.sortNewest}</option>
            <option value="SUBMITTED_ASC">{copy.sortOldest}</option>
          </select>
        </label>
      </div>
      {error ? (
        <p className="candidate-application-error" role="alert">
          {error}
        </p>
      ) : null}
      {applications.length ? (
        <div className="candidate-application-list">
          {applications.map((application, index) => (
            <ApplicationListCard
              key={application.applicationId}
              application={application}
              index={index}
              locale={locale}
            />
          ))}
        </div>
      ) : (
        <div className="candidate-application-list-page__empty">
          <EmptyState
            icon={<BriefcaseBusiness />}
            title={filter !== "ALL" ? copy.noMatchesTitle : copy.emptyTitle}
            description={
              filter !== "ALL"
                ? copy.noMatchesDescription
                : copy.emptyDescription
            }
          />
          {filter === "ALL" ? (
            <Link href="/jobs">{copy.browseJobs} →</Link>
          ) : null}
        </div>
      )}
      {nextCursor && hasMore ? (
        <button
          type="button"
          className="job-secondary-button"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading
            ? copy.loading
            : loadMoreFailed
              ? copy.retryLoadMore
              : copy.loadMore}
        </button>
      ) : null}
    </section>
  );
}
