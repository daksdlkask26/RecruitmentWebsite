import "server-only";

import { channel, type Channel } from "node:diagnostics_channel";

export const PLATFORM_OPERATIONAL_CHANNEL = "smarthire.platform" as const;

export type PlatformOperationalMetric = Readonly<{
  event:
    | "export.completed"
    | "export.audit_retry"
    | "export.audit_dead_letter"
    | "backup.lease_reclaimed"
    | "backup.fenced_completion"
    | "backup.failed"
    | "health.not_ready";
  value: number;
  dimensions: Readonly<Record<string, string>>;
}>;

let configured = false;

export function platformOperationalChannel(): Channel {
  return channel(PLATFORM_OPERATIONAL_CHANNEL);
}

/**
 * The default consumer is a redacted structured log. A deployment can replace
 * this subscription with its log/metrics agent at the same channel boundary;
 * no raw query, PII, token, or storage locator is accepted here.
 */
export function configurePlatformOperationalMetrics() {
  if (configured) return;
  configured = true;
  platformOperationalChannel().subscribe((message) => {
    const metric = message as PlatformOperationalMetric;
    console.info(JSON.stringify({ event: "platform_metric", metric }));
  });
}

export function emitPlatformOperationalMetric(
  metric: PlatformOperationalMetric,
) {
  configurePlatformOperationalMetrics();
  platformOperationalChannel().publish(metric);
}
