import "server-only";

import {
  ANALYTICS_DEFINITION_VERSION,
  ANALYTICS_PLATFORM_TIME_ZONE,
  ANALYTICS_QUALIFICATION_POLICY_VERSION,
  ANALYTICS_VISITOR_DIGEST_VERSION,
} from "@/shared/contracts/analytics";

const LOCAL_VISITOR_KEY = "smarthire-local-analytics-visitor-key-v1";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function visitorKey() {
  const configured = process.env.ANALYTICS_VISITOR_HMAC_KEY_V1?.trim();
  if (!configured) return Buffer.from(LOCAL_VISITOR_KEY, "utf8");
  const decoded = Buffer.from(configured, "base64");
  if (decoded.byteLength === 32 && /^[A-Za-z0-9+/]+={0,2}$/u.test(configured)) {
    return decoded;
  }
  return Buffer.from(configured, "utf8");
}

export function analyticsConfiguration() {
  return Object.freeze({
    definitionVersion: ANALYTICS_DEFINITION_VERSION,
    qualificationPolicyVersion: ANALYTICS_QUALIFICATION_POLICY_VERSION,
    visitorDigestVersion: ANALYTICS_VISITOR_DIGEST_VERSION,
    visitorHmacKey: visitorKey(),
    platformTimeZone:
      process.env.ANALYTICS_PLATFORM_TIME_ZONE?.trim() ||
      ANALYTICS_PLATFORM_TIME_ZONE,
    maxRangeDays: positiveInteger(process.env.ANALYTICS_MAX_RANGE_DAYS, 731),
    viewBotUserAgentPattern:
      /(?:bot|crawler|spider|slurp|headless|uptimerobot|pingdom|preview)/iu,
    exportLeaseSeconds: positiveInteger(
      process.env.ANALYTICS_EXPORT_LEASE_SECONDS,
      60,
    ),
    exportMaxAttempts: positiveInteger(
      process.env.ANALYTICS_EXPORT_MAX_ATTEMPTS,
      3,
    ),
    exportBatchSize: Math.min(
      1_000,
      positiveInteger(process.env.ANALYTICS_EXPORT_BATCH_SIZE, 500),
    ),
    exportMaxRows: Math.min(
      1_000_000,
      positiveInteger(process.env.ANALYTICS_EXPORT_MAX_ROWS, 250_000),
    ),
    exportMaxBytes: Math.min(
      512 * 1024 * 1024,
      positiveInteger(
        process.env.ANALYTICS_EXPORT_MAX_BYTES,
        128 * 1024 * 1024,
      ),
    ),
  });
}
