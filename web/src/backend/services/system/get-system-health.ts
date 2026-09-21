import "server-only";

import { cvConfiguration, cvParserAvailability } from "@/backend/cv/config";
import { prisma } from "@/backend/database/prisma";
import { emitPlatformOperationalMetric } from "@/backend/observability/platform-operational-metrics";

const dependencyTimeoutMs = 1_500;

async function databaseReady(timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getSystemHealth(
  input: Readonly<{ dependencyTimeoutMs?: number }> = {},
) {
  const parserAvailability = cvParserAvailability(cvConfiguration);
  const now = new Date();
  const database = await databaseReady(
    input.dependencyTimeoutMs ?? dependencyTimeoutMs,
  );
  if (!database) {
    emitPlatformOperationalMetric({
      event: "health.not_ready",
      value: 1,
      dimensions: { dependency: "database" },
    });
  }
  const evidence = database
    ? await prisma.imageSearchOperationalEvidence
        .findMany({
          where: { component: { in: ["CLEANUP", "RECONCILIATION"] } },
          select: { component: true, validUntil: true },
        })
        .catch(() => [])
    : [];
  const ready = (component: string) =>
    Boolean(
      evidence.find(
        (item) => item.component === component && item.validUntil > now,
      ),
    );

  return {
    status: database ? ("ok" as const) : ("not_ready" as const),
    liveness: { status: "ok" as const },
    readiness: {
      status: database ? ("ok" as const) : ("not_ready" as const),
      dependencies: {
        database: database ? ("ok" as const) : ("unavailable" as const),
      },
    },
    cv: {
      cleanupEnabled: cvConfiguration.cleanupEnabled,
      processingEnabled: cvConfiguration.workerEnabled,
      deterministicParserReady: parserAvailability.deterministic,
      externalParserReady: parserAvailability.external,
    },
    capabilities: {
      nativeCvImport: true,
      ordinaryJobSearch: true,
      cvHybridOcrConfigured: process.env.OCR_ENGINE_ENABLED === "true",
      imageSearchWorkerConfigured:
        process.env.IMAGE_SEARCH_WORKER_ENABLED === "true",
      imageSearchAdmissionReady: ready("CLEANUP") && ready("RECONCILIATION"),
      cleanupReady: ready("CLEANUP"),
      reconciliationReady: ready("RECONCILIATION"),
    },
  };
}
