import type { ReactNode } from "react";

export function InfoRow({
  label,
  value,
  valueTone = "default",
  icon,
  asDefinition = false,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  valueTone?: "default" | "success";
  icon?: ReactNode;
  asDefinition?: boolean;
  className?: string;
}) {
  const classes = ["sh-info-row", className].filter(Boolean).join(" ");
  const valueClasses = "sh-info-row__value";

  if (asDefinition) {
    return (
      <div className={classes} data-value-tone={valueTone}>
        <dt className="sh-info-row__label">
          {icon ? <span className="sh-info-row__icon">{icon}</span> : null}
          <span className="sh-info-row__label-text">{label}</span>
        </dt>
        <dd className={valueClasses}>{value}</dd>
      </div>
    );
  }

  return (
    <div className={classes} data-value-tone={valueTone}>
      {icon ? <span className="sh-info-row__icon">{icon}</span> : null}
      <span className="sh-info-row__label">{label}</span>
      <span className={valueClasses}>{value}</span>
    </div>
  );
}
