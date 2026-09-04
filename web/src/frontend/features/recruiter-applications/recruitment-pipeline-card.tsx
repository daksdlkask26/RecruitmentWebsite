"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical, LockKeyhole } from "lucide-react";
import { type KeyboardEvent } from "react";
import {
  isTerminalPipelineStage,
  type ApplicationStage,
  type PipelineApplicationCard,
} from "@/shared/contracts/applications";
import {
  pipelineScoreForCard,
  pipelineTierForCard,
} from "./recruitment-pipeline-ui";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import {
  recruiterApplicationsCopy,
  type RecruiterApplicationsCopy,
} from "./recruiter-applications-copy";

const lockedStages = new Set<ApplicationStage>([
  "OFFERED",
  "HIRED",
  "OFFER_DECLINED",
  "REJECTED",
]);

type PipelineTier = "strong" | "review" | "low" | "pending";

function ScoreRing({
  score,
  tier,
  candidateName,
  copy,
}: {
  score: number | null;
  tier: PipelineTier;
  candidateName: string;
  copy: RecruiterApplicationsCopy["pipeline"];
}) {
  const dashOffset =
    score === null
      ? undefined
      : 113 - (Math.max(0, Math.min(100, score)) / 100) * 113;

  return (
    <div
      className={`score-ring ring-${tier} pipeline-card__score-ring`}
      role={score === null ? undefined : "progressbar"}
      aria-label={
        score === null
          ? copy.finalScoreUnavailable
          : copy.finalScoreFor(Math.round(score), candidateName)
      }
      aria-valuemin={score === null ? undefined : 0}
      aria-valuemax={score === null ? undefined : 100}
      aria-valuenow={score === null ? undefined : Math.round(score)}
    >
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="track" cx="22" cy="22" r="18" />
        {score !== null ? (
          <circle
            className="value"
            cx="22"
            cy="22"
            r="18"
            strokeDasharray="113"
            strokeDashoffset={dashOffset}
          />
        ) : null}
      </svg>
      <div className="score-num">
        {score === null ? "\u2014" : `${Math.round(score)}%`}
      </div>
    </div>
  );
}

function stopInteractiveEvent(event: {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}) {
  if (!(event.target instanceof Element)) return false;
  const interactive = event.target.closest(
    "a, button, input, select, textarea, [role='button'], [contenteditable='true']",
  );
  return Boolean(interactive && interactive !== event.currentTarget);
}
export function RecruitmentPipelineCard({
  card,
  onPreview,
  onPreviewLeave,
  previewed = false,
  dragOverlay = false,
  copy: copyProp,
}: {
  card: PipelineApplicationCard;
  jobId: string;
  onChangeStage?: (
    card: PipelineApplicationCard,
    targetStage?: ApplicationStage,
  ) => void;
  onViewAssessment?: (card: PipelineApplicationCard) => void;
  onPreview?: (
    card: PipelineApplicationCard,
    pinned: boolean,
    anchor: DOMRect,
  ) => void;
  onPreviewLeave?: () => void;
  previewed?: boolean;
  dragOverlay?: boolean;
  copy?: RecruiterApplicationsCopy["pipeline"];
}) {
  const locale = useWorkspaceLocale();
  const copy = copyProp ?? recruiterApplicationsCopy(locale).pipeline;
  const withdrawn = card.withdrawalOutcome === "CANDIDATE_WITHDRAWN";
  const terminal = isTerminalPipelineStage(card.stage) || withdrawn;
  const outcomeStatus =
    withdrawn || card.stage === "HIRED" || card.stage === "REJECTED";
  const locked = withdrawn || lockedStages.has(card.stage);
  // The server projection is authoritative. A missing dragDestinations value
  // is treated as no drag permission instead of widening the policy on the FE.
  const dragDestinations = terminal ? [] : (card.dragDestinations ?? []);
  const canDrag = !dragOverlay && dragDestinations.length > 0 && !locked;
  const draggable = useDraggable({
    id: dragOverlay ? `${card.applicationId}-overlay` : card.applicationId,
    data: { card, dragDestinations },
    disabled: !canDrag,
  });
  const { setNodeRef, listeners, attributes, transform, isDragging } =
    draggable;
  const score = pipelineScoreForCard(card);
  const tier = pipelineTierForCard(card);
  const localizedTierLabels = {
    strong: copy.strong,
    review: copy.review,
    low: copy.low,
    pending: copy.pending,
  } as const;
  const handleCardClick = (event: React.MouseEvent<HTMLElement>) => {
    if (stopInteractiveEvent(event)) return;
    onPreview?.(card, true, event.currentTarget.getBoundingClientRect());
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (dragOverlay || stopInteractiveEvent(event)) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPreview?.(card, true, event.currentTarget.getBoundingClientRect());
    }
  };
  const handleCardPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!canDrag || stopInteractiveEvent(event)) return;
    listeners?.onPointerDown?.(event);
  };

  const dragHandle = canDrag ? (
    <button
      type="button"
      className="pipeline-card__drag-handle"
      {...attributes}
      onPointerDown={(event) => {
        event.stopPropagation();
        listeners?.onPointerDown?.(event);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        listeners?.onKeyDown?.(event);
      }}
      aria-label={copy.dragToStage(card.candidate.displayName)}
      title={copy.dragCard}
    >
      <GripVertical aria-hidden="true" />
    </button>
  ) : null;

  return (
    <article
      ref={setNodeRef}
      onPointerDown={handleCardPointerDown}
      className={[
        "candidate-card",
        "pipeline-card",
        canDrag ? "is-draggable" : "",
        isDragging ? "is-dragging" : "",
        dragOverlay ? "pipeline-card--overlay" : "",
        previewed ? "is-previewed" : "",
        !dragOverlay ? "collapsible is-collapsible" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-application-id={dragOverlay ? undefined : card.applicationId}
      data-stage={card.stage}
      data-tier={tier}
      data-score={score ?? -1}
      data-name={card.candidate.displayName}
      data-dragging={isDragging ? "true" : undefined}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
      role={!dragOverlay ? "button" : undefined}
      tabIndex={!dragOverlay ? 0 : -1}
      onClick={!dragOverlay ? handleCardClick : undefined}
      onKeyDown={!dragOverlay ? handleCardKeyDown : undefined}
      onMouseEnter={(event) =>
        onPreview?.(card, false, event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={onPreviewLeave}
      onFocus={(event) =>
        onPreview?.(card, false, event.currentTarget.getBoundingClientRect())
      }
    >
      <div className="card-top pipeline-card__topline">
        <div className="candidate-name pipeline-card__identity">
          {card.candidate.displayName}
        </div>
        {outcomeStatus ? (
          <>
            <span
              className={`status-pill ${withdrawn ? "status-withdrawn" : card.stage === "HIRED" ? "status-hired" : "status-rejected"} pipeline-card__status-pill`}
            >
              {withdrawn
                ? copy.stageLabels.WITHDRAWN.toUpperCase()
                : copy.stageLabels[card.stage].toUpperCase()}
            </span>
            {dragHandle}
          </>
        ) : canDrag ? (
          dragHandle
        ) : locked ? (
          <LockKeyhole
            className="pipeline-card__locked-icon"
            aria-label={copy.stageLocked}
          />
        ) : null}
      </div>
      <div className="submitted-date pipeline-card__submitted-date">
        <time dateTime={card.submittedAt}>
          {copy.submitted(
            new Date(card.submittedAt).toLocaleDateString(
              locale === "vi" ? "vi-VN" : "en-US",
              {
                day: "2-digit",
                month: "short",
                year: "numeric",
              },
            ),
          )}
        </time>
      </div>
      <div
        className={`score-row pipeline-card__score pipeline-card__score--${tier}`}
      >
        <ScoreRing
          score={score}
          tier={tier}
          candidateName={card.candidate.displayName}
          copy={copy}
        />
        <div className="score-meta pipeline-card__score-meta">
          <span className="score-meta-label">{copy.finalScore}</span>
          <span className={`tier-badge tier-${tier}`}>
            <span className="dot" aria-hidden="true" />
            {localizedTierLabels[tier]}
          </span>
        </div>
      </div>
    </article>
  );
}
