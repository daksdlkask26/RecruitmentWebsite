"use client";

import {
  ArrowRight,
  BadgeCheck,
  ChartNoAxesColumn,
  BriefcaseBusiness,
  CheckCircle2,
  FileText,
  LockKeyhole,
  List,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type {
  FullPrivateReport,
  LimitedPrivateReport,
} from "@/shared/contracts/private-cv-match";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import {
  privateMatchCopy,
  type PrivateMatchLocale,
} from "../i18n/private-match-copy";
import {
  PrivateMatchAnalysisSteps,
  PrivateMatchPrivacyCard,
  PrivateMatchSelectedJobCard,
  PrivateMatchStatusBadge,
} from "./private-match-shared";

function duration(report: FullPrivateReport | LimitedPrivateReport) {
  const seconds =
    (new Date(report.completedAt).getTime() -
      new Date(report.createdAt).getTime()) /
    1_000;
  return Math.max(0, Math.round(seconds * 10) / 10);
}

function date(value: string, locale: PrivateMatchLocale) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function previewBand(
  report: FullPrivateReport | LimitedPrivateReport,
  locale: PrivateMatchLocale,
) {
  const copy = privateMatchCopy(locale).readyView;
  if (!report.scoreEligible) return privateMatchCopy(locale).report.unavailable;
  if (report.view === "LIMITED_REPORT") return copy.aiUnavailable;
  if (report.matchBand === "HIGH_MATCH") return copy.strongPotential;
  if (report.matchBand === "MEDIUM_MATCH") return copy.goodPotential;
  return copy.moreEvidence;
}

function headline(
  report: FullPrivateReport | LimitedPrivateReport,
  locale: PrivateMatchLocale,
) {
  const copy = privateMatchCopy(locale).readyView;
  if (!report.scoreEligible)
    return privateMatchCopy(locale).report.highHeadline;
  if (report.view === "LIMITED_REPORT") return copy.limitedHeadline;
  if (report.matchBand === "HIGH_MATCH") return copy.highHeadline;
  if (report.matchBand === "MEDIUM_MATCH") return copy.mediumHeadline;
  return copy.lowHeadline;
}

export function PrivateMatchReady({
  report,
  onOpen,
}: {
  report: FullPrivateReport | LimitedPrivateReport;
  onOpen: () => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = privateMatchCopy(locale);
  const limited = report.view === "LIMITED_REPORT";
  const score = report.scoreEligible
    ? limited
      ? report.automatic.score
      : report.hybridScore
    : null;
  const caution =
    !report.scoreEligible || limited || report.matchBand === "LOW_MATCH";
  return (
    <main className="private-match-page private-match-ready-page">
      <div className="private-match-breadcrumb">
        {copy.common.cvMatchCheck} <span>/</span> {copy.common.analysis}
      </div>
      <div className="private-match-title-row">
        <div>
          <h1>{copy.readyView.heading}</h1>
          <p>
            {copy.readyView.finishedPrefix}{" "}
            <strong className="private-match-analysis-duration">
              {duration(report)} {copy.readyView.secondsUnit}
            </strong>
            . {copy.readyView.reviewBeforeApply}
          </p>
        </div>
        <PrivateMatchStatusBadge state="completed" />
      </div>
      <div
        className={`private-match-source-notice ${report.completeness === "INCOMPLETE" ? "private-match-source-notice--incomplete" : ""}`}
        role="note"
        aria-live="polite"
      >
        <strong>{copy.report.sourceLabel}: </strong>
        {copy.report.sourceCv}.{" "}
        {report.completeness === "INCOMPLETE"
          ? copy.report.incompleteEvidence
          : copy.report.completeEvidence}
      </div>
      <section
        className={`private-match-ready-banner ${limited ? "is-limited" : ""} ${caution ? "is-caution" : ""}`}
      >
        <div className="private-match-ready-copy">
          <div className="private-match-hero-icon">
            {caution ? (
              <TriangleAlert aria-hidden="true" />
            ) : (
              <CheckCircle2 aria-hidden="true" />
            )}
          </div>
          <div className="private-match-ready-body">
            <span
              className={`private-match-ready-status ${limited ? "private-match-ready-status--warning" : ""}`}
            >
              {limited ? (
                <TriangleAlert aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              {limited
                ? copy.readyView.limitedStatus
                : copy.readyView.completedStatus}
            </span>
            <h2>{headline(report, locale)}</h2>
            <p>
              {limited
                ? copy.readyView.limitedDescription
                : copy.readyView.description}
            </p>
            <span className="private-match-private-line">
              <LockKeyhole aria-hidden="true" /> {copy.readyView.privatePreview}
            </span>
          </div>
        </div>
        <div className="private-match-preview-score">
          <div className="private-match-score-label">
            {limited
              ? copy.readyView.deterministicMatch
              : copy.readyView.previewScore}
          </div>
          <div className="private-match-score-value">
            <strong>{score === null ? "—" : score}</strong>
            {score === null ? null : <span>/ 100</span>}
          </div>
          {report.scoreEligible ? (
            <div
              className={`private-match-score-tag ${caution ? "private-match-score-tag--caution" : ""}`}
            >
              {previewBand(report, locale)}
            </div>
          ) : (
            <div className="private-match-score-unavailable" role="status">
              {copy.report.hybridUnavailable}
            </div>
          )}
        </div>
      </section>

      <div className="private-match-columns">
        <div className="private-match-main-column">
          <section className="private-match-card">
            <h2>{copy.readyView.progressTitle}</h2>
            <p className="private-match-section-intro">
              {copy.readyView.progressDescription}
            </p>
            <PrivateMatchAnalysisSteps />
          </section>
          <section className="private-match-card private-match-source-card">
            <h2>{copy.readyView.sourcesTitle}</h2>
            <div className="private-match-source-row">
              <span className="private-match-source-icon">
                <FileText aria-hidden="true" />
              </span>
              <div>
                <strong>{report.cv.fileName}</strong>
                <p>
                  {copy.readyView.parsedUpdated(
                    date(report.cv.confirmedAt, locale),
                  )}
                </p>
              </div>
              <span
                className={`private-match-badge ${report.cv.parseStatus === "READY" ? "private-match-badge--success" : "private-match-badge--yellow"}`}
              >
                <BadgeCheck aria-hidden="true" />{" "}
                {report.cv.parseStatus === "READY"
                  ? copy.common.ready
                  : copy.report.unavailable}
              </span>
            </div>
            <div className="private-match-source-row">
              <span className="private-match-source-icon">
                <BriefcaseBusiness aria-hidden="true" />
              </span>
              <div>
                <strong>{report.job.title}</strong>
                <p>
                  {report.job.company} ·{" "}
                  {copy.readyView.jobDescriptionVersion(report.job.jdVersion)}
                </p>
              </div>
              <span className="private-match-badge private-match-badge--blue">
                <CheckCircle2 aria-hidden="true" />
                {copy.common.currentJd}
              </span>
            </div>
          </section>
          <section className="private-match-guidance-banner">
            <span className="private-match-guidance-icon">
              <ShieldCheck aria-hidden="true" />
            </span>
            <div>
              <strong>{copy.readyView.guidanceTitle}</strong>
              <p>{copy.readyView.guidanceDescription}</p>
            </div>
          </section>
        </div>
        <aside className="private-match-sidebar">
          <PrivateMatchSelectedJobCard job={report.job} />
          <PrivateMatchPrivacyCard />
          <section className="private-match-card private-match-report-preview-card">
            <h2>{copy.readyView.insideTitle}</h2>
            <ul className="private-match-preview-list">
              <li>
                <span className="private-match-inside-icon">
                  <List aria-hidden="true" />
                </span>
                <div>
                  <strong>{copy.readyView.requirementEvidence}</strong>
                  <span>{copy.readyView.requirementEvidenceDescription}</span>
                </div>
              </li>
              <li>
                <span className="private-match-inside-icon">
                  <ChartNoAxesColumn aria-hidden="true" />
                </span>
                <div>
                  <strong>{copy.readyView.explainableScore}</strong>
                  <span>{copy.readyView.explainableScoreDescription}</span>
                </div>
              </li>
              <li>
                <span className="private-match-inside-icon">
                  <Sparkles aria-hidden="true" />
                </span>
                <div>
                  <strong>{copy.readyView.improvementPlan}</strong>
                  <span>{copy.readyView.improvementPlanDescription}</span>
                </div>
              </li>
            </ul>
            <button
              className="private-match-primary-button private-match-primary-button--wide"
              type="button"
              onClick={onOpen}
            >
              <Sparkles aria-hidden="true" /> {copy.readyView.openReport}
              <ArrowRight aria-hidden="true" />
            </button>
          </section>
          {limited ? (
            <p className="private-match-inline-note">
              <TriangleAlert aria-hidden="true" />{" "}
              {copy.readyView.limitedOpenNote}
            </p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
