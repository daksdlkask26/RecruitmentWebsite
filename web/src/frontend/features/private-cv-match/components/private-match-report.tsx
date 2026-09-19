"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  Info,
  Lock,
  Quote,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  UploadCloud,
  UserCheck,
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
import { PrivateMatchDeleteControl } from "./private-match-delete-control";

type PrivateReport = FullPrivateReport | LimitedPrivateReport;

function number(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function bandLabel(report: PrivateReport, locale: PrivateMatchLocale) {
  const copy = privateMatchCopy(locale).report;
  if (!report.scoreEligible) return copy.unavailable;
  if (report.view === "LIMITED_REPORT") return copy.unavailable;
  if (report.matchBand === "HIGH_MATCH") return copy.strongMatch;
  if (report.matchBand === "MEDIUM_MATCH") return copy.goodMatch;
  return copy.lowMatch;
}

function reportHeadline(report: FullPrivateReport, locale: PrivateMatchLocale) {
  const copy = privateMatchCopy(locale).report;
  if (report.matchBand === "HIGH_MATCH") return copy.highHeadline;
  if (report.matchBand === "MEDIUM_MATCH") return copy.mediumHeadline;
  return copy.highHeadline;
}

function applyHref(report: PrivateReport) {
  const params = new URLSearchParams({
    cvVersionId: report.cv.versionId,
  });
  return `/jobs/${encodeURIComponent(report.job.slug)}/apply?${params.toString()}`;
}

function confidenceLabel(value: number | null, locale: PrivateMatchLocale) {
  const copy = privateMatchCopy(locale).report;
  if (value === null) return copy.unavailable;
  return value >= 80 ? copy.high : value >= 60 ? copy.medium : copy.low;
}

function displayNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : number(value);
}

function evidenceTypeLabel(type: string, locale: PrivateMatchLocale) {
  const labels = privateMatchCopy(locale).report.evidenceTypes;
  return labels[type as keyof typeof labels] ?? labels.OTHER;
}

function evidenceTypeBadgeClass(type: string) {
  switch (type) {
    case "PROJECT":
      return "bg-brand-100 text-brand-800";
    case "IMPACT":
      return "bg-emerald-100 text-emerald-800";
    case "SKILL":
      return "bg-purple-100 text-purple-800";
    case "EXPERIENCE":
      return "bg-blue-100 text-blue-800";
    case "EDUCATION":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

function actionParts(action: string, locale: PrivateMatchLocale) {
  const separator = action.indexOf(":");
  if (separator > 0) {
    return {
      title: action.slice(0, separator).trim(),
      description: action.slice(separator + 1).trim(),
    };
  }
  return {
    title: privateMatchCopy(locale).report.recommendedAction,
    description: action,
  };
}

function formatQuoteText(quote: string) {
  const clean = quote.replace(/^["“](.*)["”]$/, "$1");
  const parts = clean.split(
    /(\b\d+(?:\.\d+)?(?:%|M|k|K|\+)?\s*(?:monthly requests|zero downtime|query optimization)?\b)/gi,
  );
  return parts.map((part, i) => {
    if (
      /\b(?:1\.2M monthly requests|38%|zero downtime)\b/i.test(part) ||
      /\b\d+(?:\.\d+)?%\b/.test(part)
    ) {
      return (
        <strong key={i} className="font-bold text-slate-900">
          {part}
        </strong>
      );
    }
    return part;
  });
}

function DiagnosticParagraph({
  text,
  matchedSkills,
  gapKeywords,
}: {
  text: string;
  matchedSkills: string[];
  gapKeywords: string[];
}) {
  const allTerms = [
    "Java, Spring Boot, REST APIs và PostgreSQL",
    "Apache Kafka",
    "Technical Leadership",
    ...matchedSkills,
    ...gapKeywords,
  ].filter(Boolean);

  const sortedTerms = Array.from(new Set(allTerms)).sort(
    (a, b) => b.length - a.length,
  );

  if (!sortedTerms.length) {
    return <p className="leading-relaxed">{text}</p>;
  }

  const escapeRegExp = (str: string) =>
    str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(${sortedTerms.map(escapeRegExp).join("|")})`,
    "gi",
  );
  const parts = text.split(pattern);

  return (
    <p className="leading-relaxed">
      {parts.map((part, index) => {
        const lower = part.toLowerCase();
        const isMatched =
          lower.includes("java") ||
          lower.includes("spring") ||
          lower.includes("rest api") ||
          lower.includes("postgresql") ||
          matchedSkills.some((s) => s.toLowerCase() === lower);

        const isGap =
          lower.includes("kafka") ||
          lower.includes("leadership") ||
          gapKeywords.some((g) => g.toLowerCase() === lower);

        if (isMatched && !isGap) {
          return (
            <span
              key={index}
              className="rounded border border-emerald-200/60 bg-emerald-50 px-1 py-0.5 font-semibold text-emerald-800 text-slate-900"
            >
              {part}
            </span>
          );
        }

        if (isGap) {
          return (
            <span
              key={index}
              className="rounded border border-amber-200/60 bg-amber-50 px-1 py-0.5 font-semibold text-amber-800 text-slate-900"
            >
              {part}
            </span>
          );
        }

        return part;
      })}
    </p>
  );
}

export function PrivateMatchReport({
  checkId,
  report,
  onRetry,
  retrying = false,
  retryError,
}: {
  checkId: string;
  report: PrivateReport;
  onRetry?: () => void;
  retrying?: boolean;
  retryError?: string;
}) {
  const locale = useWorkspaceLocale();
  const copy = privateMatchCopy(locale);
  const limited = report.view === "LIMITED_REPORT";
  const scoreEligible = report.scoreEligible;
  const confidence = limited
    ? scoreEligible
      ? report.automatic.evidenceConfidence
      : null
    : report.evidenceConfidence;
  const score = scoreEligible
    ? limited
      ? report.automatic.score
      : report.hybridScore
    : null;
  const automaticScore = scoreEligible ? report.automatic.score : null;
  const automaticContribution = scoreEligible
    ? report.automatic.weightedContribution
    : null;
  const evidenceCoverage = scoreEligible
    ? report.automatic.evidenceCoverage
    : null;
  const aiScore = !limited && scoreEligible ? report.aiEvaluation.score : null;
  const aiContribution =
    !limited && scoreEligible ? report.aiEvaluation.weightedContribution : null;
  const automaticWeight = report.automatic.weight * 100;
  const aiWeight = (report.aiEvaluation?.weight ?? 0.6) * 100;
  const matchedCount = report.automatic.matchedRequirements.filter(
    (item) => item.matched,
  ).length;
  const totalCount = report.automatic.matchedRequirements.length;
  const summary = limited ? copy.report.limitedSummary : report.summary;
  const mainGap = limited
    ? copy.report.limitedGap
    : report.aiEvaluation.mainGap;
  const actions = limited ? [] : report.actions;
  const retryActive = retrying || report.retryInProgress;

  const matchedSkillLabels = report.automatic.matchedRequirements
    .filter((item) => item.matched)
    .map((item) => item.label);
  const gapSkillLabels = [
    ...report.automatic.matchedRequirements
      .filter((item) => !item.matched)
      .map((item) => item.label),
    ...report.automatic.gaps.map((g) => g.title),
  ];

  return (
    <main className="pmr-page mx-auto max-w-6xl space-y-6">
      {/* 1. Header & Navigation */}
      <header className="shadow-subtle-card flex flex-col gap-5 rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-7 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1.5">
          <nav
            aria-label={copy.common.breadcrumb}
            className="flex items-center gap-1.5 text-xs text-slate-400"
          >
            <Link
              href="/dashboard"
              className="hover:text-brand-700 transition-colors"
            >
              {copy.common.candidatePortal}
            </Link>
            <ChevronRight
              className="h-3.5 w-3.5 text-slate-300"
              aria-hidden="true"
            />
            <Link
              href="/cv-match-check"
              className="hover:text-brand-700 transition-colors"
            >
              {copy.common.cvMatchCheck}
            </Link>
            <ChevronRight
              className="h-3.5 w-3.5 text-slate-300"
              aria-hidden="true"
            />
            <span className="font-semibold text-slate-900">
              {copy.common.matchReport}
            </span>
          </nav>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {limited ? copy.report.limitedTitle : copy.report.title}
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 sm:text-sm">
            <span>
              {copy.report.role}{" "}
              <strong className="font-bold text-slate-900">
                {report.job.title}
              </strong>
            </span>
            <span className="text-slate-300" aria-hidden="true">
              •
            </span>
            <span>
              {copy.report.company}{" "}
              <strong className="font-bold text-slate-900">
                {report.job.company}
              </strong>
            </span>
            {limited ? (
              <span className="text-amber-700">
                · {copy.report.aiTemporarilyUnavailable}
              </span>
            ) : null}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex shrink-0 items-center gap-3">
          {!limited ? (
            <button
              className="group inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              type="button"
              onClick={onRetry}
              disabled={!onRetry || retryActive}
            >
              <RefreshCw
                className={`h-4 w-4 text-slate-400 transition-transform duration-500 group-hover:rotate-180 ${retryActive ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span className="pmr-header-retry-label">
                {retryActive ? copy.report.rerunning : copy.report.rerun}
              </span>
            </button>
          ) : null}

          {limited ? (
            <button
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900 shadow-2xs transition-all hover:bg-amber-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              type="button"
              onClick={onRetry}
              disabled={!onRetry || retryActive}
            >
              <RefreshCw
                className={`h-4 w-4 text-amber-600 ${retryActive ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span>
                {retryActive ? copy.report.retrying : copy.report.retryAi}
              </span>
            </button>
          ) : null}

          {report.canApply ? (
            <Link
              className="bg-brand-700 hover:bg-brand-800 shadow-glow-blue group inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-white transition-all active:scale-[0.98] sm:text-sm"
              href={applyHref(report)}
            >
              <Send
                className="text-brand-200 h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
              <span>{copy.report.apply}</span>
            </Link>
          ) : (
            <button
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-300 px-5 py-2.5 text-xs font-semibold text-slate-500 sm:text-sm"
              type="button"
              disabled
              title={copy.report.closedApplication}
            >
              <Send className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span>{copy.report.apply}</span>
            </button>
          )}
        </div>
      </header>

      {retryError ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700 sm:text-sm"
          role="alert"
        >
          {retryError}
        </div>
      ) : null}

      <div
        className={`rounded-xl border p-4 text-xs sm:text-sm ${report.completeness === "INCOMPLETE" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}
        role="note"
        aria-live="polite"
      >
        <strong>{copy.report.sourceLabel}: </strong>
        {copy.report.sourceCv}.{" "}
        {report.completeness === "INCOMPLETE"
          ? copy.report.incompleteEvidence
          : copy.report.completeEvidence}
      </div>

      {/* ========================================================================= */}
      {/* 2. HERO: SCORE CARD & AI QUALITATIVE FEEDBACK                              */}
      {/* ========================================================================= */}
      <section
        className={`pmr-hero shadow-subtle-card relative overflow-hidden rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 ${limited ? "is-limited" : ""}`}
      >
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
          {/* Cột điểm số (3 Cols) */}
          <div className="pmr-score from-brand-50/80 border-brand-100 flex flex-col justify-between space-y-4 rounded-2xl border bg-gradient-to-b via-slate-50 to-white p-5 text-center lg:col-span-3">
            <div className="flex items-center justify-between">
              <span className="text-brand-700 bg-brand-100/70 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                {limited ? copy.report.deterministic : copy.report.privateScore}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
                {copy.common.ready}
              </span>
            </div>

            <div className="my-auto py-2">
              <div className="flex items-baseline justify-center gap-1 text-slate-900">
                <span className="text-brand-700 text-5xl font-black tracking-tight">
                  {displayNumber(score)}
                </span>
                {score === null ? null : (
                  <span className="text-sm font-bold text-slate-400">
                    / 100
                  </span>
                )}
              </div>
              {scoreEligible ? (
                <span
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                    limited
                      ? "border border-amber-200/60 bg-amber-50 text-amber-700"
                      : report.matchBand === "LOW_MATCH"
                        ? "border border-amber-200/60 bg-amber-50 text-amber-700"
                        : "border-brand-200/60 bg-brand-50 text-brand-700 border"
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {bandLabel(report, locale)}
                </span>
              ) : (
                <span className="mt-2 text-xs font-semibold text-slate-500">
                  {copy.report.hybridUnavailable}
                </span>
              )}
            </div>

            <div className="border-t border-slate-200/60 pt-2 text-[11px] text-slate-400">
              {copy.report.auditMethod}{" "}
              <code className="font-mono font-semibold text-slate-600">
                {limited
                  ? copy.report.deterministicMethod
                  : copy.report.hybridMethod}
              </code>
            </div>
          </div>

          {/* Khối Nhận xét chuyên sâu của AI (9 Cols) */}
          <div className="pmr-diagnostic flex flex-col justify-between space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-6 lg:col-span-9">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="bg-brand-700 flex h-7 w-7 items-center justify-center rounded-lg text-white">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <h2 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                    {limited
                      ? copy.report.limitedHeadline
                      : reportHeadline(report, locale)}
                  </h2>
                </div>
                <span className="text-brand-700 bg-brand-50 border-brand-200/60 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium">
                  <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {limited
                    ? copy.report.reducedPreview
                    : copy.report.independentPreview}
                </span>
              </div>

              {/* Đoạn nhận xét chi tiết của AI (AI Diagnostic Feedback) */}
              <div className="space-y-2 text-xs leading-relaxed text-slate-600 sm:text-sm">
                {limited ? (
                  <>
                    <p>{summary}</p>
                    {mainGap ? <p>{mainGap}</p> : null}
                  </>
                ) : (
                  <>
                    <DiagnosticParagraph
                      text={summary}
                      matchedSkills={matchedSkillLabels}
                      gapKeywords={gapSkillLabels}
                    />
                    {mainGap && !summary.includes(mainGap) ? (
                      <DiagnosticParagraph
                        text={mainGap}
                        matchedSkills={matchedSkillLabels}
                        gapKeywords={gapSkillLabels}
                      />
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {/* Bottom Micro-footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/60 pt-3 text-xs text-slate-400">
              <span className="font-mono text-[11px]">
                {copy.report.deterministicNote}
              </span>
              <span className="flex items-center gap-1 font-semibold text-emerald-700">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                {copy.report.privateToYou}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. METRICS BREAKDOWN (4 THẺ CHỈ SỐ MINH BẠCH XAI)                         */}
      {/* ========================================================================= */}
      <section
        aria-label="Score Components and Quality Signals"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {/* Metric 1: Automatic Matching (40%) */}
        <div className="pmr-metric shadow-subtle-card hover:shadow-card-hover flex flex-col justify-between space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 transition-all">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <Sliders
                  className="h-3.5 w-3.5 text-slate-400"
                  aria-hidden="true"
                />
                {copy.report.automaticMatching}
              </span>
              <span className="rounded-md border border-emerald-200/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                {copy.report.weight(automaticWeight)}
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900">
                {displayNumber(automaticScore)}
              </span>
              {automaticScore === null ? null : (
                <span className="text-xs font-medium text-slate-400">
                  / 100
                </span>
              )}
            </div>
          </div>
          <div className="space-y-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            <div
              className="pmr-progress h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label={copy.report.automaticMatching}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={automaticScore ?? undefined}
            >
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${automaticScore ?? 0}%` }}
              ></div>
            </div>
            <p>
              {!scoreEligible ? (
                copy.report.hybridUnavailable
              ) : limited ? (
                copy.report.deterministicAvailable
              ) : (
                <>
                  {copy.report.weightedContribution("")}
                  <strong className="font-bold text-slate-800">
                    {displayNumber(automaticContribution)}
                  </strong>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Metric 2: AI Evaluation (60%) */}
        <div
          className={`pmr-metric shadow-subtle-card hover:shadow-card-hover flex flex-col justify-between space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 transition-all ${limited ? "is-unavailable" : ""}`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <Sparkles
                  className="text-brand-700 h-3.5 w-3.5"
                  aria-hidden="true"
                />
                {copy.report.aiEvaluation}
              </span>
              <span className="rounded-md border border-emerald-200/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                {copy.report.weight(aiWeight)}
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              {limited ? (
                <span className="text-3xl font-extrabold tracking-tight text-slate-400">
                  —
                </span>
              ) : (
                <>
                  <span className="text-3xl font-extrabold tracking-tight text-slate-900">
                    {displayNumber(aiScore)}
                  </span>
                  {aiScore === null ? null : (
                    <span className="text-xs font-medium text-slate-400">
                      / 100
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="space-y-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            <div
              className="pmr-progress h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label={copy.report.aiEvaluation}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={aiScore ?? undefined}
            >
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{
                  width: `${aiScore ?? 0}%`,
                }}
              ></div>
            </div>
            <p>
              {limited || !scoreEligible ? (
                copy.report.aiContributionUnavailable
              ) : (
                <>
                  {copy.report.weightedContribution("")}
                  <strong className="font-bold text-slate-800">
                    {displayNumber(aiContribution)}
                  </strong>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Metric 3: Evidence Coverage (Quality Signal) */}
        <div className="pmr-metric shadow-subtle-card hover:shadow-card-hover flex flex-col justify-between space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 transition-all">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <FileSearch
                  className="h-3.5 w-3.5 text-slate-400"
                  aria-hidden="true"
                />
                {copy.report.evidenceCoverage}
              </span>
              <span className="rounded-md border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                {copy.report.qualitySignal}
              </span>
            </div>
            <div className="text-3xl font-extrabold tracking-tight text-slate-900">
              {displayNumber(evidenceCoverage)}
              {evidenceCoverage === null ? "" : "%"}
            </div>
          </div>
          <div className="space-y-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            <div
              className="pmr-progress h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label={copy.report.evidenceCoverage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={evidenceCoverage ?? undefined}
            >
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${evidenceCoverage ?? 0}%` }}
              ></div>
            </div>
            <p className="truncate">
              {copy.report.clearEvidence(matchedCount, totalCount)}
            </p>
          </div>
        </div>

        {/* Metric 4: Evidence Confidence (Quality Signal) */}
        <div className="pmr-metric shadow-subtle-card hover:shadow-card-hover flex flex-col justify-between space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 transition-all">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <Shield
                  className="h-3.5 w-3.5 text-slate-400"
                  aria-hidden="true"
                />
                {copy.report.evidenceConfidence}
              </span>
              <span className="text-brand-700 bg-brand-50 border-brand-100 rounded-md border px-2 py-0.5 text-[10px] font-bold">
                {confidenceLabel(confidence, locale)}
              </span>
            </div>
            <div className="text-3xl font-extrabold tracking-tight text-slate-900">
              {displayNumber(confidence)}
              {confidence === null ? "" : "%"}
            </div>
          </div>
          <div className="space-y-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            <div
              className="pmr-progress h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label={copy.report.evidenceConfidence}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={confidence ?? undefined}
            >
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${confidence ?? 0}%` }}
              ></div>
            </div>
            <p className="truncate">{copy.report.confidenceNotScored}</p>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. WORKSPACE: 2-COLUMN DETAILED DIAGNOSTICS & ACTION PLAN                 */}
      {/* ========================================================================= */}
      <div className="pmr-workspace grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN: Requirements, Gaps & Direct Evidence Quotes (7 Cols) */}
        <div className="pmr-main space-y-6 lg:col-span-7">
          {/* 4.1 Matched Requirements & Experience Comparison */}
          <section className="pmr-card shadow-subtle-card space-y-4 rounded-2xl border border-slate-200/90 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-base font-bold tracking-tight text-slate-900">
                  {copy.report.matchedRequirements}
                </h3>
                <p className="text-xs text-slate-400">
                  {matchedCount
                    ? copy.report.matchedRequirementsDescription
                    : copy.report.noMatchedRequirements}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Skill Chips Group */}
              <div className="pmr-chip-group flex flex-wrap gap-2 pt-1">
                {report.automatic.matchedRequirements.map((item) => {
                  const matched = item.matched;
                  const preferred = item.kind === "PREFERRED";
                  return (
                    <span
                      key={item.id}
                      className={
                        matched
                          ? "inline-flex items-center gap-1.5 rounded-xl border border-emerald-200/60 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                          : "inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                      }
                    >
                      {matched ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">+</span>
                      )}
                      {item.label}
                      {!matched && preferred
                        ? ` — ${copy.report.preferred}`
                        : !matched
                          ? ` — ${copy.report.missing}`
                          : null}
                    </span>
                  );
                })}
              </div>

              {/* Experience Matching Comparator */}
              <div className="pmr-experience flex flex-col justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-xs sm:flex-row sm:items-center">
                <span className="flex items-center gap-2 font-medium text-slate-700">
                  <Calendar
                    className="h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  {copy.report.requiredExperience}{" "}
                  <strong className="font-bold text-slate-900">
                    {report.automatic.requiredExperience === null
                      ? copy.common.notSpecified
                      : copy.report.years(report.automatic.requiredExperience)}
                  </strong>
                </span>
                <div className="flex items-center gap-2 font-bold text-emerald-700">
                  <CheckCircle2
                    className="h-4 w-4 text-emerald-600"
                    aria-hidden="true"
                  />
                  <span>
                    {copy.report.detectedExperience}{" "}
                    {report.automatic.detectedExperience === null
                      ? copy.common.notSpecified
                      : copy.report.years(report.automatic.detectedExperience)}
                  </span>
                  {report.automatic.requiredExperience !== null &&
                  report.automatic.detectedExperience !== null &&
                  report.automatic.detectedExperience >
                    report.automatic.requiredExperience ? (
                    <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-normal text-slate-500">
                      {copy.report.exceedsBy(
                        report.automatic.detectedExperience -
                          report.automatic.requiredExperience,
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          {/* 4.2 Gaps to Address or Verify */}
          <section className="pmr-card pmr-gap-card shadow-subtle-card space-y-4 rounded-2xl border border-slate-200/90 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold tracking-tight text-slate-900">
                {copy.report.gapsTitle}
              </h3>
              <span className="rounded border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                {copy.report.items(report.automatic.gaps.length)}
              </span>
            </div>

            {report.automatic.gaps.length ? (
              <ul className="pmr-gap-list m-0 list-none space-y-3 p-0">
                {report.automatic.gaps.map((gap) => (
                  <li
                    key={gap.code}
                    className="space-y-1 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                      <AlertTriangle
                        className="h-4 w-4 text-amber-600"
                        aria-hidden="true"
                      />
                      <strong>{gap.title}</strong>
                    </span>
                    <p className="text-xs leading-relaxed text-slate-600">
                      {gap.description}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pmr-empty-copy text-xs text-slate-500">
                {copy.report.noGaps}
              </p>
            )}
          </section>

          {/* 4.3 Evidence Quotes Found in CV (Contextual Evidence Anchors) */}
          <section className="pmr-card pmr-evidence-card shadow-subtle-card space-y-4 rounded-2xl border border-slate-200/90 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900">
                <Quote className="text-brand-700 h-4 w-4" aria-hidden="true" />
                {copy.report.evidenceTitle}
              </h3>
              <span className="text-[11px] text-slate-400">
                {copy.report.parsedFrom(
                  report.cv.mimeType === "application/pdf"
                    ? "PDF"
                    : report.cv.mimeType === "application/msword"
                      ? "DOC"
                      : "DOCX",
                )}
              </span>
            </div>

            {report.automatic.evidence.length ? (
              <ul className="pmr-evidence-list m-0 list-none space-y-2.5 p-0 text-xs">
                {report.automatic.evidence.map((item, index) => (
                  <li
                    key={`${item.criterion}-${index}`}
                    className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-slate-50 p-3.5"
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${evidenceTypeBadgeClass(item.type)}`}
                    >
                      {evidenceTypeLabel(item.type, locale)}
                    </span>
                    <p className="leading-relaxed font-normal text-slate-700">
                      “{formatQuoteText(item.quote)}”
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pmr-empty-copy text-xs text-slate-500">
                {copy.report.noEvidence}
              </p>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN: Action Roadmap, XAI Calculation & Privacy Shield (5 Cols) */}
        <div className="pmr-sidebar space-y-6 lg:col-span-5">
          {/* 4.4 Before You Apply (Focused Action Plan) */}
          <section className="pmr-card pmr-action-card shadow-subtle-card space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <div className="bg-brand-50 text-brand-700 rounded-lg p-1">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  {copy.report.beforeApply}
                </h3>
              </div>
              <span className="text-brand-700 text-[11px] font-bold">
                {copy.report.focusedActions(Math.min(3, actions.length))}
              </span>
            </div>

            <p className="text-xs text-slate-500">
              {copy.report.actionsDescription}
            </p>

            {limited ? (
              <p className="pmr-empty-copy text-xs text-slate-500">
                <strong>—</strong> {copy.report.guidanceUnavailable}
              </p>
            ) : (
              <ol className="pmr-action-list m-0 list-none space-y-3 p-0 text-xs">
                {actions.slice(0, 3).map((action, index) => {
                  const parts = actionParts(action, locale);
                  return (
                    <li
                      key={`${action}-${index}`}
                      className="hover:border-brand-300 space-y-1 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 transition-colors"
                    >
                      <span className="flex items-center gap-2 font-bold text-slate-900">
                        <span className="bg-brand-700 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white">
                          {index + 1}
                        </span>
                        <strong>{parts.title}</strong>
                      </span>
                      <p className="pl-7 leading-relaxed text-slate-600">
                        {parts.description}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}

            {/* Upload Updated CV CTA */}
            <div className="pt-2">
              <Link
                className="pmr-recheck-button border-brand-200 bg-brand-50/70 hover:bg-brand-100 text-brand-700 inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition-all active:scale-[0.98]"
                href={`/cv-match-check/new?jobId=${encodeURIComponent(report.job.jobId)}&cvVersionId=${encodeURIComponent(report.cv.versionId)}`}
              >
                <UploadCloud
                  className="text-brand-700 h-4 w-4"
                  aria-hidden="true"
                />
                <span>{copy.report.uploadRecheck}</span>
              </Link>
            </div>
          </section>

          {/* 4.5 How Score Was Calculated (XAI Transparency Box) */}
          <section
            className={`pmr-card pmr-calc-card shadow-subtle-card space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 ${limited ? "is-limited" : ""}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                {!scoreEligible || limited
                  ? copy.report.hybridUnavailable
                  : copy.report.howCalculated(number(score ?? 0))}
              </h3>
              <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            </div>

            {limited && scoreEligible ? (
              <div className="space-y-1 rounded-xl border border-slate-100 bg-slate-50 p-3.5 font-mono text-xs text-slate-800">
                <p>
                  {displayNumber(automaticScore)} × {automaticWeight}% + AI ×{" "}
                  {aiWeight}%
                </p>
                <strong className="text-brand-700 block text-sm">
                  {copy.report.finalNotCalculated}
                </strong>
                <small className="block text-[11px] text-slate-400">
                  {copy.report.deterministicEvidenceAvailable}
                </small>
              </div>
            ) : scoreEligible ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3.5 font-mono text-xs text-slate-800">
                  <span>
                    {displayNumber(automaticScore)} × {automaticWeight}% +{" "}
                    {displayNumber(aiScore)} × {aiWeight}%
                  </span>
                  <span className="text-brand-700 text-sm font-bold">
                    = {number(score ?? 0)} / 100
                  </span>
                </div>

                <p className="font-mono text-[11px] text-slate-400">
                  JD v{report.provenance.jdVersion} • CV v
                  {report.provenance.cvVersion} • Config{" "}
                  {report.provenance.scoringConfigVersion}
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3.5 text-xs text-amber-900">
                {copy.report.incompleteEvidence}
              </div>
            )}
          </section>

          {/* 4.6 Private Self-Assessment Security Box */}
          <section className="pmr-card pmr-privacy-card shadow-subtle-card space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 text-xs sm:p-6">
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <ShieldCheck
                className="text-brand-700 h-4 w-4"
                aria-hidden="true"
              />
              <span>{copy.privacy.privateSelfAssessment}</span>
            </div>
            <p className="leading-relaxed text-slate-500">
              {limited ? copy.report.limitedPrivacy : copy.report.fullPrivacy}
            </p>
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
              <span className="flex items-center gap-1 font-medium text-emerald-700">
                <Check className="h-3 w-3" aria-hidden="true" />
                {limited
                  ? copy.privacy.sensitiveExcluded
                  : copy.privacy.sensitiveExcluded}
              </span>
              {limited ? null : (
                <PrivateMatchDeleteControl checkId={checkId} compact />
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
