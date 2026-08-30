"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  FileText,
  ListChecks,
  LoaderCircle,
  Mail,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  X,
} from "lucide-react";
import type {
  RankedApplicationRow,
  ScoringDetail,
  ScoringState,
} from "@/shared/contracts/scoring";
import type { PipelineApplicationCard } from "@/shared/contracts/applications";
import { scoringDetailSchema } from "@/shared/contracts/scoring";
import type { RecruiterCandidateProfile } from "@/shared/contracts/recruiter-candidate-profile";
import { AutomaticMatchTab } from "./automatic-match-tab";
import { AiAssessmentTab } from "./ai-assessment-tab";
import { DocumentsTab } from "./documents-tab";
import { RankingModalFrame } from "./ranking-modal-frame";
import { ScoreBadgeFromLabel, formatScore } from "./candidate-ranking-ui";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { applicationDetailCopy } from "./application-detail-copy";

type Tab = "automatic" | "ai" | "documents" | "profile";
type CandidateScoreDrawerCandidate =
  | RankedApplicationRow
  | PipelineApplicationCard;

export function CandidateScoreDrawer({
  jobId,
  jobTitle,
  candidate,
  readOnly = false,
  onClose,
  onSetPriority,
  onShortlist,
  onMoveToInterview,
  onReject,
  onApplicationOpened,
  onOpenRecruitmentChat,
  onScoringChanged,
}: {
  jobId: string;
  jobTitle: string;
  candidate: CandidateScoreDrawerCandidate;
  readOnly?: boolean;
  onClose: () => void;
  onSetPriority: () => void;
  onShortlist: () => void | Promise<void>;
  onMoveToInterview: () => void;
  onReject: () => void;
  onApplicationOpened: () => void | Promise<void>;
  onOpenRecruitmentChat: () => Promise<void>;
  onScoringChanged: () => void;
}) {
  const locale = useWorkspaceLocale();
  const detailCopy = useMemo(() => applicationDetailCopy(locale), [locale]);
  const copy = detailCopy.drawer;
  const [activeTab, setActiveTab] = useState<Tab>("automatic");
  const [detail, setDetail] = useState<ScoringDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryConfirm, setRetryConfirm] = useState(false);
  const [scoreConfirm, setScoreConfirm] = useState(false);
  const [scoringActionLoading, setScoringActionLoading] = useState(false);
  const [shortlisting, setShortlisting] = useState(false);
  const [shortlistError, setShortlistError] = useState<string | null>(null);
  const [openingRecruitmentChat, setOpeningRecruitmentChat] = useState(false);
  const [openDocument, setOpenDocument] = useState<
    "cv" | "cover-letter" | null
  >(null);
  const [openDocumentRequest, setOpenDocumentRequest] = useState(0);
  const [profileReview, setProfileReview] =
    useState<RecruiterCandidateProfile | null>(null);
  const acknowledgedApplicationId = useRef<string | null>(null);

  useEffect(() => {
    if (acknowledgedApplicationId.current === candidate.applicationId) return;
    acknowledgedApplicationId.current = candidate.applicationId;
    void Promise.resolve(onApplicationOpened()).catch(() => undefined);
  }, [candidate.applicationId, onApplicationOpened]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setProfileReview(null);
    setOpenDocument(null);
  }, [candidate.applicationId]);

  const loadDetail = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/recruiter/applications/${encodeURIComponent(candidate.applicationId)}/scoring`,
        { cache: "no-store", signal },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(copy.loadError);
      const next = scoringDetailSchema.parse(payload);
      return next;
    },
    [candidate.applicationId, copy.loadError],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setDetail(next);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            locale === "en" && cause instanceof Error
              ? cause.message
              : copy.loadError,
          );
      });
    return () => controller.abort();
  }, [copy.loadError, loadDetail, locale]);

  useEffect(() => {
    if (
      !detail ||
      !(
        detail.rescoreInProgress ||
        detail.scoring.kind === "PROCESSING" ||
        detail.scoring.kind === "PENDING"
      )
    )
      return;
    const timer = window.setInterval(() => {
      void loadDetail()
        .then((next) => {
          const wasInProgress =
            detail.rescoreInProgress ||
            detail.scoring.kind === "PROCESSING" ||
            detail.scoring.kind === "PENDING";
          const hasFinished =
            !next.rescoreInProgress &&
            next.scoring.kind !== "PROCESSING" &&
            next.scoring.kind !== "PENDING";
          if (wasInProgress && hasFinished) onScoringChanged();
          setDetail(next);
        })
        .catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [detail, loadDetail, onScoringChanged]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !retryConfirm && !scoreConfirm) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, retryConfirm, scoreConfirm]);

  const scoreSummary = scoreSummaryForCandidate(candidate);
  const scoring = detail?.scoring ?? rowToScoring(candidate);
  const finalScore = scoring.kind === "SCORED" ? scoring.finalScore : null;
  const automatic =
    scoring.kind === "SCORED" ||
    scoring.kind === "UNAVAILABLE" ||
    scoring.kind === "PENDING"
      ? scoring.automaticMatch
      : null;
  const scoreValue =
    scoring.kind === "SCORED"
      ? (finalScore?.value ?? null)
      : scoring.kind === "UNAVAILABLE" ||
          scoring.kind === "FAILED" ||
          scoring.kind === "PENDING" ||
          scoring.kind === "PROCESSING"
        ? null
        : scoreSummary.final;
  const badge =
    scoring.kind === "SCORED"
      ? (finalScore?.band ?? null)
      : scoring.kind === "UNAVAILABLE" ||
          scoring.kind === "FAILED" ||
          scoring.kind === "PENDING" ||
          scoring.kind === "PROCESSING"
        ? null
        : scoreSummary.band;
  const headerScore =
    scoring.kind === "PENDING"
      ? copy.pending
      : scoreValue === null
        ? "—/100"
        : `${formatScore(scoreValue)}/100`;
  const headerLabel =
    badge?.label ??
    (scoring.kind === "PROCESSING"
      ? copy.processing
      : scoring.kind === "PENDING"
        ? copy.retryingAi
        : scoring.kind === "UNAVAILABLE"
          ? copy.ruleBasedOnly
          : scoring.kind === "FAILED"
            ? copy.scoringFailedLabel
            : copy.notCalculated);
  const headerCode =
    badge?.code ??
    (scoring.kind === "UNAVAILABLE" ? "RULE_BASED" : scoring.kind);
  const aiBand =
    scoring.kind === "SCORED"
      ? (scoring.aiAssessment.aiScoreBand ?? null)
      : (scoreSummary.aiBand ?? null);
  const canScoreCandidate =
    detail?.scoring.kind === "NOT_CALCULATED" ||
    detail?.scoring.kind === "FAILED" ||
    detail?.scoring.kind === "SCORED";
  const scoreActionLabel =
    detail?.scoring.kind === "SCORED"
      ? "Rescore candidate"
      : detail?.scoring.kind === "FAILED"
        ? "Retry scoring"
        : "Score candidate";
  const canShortlist = !readOnly && candidate.stage === "VIEWED";
  const canOpenRecruitmentChat =
    !readOnly &&
    ["VIEWED", "SHORTLISTED", "INTERVIEWING", "OFFERED"].includes(
      candidate.stage,
    );
  const canMoveToInterview =
    !readOnly &&
    "allowedActions" in candidate &&
    candidate.allowedActions.moveToInterview.allowed;
  const canReject =
    !readOnly &&
    "allowedActions" in candidate &&
    candidate.allowedActions.reject.allowed;
  const manuallyPrioritized =
    "manuallyPrioritized" in candidate && candidate.manuallyPrioritized;

  const shortlist = async () => {
    if (!canShortlist || shortlisting) return;
    setShortlisting(true);
    setShortlistError(null);
    try {
      await onShortlist();
    } catch (cause) {
      setShortlistError(
        locale === "en" && cause instanceof Error
          ? cause.message
          : copy.scoreError,
      );
    } finally {
      setShortlisting(false);
    }
  };
  const openRecruitmentChat = async () => {
    if (!canOpenRecruitmentChat || openingRecruitmentChat) return;
    setOpeningRecruitmentChat(true);
    setError(null);
    try {
      await onOpenRecruitmentChat();
    } catch (cause) {
      setError(
        locale === "en" && cause instanceof Error
          ? cause.message
          : copy.loadError,
      );
      setOpeningRecruitmentChat(false);
    }
  };

  const retry = async () => {
    setRetryConfirm(false);
    try {
      const response = await fetch(
        `/api/recruiter/applications/${encodeURIComponent(candidate.applicationId)}/scoring/retry-ai`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key":
              globalThis.crypto?.randomUUID?.() ?? `retry-${Date.now()}`,
          },
          body: JSON.stringify({ confirmed: true }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.scoring) {
        setDetail((current) =>
          current ? { ...current, scoring: payload.scoring } : current,
        );
        // Keep the outer ranking in sync immediately, then the polling effect
        // refreshes it again when the replacement score is published.
        onScoringChanged();
      } else setError(copy.retryError);
    } catch {
      setError(copy.retryError);
    }
  };
  const scoreCandidate = async () => {
    setScoreConfirm(false);
    setScoringActionLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/recruiter/applications/${encodeURIComponent(candidate.applicationId)}/scoring/score`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key":
              globalThis.crypto?.randomUUID?.() ?? `score-${Date.now()}`,
          },
          body: JSON.stringify({ confirmed: true }),
        },
      );
      if (!response.ok) throw new Error(copy.scoreError);
      setDetail(await loadDetail());
      onScoringChanged();
    } catch (cause) {
      setError(
        locale === "en" && cause instanceof Error
          ? cause.message
          : copy.scoreError,
      );
    } finally {
      setScoringActionLoading(false);
    }
  };
  const changeTab = (next: Tab) => {
    if (next !== "documents") setOpenDocument(null);
    setActiveTab(next);
    window.sessionStorage.setItem("smartHire.scoreDrawerTab", next);
  };
  const requestDocument = (kind: "cv" | "cover-letter") => {
    setOpenDocument(kind);
    setOpenDocumentRequest((current) => current + 1);
    changeTab("documents");
  };
  const openProfileReview = async () => {
    setActiveTab("profile");
    setError(null);
    try {
      const response = await fetch(
        `/api/recruiter/jobs/${encodeURIComponent(jobId)}/applications/${encodeURIComponent(candidate.applicationId)}/profile`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(copy.profileError);
      setProfileReview(body as RecruiterCandidateProfile);
    } catch (cause) {
      setError(
        locale === "en" && cause instanceof Error
          ? cause.message
          : copy.profileError,
      );
    }
  };

  return (
    <div
      className="ranking-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="ranking-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-ranking-drawer-title"
      >
        <header className="ranking-drawer__header">
          <div className="ranking-drawer__identity">
            <div
              className="ranking-avatar ranking-avatar--large"
              aria-hidden="true"
            >
              {candidate.candidate.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h2 id="ai-ranking-drawer-title">
                {candidate.candidate.displayName}
              </h2>
              <p>{copy.applyingFor(jobTitle)}</p>
            </div>
          </div>
          <button
            type="button"
            className="ranking-icon-button"
            onClick={onClose}
            aria-label={copy.close}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="ranking-drawer__scoreline">
          <div className="ranking-drawer__score-summary">
            <div className="ranking-drawer__score">
              <strong>{headerScore}</strong>
              <span>
                {scoring.kind === "UNAVAILABLE"
                  ? copy.hybridUnavailable
                  : scoring.kind === "FAILED"
                    ? copy.scoringJobFailed
                    : scoring.kind === "PENDING"
                      ? copy.hybridPending
                      : copy.finalScore}
              </span>
            </div>
            <ScoreBadgeFromLabel code={headerCode} label={headerLabel} />
            {aiBand ? (
              <ScoreBadgeFromLabel
                code={aiBand.code}
                label={copy.aiLabel(aiBand.label)}
                compact
              />
            ) : null}
          </div>
          <div className="ranking-drawer__scoreline-actions">
            <div
              className="ranking-drawer__action-group"
              role="group"
              aria-label={copy.reviewInfo}
            >
              <div className="ranking-drawer__action-buttons">
                <button
                  type="button"
                  className="ai-ranking-button ai-ranking-button--secondary"
                  onClick={() => requestDocument("cv")}
                >
                  <FileText aria-hidden="true" /> {copy.viewCv}
                </button>
                <button
                  type="button"
                  className="ai-ranking-button ai-ranking-button--secondary"
                  onClick={() => requestDocument("cover-letter")}
                >
                  <Mail aria-hidden="true" /> {copy.viewCoverLetter}
                </button>
                <button
                  type="button"
                  className="ai-ranking-button ai-ranking-button--secondary"
                  onClick={() => void openProfileReview()}
                >
                  <UserRoundCheck aria-hidden="true" /> {copy.viewProfile}
                </button>
              </div>
            </div>
            <div
              className="ranking-drawer__action-group"
              role="group"
              aria-label={copy.recruitmentActions}
            >
              <div className="ranking-drawer__action-buttons">
                {canShortlist ? (
                  <button
                    type="button"
                    className="ai-ranking-button ai-ranking-button--secondary"
                    onClick={() => void shortlist()}
                    disabled={shortlisting}
                  >
                    {shortlisting ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="is-spinning"
                      />
                    ) : (
                      <ListChecks aria-hidden="true" />
                    )}{" "}
                    {shortlisting ? copy.shortlisting : copy.shortlist}
                  </button>
                ) : null}
                {canOpenRecruitmentChat ? (
                  <button
                    type="button"
                    className="ai-ranking-button ai-ranking-button--primary"
                    onClick={() => void openRecruitmentChat()}
                    disabled={openingRecruitmentChat}
                  >
                    {openingRecruitmentChat ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="is-spinning"
                      />
                    ) : (
                      <MessageSquare aria-hidden="true" />
                    )}{" "}
                    {openingRecruitmentChat
                      ? copy.openingChat
                      : copy.messageCandidate}
                  </button>
                ) : null}
                {!readOnly ? (
                  <button
                    type="button"
                    className="ai-ranking-button ai-ranking-button--primary"
                    onClick={onMoveToInterview}
                    disabled={!canMoveToInterview}
                  >
                    <ArrowRight aria-hidden="true" /> {copy.moveToInterview}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <nav
          className="ranking-drawer__tabs"
          role="tablist"
          aria-label={copy.tabsLabel}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "automatic"}
            className={activeTab === "automatic" ? "is-active" : ""}
            onClick={() => changeTab("automatic")}
          >
            <span>{copy.automatic}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ai"}
            className={activeTab === "ai" ? "is-active" : ""}
            onClick={() => changeTab("ai")}
          >
            <span>{copy.assessment}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "documents"}
            className={activeTab === "documents" ? "is-active" : ""}
            onClick={() => changeTab("documents")}
          >
            <span>{copy.documents}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "profile"}
            className={activeTab === "profile" ? "is-active" : ""}
            onClick={() => void openProfileReview()}
          >
            <span>{copy.profile}</span>
          </button>
        </nav>

        <div className="ranking-drawer__body">
          {shortlistError ? (
            <p className="ai-ranking-error" role="alert">
              {shortlistError}
            </p>
          ) : null}
          {error ? (
            <div className="ranking-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>{error}</span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  void loadDetail().catch((cause) =>
                    setError(
                      locale === "en" && cause instanceof Error
                        ? cause.message
                        : copy.loadError,
                    ),
                  );
                }}
              >
                {copy.retry}
              </button>
              <button type="button" onClick={() => setError(null)}>
                {copy.dismiss}
              </button>
            </div>
          ) : null}
          {scoring.kind === "FAILED" ? (
            <div
              className="drawer-state-banner drawer-state-banner--warning"
              role="alert"
            >
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>{copy.scoringFailed}</strong>
                <span>
                  {copy.scoringStopped(scoring.safeFailureCode ?? "")}
                </span>
              </div>
              {!readOnly && scoring.retryAllowed ? (
                <button type="button" onClick={() => setScoreConfirm(true)}>
                  <RefreshCw aria-hidden="true" /> {copy.retryScoring}
                </button>
              ) : null}
            </div>
          ) : scoring.kind === "UNAVAILABLE" ? (
            <div
              className="drawer-state-banner drawer-state-banner--warning"
              role="status"
            >
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>{copy.aiUnavailable}</strong>
                <span>
                  {copy.aiUnavailableMessage(
                    scoring.aiAssessment.safeFailureCode,
                  )}
                </span>
              </div>
              {!readOnly ? (
                <button type="button" onClick={() => setRetryConfirm(true)}>
                  <RefreshCw aria-hidden="true" /> {copy.retryAi}
                </button>
              ) : null}
            </div>
          ) : scoring.kind === "PENDING" ? (
            <div
              className="drawer-state-banner drawer-state-banner--info"
              role="status"
            >
              <RefreshCw aria-hidden="true" className="is-spinning" />
              <div>
                <strong>{copy.aiRetrying}</strong>
                <span>
                  {copy.aiRetryingDescription(
                    automatic?.score ?? "deterministic",
                  )}
                </span>
              </div>
            </div>
          ) : scoring.kind === "PROCESSING" ? (
            <div
              className="drawer-state-banner drawer-state-banner--info"
              role="status"
            >
              <RefreshCw aria-hidden="true" className="is-spinning" />
              <div>
                <strong>{copy.scoringInProgress}</strong>
                <span>{copy.scoringInProgressDescription}</span>
              </div>
            </div>
          ) : null}
          {detail?.rescoreInProgress ? (
            <div className="drawer-rescore-note" role="status">
              <RefreshCw aria-hidden="true" className="is-spinning" />{" "}
              {copy.rescoring}
            </div>
          ) : null}
          {activeTab === "automatic" ? (
            <AutomaticMatchTab
              automatic={automatic}
              finalScore={finalScore}
              aiScore={
                scoring.kind === "SCORED" ? scoring.aiAssessment.score : null
              }
              retrying={scoring.kind === "PENDING"}
            />
          ) : activeTab === "ai" ? (
            <AiAssessmentTab
              state={scoring}
              canScore={!readOnly}
              onScore={() => setScoreConfirm(true)}
            />
          ) : activeTab === "documents" ? (
            <DocumentsTab
              key={`${openDocument ?? "documents"}-${openDocumentRequest}`}
              jobId={jobId}
              applicationId={candidate.applicationId}
              automatic={automatic}
              openKind={openDocument}
              openRequest={openDocumentRequest}
            />
          ) : (
            <section
              className="candidate-profile-review"
              aria-label={copy.profileReview}
            >
              <header className="candidate-profile-review__intro">
                <span aria-hidden="true">
                  <UserRoundCheck />
                </span>
                <div>
                  <h3>{copy.currentProfile}</h3>
                  <p>{copy.profileDescription}</p>
                </div>
              </header>

              <section className="candidate-profile-card candidate-profile-card--current">
                <span className="candidate-profile-card__eyebrow">
                  Current profile
                </span>
                {profileReview?.liveProfile ? (
                  <>
                    <h4>
                      {profileReview.liveProfile.sections.headline ??
                        copy.noHeadline}
                    </h4>
                    <p>
                      {profileReview.liveProfile.sections.summary ??
                        copy.noSummary}
                    </p>
                    {profileReview.liveProfile.sections.skills?.length ? (
                      <div
                        className="candidate-profile-card__skills"
                        aria-label={copy.sharedSkills}
                      >
                        {profileReview.liveProfile.sections.skills.map(
                          (skill) => (
                            <span key={skill}>{skill}</span>
                          ),
                        )}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="candidate-profile-card__empty">
                    {copy.noSharedSections}
                  </p>
                )}
              </section>

              <p
                className={`candidate-profile-review__contact ${
                  profileReview?.contactShared ? "is-shared" : ""
                }`}
              >
                <ShieldCheck aria-hidden="true" />
                {profileReview?.contactShared
                  ? copy.contactShared
                  : copy.contactNotShared}
              </p>
            </section>
          )}
        </div>

        <footer className="ranking-drawer__footer">
          <div className="ranking-drawer__human-note">
            <UserRoundCheck aria-hidden="true" />
            <span>
              <strong>{copy.humanDecision}</strong>
              <small>{copy.scoreUnchanged}</small>
            </span>
          </div>
          <div className="ranking-drawer__actions">
            {!readOnly ? (
              <>
                {canScoreCandidate ? (
                  <button
                    type="button"
                    className="ai-ranking-button ai-ranking-button--secondary"
                    onClick={() => setScoreConfirm(true)}
                    disabled={scoringActionLoading}
                  >
                    {scoringActionLoading ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="is-spinning"
                      />
                    ) : (
                      <RefreshCw aria-hidden="true" />
                    )}{" "}
                    {scoreActionLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ai-ranking-button ai-ranking-button--secondary"
                  onClick={onSetPriority}
                >
                  <ShieldCheck aria-hidden="true" />{" "}
                  {manuallyPrioritized ? copy.editPriority : copy.setPriority}
                </button>
                <button
                  type="button"
                  className="ai-ranking-button ai-ranking-button--danger-outline"
                  onClick={onReject}
                  disabled={!canReject}
                >
                  <UserRoundCheck aria-hidden="true" /> {copy.reject}
                </button>
              </>
            ) : (
              <span className="ranking-drawer__read-only-note">
                {copy.assessmentView}
              </span>
            )}
          </div>
        </footer>
      </aside>
      {retryConfirm ? (
        <RankingModalFrame
          title={copy.retryDialogTitle}
          subtitle={copy.retryDialogSubtitle(candidate.candidate.displayName)}
          icon="AI"
          info={copy.retryDialogInfo}
          confirmLabel={copy.retryAi}
          cancelLabel={locale === "vi" ? "Hủy" : "Cancel"}
          onCancel={() => setRetryConfirm(false)}
          onConfirm={() => void retry()}
        />
      ) : null}
      {scoreConfirm ? (
        <RankingModalFrame
          title={copy.scoreDialogTitle(scoreActionLabel)}
          subtitle={copy.scoreDialogSubtitle(candidate.candidate.displayName)}
          icon="AI"
          info={copy.scoreDialogInfo}
          cancelLabel={locale === "vi" ? "Hủy" : "Cancel"}
          confirmLabel={scoreActionLabel}
          confirmDisabled={scoringActionLoading}
          onCancel={() => setScoreConfirm(false)}
          onConfirm={() => void scoreCandidate()}
        />
      ) : null}
    </div>
  );
}

function scoreSummaryForCandidate(candidate: CandidateScoreDrawerCandidate) {
  if ("scoreSummary" in candidate) {
    return {
      final: candidate.scoreSummary.final,
      band: candidate.scoreSummary.band,
      aiBand: candidate.scoreSummary.aiBand ?? null,
    };
  }
  return {
    final: candidate.score?.final ?? null,
    band: candidate.score?.band ?? null,
    aiBand: candidate.score?.aiScoreBand ?? null,
  };
}

function rowToScoring(candidate: CandidateScoreDrawerCandidate): ScoringState {
  if ("score" in candidate) {
    if (candidate.score?.state === "FAILED")
      return {
        kind: "FAILED",
        label: "Scoring failed",
        safeFailureCode: null,
        retryAllowed: true,
      };
    if (candidate.score?.state === "PROCESSING")
      return {
        kind: "PROCESSING",
        label: "Processing",
        operationId: `pipeline-${candidate.applicationId}`,
      };
    if (candidate.score?.state === "PENDING")
      return {
        kind: "PENDING",
        label: "Pending",
        operationId: `pipeline-${candidate.applicationId}`,
        automaticMatch: null,
      };
    return { kind: "NOT_CALCULATED", label: "Not calculated" };
  }
  if (candidate.scoring.kind === "FAILED")
    return {
      kind: "FAILED",
      label: "Scoring failed",
      safeFailureCode: null,
      retryAllowed: true,
    };
  if (candidate.scoring.kind === "PROCESSING")
    return {
      kind: "PROCESSING",
      label: "Processing",
      operationId: candidate.scoring.operationId,
    };
  if (candidate.scoring.kind === "PENDING")
    return {
      kind: "PENDING",
      label: "Pending",
      operationId: candidate.scoring.operationId,
      automaticMatch: null,
    };
  return { kind: "NOT_CALCULATED", label: "Not calculated" };
}
