"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
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
import {
  candidateApplicationListResponseSchema,
  publicStageForCanonicalStage,
  type CandidateApplicationSummary,
  type PublicStage,
} from "@/shared/contracts/candidate-applications";
import {
  ApplicationStatusBadge,
  type ApplicationListStatus,
} from "./application-status-badge";

const APPLICATION_REFRESH_INTERVAL_MS = 60_000;

function formatDate(value: string, locale: "en" | "vi") {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

type ApplicationFilterValue = "ALL" | PublicStage | "WITHDRAWN";
type ApplicationFilterValueWithoutAll = Exclude<ApplicationFilterValue, "ALL">;

type ApplicationFilterOption = {
  value: ApplicationFilterValue;
  label: string;
  count: number;
  isTerminal?: boolean;
};

type ApplicationFilterCounts = Record<ApplicationFilterValue, number>;

function applicationFilterFor(
  application: CandidateApplicationSummary,
): ApplicationFilterValueWithoutAll {
  // Withdrawal is an effective terminal status. It must win over the
  // preserved canonical stage so a withdrawn interview is not still shown in
  // the Interview filter.
  if (application.publicOutcome === "WITHDRAWN") return "WITHDRAWN";
  return publicStageForCanonicalStage(application.canonicalStage);
}

function applicationFilterCounts(
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

  for (const application of applications) {
    counts[applicationFilterFor(application)] += 1;
  }

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
        aria-label={`${label}: ${selectedOption.label}, ${countLabel(selectedOption.count)}`}
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
                aria-label={`${option.label}, ${countLabel(option.count)}`}
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
                    {option.count}
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
  initialNextCursor,
}: {
  initialApplications: readonly CandidateApplicationSummary[];
  initialNextCursor: string | null;
}) {
  const locale = useWorkspaceLocale();
  const copy = applicationCopy(locale).applicationsList;
  const companyCopy = getCompanyCopy(locale);
  const [applications, setApplications] = useState(() => [
    ...initialApplications,
  ]);
  const [filter, setFilter] = useState<ApplicationFilterValue>("ALL");
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshApplications = useCallback(async () => {
    try {
      const response = await fetch("/api/candidate/applications?limit=24", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const next = candidateApplicationListResponseSchema.parse(
        await response.json(),
      );
      setApplications((current) => {
        const refreshedIds = new Set(
          next.applications.map((item) => item.applicationId),
        );
        return [
          ...next.applications,
          ...current.filter((item) => !refreshedIds.has(item.applicationId)),
        ];
      });
      setNextCursor(next.nextCursor);
    } catch {
      // Keep the current list during a transient background refresh failure.
    }
  }, []);
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
  const counts = useMemo(
    () => applicationFilterCounts(applications),
    [applications],
  );
  const filters = useMemo<readonly ApplicationFilterOption[]>(
    () => [
      { value: "ALL", label: copy.filters.all, count: counts.ALL },
      {
        value: "APPLICATION_SUBMITTED",
        label: copy.filters.applicationSubmitted,
        count: counts.APPLICATION_SUBMITTED,
      },
      {
        value: "UNDER_REVIEW",
        label: copy.filters.underReview,
        count: counts.UNDER_REVIEW,
      },
      {
        value: "INTERVIEW",
        label: copy.filters.interview,
        count: counts.INTERVIEW,
      },
      {
        value: "OUTCOME",
        label: copy.filters.outcome,
        count: counts.OUTCOME,
        isTerminal: true,
      },
      {
        value: "WITHDRAWN",
        label: copy.filters.withdrawn,
        count: counts.WITHDRAWN,
      },
    ],
    [copy.filters, counts],
  );
  const filtered = useMemo(
    () =>
      filter === "ALL"
        ? applications
        : applications.filter((item) => applicationFilterFor(item) === filter),
    [applications, filter],
  );

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/candidate/applications?cursor=${encodeURIComponent(nextCursor)}&limit=24`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(copy.loadMoreError);
      const next = candidateApplicationListResponseSchema.parse(body);
      setApplications((current) => {
        const known = new Set(current.map((item) => item.applicationId));
        return [
          ...current,
          ...next.applications.filter((item) => !known.has(item.applicationId)),
        ];
      });
      setNextCursor(next.nextCursor);
    } catch (caught) {
      setError(applicationErrorMessage(locale, caught, copy.loadMoreError));
    } finally {
      setLoading(false);
    }
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
              {applications.length}
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
          onChange={setFilter}
        />
      </div>
      {error ? (
        <p className="candidate-application-error" role="alert">
          {error}
        </p>
      ) : null}
      {filtered.length ? (
        <div className="candidate-application-list">
          {filtered.map((application, index) => (
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
            title={applications.length ? copy.noMatchesTitle : copy.emptyTitle}
            description={
              applications.length
                ? copy.noMatchesDescription
                : copy.emptyDescription
            }
          />
          {applications.length === 0 ? (
            <Link href="/jobs">{copy.browseJobs} →</Link>
          ) : null}
        </div>
      )}
      {nextCursor ? (
        <button
          type="button"
          className="job-secondary-button"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? copy.loading : copy.loadMore}
        </button>
      ) : null}
    </section>
  );
}
