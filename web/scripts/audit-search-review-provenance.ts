import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

const actorUserId = valueFor("--actor-user-id");
const catalogVersion = valueFor("--catalog-version");
const outputPath = valueFor("--output");
let database:
  | typeof import("../src/backend/database/prisma").prisma
  | undefined;

function valueFor(name: string) {
  const prefix = `${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

async function writeReport(report: Record<string, unknown>) {
  if (!outputPath) return;
  const target = isAbsolute(outputPath)
    ? outputPath
    : resolve(process.cwd(), outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  if (!actorUserId) throw new Error("ACTOR_USER_ID_REQUIRED");
  const { prisma } = await import("../src/backend/database/prisma");
  database = prisma;

  const user = await prisma.userAccount.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      name: true,
      email: true,
      state: true,
      emailVerified: true,
      twoFactorEnabled: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const grant = await prisma.platformAdministratorGrant.findUnique({
    where: { userId: actorUserId },
    select: {
      id: true,
      userId: true,
      state: true,
      expiresAt: true,
      stateChangedAt: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      scopes: { select: { scope: true, createdAt: true } },
      sessionPolicy: {
        select: {
          grantId: true,
          designatedSessionId: true,
          initialTwoFactorAt: true,
          latestTwoFactorProofAt: true,
          designationVersion: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const designatedSessionId = grant?.sessionPolicy?.designatedSessionId;
  const session = designatedSessionId
    ? await prisma.session.findUnique({
        where: { id: designatedSessionId },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
          lastActivityAt: true,
          absoluteExpiresAt: true,
          revokedAt: true,
          revocationReason: true,
          userAgent: true,
        },
      })
    : null;

  const catalogRow = catalogVersion
    ? await prisma.searchCatalogVersion.findUnique({
        where: { version: catalogVersion },
        select: { id: true },
      })
    : null;
  const reviewRows = await prisma.searchMappingReview.findMany({
    where: {
      reviewedByAdminUserId: actorUserId,
      ...(catalogVersion ? { catalogVersionId: catalogRow?.id ?? "" } : {}),
    },
    orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      catalogVersionId: true,
      originalTitle: true,
      normalizedTitle: true,
      suggestedTitleId: true,
      suggestedTranslationVi: true,
      suggestedTranslationEn: true,
      suggestedOccupationId: true,
      suggestedFacetIds: true,
      confidence: true,
      status: true,
      version: true,
      resultCatalogVersionId: true,
      reviewedByAdminUserId: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const audits = await prisma.auditEvent.findMany({
    where: {
      actorUserId,
      OR: [
        { action: { startsWith: "admin.search_mapping_review_" } },
        { action: { startsWith: "admin.search_catalog_version_" } },
      ],
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      occurredAt: true,
      actorType: true,
      actorUserId: true,
      actorSessionId: true,
      action: true,
      targetType: true,
      targetId: true,
      result: true,
      correlationId: true,
      userAgentFamily: true,
      context: true,
    },
  });

  const correlationIds = [
    ...new Set(audits.map((audit) => audit.correlationId)),
  ];
  const commandReceipts = correlationIds.length
    ? await prisma.adminCommandReceipt.findMany({
        where: { correlationId: { in: correlationIds } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          commandKind: true,
          targetReference: true,
          resultCode: true,
          resultingVersion: true,
          correlationId: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    : [];
  const privilegedRationales = correlationIds.length
    ? await prisma.privilegedActionRationale.findMany({
        where: { correlationId: { in: correlationIds } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          correlationId: true,
          encryptionKeyVersion: true,
          inaccessibleAt: true,
          deleteAfter: true,
          deletedAt: true,
          deleteAttempts: true,
          safeFailureCode: true,
          createdAt: true,
        },
      })
    : [];

  const catalogRows = await prisma.searchCatalogVersion.findMany({
    where: {
      OR: [
        { createdByAdminUserId: actorUserId },
        { publishedByAdminUserId: actorUserId },
        { retiredByAdminUserId: actorUserId },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      version: true,
      status: true,
      isActive: true,
      revision: true,
      parentVersion: true,
      createdByAdminUserId: true,
      publishedByAdminUserId: true,
      retiredByAdminUserId: true,
      publishedAt: true,
      retiredAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const projectionRuns =
    await prisma.searchProjectionReconciliationRun.findMany({
      where: { createdByAdminUserId: actorUserId },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        catalogVersionId: true,
        mode: true,
        status: true,
        inspected: true,
        refreshed: true,
        missing: true,
        stale: true,
        inconsistent: true,
        unmapped: true,
        ambiguous: true,
        requiresReview: true,
        orphaned: true,
        policyFailures: true,
        errorMessage: true,
        createdByAdminUserId: true,
        startedAt: true,
        completedAt: true,
      },
    });

  const report = {
    schemaVersion: "search-review-provenance-audit-v1",
    generatedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    actorUserId,
    catalogVersion: catalogVersion ?? null,
    subject: user
      ? {
          ...user,
          deletedAt: iso(user.deletedAt),
          createdAt: iso(user.createdAt),
          updatedAt: iso(user.updatedAt),
        }
      : null,
    administratorGrant: grant
      ? {
          ...grant,
          expiresAt: iso(grant.expiresAt),
          stateChangedAt: iso(grant.stateChangedAt),
          createdAt: iso(grant.createdAt),
          updatedAt: iso(grant.updatedAt),
          scopes: grant.scopes.map((scope) => ({
            ...scope,
            createdAt: iso(scope.createdAt),
          })),
          sessionPolicy: grant.sessionPolicy
            ? {
                ...grant.sessionPolicy,
                initialTwoFactorAt: iso(grant.sessionPolicy.initialTwoFactorAt),
                latestTwoFactorProofAt: iso(
                  grant.sessionPolicy.latestTwoFactorProofAt,
                ),
                createdAt: iso(grant.sessionPolicy.createdAt),
                updatedAt: iso(grant.sessionPolicy.updatedAt),
              }
            : null,
        }
      : null,
    designatedSession: session
      ? {
          ...session,
          expiresAt: iso(session.expiresAt),
          createdAt: iso(session.createdAt),
          updatedAt: iso(session.updatedAt),
          lastActivityAt: iso(session.lastActivityAt),
          absoluteExpiresAt: iso(session.absoluteExpiresAt),
          revokedAt: iso(session.revokedAt),
        }
      : null,
    reviewSummary: {
      totalReviewedRows: reviewRows.length,
      byStatus: reviewRows.reduce<Record<string, number>>((counts, row) => {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        return counts;
      }, {}),
      firstReviewedAt: iso(reviewRows[0]?.reviewedAt),
      lastReviewedAt: iso(reviewRows.at(-1)?.reviewedAt),
    },
    reviewedRows: reviewRows.map((row) => ({
      ...row,
      reviewedAt: iso(row.reviewedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    auditSummary: {
      totalEvents: audits.length,
      successfulEvents: audits.filter((audit) => audit.result === "SUCCESS")
        .length,
      distinctSessions: [
        ...new Set(
          audits
            .map((audit) => audit.actorSessionId)
            .filter((value): value is string => Boolean(value)),
        ),
      ],
      distinctCorrelations: correlationIds,
    },
    auditEvents: audits.map((audit) => ({
      ...audit,
      occurredAt: iso(audit.occurredAt),
    })),
    commandReceipts,
    privilegedRationales: privilegedRationales.map((rationale) => ({
      ...rationale,
      inaccessibleAt: iso(rationale.inaccessibleAt),
      deleteAfter: iso(rationale.deleteAfter),
      deletedAt: iso(rationale.deletedAt),
      createdAt: iso(rationale.createdAt),
    })),
    catalogVersions: catalogRows.map((row) => ({
      ...row,
      publishedAt: iso(row.publishedAt),
      retiredAt: iso(row.retiredAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    projectionRuns: projectionRuns.map((run) => ({
      ...run,
      startedAt: iso(run.startedAt),
      completedAt: iso(run.completedAt),
    })),
    checks: {
      actorExists: Boolean(user),
      actorIsActive: user?.state === "ACTIVE" && !user.deletedAt,
      actorHasTwoFactor: user?.twoFactorEnabled === true,
      activeGrant: grant?.state === "ACTIVE",
      designatedSessionMatchesGrant: Boolean(
        grant?.sessionPolicy?.designatedSessionId &&
        session?.userId === actorUserId,
      ),
      latestTwoFactorProofPresent: Boolean(
        grant?.sessionPolicy?.latestTwoFactorProofAt,
      ),
      reviewRowsHaveActor: reviewRows.every(
        (row) => row.reviewedByAdminUserId === actorUserId,
      ),
      auditRowsHaveActor: audits.every(
        (audit) => audit.actorUserId === actorUserId,
      ),
      successfulReviewAuditCount: audits.filter(
        (audit) =>
          audit.result === "SUCCESS" &&
          audit.action.startsWith("admin.search_mapping_review_"),
      ).length,
      allReviewAuditsHaveSession: audits
        .filter((audit) =>
          audit.action.startsWith("admin.search_mapping_review_"),
        )
        .every((audit) => Boolean(audit.actorSessionId)),
    },
  };

  await writeReport(report);
  console.log(
    JSON.stringify(
      {
        schemaVersion: report.schemaVersion,
        generatedAt: report.generatedAt,
        mode: report.mode,
        actorUserId: report.actorUserId,
        catalogVersion: report.catalogVersion,
        reviewSummary: report.reviewSummary,
        auditSummary: report.auditSummary,
        commandReceiptCount: report.commandReceipts.length,
        privilegedRationaleCount: report.privilegedRationales.length,
        catalogVersionCount: report.catalogVersions.length,
        projectionRunCount: report.projectionRuns.length,
        checks: report.checks,
        outputPath: outputPath ?? null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await database?.$disconnect();
  });
