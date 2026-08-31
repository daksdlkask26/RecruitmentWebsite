"use client";

import Link from "next/link";
import { useState } from "react";
import type { JobCard as JobCardData } from "@/shared/contracts/jobs/discovery";
import {
  formatRelativeTime,
  formatSalary,
  isSalaryNegotiable,
} from "@/shared/utils/jobs/job-display";
import { CompanyAvatar } from "./company-avatar";
import { JobMetaIcon } from "./job-meta-icon";
import { QuickViewPanel } from "./quick-view-panel";
import { useOptionalJobInteraction } from "./job-interaction-provider";
import { SaveJobAction } from "./save-job-action";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { jobCopy } from "./job-copy";

export type JobCardVariant = "grid" | "row";
export type JobCardTimeMode = "posted" | "updated";

function timeLabel(
  job: JobCardData,
  timeMode: JobCardTimeMode,
  locale: "vi" | "en",
) {
  const value =
    timeMode === "updated"
      ? (job.updatedAt ?? job.publishedAt)
      : job.publishedAt;
  const copy = jobCopy(locale);
  return (
    (timeMode === "updated" ? `${copy.updated} ` : `${copy.posted} `) +
    formatRelativeTime(value, locale)
  );
}

function visibleTagValues(job: JobCardData) {
  return [...job.skills].filter(
    (value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index,
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.8L6 21V4.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </svg>
  );
}

function HideIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 0 2.5 12c1.5 4 5 7 9.5 7 1.2 0 2.3-.2 3.3-.6M14.1 4.8c3.5.8 6.3 3.6 7.4 7.2a12 12 0 0 1-2.1 4.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function QuickViewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle
        cx="12"
        cy="12"
        r="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 7.5v5l3.2 1.8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

const hoverActionClassName =
  "job-icon-button job-card-hover-action transition-[opacity,transform] duration-150";

export function JobCardHeader({
  job,
  timeMode,
}: {
  job: JobCardData;
  timeMode: JobCardTimeMode;
}) {
  const locale = useWorkspaceLocale();
  return (
    <header className="job-card-header job-redesign-card-header">
      <CompanyAvatar
        name={job.company.displayName}
        imageUrl={job.company.logoUrl}
        size="sm"
        className="job-card-avatar"
      />
      <div className="job-card-company-block">
        <p className="job-card-company-name">{job.company.displayName}</p>
      </div>
      <div className="job-card-header-meta">
        <p
          className={
            "job-salary" +
            (isSalaryNegotiable(job.salary) ? " job-salary--negotiable" : "")
          }
        >
          {formatSalary(job.salary, locale)}
        </p>
        <p className="job-card-timing">
          <span className="job-card-timing-icon" aria-hidden="true">
            <ClockIcon />
          </span>
          <time
            dateTime={
              timeMode === "updated"
                ? (job.updatedAt ?? job.publishedAt)
                : job.publishedAt
            }
          >
            {timeLabel(job, timeMode, locale)}
          </time>
        </p>
      </div>
    </header>
  );
}

export function JobCardBody({ job }: { job: JobCardData }) {
  const locale = useWorkspaceLocale();
  const copy = jobCopy(locale);
  const tagValues = visibleTagValues(job);
  const secondaryTags = [
    copy.employmentTypeLabels[job.employmentType] ?? job.employmentType,
    copy.experienceLevelLabels[job.experienceLevel] ?? job.experienceLevel,
  ];
  const visibleTags = [...secondaryTags, ...tagValues].slice(0, 3);

  return (
    <div className="job-card-body">
      <h2 id={"job-" + job.id} className="job-card-title">
        <Link href={"/jobs/" + job.slug}>{job.title}</Link>
      </h2>
      <p className="job-card-location">
        <JobMetaIcon name="location" aria-hidden="true" />
        <span>{job.location}</span>
      </p>
      <div className="job-card-tags" aria-label={copy.jobTags}>
        {visibleTags.map((tag, index) => (
          <span
            className={
              "job-card-tag " +
              (index < secondaryTags.length
                ? "job-card-tag--neutral"
                : "job-card-tag--skill")
            }
            key={tag + index}
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function SignInApplyLink({ job }: { job: JobCardData }) {
  const copy = jobCopy(useWorkspaceLocale());
  const returnTo = "/jobs/" + job.slug + "/apply";
  return (
    <Link
      className="sh-button job-card-apply-button"
      href={"/login?returnTo=" + encodeURIComponent(returnTo)}
    >
      {copy.apply}
    </Link>
  );
}

export function ApplyButton({ job }: { job: JobCardData }) {
  const locale = useWorkspaceLocale();
  const copy = jobCopy(locale);
  const shared = useOptionalJobInteraction();
  const applied =
    job.actions.applied || Boolean(shared?.records[job.id]?.applied);

  if (applied) {
    return (
      <span role="status" className="job-applied-state">
        {copy.applied}
      </span>
    );
  }

  if (job.actions.applicationLimitReached) {
    const message =
      locale === "vi"
        ? copy.applicationLimitReached
        : (job.actions.applicationLimitMessage ?? copy.applicationLimitReached);
    return (
      <span role="status" aria-label={message} className="job-closed-state">
        {message}
      </span>
    );
  }

  if (!job.actions.canApply) {
    return <span className="job-closed-state">{copy.applicationsClosed}</span>;
  }

  if (!job.actions.authenticated) return <SignInApplyLink job={job} />;

  return (
    <Link
      className="sh-button job-card-apply-button"
      href={"/jobs/" + job.slug + "/apply"}
    >
      {copy.apply}
    </Link>
  );
}

export function SaveButton({ job }: { job: JobCardData }) {
  const copy = jobCopy(useWorkspaceLocale());
  if (job.actions.authenticated && job.actions.canSave) {
    return (
      <SaveJobAction
        jobId={job.id}
        initialSaved={job.actions.saved}
        initialApplied={job.actions.applied}
        variant="icon"
      />
    );
  }

  return (
    <Link
      className="job-icon-button job-heart-button"
      href={"/login?returnTo=" + encodeURIComponent("/jobs/" + job.slug)}
      aria-label={copy.signInToSave}
      title={copy.signInToSave}
    >
      <SaveIcon />
    </Link>
  );
}

export function HideButton({
  jobId,
  onHidden,
}: {
  jobId: string;
  onHidden?: () => void;
}) {
  const copy = jobCopy(useWorkspaceLocale());
  const shared = useOptionalJobInteraction();

  return (
    <button
      className={hoverActionClassName}
      type="button"
      aria-label={copy.hideJob}
      title={copy.hideJob}
      onClick={() => {
        shared?.hideJob(jobId);
        onHidden?.();
      }}
    >
      <HideIcon />
    </button>
  );
}

export function QuickViewButton({ onQuickView }: { onQuickView: () => void }) {
  const copy = jobCopy(useWorkspaceLocale());
  return (
    <button
      className={hoverActionClassName}
      type="button"
      aria-label={copy.quickView}
      title={copy.quickView}
      onClick={onQuickView}
    >
      <QuickViewIcon />
    </button>
  );
}

export function JobCardActions({
  job,
  variant,
  onQuickView,
  onHidden,
}: {
  job: JobCardData;
  variant: JobCardVariant;
  onQuickView?: () => void;
  onHidden?: () => void;
}) {
  const [localQuickViewOpen, setLocalQuickViewOpen] = useState(false);
  const copy = jobCopy(useWorkspaceLocale());
  const openQuickView = () => {
    if (onQuickView) onQuickView();
    else setLocalQuickViewOpen(true);
  };

  return (
    <>
      <footer
        className={
          "job-card-footer job-redesign-card-footer job-card-footer--" + variant
        }
      >
        {variant === "row" ? (
          <div className="job-card-row-actions" aria-label={copy.jobActions}>
            <QuickViewButton onQuickView={openQuickView} />
            <HideButton jobId={job.id} onHidden={onHidden} />
            <SaveButton job={job} />
            <ApplyButton job={job} />
          </div>
        ) : (
          <div className="job-card-grid-actions" aria-label={copy.jobActions}>
            <QuickViewButton onQuickView={openQuickView} />
            <HideButton jobId={job.id} onHidden={onHidden} />
            <SaveButton job={job} />
            <ApplyButton job={job} />
          </div>
        )}
      </footer>

      {!onQuickView ? (
        <QuickViewPanel
          jobs={[job]}
          jobId={localQuickViewOpen ? job.id : null}
          onClose={() => setLocalQuickViewOpen(false)}
          onJobChange={() => setLocalQuickViewOpen(true)}
        />
      ) : null}
    </>
  );
}

export function JobCard({
  job,
  variant = "row",
  timeMode = "posted",
  onQuickView,
  onHidden,
}: {
  job: JobCardData;
  variant?: JobCardVariant;
  timeMode?: JobCardTimeMode;
  onQuickView?: () => void;
  onHidden?: () => void;
}) {
  return (
    <article
      className={"group job-card job-redesign-card job-card--" + variant}
      aria-labelledby={"job-" + job.id}
    >
      <JobCardHeader job={job} timeMode={timeMode} />
      <JobCardBody job={job} />
      <JobCardActions
        job={job}
        variant={variant}
        onQuickView={onQuickView}
        onHidden={onHidden}
      />
    </article>
  );
}

export function JobCardView(props: {
  job: JobCardData;
  variant?: JobCardVariant;
  timeMode?: JobCardTimeMode;
  onQuickView?: () => void;
  onHidden?: () => void;
}) {
  return <JobCard {...props} />;
}
