import { afterEach, describe, expect, it } from "vitest";
import {
  emitPlatformOperationalMetric,
  platformOperationalChannel,
} from "@/backend/observability/platform-operational-metrics";

describe("platform operational metrics", () => {
  const channel = platformOperationalChannel();
  const listeners: Array<(message: unknown) => void> = [];

  afterEach(() => {
    for (const listener of listeners.splice(0)) channel.unsubscribe(listener);
  });

  it("publishes bounded recovery metrics to the runtime consumer boundary", () => {
    const received: unknown[] = [];
    const listener = (message: unknown) => received.push(message);
    listeners.push(listener);
    channel.subscribe(listener);

    emitPlatformOperationalMetric({
      event: "backup.lease_reclaimed",
      value: 1,
      dimensions: { attempt: "2" },
    });

    expect(received).toEqual([
      {
        event: "backup.lease_reclaimed",
        value: 1,
        dimensions: { attempt: "2" },
      },
    ]);
  });

  it("does not accept unbounded payload fields in the metric contract", () => {
    const metric = {
      event: "export.audit_retry" as const,
      value: 1,
      dimensions: { code: "EXPORT_AUDIT_APPEND_FAILED" },
    };

    expect(Object.keys(metric.dimensions)).toEqual(["code"]);
    expect(metric.dimensions.code.length).toBeLessThanOrEqual(80);
  });
});
