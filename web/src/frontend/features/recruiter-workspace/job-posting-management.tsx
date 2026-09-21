"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/frontend/components/layout/page-header";
import { Badge } from "@/frontend/components/ui/badge";
import { Modal } from "@/frontend/components/ui/modal";
import {
  WorkspaceNavIcon,
  type WorkspaceNavIconName,
} from "@/frontend/features/dashboard/components/workspace-navigation-icons";
import { CompanyAvatar } from "@/frontend/features/jobs/components/company-avatar";
import { JobPostingEditor } from "./job-posting-editor";
import { CandidateRankingList } from "@/frontend/features/recruiter-applications/candidate-ranking-list";
import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import {
  createEmptyJobPosting,
  recruiterJobStatusMeta,
  type RecruiterCompanyView,
  type RecruiterJob,
  type RecruiterJobManagementData,
  type RecruiterJobStatus,
} from "@/shared/contracts/recruiter-job-posting";
import type { JobCatalogItem } from "@/shared/contracts/jobs/catalog";
import { collectRecruiterSubIndustrySuggestions } from "@/shared/contracts/jobs/industry-taxonomy";
import {
  recruiterRoutes,
  type RecruiterJobPostingTab,
} from "@/shared/routing/recruiter-routes";
import { RecruiterCompanyFilter } from "./recruiter-company-filter";
import {
  companyMatchesScope,
  useRecruiterCompanyScope,
} from "./recruiter-company-scope";
import {
  recruiterWorkspaceCopy,
  type RecruiterWorkspaceCopy,
} from "./recruiter-workspace-copy";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";

const tabs: Array<{
  value: RecruiterJobPostingTab;
  label: string;
}> = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "closed", label: "Closed" },
];

const emptyData: RecruiterJobManagementData = {
  jobs: [],
  companies: [],
  companyId: null,
};

// The API response is cached briefly and refreshes on focus/visibility and
// after mutations. A longer background interval avoids repeatedly parsing the
// large split catalogue while the recruiter is idle on this screen.
const JOB_POSTINGS_REFRESH_INTERVAL_MS = 15_000;

async function fetchRecruiterJobManagementData() {
  const response = await fetch("/api/recruiter/job-postings", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to load job postings.");
  return response.json() as Promise<RecruiterJobManagementData>;
}

function Icon({
  name,
}: {
  name:
    | "briefcase"
    | "users"
    | "clock"
    | "check"
    | "warning"
    | "calendar"
    | "search"
    | "chevron-down"
    | "plus"
    | "arrow"
    | "edit"
    | "close"
    | "lock"
    | "trash"
    | "undo";
}) {
  const paths = {
    briefcase: (
      <>
        <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        <rect width="20" height="14" x="2" y="6" rx="2" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
    calendar: (
      <>
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <line x1="16" x2="16" y1="2" y2="6" />
        <line x1="8" x2="8" y1="2" y2="6" />
        <line x1="3" x2="21" y1="10" y2="10" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    edit: (
      <>
        <path d="m5 16-.8 4 4-.8L19 8.4a2.8 2.8 0 0 0-4-4L5 16Z" />
        <path d="m13.5 6.5 4 4" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    trash: (
      <>
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6" />
        <path d="M10 11v5M14 11v5" />
      </>
    ),
    undo: (
      <>
        <path d="M9 7 4 12l5 5" />
        <path d="M4 12h9a7 7 0 0 1 7 7" />
      </>
    ),
    lock: (
      <>
        <rect width="16" height="12" x="4" y="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    warning: (
      <>
        <path d="M12 2 2 19.5h20L12 2z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
  } as const;
  return (
    <svg className="recruiter-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function formatRelative(
  value: string,
  copy: RecruiterWorkspaceCopy["jobManagement"],
) {
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  const days = Math.floor(delta / 86_400_000);
  if (days === 0) return copy.today;
  if (days === 1) return copy.dayAgo;
  if (days < 30) return copy.daysAgo(days);
  const months = Math.floor(days / 30);
  return months === 1 ? copy.monthAgo : copy.monthsAgo(months);
}

function locationLabel(
  job: RecruiterJob,
  copy: RecruiterWorkspaceCopy["jobManagement"],
) {
  return (
    [job.location.city, job.location.district].filter(Boolean).join(", ") ||
    copy.locationNotSet
  );
}

function arrangementLabel(
  job: RecruiterJob,
  copy: RecruiterWorkspaceCopy["jobManagement"],
) {
  const key = job.workArrangement.toUpperCase().replace("-", "_");
  return (
    copy.arrangements[key as keyof typeof copy.arrangements] ??
    job.workArrangement
  );
}

function isClosingSoon(job: RecruiterJob) {
  if (job.status !== "active" || !job.applyDeadline) return false;
  const remaining = new Date(job.applyDeadline).getTime() - Date.now();
  return remaining >= 0 && remaining <= 7 * 86_400_000;
}

function formatReasonCode(
  code: string,
  copy: RecruiterWorkspaceCopy["jobManagement"],
): string {
  return (
    copy.reasonLabels[code as keyof typeof copy.reasonLabels] ||
    code.replace(/_/g, " ")
  );
}

function statusForTab(job: RecruiterJob, tab: (typeof tabs)[number]["value"]) {
  return tab === "draft"
    ? job.status === "draft" || job.status === "rejected"
    : job.status === tab;
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: "briefcase" | "users" | "clock" | "calendar";
  tone: string;
}) {
  return (
    <article className={`recruiter-stat-card recruiter-stat-card--${tone}`}>
      <span className="recruiter-feature-icon">
        <Icon name={icon} />
      </span>
      <div>
        <strong>{value.toLocaleString("en-US")}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: RecruiterJobStatus }) {
  const copy = recruiterWorkspaceCopy(useWorkspaceLocale()).jobManagement;
  const meta = recruiterJobStatusMeta[status];
  return (
    <Badge tone={meta.tone}>
      {copy.statuses[status as keyof typeof copy.statuses] ?? meta.label}
    </Badge>
  );
}

type JobActionConfirmation = {
  kind: "close" | "reactivate" | "delete" | "withdraw";
  job: RecruiterJob;
};

function JobActionConfirmationDialog({
  confirmation,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  confirmation: JobActionConfirmation;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = recruiterWorkspaceCopy(useWorkspaceLocale()).jobManagement;
  const { job, kind } = confirmation;
  const closing = kind === "close";
  const reactivating = kind === "reactivate";
  const activeDelete = kind === "delete" && job.status === "active";
  const title = closing
    ? copy.confirm.closeTitle
    : reactivating
      ? copy.confirm.reactivateTitle
      : kind === "withdraw"
        ? copy.confirm.withdrawTitle
        : activeDelete
          ? copy.confirm.deleteActiveTitle
          : copy.confirm.deleteDraftTitle;
  const confirmLabel = closing
    ? copy.confirm.closeLabel
    : reactivating
      ? copy.confirm.reactivateLabel
      : kind === "withdraw"
        ? copy.confirm.withdrawLabel
        : activeDelete
          ? copy.confirm.deleteActiveLabel
          : copy.confirm.deleteDraftLabel;
  const description = closing
    ? copy.confirm.closeDescription
    : reactivating
      ? copy.confirm.reactivateDescription
      : kind === "withdraw"
        ? copy.confirm.withdrawDescription
        : activeDelete
          ? copy.confirm.deleteActiveDescription
          : copy.confirm.deleteDraftDescription;

  return (
    <Modal
      open
      title={title}
      description={description}
      tone={closing || kind === "delete" ? "destructive" : "standard"}
      busy={busy}
      icon={
        <Icon
          name={
            closing
              ? "lock"
              : reactivating
                ? "undo"
                : kind === "delete"
                  ? "trash"
                  : "undo"
          }
        />
      }
      className="recruiter-job-confirm-modal"
      onClose={onCancel}
    >
      <strong className="recruiter-confirm-dialog__job">
        {job.title || copy.untitled}
      </strong>
      {error ? (
        <p className="recruiter-confirm-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sh-modal-actions">
        <button
          type="button"
          className="recruiter-outline-button"
          disabled={busy}
          onClick={onCancel}
          data-autofocus
        >
          {copy.confirm.cancel}
        </button>
        <button
          type="button"
          className={
            closing || kind === "delete"
              ? "recruiter-primary-button recruiter-primary-button--danger"
              : "recruiter-primary-button"
          }
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? copy.confirm.processing : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function JobPostingCard({
  job,
  onEdit,
  onApplicants,
  onClose,
  onReactivate,
  onExtend,
  onDelete,
  onWithdraw,
  actionPending,
}: {
  job: RecruiterJob;
  onEdit: () => void;
  onApplicants: () => void;
  onClose: () => void;
  onReactivate: () => void;
  onExtend: () => void;
  onDelete: () => void;
  onWithdraw: () => void;
  actionPending: boolean;
}) {
  const copy = recruiterWorkspaceCopy(useWorkspaceLocale()).jobManagement;
  const title = job.title || copy.untitled;
  return (
    <article
      className="recruiter-job-card"
      aria-labelledby={`recruiter-job-${job.id}`}
    >
      <div className="recruiter-job-card__header">
        <div className="recruiter-job-card__company">
          <CompanyAvatar
            name={job.company.name}
            imageUrl={job.company.logo}
            size="sm"
          />
          <div>
            <strong>{job.company.name}</strong>
            <span>{copy.updated(formatRelative(job.updatedAt, copy))}</span>
          </div>
        </div>
        <StatusPill status={job.status} />
      </div>
      <div className="recruiter-job-card__body">
        <h2 id={`recruiter-job-${job.id}`}>{title}</h2>
        <p className="recruiter-job-card__meta">
          {job.description.generalInfo.department ||
            job.categoryFamily ||
            copy.noDepartment}
          <span aria-hidden="true">|</span>
          {locationLabel(job, copy)}
          <span aria-hidden="true">|</span>
          {arrangementLabel(job, copy)}
        </p>
        {job.review ? (
          <>
            <p
              className={`recruiter-review-state recruiter-review-state--${job.review.state.toLowerCase()}`}
              role="status"
              aria-live="polite"
            >
              <Icon
                name={
                  job.review.state === "APPROVED"
                    ? "check"
                    : job.review.state === "REJECTED"
                      ? "warning"
                      : "clock"
                }
                aria-hidden="true"
              />
              <strong>
                {copy.reviewVersion(
                  job.review.sequence,
                  copy.reviewStates[
                    job.review.state as keyof typeof copy.reviewStates
                  ] ?? job.review.state.replace("_", " "),
                )}
              </strong>
              {job.review.readOnly ? copy.reviewLocked : null}
            </p>
            {job.review.state === "REJECTED" && job.review.reasonCode ? (
              <div
                className="recruiter-review-feedback"
                role="region"
                aria-label={copy.rejectionFeedback}
              >
                <p className="recruiter-review-feedback__reason">
                  <strong>
                    {formatReasonCode(job.review.reasonCode, copy)}
                  </strong>
                </p>
                {job.review.publicExplanation ? (
                  <p className="recruiter-review-feedback__explanation">
                    {job.review.publicExplanation}
                  </p>
                ) : null}
                <p className="recruiter-review-feedback__guidance">
                  {copy.reviseAndResubmit}
                </p>
              </div>
            ) : null}
            {job.review.state === "APPROVED" ? (
              <p className="recruiter-review-approved-note" role="status">
                {job.status === "closed"
                  ? copy.approvedClosed
                  : copy.approvedVisible}
              </p>
            ) : null}
          </>
        ) : null}
        {job.correctionRequest ? (
          <div
            className="recruiter-review-feedback"
            role="region"
            aria-label={copy.correctionRequest}
          >
            <p className="recruiter-review-feedback__reason">
              <strong>{copy.correctionRequest}</strong>
            </p>
            <p className="recruiter-review-feedback__explanation">
              {job.correctionRequest.publicExplanation}
            </p>
            <p className="recruiter-review-feedback__guidance">
              {copy.correctionGuidance}
            </p>
          </div>
        ) : null}
        <div className="recruiter-job-card__chips" aria-label={copy.skills}>
          {job.skillTags.slice(0, 6).map((skill) => (
            <span className="recruiter-skill-chip" key={skill}>
              {skill}
            </span>
          ))}
        </div>
      </div>
      <footer className="recruiter-job-card__footer">
        <button
          type="button"
          className="recruiter-applicant-link"
          aria-label={copy.applicantsFor(job.stats.applicantCount, title)}
          onClick={onApplicants}
        >
          <Icon name="users" />
          <strong>{job.stats.applicantCount.toLocaleString("en-US")}</strong>
          <span>{copy.applicants}</span>
          <Icon name="arrow" />
        </button>
        <Link
          href={recruiterRoutes.pipelineForJob(job.id)}
          className="recruiter-applicant-link recruiter-applicant-link--pipeline"
          aria-label={copy.viewPipelineFor(title)}
        >
          <WorkspaceNavIcon name="pipeline" />
          <span>{copy.viewPipeline}</span>
          <Icon name="arrow" />
        </Link>
        <div className="recruiter-job-card__actions">
          <button
            type="button"
            className="recruiter-outline-button"
            onClick={onEdit}
            aria-label={
              job.status === "rejected"
                ? copy.reviseRejectedFor(title)
                : job.status === "pending_approval"
                  ? copy.viewUnderReviewFor(title)
                  : job.status === "closed"
                    ? copy.viewClosedFor(title)
                    : copy.editFor(title)
            }
          >
            <Icon name="edit" />
            {job.status === "rejected"
              ? copy.revisePosting
              : job.status === "pending_approval"
                ? copy.viewPosting
                : job.status === "closed"
                  ? copy.viewPosting
                  : copy.editPosting}
          </button>
          {job.status === "active" ? (
            <>
              <button
                type="button"
                className="recruiter-outline-button recruiter-outline-button--danger"
                onClick={onDelete}
                disabled={actionPending}
              >
                <Icon name="trash" />
                {copy.deleteJob}
              </button>
              <button
                type="button"
                className="recruiter-primary-button"
                onClick={isClosingSoon(job) ? onExtend : onClose}
                disabled={actionPending}
              >
                {isClosingSoon(job) ? copy.extendDeadline : copy.closeEarly}
              </button>
            </>
          ) : null}
          {job.status === "draft" || job.status === "rejected" ? (
            <button
              type="button"
              className="recruiter-outline-button recruiter-outline-button--danger"
              onClick={onDelete}
              disabled={actionPending}
            >
              <Icon name="trash" />
              {copy.deleteDraft}
            </button>
          ) : null}
          {job.status === "pending_approval" ? (
            <button
              type="button"
              className="recruiter-outline-button"
              onClick={onWithdraw}
              disabled={actionPending}
            >
              <Icon name="undo" />
              {copy.withdrawToDraft}
            </button>
          ) : null}
          {job.status === "closed" ? (
            <button
              type="button"
              className="recruiter-primary-button"
              onClick={onReactivate}
              disabled={actionPending}
            >
              <Icon name="undo" />
              {copy.reactivate}
            </button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

function JobListSkeleton() {
  const copy = recruiterWorkspaceCopy(useWorkspaceLocale()).jobManagement;
  return (
    <div
      className="recruiter-job-list recruiter-job-list--skeleton"
      role="status"
      aria-label={copy.jobPostings}
    >
      {[1, 2, 3].map((item) => (
        <div className="recruiter-skeleton-card" key={item}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  hasAnyJobs,
  tab,
  onCreate,
}: {
  hasAnyJobs: boolean;
  tab: (typeof tabs)[number]["value"];
  onCreate: () => void;
}) {
  const copy = recruiterWorkspaceCopy(useWorkspaceLocale()).jobManagement;
  const empty = hasAnyJobs ? copy.empty[tab] : copy.empty.first;
  return (
    <section className="recruiter-empty-state">
      <span className="recruiter-empty-state__icon">
        <Icon name="briefcase" />
      </span>
      <div>
        <h2>{empty[0]}</h2>
        <p>{empty[1]}</p>
      </div>
      <button
        type="button"
        className="recruiter-primary-button"
        onClick={onCreate}
      >
        <Icon name="plus" />
        {hasAnyJobs ? copy.createNext : copy.createFirst}
      </button>
    </section>
  );
}

function CompanyRequiredState() {
  const copy = recruiterWorkspaceCopy(useWorkspaceLocale()).jobManagement;
  return (
    <section className="recruiter-empty-state recruiter-company-required">
      <span className="recruiter-empty-state__icon">
        <Icon name="briefcase" />
      </span>
      <div>
        <h2>{copy.companySetupRequired}</h2>
        <p>{copy.companySetupDescription}</p>
      </div>
      <a
        className="recruiter-primary-button"
        href="/dashboard/employer-verification"
      >
        {copy.setupCompany}
      </a>
    </section>
  );
}

function CompanyProfileRequiredState({
  missingFields,
}: {
  missingFields: Array<"name" | "industry" | "size" | "address" | "logo">;
}) {
  const workspaceCopy = recruiterWorkspaceCopy(useWorkspaceLocale());
  const copy = workspaceCopy.jobManagement;
  const labels: Record<(typeof missingFields)[number], string> = {
    name: workspaceCopy.companyName,
    industry: workspaceCopy.industry,
    size: workspaceCopy.companySize,
    address: workspaceCopy.address,
    logo: workspaceCopy.logo,
  };
  return (
    <section className="recruiter-company-required">
      <span
        className="recruiter-company-required__illustration"
        aria-hidden="true"
      >
        <Icon name="briefcase" />
        <span className="recruiter-company-required__lock">
          <Icon name="lock" />
        </span>
      </span>
      <div className="recruiter-company-required__content">
        <span className="recruiter-company-required__eyebrow">
          {copy.profileActionRequired}
        </span>
        <h2>{copy.completeProfile}</h2>
        <p>{copy.profileLocked}</p>
        <ul className="recruiter-company-required__list">
          {missingFields.map((field) => (
            <li key={field}>
              <Icon name="warning" />
              <span>{labels[field]}</span>
            </li>
          ))}
        </ul>
      </div>
      <Link
        className="recruiter-company-required__action"
        href="/recruiter/company-settings?required=profile"
      >
        {copy.openCompanySettings}
        <Icon name="arrow" />
      </Link>
    </section>
  );
}

function withCompany(
  job: JobCatalogItem,
  companies: RecruiterCompanyView[],
): RecruiterJob {
  const company =
    companies.find((item) => item.id === job.companyId) ?? companies[0];
  if (!company) {
    throw new Error("Company data is required for recruiter jobs.");
  }
  return {
    ...job,
    company,
  };
}

function withCompanyFromState(
  job: JobCatalogItem,
  companies: RecruiterCompanyView[],
  existing?: RecruiterJobManagementData["jobs"],
): RecruiterJob {
  const company =
    existing?.find((item) => item.id === job.id)?.company ??
    companies.find((item) => item.id === job.companyId) ??
    companies[0];
  if (!company) {
    throw new Error("Company data is required for recruiter jobs.");
  }
  return {
    ...job,
    company,
  };
}
export function RecruiterJobPostingManagement({
  initialData,
  initialTab = "active",
  onNavigate,
  onTabChange,
}: {
  initialData?: RecruiterJobManagementData | null;
  initialTab?: RecruiterJobPostingTab;
  onNavigate?: (href: string) => void;
  onTabChange?: (tab: RecruiterJobPostingTab) => void;
} = {}) {
  const locale = useWorkspaceLocale();
  const workspaceCopy = recruiterWorkspaceCopy(locale);
  const copy = workspaceCopy.jobManagement;
  const [data, setData] = useState<RecruiterJobManagementData | null>(
    initialData ?? null,
  );
  const [loading, setLoading] = useState(!initialData);
  const [localActiveTab, setLocalActiveTab] =
    useState<(typeof tabs)[number]["value"]>(initialTab);
  const activeTab = onTabChange ? initialTab : localActiveTab;
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [view, setView] = useState<"dashboard" | "editor" | "applicants">(
    "dashboard",
  );
  const [editorJob, setEditorJob] = useState<RecruiterJob | null>(null);
  const [applicantJob, setApplicantJob] = useState<RecruiterJob | null>(null);
  const [actionPendingJobId, setActionPendingJobId] = useState<string | null>(
    null,
  );
  const [actionError, setActionError] = useState("");
  const [confirmation, setConfirmation] =
    useState<JobActionConfirmation | null>(null);
  const mutationEpoch = useRef(0);
  const csrfProof = useCsrfProof();

  const selectTab = useCallback(
    (tab: RecruiterJobPostingTab) => {
      if (!onTabChange) setLocalActiveTab(tab);
      onTabChange?.(tab);
    },
    [onTabChange],
  );

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    const refresh = async (showLoading = false) => {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;
      const requestEpoch = mutationEpoch.current;
      if (showLoading) setLoading(true);
      try {
        const next = await fetchRecruiterJobManagementData();
        if (!cancelled && requestEpoch === mutationEpoch.current) setData(next);
      } catch {
        // Keep the last known data during background refreshes. If the first
        // request fails, preserve the existing empty-state behavior.
        if (showLoading && !cancelled) setData(emptyData);
      } finally {
        requestInFlight = false;
        if (showLoading && !cancelled) setLoading(false);
      }
    };

    if (!initialData) {
      void refresh(true);
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const intervalId = window.setInterval(
      refreshWhenVisible,
      JOB_POSTINGS_REFRESH_INTERVAL_MS,
    );
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [initialData]);

  const current = data ?? emptyData;
  const { companyId, selectedCompanyId, setCompanyId } =
    useRecruiterCompanyScope(current.companies);
  const scopedJobs = useMemo(
    () =>
      current.jobs.filter((job) =>
        companyMatchesScope(job.companyId, selectedCompanyId),
      ),
    [current.jobs, selectedCompanyId],
  );
  const selectedCompany =
    (selectedCompanyId
      ? current.companies.find((company) => company.id === selectedCompanyId)
      : current.companies.find(
          (company) => company.id === current.companyId,
        )) ?? current.companies[0];
  // In the aggregate view, use a complete company as the default create
  // context so one unfinished profile does not hide another company's
  // existing postings or block its create flow.
  const targetCompany = selectedCompanyId
    ? selectedCompany
    : (current.companies.find((company) => company.profileComplete !== false) ??
      selectedCompany);
  const targetCompanyId = targetCompany?.id ?? current.companyId;
  const companyReady = Boolean(targetCompanyId && current.companies.length);
  const selectedCompanyProfileComplete =
    targetCompany?.profileComplete ?? current.companyProfileComplete;
  const selectedCompanyMissingFields =
    targetCompany?.missingProfileFields ?? current.missingCompanyProfileFields;
  const departments = useMemo(
    () =>
      Array.from(
        new Set(
          scopedJobs
            .map(
              (job) =>
                job.description.generalInfo.department || job.categoryFamily,
            )
            .filter(Boolean),
        ),
      ).sort(),
    [scopedJobs],
  );
  const counts = useMemo(
    () => ({
      active: scopedJobs.filter((job) => job.status === "active").length,
      applicants: scopedJobs.reduce(
        (sum, job) => sum + job.stats.applicantCount,
        0,
      ),
      pending: scopedJobs.filter((job) => job.status === "pending_approval")
        .length,
      closing: scopedJobs.filter(isClosingSoon).length,
    }),
    [scopedJobs],
  );
  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopedJobs
      .filter((job) => statusForTab(job, activeTab))
      .filter(
        (job) =>
          department === "all" ||
          (job.description.generalInfo.department || job.categoryFamily) ===
            department,
      )
      .filter(
        (job) =>
          !query ||
          [
            job.title,
            job.description.generalInfo.department,
            job.categoryFamily,
            job.location.city,
            job.location.district,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [activeTab, department, scopedJobs, search]);
  const subIndustrySuggestions = useMemo(
    () => collectRecruiterSubIndustrySuggestions(current.jobs),
    [current.jobs],
  );
  const openCreate = () => {
    if (selectedCompanyProfileComplete === false) {
      if (onNavigate) {
        onNavigate(
          `/recruiter/company-settings?required=profile&companyId=${encodeURIComponent(targetCompanyId ?? "")}`,
        );
      }
      return;
    }
    if (!targetCompanyId) {
      return;
    }
    if (onNavigate) {
      onNavigate(recruiterRoutes.jobPostingCreateForCompany(targetCompanyId));
      return;
    }
    setEditorJob(
      withCompany(createEmptyJobPosting(targetCompanyId), current.companies),
    );
    setView("editor");
  };
  const openEdit = (job: RecruiterJob) => {
    if (onNavigate) {
      onNavigate(recruiterRoutes.jobPostingEdit(job.id));
      return;
    }
    setEditorJob(job);
    setView("editor");
  };
  const storeSavedJob = useCallback((job: RecruiterJob) => {
    // A background refresh may have started before the PATCH completed. Mark
    // this local save as a newer mutation so that an older GET response cannot
    // overwrite the freshly saved draft in the dashboard.
    mutationEpoch.current += 1;
    setData((currentData) => {
      const next = currentData ?? emptyData;
      const normalizedJob = withCompanyFromState(
        job,
        next.companies,
        next.jobs,
      );
      const exists = next.jobs.some((item) => item.id === job.id);
      return {
        ...next,
        jobs: exists
          ? next.jobs.map((item) =>
              item.id === normalizedJob.id ? normalizedJob : item,
            )
          : [normalizedJob, ...next.jobs],
      };
    });
  }, []);
  const receiveSavedJob = useCallback(
    (job: RecruiterJob) => {
      storeSavedJob(job);
      setView("dashboard");
      selectTab(
        job.status === "pending_approval"
          ? "pending_approval"
          : job.status === "closed"
            ? "closed"
            : job.status === "rejected"
              ? "draft"
              : job.status,
      );
    },
    [selectTab, storeSavedJob],
  );
  const closeJob = async (job: RecruiterJob) => {
    setActionError("");
    setActionPendingJobId(job.id);
    mutationEpoch.current += 1;
    try {
      const response = await fetch(
        "/api/recruiter/job-postings?jobId=" +
          encodeURIComponent(job.id) +
          "&industryCode=" +
          encodeURIComponent(job.industryCode),
        {
          method: "DELETE",
          headers: { "x-csrf-token": csrfProof },
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | (JobCatalogItem & { message?: string })
        | null;
      if (!response.ok || !payload) {
        setActionError(copy.errors.close);
        return false;
      }
      receiveSavedJob(
        withCompanyFromState(payload, current.companies, current.jobs),
      );
      return true;
    } catch {
      setActionError(copy.errors.close);
      return false;
    } finally {
      setActionPendingJobId(null);
    }
  };

  const reactivateJob = async (job: RecruiterJob) => {
    setActionError("");
    setActionPendingJobId(job.id);
    mutationEpoch.current += 1;
    try {
      const response = await fetch(
        `/api/recruiter/job-postings/${encodeURIComponent(job.id)}/reactivate?industryCode=${encodeURIComponent(job.industryCode)}`,
        {
          method: "POST",
          headers: { "x-csrf-token": csrfProof },
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | (JobCatalogItem & { message?: string })
        | null;
      if (!response.ok || !payload) {
        setActionError(copy.errors.reactivate);
        return false;
      }
      receiveSavedJob(
        withCompanyFromState(payload, current.companies, current.jobs),
      );
      return true;
    } catch {
      setActionError(copy.errors.reactivate);
      return false;
    } finally {
      setActionPendingJobId(null);
    }
  };

  const deleteJob = async (job: RecruiterJob) => {
    setActionError("");
    setActionPendingJobId(job.id);
    mutationEpoch.current += 1;
    try {
      const response = await fetch(
        "/api/recruiter/job-postings?jobId=" +
          encodeURIComponent(job.id) +
          "&action=delete&industryCode=" +
          encodeURIComponent(job.industryCode),
        {
          method: "DELETE",
          headers: { "x-csrf-token": csrfProof },
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        deleted?: boolean;
        message?: string;
      } | null;
      if (!response.ok || !payload?.deleted) {
        setActionError(copy.errors.delete);
        return false;
      }
      mutationEpoch.current += 1;
      setData((currentData) => {
        const next = currentData ?? emptyData;
        return {
          ...next,
          jobs: next.jobs.filter((item) => item.id !== job.id),
        };
      });
      return true;
    } catch {
      setActionError(copy.errors.delete);
      return false;
    } finally {
      setActionPendingJobId(null);
    }
  };

  const withdrawJob = async (job: RecruiterJob) => {
    setActionError("");
    setActionPendingJobId(job.id);
    mutationEpoch.current += 1;
    try {
      const response = await fetch(
        `/api/recruiter/job-postings/${encodeURIComponent(job.id)}/withdraw-review?industryCode=${encodeURIComponent(job.industryCode)}`,
        {
          method: "POST",
          headers: { "x-csrf-token": csrfProof },
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | (JobCatalogItem & { message?: string })
        | null;
      if (!response.ok || !payload) {
        setActionError(copy.errors.withdraw);
        return false;
      }
      const normalizedJob = withCompanyFromState(
        payload,
        current.companies,
        current.jobs,
      );
      mutationEpoch.current += 1;
      setData((currentData) => {
        const next = currentData ?? emptyData;
        return {
          ...next,
          jobs: next.jobs.map((item) =>
            item.id === normalizedJob.id ? normalizedJob : item,
          ),
        };
      });
      setView("dashboard");
      selectTab("draft");
      return true;
    } catch {
      setActionError(copy.errors.withdraw);
      return false;
    } finally {
      setActionPendingJobId(null);
    }
  };

  const extendJob = async (job: RecruiterJob) => {
    const base = new Date(job.applyDeadline ?? job.updatedAt);
    base.setUTCDate(base.getUTCDate() + 30);
    const response = await fetch("/api/recruiter/job-postings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfProof,
      },
      body: JSON.stringify({
        ...job,
        status: "active",
        applyDeadline: base.toISOString(),
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | (JobCatalogItem & { message?: string })
      | null;
    if (!response.ok || !payload) {
      return;
    }
    receiveSavedJob(
      withCompanyFromState(payload, current.companies, current.jobs),
    );
  };
  if (view === "editor" && editorJob)
    return (
      <JobPostingEditor
        initialJob={editorJob}
        companyName={targetCompany?.name ?? workspaceCopy.company}
        autoSavePreferenceScope={
          current.recruiterUserId ?? current.companyId ?? undefined
        }
        jobTaxonomy={current.jobTaxonomy}
        subIndustrySuggestions={subIndustrySuggestions}
        onBack={() => setView("dashboard")}
        onDraftAutoSaved={storeSavedJob}
        onSaved={receiveSavedJob}
      />
    );
  if (view === "applicants" && applicantJob)
    return (
      <CandidateRankingList
        jobId={applicantJob.id}
        jobTitle={applicantJob.title}
        onBack={() => setView("dashboard")}
        pipelineHref={recruiterRoutes.pipelineForJob(applicantJob.id)}
      />
    );

  if (!loading && selectedCompanyProfileComplete === false) {
    return (
      <div className="recruiter-management">
        <PageHeader
          className="recruiter-management__page-header"
          eyebrow={workspaceCopy.navigation.workspace}
          title={copy.jobPostings}
          subtitle={workspaceCopy.jobManagement.profileLocked}
          rightSlot={
            <button
              type="button"
              className="recruiter-primary-button"
              onClick={openCreate}
            >
              <Icon name="plus" />
              {copy.create}
            </button>
          }
        />
        {current.companies.length > 1 ? (
          <div className="recruiter-filter-panel recruiter-surface-card recruiter-profile-scope-filter recruiter-filter-panel--with-company">
            <RecruiterCompanyFilter
              companies={current.companies}
              value={companyId}
              onChange={setCompanyId}
              id="recruiter-job-postings-company-required"
            />
          </div>
        ) : null}
        <CompanyProfileRequiredState
          missingFields={
            selectedCompanyMissingFields ?? [
              "name",
              "industry",
              "size",
              "address",
              "logo",
            ]
          }
        />
      </div>
    );
  }
  if (!loading && !companyReady) {
    return (
      <div className="recruiter-management">
        <PageHeader
          className="recruiter-management__page-header"
          eyebrow={workspaceCopy.navigation.workspace}
          title={copy.jobPostings}
          subtitle={copy.subtitle}
          rightSlot={
            <button
              type="button"
              className="recruiter-primary-button"
              disabled
              title={copy.companySetupRequired}
            >
              <Icon name="plus" />
              {copy.create}
            </button>
          }
        />
        <CompanyRequiredState />
      </div>
    );
  }
  return (
    <div className="recruiter-management">
      <PageHeader
        className="recruiter-management__page-header"
        eyebrow={workspaceCopy.navigation.workspace}
        title={copy.jobPostings}
        subtitle={copy.subtitle}
        rightSlot={
          <button
            type="button"
            className="recruiter-primary-button"
            onClick={openCreate}
          >
            <Icon name="plus" />
            {copy.create}
          </button>
        }
      />
      <section className="recruiter-stat-strip" aria-label={copy.overview}>
        <StatCard
          label={copy.stats.active}
          value={counts.active}
          icon="briefcase"
          tone="blue"
        />
        <StatCard
          label={copy.stats.applicants}
          value={counts.applicants}
          icon="users"
          tone="teal"
        />
        <StatCard
          label={copy.stats.pending}
          value={counts.pending}
          icon="clock"
          tone="amber"
        />
        <StatCard
          label={copy.stats.closing}
          value={counts.closing}
          icon="calendar"
          tone="violet"
        />
      </section>
      <section className="recruiter-list-section">
        <div className="recruiter-section-heading">
          <div>
            <p className="recruiter-eyebrow">{copy.yourOpenings}</p>
            <h2>{copy.trackPipeline}</h2>
          </div>
          <span className="recruiter-live-status">
            <span />
            {copy.liveApplicantCounts}
          </span>
        </div>
        <nav
          className="recruiter-tabs"
          role="tablist"
          aria-label={copy.overview}
        >
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`recruiter-job-tab-${tab.value}`}
              aria-selected={activeTab === tab.value}
              aria-controls="recruiter-job-postings-panel"
              className={activeTab === tab.value ? "is-active" : ""}
              onClick={() => selectTab(tab.value)}
            >
              {copy.tabs[tab.value]}
              <span>
                {
                  scopedJobs.filter((job) => statusForTab(job, tab.value))
                    .length
                }
              </span>
            </button>
          ))}
        </nav>
        <div
          className={`recruiter-filter-panel recruiter-surface-card${current.companies.length > 1 ? "recruiter-filter-panel--with-company" : ""}`}
        >
          <label htmlFor="recruiter-job-postings-search">
            <span>{copy.searchPostings}</span>
            <div className="recruiter-input-with-icon">
              <Icon name="search" />
              <input
                id="recruiter-job-postings-search"
                name="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
              />
            </div>
          </label>
          <label htmlFor="recruiter-job-postings-department">
            <span>{copy.department}</span>
            <div className="recruiter-select-with-icon">
              <select
                id="recruiter-job-postings-department"
                name="department"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
              >
                <option value="all">{copy.allDepartments}</option>
                {departments.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" />
            </div>
          </label>
          <RecruiterCompanyFilter
            companies={current.companies}
            value={companyId}
            onChange={setCompanyId}
            id="recruiter-job-postings-company"
          />
        </div>
        <div
          id="recruiter-job-postings-panel"
          role="tabpanel"
          aria-labelledby={`recruiter-job-tab-${activeTab}`}
          aria-live="polite"
          aria-busy={loading}
        >
          {loading ? (
            <JobListSkeleton />
          ) : filteredJobs.length ? (
            <div className="recruiter-job-list">
              {filteredJobs.map((job) => (
                <JobPostingCard
                  key={job.id}
                  job={job}
                  onEdit={() => openEdit(job)}
                  onApplicants={() => {
                    if (onNavigate) {
                      onNavigate(recruiterRoutes.candidateRanking(job.id));
                      return;
                    }
                    setApplicantJob(job);
                    setView("applicants");
                  }}
                  onClose={() => {
                    setActionError("");
                    setConfirmation({ kind: "close", job });
                  }}
                  onReactivate={() => {
                    setActionError("");
                    setConfirmation({ kind: "reactivate", job });
                  }}
                  onExtend={() => void extendJob(job)}
                  onDelete={() => {
                    setActionError("");
                    setConfirmation({ kind: "delete", job });
                  }}
                  onWithdraw={() => {
                    setActionError("");
                    setConfirmation({ kind: "withdraw", job });
                  }}
                  actionPending={actionPendingJobId === job.id}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              hasAnyJobs={scopedJobs.length > 0}
              tab={activeTab}
              onCreate={openCreate}
            />
          )}
        </div>
      </section>
      {confirmation ? (
        <JobActionConfirmationDialog
          confirmation={confirmation}
          busy={actionPendingJobId === confirmation.job.id}
          error={actionError}
          onCancel={() => {
            setActionError("");
            setConfirmation(null);
          }}
          onConfirm={() => {
            const operation =
              confirmation.kind === "close"
                ? closeJob(confirmation.job)
                : confirmation.kind === "reactivate"
                  ? reactivateJob(confirmation.job)
                  : confirmation.kind === "delete"
                    ? deleteJob(confirmation.job)
                    : withdrawJob(confirmation.job);
            void operation.then((completed) => {
              if (completed) setConfirmation(null);
            });
          }}
        />
      ) : null}
    </div>
  );
}

type RecruiterNavIconName = Exclude<
  WorkspaceNavIconName,
  "support" | "profile"
>;

export function RecruiterWorkspaceNavigation({
  collapsed,
  busy,
  onSignOut,
}: {
  collapsed: boolean;
  busy: boolean;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const workspaceCopy = recruiterWorkspaceCopy(useWorkspaceLocale());
  const copy = workspaceCopy.navigation;
  const destinations: Array<{
    label: string;
    icon: Exclude<RecruiterNavIconName, "signout">;
    href?: string;
    active: boolean;
  }> = [
    {
      label: copy.overview,
      icon: "dashboard",
      href: recruiterRoutes.analytics,
      active:
        pathname === recruiterRoutes.analytics ||
        pathname.startsWith(recruiterRoutes.analytics + "/"),
    },
    {
      label: copy.jobs,
      icon: "jobs",
      href: recruiterRoutes.jobPostings,
      active:
        pathname === "/recruiter" ||
        pathname === recruiterRoutes.jobPostings ||
        pathname.startsWith("/recruiter/jobs") ||
        pathname.startsWith(`${recruiterRoutes.jobPostings}/`),
    },
    {
      label: copy.candidates,
      icon: "user-check",
      href: recruiterRoutes.candidates,
      active:
        pathname === recruiterRoutes.candidates ||
        pathname.startsWith(`${recruiterRoutes.candidates}/`),
    },
    {
      label: copy.pipeline,
      icon: "kanban",
      href: recruiterRoutes.pipeline,
      active:
        pathname === recruiterRoutes.pipeline ||
        pathname.startsWith(`${recruiterRoutes.pipeline}/`),
    },
    {
      label: copy.messages,
      icon: "messages",
      href: recruiterRoutes.messages,
      active:
        pathname === recruiterRoutes.messages ||
        pathname.startsWith(`${recruiterRoutes.messages}/`),
    },
    {
      label: copy.settings,
      icon: "building-2",
      href: "/recruiter/company-settings",
      active: pathname === "/recruiter/company-settings",
    },
  ];
  return (
    <nav
      className="workspace-navigation recruiter-workspace-navigation"
      id="recruiter-workspace-navigation"
      aria-label={copy.workspace}
    >
      <span className="workspace-sidebar-width-sizer" aria-hidden="true">
        {destinations.map((item) => (
          <span key={item.label}>{item.label}</span>
        ))}
      </span>
      <p className="workspace-nav-label">{copy.workspace}</p>
      <div className="workspace-navigation-scroll">
        {destinations.map((item) => {
          const content = (
            <>
              <WorkspaceNavIcon name={item.icon} />
              <span className="workspace-navigation-label">{item.label}</span>
              {!item.href ? (
                <span className="recruiter-nav-soon">{copy.soon}</span>
              ) : null}
            </>
          );
          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              {content}
            </Link>
          ) : (
            <button
              key={item.label}
              type="button"
              title={collapsed ? item.label : undefined}
              disabled
            >
              {content}
            </button>
          );
        })}
      </div>
      <div className="workspace-navigation-footer">
        <button
          type="button"
          onClick={onSignOut}
          disabled={busy}
          aria-busy={busy}
        >
          <WorkspaceNavIcon name="signout" />
          <span className="workspace-navigation-label">
            {busy ? copy.signingOut : copy.signOut}
          </span>
        </button>
      </div>
    </nav>
  );
}
