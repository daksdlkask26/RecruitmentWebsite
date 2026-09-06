import type { ElementType, HTMLAttributes, ReactNode } from "react";

export type DesignTone = "blue" | "teal" | "amber" | "neutral";

export type PanelProps = {
  eyebrow: ReactNode;
  title: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
  tone?: DesignTone;
  accentBorder?: "blue" | "teal";
  showDivider?: boolean;
  className?: string;
  headClassName?: string;
  titleClassName?: string;
  bodyClassName?: string;
  titleId?: string;
  titleAs?: "h1" | "h2";
  as?: "article" | "section" | "header" | "div";
} & Omit<HTMLAttributes<HTMLElement>, "title">;

export function Panel({
  eyebrow,
  title,
  rightSlot,
  children,
  tone = "blue",
  accentBorder,
  showDivider = true,
  className = "",
  headClassName = "",
  titleClassName = "",
  bodyClassName = "",
  titleId,
  titleAs = "h2",
  as = "section",
  ...props
}: PanelProps) {
  const Component = as as ElementType;
  const Title = titleAs;
  return (
    <Component
      className={["sh-panel", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-accent-border={accentBorder}
      aria-labelledby={titleId}
      {...props}
    >
      <div className={["sh-panel__head", headClassName].filter(Boolean).join(" ")}>
        <div className="sh-panel__heading">
          <p className="sh-panel__eyebrow">{eyebrow}</p>
          <Title
            className={["sh-panel__title", titleClassName]
              .filter(Boolean)
              .join(" ")}
            id={titleId}
          >
            {title}
          </Title>
        </div>
        {rightSlot ? <div className="sh-panel__right">{rightSlot}</div> : null}
      </div>
      {showDivider ? <hr className="sh-panel__divider" /> : null}
      <div className={["sh-panel__body", bodyClassName].filter(Boolean).join(" ")}>
        {children}
      </div>
    </Component>
  );
}

export type ChipProps = {
  label: string;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
};

export function Chip({
  label,
  onRemove,
  removeLabel = `Remove ${label}`,
  className = "",
}: ChipProps) {
  return (
    <span className={["sh-chip", className].filter(Boolean).join(" ")}>
      <span className="sh-chip__label">{label}</span>
      {onRemove ? (
        <button
          type="button"
          className="sh-chip__remove"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function ProgressBar({
  percent,
  label = "Profile completion",
  className = "",
}: {
  percent: number;
  label?: string;
  className?: string;
}) {
  const value = Math.min(
    100,
    Math.max(0, Number.isFinite(percent) ? percent : 0),
  );
  return (
    <div
      className={["sh-progress", className].filter(Boolean).join(" ")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span className="sh-progress__track">
        <span className="sh-progress__fill" style={{ width: `${value}%` }} />
      </span>
    </div>
  );
}

export type StatusPillTone = "success" | "warning" | "neutral" | "info";

export function StatusPill({
  label,
  tone = "success",
  pulsing = false,
  state,
  role,
  className = "",
}: {
  label: string;
  tone?: StatusPillTone;
  pulsing?: boolean;
  state?: string;
  role?: "status" | "presentation";
  className?: string;
}) {
  return (
    <span
      className={["sh-status-pill", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-state={state}
      data-pulsing={pulsing ? "true" : undefined}
      role={role}
    >
      <span className="sh-status-pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export type TimelineItemProps = {
  title: ReactNode;
  subtitle: ReactNode;
  description?: ReactNode;
  current?: ReactNode;
  icon: ReactNode;
  tone?: DesignTone;
  showConnector?: boolean;
  className?: string;
};

export function Timeline({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={["sh-timeline", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

export function TimelineItem({
  title,
  subtitle,
  description,
  current,
  icon,
  tone = "blue",
  showConnector = true,
  className = "",
}: TimelineItemProps) {
  return (
    <div className={["sh-timeline__item", className].filter(Boolean).join(" ")}>
      <div className="sh-timeline__rail" aria-hidden="true">
        <span className="sh-timeline__icon" data-tone={tone}>
          {icon}
        </span>
        {showConnector ? <span className="sh-timeline__connector" /> : null}
      </div>
      <div className="sh-timeline__content">
        <p className="sh-timeline__title">
          {title}
          {current ? (
            <span className="sh-timeline__current">{current}</span>
          ) : null}
        </p>
        <p className="sh-timeline__subtitle">{subtitle}</p>
        {description ? (
          <p className="sh-timeline__description">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
