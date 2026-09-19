"use client";

import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import type { PrivateMatchJob } from "@/shared/contracts/private-cv-match";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import {
  privateMatchCopy,
  type PrivateMatchLocale,
} from "../i18n/private-match-copy";

export function formatEmploymentType(
  value: string,
  locale: PrivateMatchLocale = "en",
) {
  const normalized = value
    .trim()
    .replace(/[\s-]+/gu, "_")
    .toUpperCase();
  const employment = privateMatchCopy(locale).job.employment;
  const knownLabel = employment[normalized as keyof typeof employment];
  if (knownLabel) return knownLabel;
  return normalized
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function formatWorkArrangement(
  value: string,
  locale: PrivateMatchLocale = "en",
) {
  const normalized = value
    .trim()
    .replace(/[\s-]+/gu, "_")
    .toUpperCase();
  const arrangement = privateMatchCopy(locale).job.arrangement;
  const knownLabel = arrangement[normalized as keyof typeof arrangement];
  if (knownLabel) return knownLabel;
  return normalized
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function formatExperienceRequirement(
  value: number | null,
  locale: PrivateMatchLocale = "en",
) {
  const copy = privateMatchCopy(locale).job;
  if (value === null) return copy.flexibleExperience;
  if (value === 0) return copy.entryLevel;
  return copy.experience(value);
}

export function PrivateMatchStatusBadge({
  state,
}: {
  state: "analyzing" | "completed";
}) {
  const copy = privateMatchCopy(useWorkspaceLocale());
  const analyzing = state === "analyzing";
  const Icon = analyzing ? LoaderCircle : Clock3;
  return (
    <span
      className={`private-match-status-card ${analyzing ? "private-match-status-card--analyzing" : "private-match-status-card--completed"}`}
      role="status"
    >
      <Icon
        aria-hidden="true"
        className={analyzing ? "private-match-spin" : undefined}
      />
      {analyzing ? copy.status.analyzing : copy.status.completed}
    </span>
  );
}

type PrivateMatchJobSummary = Pick<
  PrivateMatchJob,
  | "title"
  | "company"
  | "location"
  | "employmentType"
  | "requiredExperienceYears"
  | "jdVersion"
>;

export function PrivateMatchJobTags({
  job,
}: {
  job: Pick<PrivateMatchJob, "employmentType" | "requiredExperienceYears">;
}) {
  const locale = useWorkspaceLocale();
  return (
    <div className="private-match-chip-group private-match-job-tags">
      <span className="private-match-chip private-match-job-tag">
        <Clock3 aria-hidden="true" />
        {formatEmploymentType(job.employmentType, locale)}
      </span>
      <span className="private-match-chip private-match-job-tag">
        <CalendarDays aria-hidden="true" />
        {formatExperienceRequirement(job.requiredExperienceYears, locale)}
      </span>
    </div>
  );
}

export function PrivateMatchSelectedJobCard({
  job,
}: {
  job?: PrivateMatchJobSummary | null;
}) {
  const copy = privateMatchCopy(useWorkspaceLocale());
  return (
    <section
      className="private-match-card private-match-selected-job-card"
      aria-busy={!job}
    >
      <div className="private-match-card-label">{copy.job.selected}</div>
      {job ? (
        <>
          <h2>{job.title}</h2>
          <p>
            {job.company} · {job.location}
          </p>
          <PrivateMatchJobTags job={job} />
          <small className="private-match-sidebar-source">
            {copy.job.source(job.jdVersion)}
          </small>
        </>
      ) : (
        <div className="private-match-job-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </section>
  );
}

export function PrivateMatchPrivacyCard() {
  const copy = privateMatchCopy(useWorkspaceLocale());
  return (
    <section className="private-match-card private-match-privacy-assurance-card">
      <h2>
        <LockKeyhole aria-hidden="true" /> {copy.privacy.title}
      </h2>
      <ul className="private-match-check-list">
        <li>
          <Check aria-hidden="true" /> {copy.privacy.onlyYou}
        </li>
        <li>
          <Check aria-hidden="true" /> {copy.privacy.sensitiveExcluded}
        </li>
        <li>
          <Check aria-hidden="true" /> {copy.privacy.notSent}
        </li>
      </ul>
    </section>
  );
}

export function PrivateMatchStepper({ activeStep }: { activeStep: 1 | 2 | 3 }) {
  const copy = privateMatchCopy(useWorkspaceLocale());
  const labels = copy.stepper.labels;
  return (
    <ol className="private-match-stepper" aria-label={copy.stepper.aria}>
      {labels.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const complete = step < activeStep;
        const active = step === activeStep;
        return (
          <li
            className={
              complete ? "is-complete" : active ? "is-active" : undefined
            }
            aria-current={active ? "step" : undefined}
            key={label}
          >
            <span aria-hidden="true">{complete ? <Check /> : step}</span>
            <div>
              <small>{copy.common.step(step)}</small>
              <strong>{label}</strong>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PrivateMatchAnalysisSteps({
  activeStep = 4,
}: {
  activeStep?: 1 | 2 | 3 | 4;
}) {
  const copy = privateMatchCopy(useWorkspaceLocale());
  return (
    <ol className="private-match-analysis-list">
      {copy.analysisSteps.map(([title, description], index) => {
        const step = index + 1;
        const allComplete = activeStep === 4;
        const complete = allComplete || step < activeStep;
        const current = !allComplete && activeStep === step;
        return (
          <li
            className={
              complete ? "is-complete" : current ? "is-current" : "is-pending"
            }
            key={title}
          >
            <span className="private-match-analysis-icon" aria-hidden="true">
              {complete ? (
                <Check />
              ) : current ? (
                <LoaderCircle className="private-match-spin" />
              ) : (
                <Clock3 />
              )}
            </span>
            <div>
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
            <span
              className={`private-match-badge ${complete ? "private-match-badge--success" : current ? "private-match-badge--blue" : ""}`}
            >
              {complete ? (
                <CheckCircle2 aria-hidden="true" />
              ) : current ? (
                <LoaderCircle
                  className="private-match-spin"
                  aria-hidden="true"
                />
              ) : (
                <Clock3 aria-hidden="true" />
              )}
              {complete
                ? copy.common.complete
                : current
                  ? copy.common.inProgress
                  : copy.common.next}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
