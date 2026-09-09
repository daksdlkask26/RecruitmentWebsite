import "server-only";

import type { ExplicitLabel } from "@/shared/contracts/scoring";

const DEFAULT_LOW_SCORE_THRESHOLD = 60;
const DEFAULT_STRONG_SCORE_THRESHOLD = 80;
const DEFAULT_VIEWED_TIMEOUT_MINUTES = 12 * 60;

export type AutomaticScoreStageRuleConfig = Readonly<{
  lowScoreThreshold: number;
  strongScoreThreshold: number;
  viewedTimeoutMinutes: number;
}>;

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return Number.NaN;
  }
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    return Number(value.toNumber());
  }
  return Number(value);
}

function environmentNumber(names: readonly string[], fallback: number) {
  for (const name of names) {
    const value = numberValue(process.env[name]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function inScoreRange(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function getAutomaticScoreStageRuleConfig(
  overrides: Partial<AutomaticScoreStageRuleConfig> = {},
): AutomaticScoreStageRuleConfig {
  const lowScoreThreshold =
    overrides.lowScoreThreshold ??
    environmentNumber(
      [
        "RECRUITMENT_AUTO_SCORE_LOW_THRESHOLD",
        "RECRUITMENT_AI_SCORE_LOW_THRESHOLD",
      ],
      DEFAULT_LOW_SCORE_THRESHOLD,
    );
  const strongScoreThreshold =
    overrides.strongScoreThreshold ??
    environmentNumber(
      [
        "RECRUITMENT_AUTO_SCORE_STRONG_THRESHOLD",
        "RECRUITMENT_AI_SCORE_STRONG_THRESHOLD",
      ],
      DEFAULT_STRONG_SCORE_THRESHOLD,
    );
  const viewedTimeoutMinutes =
    overrides.viewedTimeoutMinutes ??
    environmentNumber(
      [
        "RECRUITMENT_VIEWED_AUTO_DECISION_WINDOW_MINUTES",
        "RECRUITMENT_REVIEW_NEEDED_TIMEOUT_MINUTES",
      ],
      DEFAULT_VIEWED_TIMEOUT_MINUTES,
    );

  const validThresholds =
    inScoreRange(lowScoreThreshold) &&
    inScoreRange(strongScoreThreshold) &&
    lowScoreThreshold < strongScoreThreshold;
  const validTimeout =
    Number.isFinite(viewedTimeoutMinutes) && viewedTimeoutMinutes > 0;

  return Object.freeze({
    lowScoreThreshold: validThresholds
      ? lowScoreThreshold
      : DEFAULT_LOW_SCORE_THRESHOLD,
    strongScoreThreshold: validThresholds
      ? strongScoreThreshold
      : DEFAULT_STRONG_SCORE_THRESHOLD,
    viewedTimeoutMinutes: validTimeout
      ? viewedTimeoutMinutes
      : DEFAULT_VIEWED_TIMEOUT_MINUTES,
  });
}

export function automaticScoreBand(
  score: number,
  config = getAutomaticScoreStageRuleConfig(),
): ExplicitLabel {
  if (score >= config.strongScoreThreshold) {
    return { code: "HIGH_MATCH", label: "Strong match", iconLabel: "✓" };
  }
  if (score >= config.lowScoreThreshold) {
    return { code: "MEDIUM_MATCH", label: "Review needed", iconLabel: "!" };
  }
  return { code: "LOW_MATCH", label: "Low match", iconLabel: "✕" };
}

export function automaticScoreConfigForPublishedResult(input: {
  mediumThreshold?: unknown;
  highThreshold?: unknown;
  fallback?: AutomaticScoreStageRuleConfig;
}) {
  const fallback = input.fallback ?? getAutomaticScoreStageRuleConfig();
  const lowScoreThreshold = numberValue(input.mediumThreshold);
  const strongScoreThreshold = numberValue(input.highThreshold);
  if (
    !inScoreRange(lowScoreThreshold) ||
    !inScoreRange(strongScoreThreshold) ||
    lowScoreThreshold >= strongScoreThreshold
  ) {
    return fallback;
  }
  return getAutomaticScoreStageRuleConfig({
    lowScoreThreshold,
    strongScoreThreshold,
    viewedTimeoutMinutes: fallback.viewedTimeoutMinutes,
  });
}
