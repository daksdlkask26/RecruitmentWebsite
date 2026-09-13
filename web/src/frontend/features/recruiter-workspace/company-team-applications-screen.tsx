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
import {
  ownerTeamApplicationListSchema,
  ownerTeamApplicationSchema,
  teamApplicationListQuerySchema,
  type TeamApplicationStatus,
  type OwnerTeamApplication,
  type TeamRole,
} from "@/shared/contracts/company-members/team-applications";
import {
  formatCompanyTeamApplicationDate,
  getCompanyTeamApplicationsCopy,
} from "./company-team-applications-copy";
import styles from "./company-team-applications-screen.module.css";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

type OwnerCompanyOption = { id: string; name: string };

function readOwnerUrlState() {
  if (typeof window === "undefined")
    return {
      status: undefined,
      role: undefined,
      sort: undefined,
      cursor: null,
      cursorInvalid: false,
      companyId: undefined,
      selected: undefined,
    };
  const params = new URLSearchParams(window.location.search);
  const query = {
    ...(params.has("cursor") ? { cursor: params.get("cursor") } : {}),
    ...(params.has("status") ? { status: params.get("status") } : {}),
    ...(params.has("role") ? { role: params.get("role") } : {}),
    ...(params.has("sort") ? { sort: params.get("sort") } : {}),
  };
  const parsed = teamApplicationListQuerySchema.safeParse(query);
  return {
    status:
      parsed.success && params.has("status") ? parsed.data.status : undefined,
    role: parsed.success && params.has("role") ? parsed.data.role : undefined,
    sort: parsed.success && params.has("sort") ? parsed.data.sort : undefined,
    cursor: parsed.success ? (parsed.data.cursor ?? null) : null,
    cursorInvalid: !parsed.success && params.has("cursor"),
    companyId: params.get("companyId") ?? undefined,
    selected: params.get("selected") ?? undefined,
  };
}

function messageFrom(
  body: unknown,
  copy: ReturnType<typeof getCompanyTeamApplicationsCopy>,
  fallback: string,
) {
  if (body && typeof body === "object") {
    const code =
      "code" in body && typeof body.code === "string" ? body.code : undefined;
    const localized = copy.errorForCode(code);
    if (localized) return localized;
    if ("message" in body && typeof body.message === "string")
      return body.message;
  }
  return fallback;
}

export function CompanyTeamApplicationsScreen({
  initialApplications,
  companyId,
  eligibleCompanies = [],
  initialCursor,
  initialNextCursor,
  initialHasMore,
  initialTotal,
  initialPendingCount,
  initialFilter,
  initialSort,
}: {
  initialApplications: readonly OwnerTeamApplication[];
  companyId?: string;
  eligibleCompanies?: readonly OwnerCompanyOption[];
  initialCursor?: string | null;
  initialNextCursor?: string | null;
  initialHasMore?: boolean;
  initialTotal?: number;
  initialPendingCount: number;
  initialFilter?: {
    status: TeamApplicationStatus | null;
    role: TeamRole | null;
  };
  initialSort?: "SUBMITTED_DESC" | "SUBMITTED_ASC";
}) {
  const locale = useWorkspaceLocale();
  const copy = getCompanyTeamApplicationsCopy(locale);
  const csrf = useCsrfProof();
  const browserState = readOwnerUrlState();
  const initialCompanyScope =
    companyId ??
    (browserState.companyId &&
    eligibleCompanies.some((company) => company.id === browserState.companyId)
      ? browserState.companyId
      : undefined);
  const initialSelectedId = browserState.selected
    ? initialApplications.some(
        (item) => item.applicationId === browserState.selected,
      )
      ? browserState.selected
      : null
    : (initialApplications[0]?.applicationId ?? null);
  const [companyScope, setCompanyScope] = useState(initialCompanyScope);
  const [applications, setApplications] = useState([...initialApplications]);
  const [status, setStatus] = useState<TeamApplicationStatus | undefined>(
    browserState.status ?? initialFilter?.status ?? undefined,
  );
  const [roleFilter, setRoleFilter] = useState<TeamRole | undefined>(
    browserState.role ?? initialFilter?.role ?? undefined,
  );
  const [sort, setSort] = useState<"SUBMITTED_DESC" | "SUBMITTED_ASC">(
    browserState.sort ?? initialSort ?? "SUBMITTED_DESC",
  );
  const [nextCursor, setNextCursor] = useState(initialNextCursor ?? null);
  const [currentCursor, setCurrentCursor] = useState<string | null>(
    browserState.cursor,
  );
  const [hasMore, setHasMore] = useState(
    initialHasMore ?? initialNextCursor !== null,
  );
  const [total, setTotal] = useState(
    initialTotal ?? initialApplications.length,
  );
  const [pendingCount, setPendingCount] = useState(initialPendingCount);
  const [loading, setLoading] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [selected, setSelected] = useState<OwnerTeamApplication | null>(
    initialApplications.find(
      (item) => item.applicationId === initialSelectedId,
    ) ?? null,
  );
  const [role, setRole] = useState<TeamRole>(
    initialApplications[0]?.appliedRole ?? "RECRUITER",
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<
    "accept" | "reject" | null
  >(null);
  const requestIdRef = useRef(0);

  const updateUrl = useCallback(
    (
      nextCompany: string | undefined,
      nextStatus: TeamApplicationStatus | undefined,
      nextRole: TeamRole | undefined,
      nextSort: "SUBMITTED_DESC" | "SUBMITTED_ASC",
      nextSelected?: string | null,
      nextCursor: string | null = null,
      historyMode: "push" | "replace" = "push",
    ) => {
      const params = new URLSearchParams(window.location.search);
      if (nextCompany) params.set("companyId", nextCompany);
      else params.delete("companyId");
      if (nextStatus) params.set("status", nextStatus);
      else params.delete("status");
      if (nextRole) params.set("role", nextRole);
      else params.delete("role");
      params.set("sort", nextSort);
      if (nextSelected) params.set("selected", nextSelected);
      else params.delete("selected");
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
      nextCompany: string | undefined,
      nextStatus: TeamApplicationStatus | undefined,
      nextRole: TeamRole | undefined,
      nextSort: "SUBMITTED_DESC" | "SUBMITTED_ASC",
      requestedCursor: string | null,
      historyMode: "none" | "push" | "replace" = "none",
      selectedForPage: string | null = null,
      isNextPage = false,
    ) => {
      let selectedForRequest = selectedForPage;
      const urlMatchesRequest = (cursor: string | null) => {
        if (historyMode !== "none") return true;
        const current = readOwnerUrlState();
        return (
          (current.companyId ?? undefined) === nextCompany &&
          (current.status ?? undefined) === nextStatus &&
          (current.role ?? undefined) === nextRole &&
          (current.sort ?? "SUBMITTED_DESC") === nextSort &&
          (current.cursorInvalid ? null : current.cursor) === cursor &&
          (current.selected ?? null) === (selectedForRequest ?? null)
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
        if (!nextCompany) {
          setApplications([]);
          setNextCursor(null);
          setCurrentCursor(null);
          setHasMore(false);
          setTotal(0);
          setPendingCount(0);
          setSelected(null);
          setSelectedId(null);
          if (historyMode !== "none")
            updateUrl(
              nextCompany,
              nextStatus,
              nextRole,
              nextSort,
              null,
              null,
              historyMode,
            );
          return;
        }
        while (true) {
          const params = new URLSearchParams({
            companyId: nextCompany,
            limit: "24",
            sort: nextSort,
          });
          if (nextStatus) params.set("status", nextStatus);
          if (nextRole) params.set("role", nextRole);
          if (cursor) params.set("cursor", cursor);
          const response = await fetch(
            `/api/recruiter/company/team/applications?${params.toString()}`,
            { cache: "no-store" },
          );
          const body: unknown = await response.json().catch(() => null);
          if (requestId !== requestIdRef.current) return;
          if (!urlMatchesRequest(cursor)) return;
          if (!response.ok) {
            if (cursor && response.status === 400 && !restarted) {
              restarted = true;
              cursor = null;
              selectedForRequest = null;
              setCurrentCursor(null);
              updateUrl(
                nextCompany,
                nextStatus,
                nextRole,
                nextSort,
                null,
                null,
                "replace",
              );
              continue;
            }
            throw new Error(
              messageFrom(
                body,
                copy,
                isNextPage ? copy.loadMoreError : copy.loadError,
              ),
            );
          }
          const result = ownerTeamApplicationListSchema.parse(body);
          const selectedItem = selectedForRequest
            ? result.items.find(
                (item) => item.applicationId === selectedForRequest,
              )
            : undefined;
          const selectedOnPage = selectedItem?.applicationId ?? null;
          setApplications(result.items);
          setNextCursor(result.nextCursor);
          setCurrentCursor(cursor);
          setHasMore(result.hasMore);
          setTotal(result.total);
          setPendingCount(result.pendingCount);
          setSelectedId(selectedOnPage);
          setSelected(selectedItem ?? null);
          if (selectedItem) setRole(selectedItem.appliedRole);
          if (selectedForRequest && !selectedItem) {
            updateUrl(
              nextCompany,
              nextStatus,
              nextRole,
              nextSort,
              null,
              cursor,
              "replace",
            );
          } else if (historyMode !== "none" && !restarted) {
            updateUrl(
              nextCompany,
              nextStatus,
              nextRole,
              nextSort,
              selectedOnPage,
              cursor,
              historyMode,
            );
          }
          return;
        }
      } catch (caught) {
        if (requestId !== requestIdRef.current) return;
        if (isNextPage) setLoadMoreFailed(true);
        setError(caught instanceof Error ? caught.message : copy.loadError);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [copy, updateUrl],
  );

  const fetchDetail = useCallback(
    async (applicationId: string, scope: string) => {
      const response = await fetch(
        `/api/recruiter/company/team/applications/${encodeURIComponent(applicationId)}?companyId=${encodeURIComponent(scope)}`,
        { cache: "no-store" },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(messageFrom(body, copy, copy.loadError));
      return ownerTeamApplicationSchema.parse(body);
    },
    [copy],
  );

  useEffect(() => {
    const urlState = readOwnerUrlState();
    if (
      !urlState.selected ||
      initialApplications.some(
        (item) => item.applicationId === urlState.selected,
      )
    )
      return;
    updateUrl(
      companyScope,
      status,
      roleFilter,
      sort,
      null,
      urlState.cursorInvalid ? null : urlState.cursor,
      "replace",
    );
  }, [companyScope, initialApplications, roleFilter, sort, status, updateUrl]);

  useEffect(() => {
    if (!selectedId || !companyScope) return;
    let cancelled = false;
    void fetchDetail(selectedId, companyScope)
      .then((detail) => {
        if (cancelled) return;
        setSelected(detail);
        setApplications((current) =>
          current.map((item) =>
            item.applicationId === detail.applicationId ? detail : item,
          ),
        );
        setRole(detail.appliedRole);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : copy.loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [companyScope, copy.loadError, fetchDetail, selectedId]);

  useLayoutEffect(() => {
    let active = true;
    let lastUrl: string | null = null;
    const syncFromUrl = (force = false) => {
      if (!active) return;
      const url = window.location.href;
      if (!force && url === lastUrl) return;
      lastUrl = url;
      const next = readOwnerUrlState();
      const nextCompany =
        next.companyId &&
        eligibleCompanies.some((company) => company.id === next.companyId)
          ? next.companyId
          : undefined;
      const nextSort = next.sort ?? "SUBMITTED_DESC";
      const nextCursor =
        nextCompany && !next.cursorInvalid ? next.cursor : null;
      const nextSelected =
        nextCompany && !next.cursorInvalid ? (next.selected ?? null) : null;
      setCompanyScope(nextCompany);
      setStatus(next.status);
      setRoleFilter(next.role);
      setSort(nextSort);
      setCurrentCursor(nextCursor);
      setSelectedId(nextSelected);
      setSelected(null);
      if (
        next.companyId !== nextCompany ||
        next.cursorInvalid ||
        (next.selected ?? null) !== nextSelected
      ) {
        updateUrl(
          nextCompany,
          next.status,
          next.role,
          nextSort,
          nextSelected,
          nextCursor,
          "replace",
        );
      }
      void fetchPage(
        nextCompany,
        next.status,
        next.role,
        nextSort,
        nextCursor,
        "none",
        nextSelected,
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
      const current = readOwnerUrlState();
      const selectedFromUrl = current.selected
        ? initialApplications.some(
            (item) => item.applicationId === current.selected,
          )
          ? current.selected
          : null
        : (initialApplications[0]?.applicationId ?? null);
      const selectedItem = initialApplications.find(
        (item) => item.applicationId === selectedFromUrl,
      );
      setApplications([...initialApplications]);
      setNextCursor(initialNextCursor ?? null);
      setCurrentCursor(current.cursor);
      setHasMore(initialHasMore ?? initialNextCursor !== null);
      setTotal(initialTotal ?? initialApplications.length);
      setPendingCount(initialPendingCount);
      setSelectedId(selectedFromUrl);
      setSelected(selectedItem ?? null);
      if (selectedItem) setRole(selectedItem.appliedRole);
    };
    window.addEventListener("popstate", handlePopState, true);
    window.addEventListener("pageshow", handlePageShow);
    if (initialCursor !== undefined) {
      const current = readOwnerUrlState();
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
    eligibleCompanies,
    fetchPage,
    initialApplications,
    initialCursor,
    initialFilter,
    initialSort,
    initialHasMore,
    initialNextCursor,
    initialPendingCount,
    initialTotal,
    updateUrl,
  ]);

  function selectApplication(applicationId: string) {
    const seed = applications.find(
      (item) => item.applicationId === applicationId,
    );
    if (seed) {
      setSelected(seed);
      setRole(seed.appliedRole);
    }
    setError(null);
    setNotice(null);
    setPendingDecision(null);
    setSelectedId(applicationId);
    if (companyScope)
      updateUrl(
        companyScope,
        status,
        roleFilter,
        sort,
        applicationId,
        currentCursor,
        "push",
      );
  }

  async function loadMore() {
    if (!nextCursor || !hasMore || loading || !companyScope) return;
    await fetchPage(
      companyScope,
      status,
      roleFilter,
      sort,
      nextCursor,
      "push",
      null,
      true,
    );
  }

  function chooseCompany(nextCompany: string | undefined) {
    setCompanyScope(nextCompany);
    setCurrentCursor(null);
    setSelectedId(null);
    setSelected(null);
    setNotice(null);
    setError(null);
    void fetchPage(nextCompany, status, roleFilter, sort, null, "push");
  }

  function clearSelectionForListChange() {
    setSelectedId(null);
    setSelected(null);
    setPendingDecision(null);
    setNotice(null);
  }

  function requestDecision(decision: "accept" | "reject") {
    if (!selected) return;
    setError(null);
    setNotice(null);
    setPendingDecision(decision);
  }

  async function decide(decision: "accept" | "reject") {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await mutateWithCurrentCsrf(
        `/api/recruiter/company/team/applications/${encodeURIComponent(selected.applicationId)}/${decision}?companyId=${encodeURIComponent(companyScope ?? "")}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            decision === "accept"
              ? { role }
              : { reason: reason.trim() || undefined },
          ),
        },
        csrf,
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(messageFrom(body, copy, copy.decisionError(decision)));
      const next = companyScope
        ? await fetchDetail(selected.applicationId, companyScope)
        : selected;
      setSelected(next);
      setApplications((current) =>
        current.map((item) =>
          item.applicationId === next.applicationId ? next : item,
        ),
      );
      setReason("");
      setPendingDecision(null);
      if (companyScope) {
        await fetchPage(
          companyScope,
          status,
          roleFilter,
          sort,
          currentCursor,
          "replace",
          next.applicationId,
        );
      }
      setNotice(
        decision === "accept" ? copy.acceptSuccess : copy.rejectSuccess,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : copy.genericDecisionError,
      );
      setPendingDecision(null);
      if (companyScope && selected) {
        void fetchDetail(selected.applicationId, companyScope)
          .then((authoritative) => {
            setSelected(authoritative);
            setApplications((current) =>
              current.map((item) =>
                item.applicationId === authoritative.applicationId
                  ? authoritative
                  : item,
              ),
            );
            setRole(authoritative.appliedRole);
          })
          .catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  const reviewable =
    selected?.status === "SUBMITTED" || selected?.status === "VIEWED";
  const retryable =
    selected?.status === "INVITATION_SENT" &&
    selected.invitationStatus === "PENDING" &&
    (selected.invitationEmailStatus === "DEAD" ||
      selected.invitationEmailStatus === "RETRYABLE");

  return (
    <main className={styles.page} aria-labelledby="team-applications-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{copy.manageTeam}</p>
          <h1 id="team-applications-title">{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.pendingBadge}>
            {copy.pendingDecision(pendingCount)}
          </span>
          <Link
            className={`${styles.link} ${styles.secondary}`}
            href={`/recruiter/company-settings/team${companyScope ? `?companyId=${encodeURIComponent(companyScope)}` : ""}`}
          >
            {copy.manageTeamLink}
          </Link>
        </div>
      </header>
      <section className={styles.notice} aria-label={copy.companyScope}>
        <label>
          {copy.companyScope}
          <select
            value={companyScope ?? ""}
            onChange={(event) => chooseCompany(event.target.value || undefined)}
          >
            <option value="">{copy.allCompanies}</option>
            {eligibleCompanies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {companyScope ? (
        <section className={styles.notice} aria-label={copy.filterApplications}>
          <label>
            {copy.allStatuses}
            <select
              value={status ?? "ALL"}
              onChange={(event) => {
                const next =
                  event.target.value === "ALL"
                    ? undefined
                    : (event.target.value as TeamApplicationStatus);
                clearSelectionForListChange();
                setStatus(next);
                setCurrentCursor(null);
                void fetchPage(
                  companyScope,
                  next,
                  roleFilter,
                  sort,
                  null,
                  "push",
                );
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
            {copy.allRoles}
            <select
              value={roleFilter ?? "ALL"}
              onChange={(event) => {
                const next =
                  event.target.value === "ALL"
                    ? undefined
                    : (event.target.value as TeamRole);
                clearSelectionForListChange();
                setRoleFilter(next);
                setCurrentCursor(null);
                void fetchPage(companyScope, status, next, sort, null, "push");
              }}
            >
              <option value="ALL">{copy.allRoles}</option>
              <option value="HR_MANAGER">{copy.roleLabel("HR_MANAGER")}</option>
              <option value="RECRUITER">{copy.roleLabel("RECRUITER")}</option>
            </select>
          </label>
          <label>
            {copy.sortApplications}
            <select
              value={sort}
              onChange={(event) => {
                const next = event.target.value as
                  | "SUBMITTED_DESC"
                  | "SUBMITTED_ASC";
                clearSelectionForListChange();
                setSort(next);
                setCurrentCursor(null);
                void fetchPage(
                  companyScope,
                  status,
                  roleFilter,
                  next,
                  null,
                  "push",
                );
              }}
            >
              <option value="SUBMITTED_DESC">{copy.newestFirst}</option>
              <option value="SUBMITTED_ASC">{copy.oldestFirst}</option>
            </select>
          </label>
        </section>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : notice ? (
        <p className={styles.success} role="status" aria-live="polite">
          {notice}
        </p>
      ) : (
        <p className={styles.notice} role="status" aria-live="polite">
          {selectedId ? copy.refreshSelection : ""}
        </p>
      )}
      {companyScope && applications.length ? (
        <div className={styles.layout}>
          <section
            className={styles.listPanel}
            aria-labelledby="team-application-list-title"
          >
            <div className={styles.panelHeading}>
              <h2 id="team-application-list-title">{copy.candidateCvs}</h2>
              <p>{copy.applicationCount(total)}</p>
            </div>
            <div className={styles.list} role="list">
              {applications.map((application) => (
                <div key={application.applicationId} role="listitem">
                  <button
                    className={styles.applicationCard}
                    data-selected={application.applicationId === selectedId}
                    type="button"
                    onClick={() => selectApplication(application.applicationId)}
                  >
                    <span className={styles.applicationTop}>
                      <span>
                        <span className={styles.applicationTitle}>
                          {application.candidateName}
                        </span>
                        <span className={styles.applicationMeta}>
                          {copy.roleLabel(application.appliedRole)} ·{" "}
                          {formatCompanyTeamApplicationDate(
                            application.submittedAt,
                            locale,
                          )}
                        </span>
                      </span>
                      <span className={styles.statusBadge}>
                        {copy.statusLabel(application.status)}
                      </span>
                    </span>
                    <span className={styles.applicationFooter}>
                      <span className={styles.applicationMeta}>
                        {application.applicationEmail}
                      </span>
                      {application.ownerViewed ? (
                        <span className={styles.viewedBadge}>
                          {copy.viewed}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section
            className={styles.detailPanel}
            aria-labelledby="team-application-detail-title"
            aria-live="polite"
          >
            {selected ? (
              <>
                <header className={styles.detailHeader}>
                  <p className={styles.eyebrow}>{copy.applicationDetail}</p>
                  <h2 id="team-application-detail-title">
                    {selected.candidateName}
                  </h2>
                  <p>{selected.applicationEmail}</p>
                </header>
                <div className={styles.detailBody}>
                  <dl className={styles.detailGrid}>
                    <div className={styles.detailItem}>
                      <dt>{copy.appliedRole}</dt>
                      <dd>{copy.roleLabel(selected.appliedRole)}</dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt>{copy.submitted}</dt>
                      <dd>
                        {formatCompanyTeamApplicationDate(
                          selected.submittedAt,
                          locale,
                        )}
                      </dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt>{copy.currentStatus}</dt>
                      <dd>{copy.statusLabel(selected.status)}</dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt>{copy.cv}</dt>
                      <dd>
                        {selected.cvFileName} ·{" "}
                        {formatBytes(selected.cvByteSize)}
                      </dd>
                    </div>
                    {selected.invitationEmailStatus ? (
                      <div className={styles.detailItem}>
                        <dt>{copy.invitationEmail}</dt>
                        <dd>
                          {selected.invitationEmailStatus === "DEAD"
                            ? copy.deliveryFailed
                            : copy.emailStatusLabel(
                                selected.invitationEmailStatus,
                              )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {selected.rejectionReason ? (
                    <p className={styles.detailMeta}>
                      {copy.rejectionReason(selected.rejectionReason)}
                    </p>
                  ) : null}
                  <div className={styles.detailActions}>
                    <a
                      className={styles.link}
                      href={`/api/recruiter/company/team/applications/${encodeURIComponent(selected.applicationId)}/cv?companyId=${encodeURIComponent(companyScope ?? "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {copy.viewCv}
                    </a>
                    {selected.invitationStatus === "PENDING" &&
                    selected.invitationExpiresAt ? (
                      <span className={styles.detailMeta}>
                        {copy.invitationExpires(
                          formatCompanyTeamApplicationDate(
                            selected.invitationExpiresAt,
                            locale,
                          ),
                        )}
                      </span>
                    ) : null}
                  </div>
                  {selected.invitationEmailStatus === "DEAD" ? (
                    <p className={styles.error} role="alert">
                      {copy.deliveryFailedDescription}
                    </p>
                  ) : null}
                  {reviewable || retryable ? (
                    <div className={styles.decisionForm}>
                      <label className={styles.field}>
                        {copy.invitationRole}
                        <select
                          className={styles.roleSelect}
                          value={role}
                          onChange={(event) =>
                            setRole(event.target.value as TeamRole)
                          }
                          disabled={busy || retryable}
                        >
                          <option value="HR_MANAGER">
                            {copy.roleLabel("HR_MANAGER")}
                          </option>
                          <option value="RECRUITER">
                            {copy.roleLabel("RECRUITER")}
                          </option>
                        </select>
                      </label>
                      {reviewable ? (
                        <label className={styles.field}>
                          {copy.optionalRejectionReason}
                          <textarea
                            className={styles.reason}
                            value={reason}
                            maxLength={2000}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder={copy.rejectionPlaceholder}
                          />
                        </label>
                      ) : null}
                      <div className={styles.detailActions}>
                        <button
                          className={styles.button}
                          type="button"
                          disabled={busy}
                          onClick={() => requestDecision("accept")}
                        >
                          {busy
                            ? copy.working
                            : retryable
                              ? copy.retryInvitationEmail
                              : copy.acceptAndInvite}
                        </button>
                        {reviewable ? (
                          <button
                            className={`${styles.button} ${styles.danger}`}
                            type="button"
                            disabled={busy}
                            onClick={() => requestDecision("reject")}
                          >
                            {copy.rejectApplication}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                <strong>{copy.selectApplication}</strong>
                <p>{copy.chooseCandidate}</p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className={styles.empty} role="status">
          <strong>
            {companyScope
              ? total
                ? copy.noMatchingApplications
                : copy.noApplications
              : copy.allCompanies}
          </strong>
          <p>
            {companyScope
              ? total
                ? copy.noMatchingApplications
                : copy.noApplicationsDescription
              : copy.chooseCompany}
          </p>
        </div>
      )}
      {companyScope && nextCursor && hasMore ? (
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
      {pendingDecision && selected ? (
        <div className={styles.dialogBackdrop}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-application-decision-title"
          >
            <h2 id="team-application-decision-title">
              {copy.confirmDecisionTitle}
            </h2>
            <p>
              {pendingDecision === "accept"
                ? copy.confirmAccept(
                    copy.roleLabel(role),
                    selected.candidateName,
                  )
                : copy.confirmReject(selected.candidateName)}
            </p>
            <div className={styles.dialogActions}>
              <button
                className={`${styles.button} ${styles.secondary}`}
                type="button"
                disabled={busy}
                onClick={() => setPendingDecision(null)}
              >
                {copy.cancelDecision}
              </button>
              <button
                className={`${styles.button} ${pendingDecision === "reject" ? styles.danger : ""}`}
                type="button"
                disabled={busy}
                onClick={() => void decide(pendingDecision)}
              >
                {busy
                  ? copy.working
                  : pendingDecision === "accept"
                    ? copy.confirmAcceptAction
                    : copy.confirmRejectAction}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
