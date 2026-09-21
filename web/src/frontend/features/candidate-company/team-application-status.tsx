"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { mutateWithCurrentCsrf } from "@/frontend/features/authentication/client/current-csrf-proof";
import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { PageHeader } from "@/frontend/components/layout/page-header";
import {
  candidateTeamApplicationListSchema,
  candidateTeamApplicationSchema,
  teamApplicationListQuerySchema,
  type TeamApplicationStatus,
  type TeamRole,
  type CandidateTeamApplication,
} from "@/shared/contracts/company-members/team-applications";
import { ANALYTICS_PLATFORM_TIME_ZONE } from "@/shared/contracts/analytics";
import styles from "./candidate-company-screen.module.css";
import { getCompanyCopy } from "./i18n/company-copy";
import { useModalA11y } from "@/frontend/components/ui/use-modal-a11y";

function formatDate(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeZone: ANALYTICS_PLATFORM_TIME_ZONE,
  }).format(new Date(value));
}

function listQueryFromUrl() {
  if (typeof window === "undefined")
    return {
      status: undefined,
      role: undefined,
      sort: undefined,
      cursor: null,
      cursorInvalid: false,
    };
  const params = new URLSearchParams(window.location.search);
  const parsed = teamApplicationListQuerySchema.safeParse({
    ...(params.has("cursor") ? { cursor: params.get("cursor") } : {}),
    ...(params.has("status") ? { status: params.get("status") } : {}),
    ...(params.has("role") ? { role: params.get("role") } : {}),
    ...(params.has("sort") ? { sort: params.get("sort") } : {}),
  });
  return parsed.success
    ? {
        status: params.has("status") ? parsed.data.status : undefined,
        role: params.has("role") ? parsed.data.role : undefined,
        sort: params.has("sort") ? parsed.data.sort : undefined,
        cursor: parsed.data.cursor ?? null,
        cursorInvalid: false,
      }
    : {
        status: undefined,
        role: undefined,
        sort: undefined,
        cursor: null,
        cursorInvalid: params.has("cursor"),
      };
}

function invitationLabel(
  status: CandidateTeamApplication["invitationStatus"],
  copy: ReturnType<typeof getCompanyCopy>,
) {
  return status ? copy.invitationStatus(status) : copy.noInvitation;
}

function messageFrom(
  body: unknown,
  copy: ReturnType<typeof getCompanyCopy>,
  fallback: string,
) {
  if (body && typeof body === "object") {
    const code =
      "code" in body && typeof body.code === "string" ? body.code : undefined;
    const localized = copy.teamApplicationError(code);
    if (localized) return localized;
    if ("message" in body && typeof body.message === "string")
      return body.message;
  }
  return fallback;
}

export function TeamApplicationStatus({
  initialApplications,
  initialCursor,
  initialNextCursor,
  initialHasMore,
  initialTotal,
  initialFilter,
  initialSort,
}: {
  initialApplications: readonly CandidateTeamApplication[];
  initialCursor?: string | null;
  initialNextCursor?: string | null;
  initialHasMore?: boolean;
  initialTotal?: number;
  initialFilter?: {
    status: TeamApplicationStatus | null;
    role: TeamRole | null;
  };
  initialSort?: "SUBMITTED_DESC" | "SUBMITTED_ASC";
}) {
  const locale = useWorkspaceLocale();
  const copy = getCompanyCopy(locale);
  const csrf = useCsrfProof();
  const [applications, setApplications] = useState([...initialApplications]);
  const browserQuery = listQueryFromUrl();
  const [status, setStatus] = useState<TeamApplicationStatus | undefined>(
    browserQuery.status ?? initialFilter?.status ?? undefined,
  );
  const [role, setRole] = useState<TeamRole | undefined>(
    browserQuery.role ?? initialFilter?.role ?? undefined,
  );
  const [sort, setSort] = useState<"SUBMITTED_DESC" | "SUBMITTED_ASC">(
    browserQuery.sort ?? initialSort ?? "SUBMITTED_DESC",
  );
  const [nextCursor, setNextCursor] = useState(initialNextCursor ?? null);
  const [hasMore, setHasMore] = useState(
    initialHasMore ?? initialNextCursor !== null,
  );
  const [total, setTotal] = useState(
    initialTotal ?? initialApplications.length,
  );
  const [loading, setLoading] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const [pendingWithdrawal, setPendingWithdrawal] =
    useState<CandidateTeamApplication | null>(null);
  const withdrawalCancel = useRef<HTMLButtonElement>(null);
  const closeWithdrawal = useCallback(() => {
    if (!busyId) setPendingWithdrawal(null);
  }, [busyId]);
  const withdrawalDialog = useModalA11y({
    open: Boolean(pendingWithdrawal),
    busy: Boolean(busyId),
    onClose: closeWithdrawal,
    initialFocusRef: withdrawalCancel,
  });

  const updateUrl = useCallback(
    (
      nextStatus: TeamApplicationStatus | undefined,
      nextRole: TeamRole | undefined,
      nextSort: "SUBMITTED_DESC" | "SUBMITTED_ASC",
      nextCursor: string | null,
      historyMode: "push" | "replace",
    ) => {
      const params = new URLSearchParams(window.location.search);
      if (nextStatus) params.set("status", nextStatus);
      else params.delete("status");
      if (nextRole) params.set("role", nextRole);
      else params.delete("role");
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
      nextStatus: TeamApplicationStatus | undefined,
      nextRole: TeamRole | undefined,
      nextSort: "SUBMITTED_DESC" | "SUBMITTED_ASC",
      requestedCursor: string | null,
      historyMode: "none" | "push" | "replace" = "none",
      isNextPage = false,
    ) => {
      const urlMatchesRequest = (cursor: string | null) => {
        if (historyMode !== "none") return true;
        const current = listQueryFromUrl();
        return (
          (current.status ?? undefined) === nextStatus &&
          (current.role ?? undefined) === nextRole &&
          (current.sort ?? "SUBMITTED_DESC") === nextSort &&
          current.cursor === cursor
        );
      };
      if (!urlMatchesRequest(requestedCursor)) return;
      const requestId = ++requestIdRef.current;
      setStatus(nextStatus);
      setRole(nextRole);
      setSort(nextSort);
      setLoading(true);
      setLoadMoreFailed(false);
      setError(null);
      let cursor = requestedCursor;
      let restarted = false;
      try {
        while (true) {
          const params = new URLSearchParams({
            limit: "24",
            sort: nextSort,
          });
          if (nextStatus) params.set("status", nextStatus);
          if (nextRole) params.set("role", nextRole);
          if (cursor) params.set("cursor", cursor);
          const response = await fetch(
            `/api/candidate/team-applications?${params.toString()}`,
            { cache: "no-store" },
          );
          const body: unknown = await response.json().catch(() => null);
          if (requestId !== requestIdRef.current) return;
          if (!urlMatchesRequest(cursor)) return;
          if (!response.ok) {
            if (cursor && response.status === 400 && !restarted) {
              restarted = true;
              cursor = null;
              updateUrl(nextStatus, nextRole, nextSort, null, "replace");
              continue;
            }
            throw new Error(
              isNextPage ? copy.loadMoreError : copy.refreshError,
            );
          }
          const result = candidateTeamApplicationListSchema.parse(body);
          setApplications(result.items);
          setNextCursor(result.nextCursor);
          setHasMore(result.hasMore);
          setTotal(result.total);
          if (historyMode !== "none" && !restarted) {
            updateUrl(nextStatus, nextRole, nextSort, cursor, historyMode);
          }
          return;
        }
      } catch (caught) {
        if (requestId !== requestIdRef.current) return;
        if (isNextPage) setLoadMoreFailed(true);
        setError(
          caught instanceof Error ? caught.message : copy.unableToRefresh,
        );
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [copy.loadMoreError, copy.refreshError, copy.unableToRefresh, updateUrl],
  );
  async function refresh() {
    const urlState = listQueryFromUrl();
    const nextStatus = urlState.status;
    const nextRole = urlState.role;
    const nextSort = urlState.sort ?? "SUBMITTED_DESC";
    await fetchPage(
      nextStatus,
      nextRole,
      nextSort,
      urlState.cursor,
      urlState.cursorInvalid ? "replace" : "none",
    );
  }

  useLayoutEffect(() => {
    let active = true;
    let lastUrl: string | null = null;
    const syncFromUrl = (force = false) => {
      if (!active) return;
      const url = window.location.href;
      if (!force && url === lastUrl) return;
      lastUrl = url;
      const query = listQueryFromUrl();
      const nextSort = query.sort ?? "SUBMITTED_DESC";
      setStatus(query.status);
      setRole(query.role);
      setSort(nextSort);
      void fetchPage(
        query.status,
        query.role,
        nextSort,
        query.cursor,
        query.cursorInvalid ? "replace" : "none",
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
      setNextCursor(initialNextCursor ?? null);
      setHasMore(initialHasMore ?? initialNextCursor !== null);
      setTotal(initialTotal ?? initialApplications.length);
    };
    window.addEventListener("popstate", handlePopState, true);
    window.addEventListener("pageshow", handlePageShow);
    if (initialCursor !== undefined) {
      const current = listQueryFromUrl();
      const initialMatchesUrl =
        !current.cursorInvalid &&
        (current.status ?? undefined) ===
          (initialFilter?.status ?? undefined) &&
        (current.role ?? undefined) === (initialFilter?.role ?? undefined) &&
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
    initialCursor,
    initialFilter,
    initialHasMore,
    initialNextCursor,
    initialSort,
    initialTotal,
  ]);
  useEffect(() => {
    if (browserQuery.cursorInvalid)
      updateUrl(status, role, sort, null, "replace");
  }, [browserQuery.cursorInvalid, role, sort, status, updateUrl]);

  async function loadMore() {
    if (!nextCursor || !hasMore || loading) return;
    await fetchPage(status, role, sort, nextCursor, "push", true);
  }

  async function withdraw(application: CandidateTeamApplication) {
    const applicationId = application.applicationId;
    setBusyId(applicationId);
    setError(null);
    setNotice(null);
    try {
      const response = await mutateWithCurrentCsrf(
        `/api/candidate/team-applications/${encodeURIComponent(applicationId)}`,
        { method: "DELETE" },
        csrf,
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(messageFrom(body, copy, copy.withdrawError));
      }
      setApplications((current) =>
        current.map((item) =>
          item.applicationId === applicationId
            ? candidateTeamApplicationSchema.parse(body)
            : item,
        ),
      );
      setPendingWithdrawal(null);
      setNotice(copy.withdrawSuccess(application.companyName));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.withdrawError);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className={styles.page} aria-labelledby="team-applications-title">
      <PageHeader
        className={styles.heading}
        eyebrow={copy.applicationsEyebrow}
        title={copy.teamApplications}
        titleId="team-applications-title"
        subtitle={copy.trackTeamApplications}
        rightSlot={
          <button
            className={`${styles.button} ${styles.secondary}`}
            type="button"
            onClick={() =>
              void refresh().catch((caught) =>
                setError(
                  caught instanceof Error
                    ? caught.message
                    : copy.unableToRefresh,
                ),
              )
            }
          >
            {loading ? copy.loadingApplications : copy.refresh}
          </button>
        }
      />
      <div className={styles.statusMeta} aria-label={copy.filterApplications}>
        <label>
          <span>{copy.allStatuses}</span>
          <select
            value={status ?? "ALL"}
            onChange={(event) => {
              const next =
                event.target.value === "ALL"
                  ? undefined
                  : (event.target.value as TeamApplicationStatus);
              setStatus(next);
              void fetchPage(next, role, sort, null, "push");
            }}
          >
            <option value="ALL">{copy.allStatuses}</option>
            {(
              [
                "SUBMITTED",
                "VIEWED",
                "REJECTED",
                "INVITATION_SENT",
                "WITHDRAWN",
                "JOINED",
              ] as const
            ).map((value) => (
              <option key={value} value={value}>
                {copy.statusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{copy.allRoles}</span>
          <select
            value={role ?? "ALL"}
            onChange={(event) => {
              const next =
                event.target.value === "ALL"
                  ? undefined
                  : (event.target.value as TeamRole);
              setRole(next);
              void fetchPage(status, next, sort, null, "push");
            }}
          >
            <option value="ALL">{copy.allRoles}</option>
            <option value="HR_MANAGER">{copy.roleLabel("HR_MANAGER")}</option>
            <option value="RECRUITER">{copy.roleLabel("RECRUITER")}</option>
          </select>
        </label>
        <label>
          <span>{copy.sortApplications}</span>
          <select
            value={sort}
            onChange={(event) => {
              const next = event.target.value as
                | "SUBMITTED_DESC"
                | "SUBMITTED_ASC";
              setSort(next);
              void fetchPage(status, role, next, null, "push");
            }}
          >
            <option value="SUBMITTED_DESC">{copy.newestFirst}</option>
            <option value="SUBMITTED_ASC">{copy.oldestFirst}</option>
          </select>
        </label>
        <span>{copy.applicationCount(total)}</span>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.success} role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {applications.length ? (
        <div className={styles.statusList}>
          {applications.map((application) => (
            <article
              className={styles.statusCard}
              key={application.applicationId}
            >
              <div className={styles.statusLine}>
                <div>
                  <h2>{application.companyName}</h2>
                  <p>{copy.roleLabel(application.appliedRole)}</p>
                </div>
                <span className={styles.statusBadge}>
                  {copy.statusLabel(application.status)}
                </span>
              </div>
              <div className={styles.statusMeta}>
                <span>
                  {copy.submittedOn(
                    formatDate(application.submittedAt, locale),
                  )}
                </span>
                <span>
                  {invitationLabel(application.invitationStatus, copy)}
                </span>
                <span>
                  {application.ownerViewed
                    ? copy.ownerViewedOn(
                        formatDate(application.ownerFirstViewedAt!, locale),
                      )
                    : copy.ownerNotViewed}
                </span>
              </div>
              {application.invitationStatus === "PENDING" &&
              application.invitationExpiresAt ? (
                <p>
                  {copy.invitationExpiresOn(
                    formatDate(application.invitationExpiresAt, locale),
                  )}
                </p>
              ) : null}
              <div className={styles.teamLinks}>
                <Link
                  className={`${styles.teamLink} ${styles.secondary}`}
                  href={`/company/${encodeURIComponent(application.companyId)}`}
                >
                  {copy.viewCompanyLink}
                </Link>
                {application.status === "INVITATION_SENT" &&
                application.invitationStatus === "PENDING" &&
                application.invitationId ? (
                  <Link
                    className={styles.teamLink}
                    href={`/recruiter/company-invitation?invitationId=${encodeURIComponent(application.invitationId)}`}
                  >
                    {copy.reviewInvitation}
                  </Link>
                ) : null}
                {application.status === "SUBMITTED" ||
                application.status === "VIEWED" ? (
                  <button
                    className={`${styles.button} ${styles.secondary}`}
                    type="button"
                    disabled={busyId === application.applicationId}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setPendingWithdrawal(application);
                    }}
                  >
                    {busyId === application.applicationId
                      ? copy.withdrawing
                      : copy.withdraw}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty} role="status">
          <strong>
            {total ? copy.noMatchingApplications : copy.noTeamApplications}
          </strong>
          <span>
            {total
              ? copy.noMatchingApplicationsDescription
              : copy.noTeamApplicationsDescription}
          </span>
          {!total ? (
            <Link className={styles.teamLink} href="/company">
              {copy.browseCompanies}
            </Link>
          ) : null}
        </div>
      )}
      {nextCursor && hasMore ? (
        <button
          className={`${styles.button} ${styles.secondary}`}
          type="button"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading
            ? copy.loadingApplications
            : loadMoreFailed
              ? copy.retryLoadMore
              : copy.loadMoreApplications}
        </button>
      ) : null}
      {pendingWithdrawal ? (
        <div className={styles.dialogBackdrop}>
          <section
            ref={withdrawalDialog}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-team-application-title"
            aria-describedby="withdraw-team-application-description"
          >
            <h2 id="withdraw-team-application-title">
              {copy.withdrawDialogTitle}
            </h2>
            <p id="withdraw-team-application-description">
              {copy.withdrawDialogDescription(
                pendingWithdrawal.companyName,
                copy.roleLabel(pendingWithdrawal.appliedRole),
              )}
            </p>
            <div className={styles.dialogActions}>
              <button
                ref={withdrawalCancel}
                className={`${styles.button} ${styles.secondary}`}
                type="button"
                disabled={busyId === pendingWithdrawal.applicationId}
                onClick={() => setPendingWithdrawal(null)}
              >
                {copy.cancelAction}
              </button>
              <button
                className={styles.button}
                type="button"
                disabled={busyId === pendingWithdrawal.applicationId}
                onClick={() => void withdraw(pendingWithdrawal)}
              >
                {busyId === pendingWithdrawal.applicationId
                  ? copy.withdrawing
                  : copy.confirmWithdraw}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
