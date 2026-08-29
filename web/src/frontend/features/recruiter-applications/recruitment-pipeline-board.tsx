"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FileText, Pin, RefreshCw, Search, X } from "lucide-react";
import type {
  ApplicationStage,
  PipelineBoardColumnStage,
  PipelineApplicationCard,
  PipelineColumnSummary,
  StageTransitionCommand,
} from "@/shared/contracts/applications";
import { isTerminalPipelineStage } from "@/shared/contracts/applications";
import { RecruitmentPipelineColumn } from "./recruitment-pipeline-column";
import { RecruitmentPipelineCard } from "./recruitment-pipeline-card";
import { CandidateScoreDrawer } from "./candidate-score-drawer";
import {
  ApplicationStageChangeDialog,
  stageTransitionNeedsDialog,
} from "./application-stage-change-dialog";
import { useRecruitmentPipeline } from "./use-recruitment-pipeline";
import {
  filterPipelineCards,
  pipelineScoreForCard,
  sortPipelineCards,
  type PipelineSortDirection,
  type PipelineTierFilter,
} from "./recruitment-pipeline-ui";
import {
  RecruitmentPipelineViewAllModal,
  type ViewAllPipelineStage,
} from "./recruitment-pipeline-view-all-modal";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import {
  recruiterApplicationsCopy,
  type RecruiterApplicationsCopy,
} from "./recruiter-applications-copy";

const activePipelineStages: ApplicationStage[] = [
  "APPLIED",
  "VIEWED",
  "SHORTLISTED",
  "INTERVIEWING",
  "OFFERED",
];

const outcomeStages: ApplicationStage[] = [
  "HIRED",
  "OFFER_DECLINED",
  "REJECTED",
  "WAITLISTED",
];

const viewAllStages = new Set<PipelineBoardColumnStage>([
  ...activePipelineStages,
  ...outcomeStages,
  "WITHDRAWN",
]);

function isViewAllPipelineStage(
  stage: PipelineBoardColumnStage,
): stage is ViewAllPipelineStage {
  return viewAllStages.has(stage);
}

const defaultSortDirections: Record<ApplicationStage, PipelineSortDirection> = {
  APPLIED: "none",
  VIEWED: "none",
  SHORTLISTED: "none",
  INTERVIEWING: "none",
  OFFERED: "none",
  HIRED: "none",
  OFFER_DECLINED: "none",
  REJECTED: "none",
  WAITLISTED: "none",
};

function dateFilterLabel(
  filter: PipelineTierFilter,
  query: string,
  options: Array<{ value: PipelineTierFilter; label: string }>,
  copy: RecruiterApplicationsCopy["pipeline"],
) {
  const tier = options.find((option) => option.value === filter)?.label;
  if (filter === "all" && !query) return copy.showingAll;
  return copy.showingFiltered(tier?.toLocaleLowerCase() ?? "tier", query);
}

export function RecruitmentPipelineBoard({ jobId }: { jobId: string }) {
  const locale = useWorkspaceLocale();
  const copy = recruiterApplicationsCopy(locale).pipeline;
  const tierOptions: Array<{ value: PipelineTierFilter; label: string }> = [
    { value: "all", label: copy.all },
    { value: "strong", label: copy.strong },
    { value: "review", label: copy.review },
    { value: "low", label: copy.low },
    { value: "pending", label: copy.pending },
  ];
  const state = useRecruitmentPipeline(jobId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const [activeCard, setActiveCard] = useState<PipelineApplicationCard | null>(
    null,
  );
  const [assessmentCard, setAssessmentCard] =
    useState<PipelineApplicationCard | null>(null);
  const [previewCard, setPreviewCard] =
    useState<PipelineApplicationCard | null>(null);
  const [previewPinned, setPreviewPinned] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [dialog, setDialog] = useState<{
    card: PipelineApplicationCard;
    target?: ApplicationStage;
    intent?: "button" | "drag";
  } | null>(null);
  const [tierFilter, setTierFilter] = useState<PipelineTierFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortDirections, setSortDirections] = useState(defaultSortDirections);
  const [openSortMenu, setOpenSortMenu] = useState<ApplicationStage | null>(
    null,
  );
  const [viewAllStage, setViewAllStage] = useState<ViewAllPipelineStage | null>(
    null,
  );
  const [bulkRejectCards, setBulkRejectCards] = useState<
    readonly PipelineApplicationCard[] | null
  >(null);
  const [bulkRejectBusy, setBulkRejectBusy] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const assessmentReturnFocus = useRef<HTMLElement | null>(null);
  const previewCloseTimer = useRef<number | null>(null);
  const previewVersion = useRef(0);
  const previewRef = useRef<HTMLElement | null>(null);
  const cards = useMemo(
    () =>
      Object.values(state.columns).flatMap(
        (column) => column?.page?.items ?? [],
      ),
    [state.columns],
  );
  const filterActive = tierFilter !== "all" || Boolean(searchQuery.trim());

  useEffect(() => {
    if (openSortMenu === null) return;
    const closeMenu = () => setOpenSortMenu(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [openSortMenu]);

  useEffect(
    () => () => {
      if (previewCloseTimer.current !== null) {
        window.clearTimeout(previewCloseTimer.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!previewCard || !previewPosition || !previewRef.current) return;

    const popup = previewRef.current.getBoundingClientRect();
    const viewportBottom = window.innerHeight - 5;
    if (popup.bottom <= viewportBottom) return;

    setPreviewPosition((current) =>
      current
        ? {
            ...current,
            top: Math.max(5, current.top - (popup.bottom - viewportBottom)),
          }
        : current,
    );
  }, [previewCard, previewPosition]);

  const cancelPreviewClose = () => {
    previewVersion.current += 1;
    if (previewCloseTimer.current !== null) {
      window.clearTimeout(previewCloseTimer.current);
      previewCloseTimer.current = null;
    }
  };

  const previewCandidate = (
    card: PipelineApplicationCard,
    pinned: boolean,
    anchor: DOMRect,
  ) => {
    cancelPreviewClose();
    const version = previewVersion.current;
    const popupWidth = 320;
    const viewportPadding = 16;
    const preferredLeft = anchor.right + 12;
    const left =
      preferredLeft + popupWidth <= window.innerWidth - viewportPadding
        ? preferredLeft
        : Math.max(viewportPadding, anchor.left - popupWidth - 12);
    if (pinned) {
      setPreviewPosition({ top: anchor.top, left });
      setPreviewCard(card);
      setPreviewPinned(true);
      return;
    }
    if (previewPinned) return;
    if (previewCard?.applicationId !== card.applicationId) {
      setPreviewCard(null);
      setPreviewPosition(null);
    }
    previewCloseTimer.current = window.setTimeout(() => {
      if (previewVersion.current !== version || previewPinned) return;
      setPreviewPosition({ top: anchor.top, left });
      setPreviewCard(card);
      previewCloseTimer.current = null;
    }, 280);
  };

  const schedulePreviewClose = () => {
    cancelPreviewClose();
    if (previewPinned) return;
    const version = previewVersion.current;
    previewCloseTimer.current = window.setTimeout(() => {
      if (previewVersion.current !== version) return;
      setPreviewCard(null);
      setPreviewPosition(null);
      previewCloseTimer.current = null;
    }, 250);
  };

  const visiblePage = (stage: PipelineBoardColumnStage) => {
    const column = state.columns[stage];
    if (!column?.page) return null;
    const filtered = filterPipelineCards(
      column.page.items,
      tierFilter,
      searchQuery,
    );
    return {
      ...column.page,
      items: sortPipelineCards(
        filtered,
        stage === "WITHDRAWN" ? "none" : sortDirections[stage],
      ),
    };
  };

  const restoreFocus = (applicationId: string) =>
    window.setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(
            `[data-application-id="${CSS.escape(applicationId)}"]`,
          )
          ?.focus(),
      0,
    );

  const onDragStart = (event: DragStartEvent) => {
    const card =
      cards.find((item) => item.applicationId === String(event.active.id)) ??
      null;
    setActiveCard(
      card &&
        !isTerminalPipelineStage(card.stage) &&
        card.withdrawalOutcome !== "CANDIDATE_WITHDRAWN"
        ? card
        : null,
    );
    returnFocus.current = document.activeElement as HTMLElement | null;
  };

  const onDragCancel = () => {
    setActiveCard(null);
    setTimeout(() => returnFocus.current?.focus(), 0);
  };

  const moveCard = (
    card: PipelineApplicationCard,
    target: ApplicationStage,
    extras: Parameters<typeof state.move>[2],
    intent: "button" | "drag",
  ) => {
    if (intent === "drag" && state.moveDrag) {
      return state.moveDrag(card, target, extras);
    }
    return state.move(card, target, extras);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const card = activeCard;
    setActiveCard(null);
    const target = event.over?.data.current?.stage as
      | PipelineBoardColumnStage
      | undefined;
    const dragDestinations = card?.dragDestinations ?? [];
    if (
      !card ||
      isTerminalPipelineStage(card.stage) ||
      card.withdrawalOutcome === "CANDIDATE_WITHDRAWN" ||
      !target ||
      target === "WITHDRAWN" ||
      target === card.stage ||
      !dragDestinations.includes(target)
    ) {
      setTimeout(() => returnFocus.current?.focus(), 0);
      return;
    }

    returnFocus.current = document.activeElement as HTMLElement | null;
    if (stageTransitionNeedsDialog(target)) {
      setDialog({ card, target, intent: "drag" });
      return;
    }
    void moveCard(card, target, {}, "drag").finally(() =>
      restoreFocus(card.applicationId),
    );
  };

  const requestStageChange = (
    card: PipelineApplicationCard,
    target?: ApplicationStage,
  ) => {
    returnFocus.current = document.activeElement as HTMLElement;
    if (
      isTerminalPipelineStage(card.stage) ||
      card.withdrawalOutcome === "CANDIDATE_WITHDRAWN"
    )
      return;
    if (target && !stageTransitionNeedsDialog(target)) {
      void moveCard(card, target, {}, "button").finally(() =>
        restoreFocus(card.applicationId),
      );
      return;
    }
    setDialog({ card, target, intent: "button" });
  };

  const runBulkMove = async (
    selectedCards: readonly PipelineApplicationCard[],
    targetStage: ApplicationStage,
    extras: Omit<
      StageTransitionCommand,
      "targetStage" | "expectedStageVersion"
    > = {},
  ) => {
    await state.moveMany(selectedCards, targetStage, extras);
    await state.retry();
    setViewAllStage(null);
  };

  const openAssessment = (card: PipelineApplicationCard) => {
    assessmentReturnFocus.current =
      document.activeElement as HTMLElement | null;
    setAssessmentCard(card);
  };

  const closeAssessment = () => {
    const target = assessmentReturnFocus.current;
    assessmentReturnFocus.current = null;
    setAssessmentCard(null);
    window.setTimeout(() => target?.focus(), 0);
  };

  const renderColumn = (summary: PipelineColumnSummary) => {
    const column = state.columns[summary.stage];
    const page = visiblePage(summary.stage);
    return (
      <RecruitmentPipelineColumn
        key={summary.stage}
        jobId={jobId}
        summary={summary}
        page={page}
        loading={column?.loading ?? true}
        loadingMore={column?.loadingMore ?? false}
        error={column?.error ?? null}
        onLoadMore={state.loadMore}
        onRetry={(stage) => void state.loadStage(stage)}
        onViewAll={(stage) => {
          if (isViewAllPipelineStage(stage)) setViewAllStage(stage);
        }}
        showViewAll={isViewAllPipelineStage(summary.stage)}
        onChangeStage={requestStageChange}
        onViewAssessment={openAssessment}
        sortDirection={
          summary.stage === "WITHDRAWN" ? "none" : sortDirections[summary.stage]
        }
        sortMenuOpen={openSortMenu === summary.stage}
        onToggleSortMenu={(stage) =>
          setOpenSortMenu((current) => (current === stage ? null : stage))
        }
        onSortDirectionChange={(stage, direction) => {
          setSortDirections((current) => ({ ...current, [stage]: direction }));
          setOpenSortMenu(null);
        }}
        filterActive={filterActive}
        loadedItemCount={column?.page?.items.length ?? 0}
        onPreview={previewCandidate}
        onPreviewLeave={schedulePreviewClose}
        previewedApplicationId={previewCard?.applicationId}
        copy={copy}
      />
    );
  };

  const previewQuickActionLabels: Partial<Record<ApplicationStage, string>> = {
    SHORTLISTED: copy.moveToShortlist,
    INTERVIEWING: copy.moveToInterview,
    OFFERED: copy.sendOffer,
    REJECTED: copy.reject,
    WAITLISTED: copy.waitlist,
  };
  const previewLocked =
    previewCard?.withdrawalOutcome === "CANDIDATE_WITHDRAWN" ||
    previewCard?.stage === "OFFERED" ||
    previewCard?.stage === "HIRED" ||
    previewCard?.stage === "OFFER_DECLINED" ||
    previewCard?.stage === "REJECTED";
  const previewQuickActions =
    previewCard && !previewLocked
      ? previewCard.allowedDestinations
          .filter((stage) => previewQuickActionLabels[stage])
          .map((stage) => ({
            stage,
            label: previewQuickActionLabels[stage] as string,
          }))
      : [];

  if (state.loading && !state.metadata) {
    return (
      <div className="pipeline-state" role="status">
        {copy.loading}
      </div>
    );
  }
  if (state.error || !state.metadata) {
    return (
      <div className="pipeline-state" role="alert">
        <p>{copy.unavailable}</p>
        <button type="button" onClick={() => void state.retry()}>
          {copy.retry}
        </button>
      </div>
    );
  }

  const boardMetadata = state.metadata;
  const withdrawnSummary: PipelineColumnSummary = {
    stage: "WITHDRAWN",
    label: "Withdrawn",
    count: boardMetadata.withdrawnCount ?? 0,
  };
  const summaryForStage = (stage: ViewAllPipelineStage) =>
    stage === "WITHDRAWN"
      ? withdrawnSummary
      : boardMetadata.stages.find((item) => item.stage === stage);
  const total =
    boardMetadata.stages.reduce((sum, item) => sum + item.count, 0) +
    withdrawnSummary.count;
  return (
    <div
      className="recruitment-pipeline"
      aria-label={copy.pipelineFor(boardMetadata.job.title)}
    >
      <header className="page-header recruitment-pipeline__header">
        <div>
          <h1>{copy.pipelineFor(boardMetadata.job.title)}</h1>
          <p>
            {boardMetadata.job.status === "CLOSED"
              ? locale === "vi"
                ? "Đã đóng nhận hồ sơ mới; các quyết định tuyển dụng vẫn được giữ lại."
                : "Closed to new applications; recruitment decisions remain available."
              : locale === "vi"
                ? `${total} đơn ứng tuyển trong quy trình.`
                : `${total} applications across the pipeline.`}
          </p>
        </div>
        <div className="recruitment-pipeline__header-actions">
          <span className="sr-only">
            {copy.readOnly}:{" "}
            {boardMetadata.permissions.canMoveStages
              ? locale === "vi"
                ? "Không, các điều khiển vòng đang bật."
                : "No, stage controls are enabled."
              : locale === "vi"
                ? "Có."
                : "Yes."}
          </span>
          {!boardMetadata.permissions.canMoveStages ? (
            <strong>{copy.readOnly}</strong>
          ) : null}
          <button
            type="button"
            className="btn-refresh"
            onClick={() => void state.retry()}
          >
            <RefreshCw aria-hidden="true" />
            {copy.refresh}
          </button>
        </div>
      </header>
      <p className="sr-only" aria-live="polite">
        {state.announcement}
      </p>
      {state.canRetryStageMove ? (
        <button type="button" onClick={() => void state.retryStageMove()}>
          {copy.retryStageChange}
        </button>
      ) : null}

      {/* Additions outside the original flow: local filter/search over loaded cards. */}
      <div
        className="filter-bar pipeline-filter-bar"
        data-addition="outside-original-flow"
      >
        <label
          className="search-input pipeline-search-field"
          htmlFor="pipeline-candidate-search"
        >
          <Search aria-hidden="true" />
          <span className="sr-only">{copy.searchCandidates}</span>
          <input
            id="pipeline-candidate-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
          />
        </label>
        <div
          className="filter-pills pipeline-tier-filters"
          role="group"
          aria-label={copy.tierFilter}
        >
          {tierOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                tierFilter === option.value
                  ? "pill pipeline-tier-filter active is-active"
                  : "pill pipeline-tier-filter"
              }
              data-filter={option.value}
              aria-pressed={tierFilter === option.value}
              onClick={() => setTierFilter(option.value)}
            >
              {option.value !== "all" ? (
                <span className="dot" aria-hidden="true" />
              ) : null}
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="pipeline-filter-status" role="status">
        {dateFilterLabel(tierFilter, searchQuery, tierOptions, copy)}
      </p>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => copy.drag.picked(String(active.id)),
            onDragOver: ({ over }) =>
              over ? copy.drag.over(String(over.id)) : copy.drag.notOver,
            onDragEnd: ({ over }) =>
              over ? copy.drag.dropped(String(over.id)) : copy.drag.cancelled,
            onDragCancel: () => copy.drag.cancelled,
          },
        }}
      >
        <div className="recruitment-pipeline__workspace">
          <div className="recruitment-pipeline__sections">
            <section className="pipeline-section pipeline-section--active">
              <div className="section-head pipeline-section__header">
                <h2 id="active-pipeline-heading">{copy.activePipeline}</h2>
                <span>{copy.activePipelineDescription}</span>
              </div>
              <div className="board recruitment-pipeline__columns">
                {activePipelineStages.map((stage) => {
                  const summary = boardMetadata.stages.find(
                    (item) => item.stage === stage,
                  );
                  return summary ? renderColumn(summary) : null;
                })}
              </div>
            </section>
            <hr className="section-divider" />
            <section className="pipeline-section pipeline-section--outcomes">
              <div className="section-head pipeline-section__header">
                <h2 id="pipeline-outcomes-heading">{copy.outcomes}</h2>
                <span>{copy.outcomesDescription}</span>
              </div>
              <div className="board outcomes recruitment-pipeline__columns">
                {outcomeStages.map((stage) => {
                  const summary = boardMetadata.stages.find(
                    (item) => item.stage === stage,
                  );
                  return summary ? renderColumn(summary) : null;
                })}
                {renderColumn(withdrawnSummary)}
              </div>
            </section>
          </div>
          {previewCard ? (
            <aside
              ref={previewRef}
              className="pipeline-candidate-preview"
              aria-live="polite"
              style={previewPosition ?? undefined}
              onMouseEnter={cancelPreviewClose}
              onMouseLeave={schedulePreviewClose}
            >
              <>
                <header className="pipeline-candidate-preview__header">
                  <div>
                    <p>{copy.candidatePreview}</p>
                    <h2>{previewCard.candidate.displayName}</h2>
                  </div>
                  <div className="pipeline-candidate-preview__actions">
                    <button
                      type="button"
                      aria-pressed={previewPinned}
                      aria-label={copy.pinPreview}
                      title={copy.pinPreview}
                      onClick={() => setPreviewPinned((current) => !current)}
                    >
                      <Pin aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={copy.closePreview}
                      title={copy.closePreview}
                      onClick={() => {
                        cancelPreviewClose();
                        setPreviewCard(null);
                        setPreviewPinned(false);
                        setPreviewPosition(null);
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                </header>
                <dl className="pipeline-candidate-preview__details">
                  <div>
                    <dt>{copy.stage}</dt>
                    <dd>{copy.stageLabels[previewCard.stage]}</dd>
                  </div>
                  <div>
                    <dt>{copy.finalScore}</dt>
                    <dd>
                      {pipelineScoreForCard(previewCard) === null
                        ? copy.finalScoreUnavailable
                        : `${Math.round(pipelineScoreForCard(previewCard) ?? 0)}%`}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.submittedLabel}</dt>
                    <dd>
                      {new Date(previewCard.submittedAt).toLocaleDateString(
                        locale === "vi" ? "vi-VN" : "en-US",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.documents}</dt>
                    <dd>
                      {previewCard.documents.cvAvailable
                        ? copy.cvAvailable
                        : copy.cvUnavailable}
                    </dd>
                  </div>
                </dl>
                <div className="pipeline-candidate-preview__actions-list">
                  {previewCard.documents.cvAvailable ? (
                    <a
                      href={`/api/recruiter/jobs/${encodeURIComponent(jobId)}/applications/${encodeURIComponent(previewCard.applicationId)}/documents/cv`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {copy.openCv}
                    </a>
                  ) : null}
                  {previewCard.documents.coverLetterAvailable ? (
                    <a
                      href={`/api/recruiter/jobs/${encodeURIComponent(jobId)}/applications/${encodeURIComponent(previewCard.applicationId)}/documents/cover-letter`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {copy.coverLetter}
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="pipeline-candidate-preview__assessment"
                    onClick={() => openAssessment(previewCard)}
                  >
                    <FileText aria-hidden="true" />
                    {copy.viewAiAssessment}
                  </button>
                  {previewQuickActions.map(({ stage, label }) => (
                    <button
                      key={stage}
                      type="button"
                      className="pipeline-candidate-preview__stage-action"
                      onClick={() => requestStageChange(previewCard, stage)}
                    >
                      {label}
                    </button>
                  ))}
                  {!previewLocked &&
                  previewCard.allowedDestinations.length > 0 ? (
                    <button
                      type="button"
                      className="pipeline-candidate-preview__stage-action pipeline-candidate-preview__stage-action--secondary"
                      onClick={() => requestStageChange(previewCard)}
                    >
                      {copy.changeStage}
                    </button>
                  ) : null}
                </div>
              </>
            </aside>
          ) : null}
        </div>
        <DragOverlay>
          {activeCard ? (
            <RecruitmentPipelineCard
              card={activeCard}
              jobId={jobId}
              dragOverlay
              copy={copy}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      {dialog ? (
        <ApplicationStageChangeDialog
          card={dialog.card}
          initialTarget={dialog.target}
          fixedTarget={
            dialog.intent === "drag" &&
            dialog.target &&
            !dialog.card.allowedDestinations.includes(dialog.target)
              ? dialog.target
              : undefined
          }
          onCancel={() => {
            const id = dialog.card.applicationId;
            setDialog(null);
            restoreFocus(id);
          }}
          onSubmit={(target, extras) => {
            const card = dialog.card;
            const intent = dialog.intent ?? "button";
            setDialog(null);
            void moveCard(card, target, extras, intent).finally(() =>
              restoreFocus(card.applicationId),
            );
          }}
        />
      ) : null}
      {viewAllStage
        ? (() => {
            const summary = summaryForStage(viewAllStage);
            return summary ? (
              <RecruitmentPipelineViewAllModal
                jobId={jobId}
                summary={summary}
                canMoveStages={boardMetadata.permissions.canMoveStages}
                canReject={boardMetadata.permissions.canReject}
                onClose={() => setViewAllStage(null)}
                onBulkMove={runBulkMove}
                onBulkReject={(cards) => {
                  setBulkRejectBusy(false);
                  setBulkRejectCards(cards);
                }}
              />
            ) : null;
          })()
        : null}
      {bulkRejectCards ? (
        <ApplicationStageChangeDialog
          card={bulkRejectCards[0]}
          initialTarget="REJECTED"
          fixedTarget="REJECTED"
          title={copy.bulkRejectTitle(bulkRejectCards.length)}
          description={copy.bulkRejectDescription}
          busy={bulkRejectBusy}
          onCancel={() => {
            if (!bulkRejectBusy) {
              setBulkRejectBusy(false);
              setBulkRejectCards(null);
            }
          }}
          onSubmit={(target, extras) => {
            const cards = bulkRejectCards;
            setBulkRejectBusy(true);
            void runBulkMove(cards, target, extras).then(() => {
              setBulkRejectBusy(false);
              setBulkRejectCards(null);
            });
          }}
        />
      ) : null}
      {assessmentCard ? (
        <CandidateScoreDrawer
          jobId={jobId}
          jobTitle={boardMetadata.job.title}
          candidate={assessmentCard}
          readOnly
          onClose={closeAssessment}
          onSetPriority={() => undefined}
          onShortlist={() => undefined}
          onMoveToInterview={() => undefined}
          onReject={() => undefined}
          onApplicationOpened={() => {
            void state.retry({ preserve: true });
          }}
          onOpenRecruitmentChat={async () => undefined}
          onScoringChanged={() => {
            void state.retry({ preserve: true });
          }}
        />
      ) : null}
    </div>
  );
}
