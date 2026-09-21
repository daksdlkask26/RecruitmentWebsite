"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  MapPin,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import type { JobCard } from "@/shared/contracts/jobs/discovery";
import { formatSalary } from "@/shared/utils/jobs/job-display";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { JobApplicationAction } from "./job-application-form";
import { QuickSkillChips } from "./quick-skill-chips";
import { useOptionalJobInteraction } from "./job-interaction-provider";
import { SaveBookmarkIcon, SaveJobAction } from "./save-job-action";
import { jobWhyHighlights } from "./job-detail-data";
import { CompanyAvatar } from "./company-avatar";
import { jobCopy, jobExperienceLabel } from "./job-copy";
import { useModalA11y } from "@/frontend/components/ui/use-modal-a11y";

export function QuickViewPanel({
  jobs,
  jobId,
  onClose,
  onJobChange,
}: {
  jobs: JobCard[];
  jobId: string | null;
  onClose: () => void;
  onJobChange: (jobId: string) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const locale = useWorkspaceLocale();
  const copy = jobCopy(locale);
  const shared = useOptionalJobInteraction();
  const job = useMemo(
    () => jobs.find((item) => item.id === jobId) ?? null,
    [jobId, jobs],
  );
  const applied = job
    ? job.actions.applied || Boolean(shared?.records[job.id]?.applied)
    : false;
  const applicationLimitMessage =
    locale === "vi"
      ? copy.applicationLimitReached
      : (job?.actions.applicationLimitMessage ?? copy.applicationLimitReached);
  const index = job ? jobs.findIndex((item) => item.id === job.id) : -1;
  const highlights = job ? jobWhyHighlights(job, locale).slice(0, 3) : [];

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && index < jobs.length - 1) {
        event.preventDefault();
        onJobChange(jobs[index + 1]!.id);
      }
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        onJobChange(jobs[index - 1]!.id);
      }
    },
    [index, jobs, onJobChange],
  );
  const dialogRef = useModalA11y<HTMLDivElement>({
    open: Boolean(job),
    onClose,
    initialFocusRef: closeButtonRef,
    onKeyDown: handleKeyDown,
  });

  if (!job) return null;

  return (
    <div
      className="job-quick-view-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="job-quick-view-panel job-quick-view-panel--redesign"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-view-title"
        tabIndex={-1}
      >
        <header className="job-quick-view-header">
          <div>
            <p className="panel-kicker">{copy.quickView}</p>
            <p className="job-quick-view-counter">
              {copy.quickViewCounter(index + 1, jobs.length)}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className="job-icon-button"
            type="button"
            aria-label={copy.closeQuickView}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="job-quick-view-scroll">
          <div className="job-quick-view-company">
            <CompanyAvatar
              name={job.company.displayName}
              imageUrl={job.company.logoUrl}
              size="lg"
              className="job-company-logo is-large"
              loading="eager"
            />
            <div>
              <div className="job-quick-view-company-meta">
                <p className="job-company-name">{job.company.displayName}</p>
                <span className="job-verified-inline">
                  <BadgeCheck aria-hidden="true" /> {copy.verifiedCompany}
                </span>
              </div>
              <h2 id="quick-view-title">{job.title}</h2>
            </div>
          </div>

          <dl className="job-quick-view-meta">
            <div>
              <dt>
                <WalletCards aria-hidden="true" /> {copy.salary}
              </dt>
              <dd
                className={
                  job.salary?.isNegotiable
                    ? "job-salary--negotiable"
                    : undefined
                }
              >
                {formatSalary(job.salary, locale)}
              </dd>
            </div>
            <div>
              <dt>
                <MapPin aria-hidden="true" /> {copy.location}
              </dt>
              <dd>{job.location}</dd>
            </div>
            <div>
              <dt>
                <BriefcaseBusiness aria-hidden="true" /> {copy.experience}
              </dt>
              <dd>{jobExperienceLabel(job.experienceLevel, locale)}</dd>
            </div>
          </dl>

          <section
            className="job-quick-view-block"
            aria-labelledby="quick-skills-heading"
          >
            <div className="job-quick-view-block-heading">
              <p className="panel-kicker" id="quick-skills-heading">
                {copy.requiredSkills}
              </p>
              <CircleHelp aria-hidden="true" />
            </div>
            <QuickSkillChips job={job} compact />
          </section>

          <section
            className="job-quick-view-block"
            aria-labelledby="quick-reasons-heading"
          >
            <div className="job-quick-view-block-heading">
              <h3 id="quick-reasons-heading">
                <Sparkles aria-hidden="true" /> {copy.whyYouWillLoveIt}
              </h3>
            </div>
            <ul className="job-quick-view-reasons">
              {highlights.map((highlight) => (
                <li key={highlight}>
                  <Check aria-hidden="true" />
                  {highlight}
                </li>
              ))}
            </ul>
          </section>

          <Link
            className="job-quick-view-full-link"
            href={"/jobs/" + job.slug}
            onClick={onClose}
          >
            {copy.viewFullJobDetails} <ChevronRight aria-hidden="true" />
          </Link>
        </div>

        <footer className="job-quick-view-footer job-quick-view-footer--redesign">
          <div className="job-quick-view-cta">
            {applied ? (
              <span className="job-applied-state">✓ {copy.applied}</span>
            ) : job.actions.applicationLimitReached ? (
              <span
                role="status"
                aria-label={applicationLimitMessage}
                className="job-closed-state"
              >
                {applicationLimitMessage}
              </span>
            ) : job.actions.canApply ? (
              job.actions.authenticated ? (
                <JobApplicationAction
                  jobId={job.id}
                  jobSlug={job.slug}
                  initialApplied={job.actions.applied}
                  onActivate={onClose}
                />
              ) : (
                <Link
                  className="sh-button job-quick-view-apply"
                  href={
                    "/login?returnTo=" + encodeURIComponent("/jobs/" + job.slug)
                  }
                  onClick={onClose}
                >
                  {copy.signInToApply}
                </Link>
              )
            ) : (
              <span className="job-closed-state">
                {copy.applicationsClosed}
              </span>
            )}

            {job.actions.authenticated && job.actions.canSave ? (
              <SaveJobAction
                jobId={job.id}
                initialSaved={job.actions.saved}
                initialApplied={job.actions.applied}
                variant="button"
              />
            ) : (
              <Link
                className="job-secondary-button job-save-button"
                href={
                  "/login?returnTo=" + encodeURIComponent("/jobs/" + job.slug)
                }
                onClick={onClose}
              >
                <SaveBookmarkIcon />
                <span>{copy.save}</span>
              </Link>
            )}
          </div>
          <div
            className="job-quick-view-navigation"
            aria-label={copy.quickViewNavigation}
          >
            <button
              className="job-icon-button"
              type="button"
              aria-label={copy.previousJob}
              disabled={index <= 0}
              onClick={() => onJobChange(jobs[index - 1]!.id)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              className="job-icon-button"
              type="button"
              aria-label={copy.nextJob}
              disabled={index >= jobs.length - 1}
              onClick={() => onJobChange(jobs[index + 1]!.id)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
