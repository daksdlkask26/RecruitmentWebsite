import "server-only";

import { createHash } from "node:crypto";

export const JOB_ALERT_POLICY_VERSION = "job-alert-v1" as const;

export type JobAlertStatus = "ACTIVE" | "PAUSED" | "UNSUBSCRIBED";
export type JobAlertChannel = "IN_APP" | "EMAIL";

export type JobAlertDecision = Readonly<{
  deliver: boolean;
  reason:
    | "FEATURE_DISABLED"
    | "PAUSED"
    | "UNSUBSCRIBED"
    | "CONSENT_REQUIRED"
    | "EMAIL_PREFERENCE_DISABLED"
    | "JOB_NOT_VISIBLE"
    | "JOB_NOT_NEW"
    | "SEARCH_MISMATCH"
    | "DELIVER";
  policyVersion: typeof JOB_ALERT_POLICY_VERSION;
}>;

type JobAlertEvaluationInput = Readonly<{
  status: JobAlertStatus;
  channel: JobAlertChannel;
  jobId: string;
  publishedAt: Date | null;
  alertCreatedAt: Date;
  lastEvaluatedAt: Date | null;
  jobIsVisible: boolean;
  matchesSearch: boolean;
  jobUpdateNotificationConsent: boolean;
  jobRecommendationsEmail: boolean;
  /** Kept injectable for tests and rollout control; production defaults off. */
  alertsEnabled?: boolean;
  now?: Date;
}>;

function validDate(value: Date | null | undefined): value is Date {
  return Boolean(value && !Number.isNaN(value.getTime()));
}

/**
 * Evaluates freshness before matching. A reindex does not change
 * `publishedAt`, so it cannot create a second alert for an existing job.
 */
export function isNewJobForAlert(input: {
  publishedAt: Date | null;
  alertCreatedAt: Date;
  lastEvaluatedAt: Date | null;
  now: Date;
}) {
  if (
    !validDate(input.publishedAt) ||
    !validDate(input.alertCreatedAt) ||
    !validDate(input.now)
  )
    return false;
  const baseline = validDate(input.lastEvaluatedAt)
    ? Math.max(input.alertCreatedAt.getTime(), input.lastEvaluatedAt.getTime())
    : input.alertCreatedAt.getTime();
  const publishedAt = input.publishedAt.getTime();
  return publishedAt > baseline && publishedAt <= input.now.getTime();
}

export function decideJobAlertDelivery(
  input: JobAlertEvaluationInput,
): JobAlertDecision {
  const now = input.now ?? new Date();
  const disabled = (reason: JobAlertDecision["reason"]): JobAlertDecision => ({
    deliver: false,
    reason,
    policyVersion: JOB_ALERT_POLICY_VERSION,
  });
  if (
    !(input.alertsEnabled ?? process.env.SEARCH_JOB_ALERTS_ENABLED === "true")
  )
    return disabled("FEATURE_DISABLED");
  if (input.status === "PAUSED") return disabled("PAUSED");
  if (input.status === "UNSUBSCRIBED") return disabled("UNSUBSCRIBED");
  if (!input.jobUpdateNotificationConsent) return disabled("CONSENT_REQUIRED");
  if (input.channel === "EMAIL" && !input.jobRecommendationsEmail)
    return disabled("EMAIL_PREFERENCE_DISABLED");
  if (!input.jobIsVisible) return disabled("JOB_NOT_VISIBLE");
  if (
    !isNewJobForAlert({
      publishedAt: input.publishedAt,
      alertCreatedAt: input.alertCreatedAt,
      lastEvaluatedAt: input.lastEvaluatedAt,
      now,
    })
  )
    return disabled("JOB_NOT_NEW");
  if (!input.matchesSearch) return disabled("SEARCH_MISMATCH");
  return {
    deliver: true,
    reason: "DELIVER",
    policyVersion: JOB_ALERT_POLICY_VERSION,
  };
}

/**
 * Stable, bounded idempotency key for the eventual alert outbox. The catalog
 * or resolver version is part of the key so a deliberate intent re-resolution
 * is distinguishable from a retry, while a projection reindex is not.
 */
export function jobAlertDeduplicationKey(input: {
  userId: string;
  searchId: string;
  jobId: string;
  version: string;
}) {
  const material = [input.userId, input.searchId, input.jobId, input.version]
    .map((value) => value.trim())
    .join("\u001f");
  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return `job-alert:${digest}`;
}
