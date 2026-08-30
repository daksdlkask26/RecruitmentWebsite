import "server-only";

export type ServerTimingMetric = {
  name: string;
  durationMs: number;
};

function duration(value: number) {
  return Math.max(0, Math.round(value * 10) / 10).toFixed(1);
}

export function withServerTiming(
  response: Response,
  metrics: readonly ServerTimingMetric[],
) {
  response.headers.set(
    "Server-Timing",
    metrics
      .map((metric) => `${metric.name};dur=${duration(metric.durationMs)}`)
      .join(", "),
  );
  return response;
}
