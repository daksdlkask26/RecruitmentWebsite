"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Inbox,
  List as ListIcon,
  SlidersHorizontal,
} from "lucide-react";
import type {
  ApplicationStage,
  PipelineBoardColumnStage,
  PipelineBoardPage,
  PipelineColumnSummary,
} from "@/shared/contracts/applications";
import type { PipelineSortDirection } from "./recruitment-pipeline-ui";
import { canSortPipelineStage } from "./recruitment-pipeline-ui";
import { RecruitmentPipelineCard } from "./recruitment-pipeline-card";
import {
  recruiterApplicationsCopy,
  type RecruiterApplicationsCopy,
} from "./recruiter-applications-copy";

type PipelineColumnProps = {
  jobId: string;
  summary: PipelineColumnSummary;
  page: PipelineBoardPage | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  onLoadMore: (stage: PipelineBoardColumnStage) => void;
  onRetry: (stage: PipelineBoardColumnStage) => void;
  onViewAll?: (stage: PipelineBoardColumnStage) => void;
  showViewAll?: boolean;
  onChangeStage?: Parameters<
    typeof RecruitmentPipelineCard
  >[0]["onChangeStage"];
  onViewAssessment?: Parameters<
    typeof RecruitmentPipelineCard
  >[0]["onViewAssessment"];
  onPreview?: Parameters<typeof RecruitmentPipelineCard>[0]["onPreview"];
  onPreviewLeave?: Parameters<
    typeof RecruitmentPipelineCard
  >[0]["onPreviewLeave"];
  previewedApplicationId?: string | null;
  sortDirection?: PipelineSortDirection;
  sortMenuOpen?: boolean;
  onToggleSortMenu?: (stage: ApplicationStage) => void;
  onSortDirectionChange?: (
    stage: ApplicationStage,
    direction: PipelineSortDirection,
  ) => void;
  filterActive?: boolean;
  loadedItemCount?: number;
  copy?: RecruiterApplicationsCopy["pipeline"];
};

const lockedStages = new Set<ApplicationStage>([
  "WAITLISTED",
  "HIRED",
  "OFFER_DECLINED",
]);

export function RecruitmentPipelineColumn({
  jobId,
  summary,
  page,
  loading,
  loadingMore,
  error,
  onLoadMore,
  onRetry,
  onViewAll,
  showViewAll = false,
  onChangeStage,
  onViewAssessment,
  onPreview,
  onPreviewLeave,
  previewedApplicationId,
  sortDirection = "none",
  sortMenuOpen = false,
  onToggleSortMenu,
  onSortDirectionChange,
  filterActive = false,
  loadedItemCount = page?.items.length ?? 0,
  copy: copyProp,
}: PipelineColumnProps) {
  const copy = copyProp ?? recruiterApplicationsCopy("en").pipeline;
  const displayLabel = copy.stageLabels[summary.stage] ?? summary.label;
  const sortOptionLabels: Record<PipelineSortDirection, string> = {
    none: copy.defaultSort,
    asc: copy.scoreLowHigh,
    desc: copy.scoreHighLow,
  };
  const withdrawn = summary.stage === "WITHDRAWN";
  const canonicalStage = withdrawn ? null : summary.stage;
  const locked =
    withdrawn || (canonicalStage !== null && lockedStages.has(canonicalStage));
  const droppable = useDroppable({
    id: summary.stage,
    data: { stage: summary.stage },
    disabled: locked,
  });
  const { setNodeRef, isOver } = droppable;
  const headingId = `pipeline-${summary.stage.toLowerCase()}-heading`;
  const canSort =
    canonicalStage !== null && canSortPipelineStage(canonicalStage);
  const visibleItems = page?.items ?? [];
  const hasMore =
    page?.hasMore ??
    (page?.nextCursor !== null && page?.nextCursor !== undefined);
  const noFilterMatch =
    !loading &&
    !error &&
    filterActive &&
    loadedItemCount > 0 &&
    visibleItems.length === 0;

  return (
    <section
      ref={setNodeRef}
      className={
        "column pipeline-column" +
        (summary.count > 0 ? " has-cards" : "") +
        (isOver ? " is-drag-over" : "") +
        (locked ? " is-locked" : "") +
        (withdrawn ? " is-withdrawn" : "")
      }
      role="region"
      aria-labelledby={headingId}
      aria-disabled={locked || undefined}
      data-stage={summary.stage}
    >
      <header className="column-head pipeline-column__header">
        <div className="column-head-left pipeline-column__heading">
          <h2
            id={headingId}
            className="column-title"
            aria-describedby={`${headingId}-count`}
          >
            {displayLabel}
          </h2>
          <span
            className="column-count"
            id={`${headingId}-count`}
            aria-label={`${summary.count} candidates`}
          >
            {summary.count}
          </span>
        </div>
        <div className="column-head-tools pipeline-column__header-tools">
          {canSort &&
          canonicalStage &&
          onToggleSortMenu &&
          onSortDirectionChange ? (
            <div className="column-sort pipeline-column__sort">
              <button
                type="button"
                className={
                  sortDirection === "none"
                    ? "column-sort-btn pipeline-sort-button"
                    : "column-sort-btn pipeline-sort-button active is-active"
                }
                data-dir={sortDirection}
                aria-haspopup="menu"
                aria-expanded={sortMenuOpen}
                aria-label={copy.sortCandidates(displayLabel)}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSortMenu(canonicalStage);
                }}
              >
                <SlidersHorizontal aria-hidden="true" />
              </button>
              {sortMenuOpen ? (
                <div
                  className="column-sort-menu pipeline-sort-menu open"
                  role="menu"
                  aria-label={copy.sortOptions(displayLabel)}
                  onClick={(event) => event.stopPropagation()}
                >
                  {(["none", "asc", "desc"] as const).map((direction) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortDirection === direction}
                      className={
                        sortDirection === direction
                          ? "column-sort-option pipeline-sort-option selected is-selected"
                          : "column-sort-option pipeline-sort-option"
                      }
                      data-sort={direction}
                      key={direction}
                      onClick={() =>
                        onSortDirectionChange(canonicalStage, direction)
                      }
                    >
                      {direction === "none" ? (
                        <SlidersHorizontal aria-hidden="true" />
                      ) : direction === "asc" ? (
                        <ArrowUp aria-hidden="true" />
                      ) : (
                        <ArrowDown aria-hidden="true" />
                      )}
                      <span>{sortOptionLabels[direction]}</span>
                      {sortDirection === direction ? (
                        <Check aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      <div className="card-stack pipeline-column__cards" data-card-stack>
        {loading ? (
          <p role="status">{copy.loadingApplications}</p>
        ) : error ? (
          <div role="alert">
            <p>{copy.unavailable}</p>
            <button type="button" onClick={() => onRetry(summary.stage)}>
              {copy.retry}
            </button>
          </div>
        ) : !visibleItems.length ? (
          <div className="column-empty pipeline-column__empty">
            <Inbox aria-hidden="true" />
            <span aria-label={copy.noCandidates}>
              {noFilterMatch ? copy.noFilterMatch : copy.noCandidates}
            </span>
          </div>
        ) : (
          visibleItems.map((card) => (
            <RecruitmentPipelineCard
              key={card.applicationId}
              card={card}
              jobId={jobId}
              onChangeStage={onChangeStage}
              onViewAssessment={onViewAssessment}
              onPreview={onPreview}
              onPreviewLeave={onPreviewLeave}
              previewed={card.applicationId === previewedApplicationId}
              copy={copy}
            />
          ))
        )}
      </div>
      {hasMore || showViewAll ? (
        <footer className="column-footer">
          {hasMore ? (
            <button
              type="button"
              onClick={() => onLoadMore(summary.stage)}
              disabled={loadingMore}
              className="load-more-btn pipeline-column__load-more"
            >
              {loadingMore
                ? copy.loadingApplications
                : copy.loadMore(displayLabel)}
            </button>
          ) : null}
          {showViewAll && onViewAll ? (
            <button
              type="button"
              onClick={() => onViewAll(summary.stage)}
              className="view-all-btn pipeline-column__view-all"
            >
              <ListIcon aria-hidden="true" />
              {copy.viewFullList}
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
