import "server-only";

import { channel, type Channel } from "node:diagnostics_channel";
import {
  configureSearchCatalogRuntimeObservability,
  type SearchCatalogRuntimeMetric,
} from "./search-catalog-runtime-metrics";
import {
  configureSearchResolutionObservability,
  type SearchResolutionMetric,
} from "./search-resolution-metrics";

export const SEARCH_OBSERVABILITY_CHANNEL_NAME = "smarthire.search" as const;

export type SearchObservabilityEvent =
  | SearchCatalogRuntimeMetric
  | SearchResolutionMetric;

let configured = false;

/**
 * Production composition root for Search telemetry.
 *
 * diagnostics_channel is deliberately used as the stable adapter boundary:
 * OpenTelemetry, a hosted metrics agent, or the platform logger can subscribe
 * without making Search depend on one vendor. No query, title, user ID, or
 * other unbounded value crosses this boundary; the builders already enforce
 * the bounded event contracts.
 */
export function searchObservabilityChannel(): Channel {
  return channel(SEARCH_OBSERVABILITY_CHANNEL_NAME);
}

export function configureSearchObservability() {
  if (configured) return;
  configured = true;
  const emit = (metric: SearchObservabilityEvent) => {
    searchObservabilityChannel().publish(metric);
  };
  configureSearchResolutionObservability({
    emit: (metric) => emit(metric),
  });
  configureSearchCatalogRuntimeObservability({
    emit: (metric) => emit(metric),
  });
}
