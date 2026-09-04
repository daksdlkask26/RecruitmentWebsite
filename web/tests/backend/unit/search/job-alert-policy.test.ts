import { describe, expect, it } from "vitest";
import {
  decideJobAlertDelivery,
  isNewJobForAlert,
  jobAlertDeduplicationKey,
} from "@/backend/services/search/job-alert-policy";

const now = new Date("2026-09-02T12:00:00.000Z");
const publishedAt = new Date("2026-09-02T11:00:00.000Z");
const createdAt = new Date("2026-09-02T10:00:00.000Z");

const base = {
  status: "ACTIVE" as const,
  channel: "IN_APP" as const,
  jobId: "job-1",
  publishedAt,
  alertCreatedAt: createdAt,
  lastEvaluatedAt: null,
  jobIsVisible: true,
  matchesSearch: true,
  jobUpdateNotificationConsent: true,
  jobRecommendationsEmail: true,
  now,
  alertsEnabled: true,
};

describe("job alert policy", () => {
  it("delivers only a new, visible, matching job with consent", () => {
    expect(decideJobAlertDelivery(base)).toMatchObject({
      deliver: true,
      reason: "DELIVER",
    });
  });

  it("does not re-alert a job after evaluation or reindex", () => {
    expect(
      isNewJobForAlert({
        publishedAt,
        alertCreatedAt: createdAt,
        lastEvaluatedAt: new Date("2026-09-02T11:30:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      decideJobAlertDelivery({
        ...base,
        lastEvaluatedAt: new Date("2026-09-02T11:30:00.000Z"),
      }),
    ).toMatchObject({ deliver: false, reason: "JOB_NOT_NEW" });
  });

  it("honors pause, consent, and email preferences", () => {
    expect(decideJobAlertDelivery({ ...base, status: "PAUSED" })).toMatchObject(
      {
        deliver: false,
        reason: "PAUSED",
      },
    );
    expect(
      decideJobAlertDelivery({ ...base, jobUpdateNotificationConsent: false }),
    ).toMatchObject({ deliver: false, reason: "CONSENT_REQUIRED" });
    expect(
      decideJobAlertDelivery({
        ...base,
        channel: "EMAIL",
        jobRecommendationsEmail: false,
      }),
    ).toMatchObject({ deliver: false, reason: "EMAIL_PREFERENCE_DISABLED" });
  });

  it("is disabled until a durable alert evaluator is explicitly enabled", () => {
    expect(
      decideJobAlertDelivery({ ...base, alertsEnabled: false }),
    ).toMatchObject({ deliver: false, reason: "FEATURE_DISABLED" });
  });

  it("deduplicates by user, saved search, job, and intent version", () => {
    const first = jobAlertDeduplicationKey({
      userId: "user-1",
      searchId: "search-1",
      jobId: "job-1",
      version: "catalog-v1",
    });
    expect(first).toBe(
      jobAlertDeduplicationKey({
        userId: "user-1",
        searchId: "search-1",
        jobId: "job-1",
        version: "catalog-v1",
      }),
    );
    expect(first).not.toBe(
      jobAlertDeduplicationKey({
        userId: "user-1",
        searchId: "search-1",
        jobId: "job-1",
        version: "catalog-v2",
      }),
    );
    expect(first).toMatch(/^job-alert:[a-f0-9]{64}$/u);
  });
});
