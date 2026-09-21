import "server-only";

import { analyticsConfiguration } from "@/backend/analytics/analytics-config";

export const exportConfiguration = () => {
  const config = analyticsConfiguration();
  return {
    leaseSeconds: config.exportLeaseSeconds,
    maxAttempts: config.exportMaxAttempts,
    batchSize: config.exportBatchSize,
    maxRows: config.exportMaxRows,
    maxBytes: config.exportMaxBytes,
    expiresAfterHours: 24,
  };
};

export const exportMedia = {
  CSV: {
    mediaType: "text/csv; charset=utf-8",
    extension: "csv",
  },
  XLSX: {
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
  },
} as const;
