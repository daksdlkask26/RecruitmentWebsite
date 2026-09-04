import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { searchMappingReviewCommandSchema } from "../src/shared/contracts/admin/search-mapping-review";
import {
  searchMappingReviewBatchManifestSchema,
  type SearchMappingReviewBatchItem,
  type SearchMappingReviewBatchManifest,
} from "../src/shared/contracts/admin/search-mapping-review-batch";
import type { AdminAuthority } from "../src/backend/security/admin-request-boundary";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm-human-review");
const manifestPath = valueFor("--manifest");
const batchSize = Number(valueFor("--batch-size") ?? "25");
const expectedCatalogVersion = valueFor("--expected-catalog-version");
const outputPath = valueFor("--output");
const userId = valueFor("--user-id") ?? process.env.SEARCH_ADMIN_USER_ID;
const sessionId =
  valueFor("--session-id") ?? process.env.SEARCH_ADMIN_SESSION_ID;
const grantId = valueFor("--grant-id") ?? process.env.SEARCH_ADMIN_GRANT_ID;
let database:
  | typeof import("../src/backend/database/prisma").prisma
  | undefined;

function valueFor(name: string) {
  const prefix = `${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) || undefined;
}

function deterministicUuid(...parts: string[]) {
  const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  const value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(
    8 +
    (Number.parseInt(hex.slice(16, 17), 16) % 4)
  ).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return value;
}

function commandFor(item: SearchMappingReviewBatchItem, rationale: string) {
  const common = {
    confirmation: true as const,
    reasonCategory: "OTHER" as const,
    explanation: rationale,
  };
  const raw =
    item.proposedDecision === "APPROVE"
      ? {
          command: "APPROVE" as const,
          ...common,
          titleId: item.titleId,
          translationVi: item.canonicalVi,
          translationEn: item.canonicalEn,
          ...(item.occupationId ? { occupationId: item.occupationId } : {}),
          facetIds: item.facetIds,
        }
      : item.proposedDecision === "INTENTIONAL_UNTRANSLATED"
        ? {
            command: "INTENTIONAL_UNTRANSLATED" as const,
            ...common,
            titleId: item.titleId,
            translationEn: item.canonicalEn,
            ...(item.occupationId ? { occupationId: item.occupationId } : {}),
            facetIds: item.facetIds,
          }
        : item.proposedDecision === "MERGE"
          ? {
              command: "MERGE" as const,
              ...common,
              targetTitleId: item.mergeTargetTitleId as string,
            }
          : { command: "REJECT" as const, ...common };
  return searchMappingReviewCommandSchema.parse(raw);
}

async function writeReport(report: Record<string, unknown>) {
  if (!outputPath) return;
  const target = resolve(process.cwd(), outputPath);
  const parent = resolve(target, "..");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(parent, { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function preflightManifest(manifest: SearchMappingReviewBatchManifest) {
  const errors: string[] = [];
  if (!Number.isInteger(batchSize) || batchSize < 25 || batchSize > 50) {
    errors.push("batch-size must be an integer between 25 and 50");
  }
  const titleIds = new Set<string>();
  const reviewIds = new Set<string>();
  for (const item of manifest.items) {
    if (titleIds.has(item.titleId))
      errors.push(`duplicate titleId: ${item.titleId}`);
    titleIds.add(item.titleId);
    if (item.reviewId) {
      if (reviewIds.has(item.reviewId))
        errors.push(`duplicate reviewId: ${item.reviewId}`);
      reviewIds.add(item.reviewId);
    }
    if (
      item.proposedDecision === "MERGE" &&
      item.mergeTargetTitleId === item.titleId
    ) {
      errors.push(`MERGE target cannot equal titleId: ${item.titleId}`);
    }
  }
  if (apply) {
    if (!confirmed)
      errors.push("--confirm-human-review is required with --apply");
    if (!manifest.humanReviewConfirmed || !manifest.reviewer) {
      errors.push(
        "manifest-level human review confirmation is required with --apply",
      );
    }
    if (!userId || !sessionId || !grantId) {
      errors.push(
        "--user-id, --session-id and --grant-id (or SEARCH_ADMIN_* env) are required",
      );
    }
    for (const item of manifest.items) {
      if (!item.humanApproved || !item.reviewer) {
        errors.push(`human review evidence missing for ${item.titleId}`);
      } else if (
        manifest.reviewer &&
        item.reviewer.actorUserId !== manifest.reviewer.actorUserId
      ) {
        errors.push(`reviewer mismatch for ${item.titleId}`);
      }
    }
  }
  return errors;
}

async function main() {
  if (!manifestPath) throw new Error("MANIFEST_REQUIRED");
  const rawManifest = JSON.parse(
    await readFile(resolve(process.cwd(), manifestPath), "utf8"),
  );
  const manifest = searchMappingReviewBatchManifestSchema.parse(rawManifest);
  const preflightErrors = preflightManifest(manifest);
  const { prisma } = await import("../src/backend/database/prisma");
  const { SearchMappingReviewAdminService } =
    await import("../src/backend/admin/search/search-mapping-review-admin-service");
  database = prisma;
  const active = await prisma.searchCatalogVersion.findFirst({
    where: { isActive: true, status: "PUBLISHED" },
    select: { id: true, version: true },
  });
  if (!active) preflightErrors.push("no active published catalog");
  if (
    expectedCatalogVersion &&
    active &&
    active.version !== expectedCatalogVersion
  ) {
    preflightErrors.push(
      `active catalog version ${active.version} does not match expected ${expectedCatalogVersion}`,
    );
  }
  if (active && active.version !== manifest.catalogVersion) {
    preflightErrors.push(
      `manifest catalog version ${manifest.catalogVersion} does not match active ${active.version}`,
    );
  }
  if (
    active &&
    manifest.provenance &&
    manifest.provenance.activeCatalogVersionId !== active.id
  ) {
    preflightErrors.push(
      `manifest provenance catalog ${manifest.provenance.activeCatalogVersionId} does not match active ${active.id}`,
    );
  }

  const explicitReviewIds = [
    ...new Set(
      manifest.items
        .map((item) => item.reviewId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const manifestTitleIds = manifest.items.map((item) => item.titleId);
  const reviewRows = active
    ? await prisma.searchMappingReview.findMany({
        where: {
          catalogVersionId: active.id,
          status: "PENDING",
          OR: [
            ...(explicitReviewIds.length
              ? [{ id: { in: explicitReviewIds } }]
              : []),
            { suggestedTitleId: { in: manifestTitleIds } },
          ],
        },
        select: {
          id: true,
          catalogVersionId: true,
          suggestedTitleId: true,
          status: true,
          version: true,
        },
      })
    : [];
  const rowsByTitle = new Map<string, typeof reviewRows>();
  for (const row of reviewRows) {
    if (!row.suggestedTitleId) continue;
    const rows = rowsByTitle.get(row.suggestedTitleId) ?? [];
    rows.push(row);
    rowsByTitle.set(row.suggestedTitleId, rows);
  }
  const planned = manifest.items.map((item) => {
    const candidates = item.reviewId
      ? reviewRows.filter((row) => row.id === item.reviewId)
      : (rowsByTitle.get(item.titleId) ?? []);
    if (candidates.length !== 1) {
      preflightErrors.push(
        `${item.titleId} resolves to ${candidates.length} pending review rows`,
      );
      return {
        titleId: item.titleId,
        reviewId: item.reviewId ?? null,
        status: "BLOCKED" as const,
      };
    }
    const row = candidates[0];
    const reviewerRationale =
      item.reviewer?.rationale ?? manifest.reviewer?.rationale;
    // Preserve the item-specific occupational decision (especially a REJECT)
    // and append the reviewer confirmation instead of replacing the decision
    // rationale with the manifest's generic attestation.
    const rationale = [item.rationale, reviewerRationale]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1000);
    const command = commandFor(item, rationale);
    return {
      titleId: item.titleId,
      reviewId: row.id,
      expectedVersion: row.version,
      decision: item.proposedDecision,
      command,
      idempotencyKey: deterministicUuid(
        "search-mapping-review-batch-v1",
        manifest.catalogVersion,
        row.id,
        String(row.version),
        JSON.stringify(command),
      ),
      status: "READY" as const,
    };
  });
  const report: Record<string, unknown> = {
    schemaVersion: "search-mapping-review-batch-run-v1",
    generatedAt: new Date().toISOString(),
    mode: apply ? "APPLY" : "DRY_RUN",
    manifestPath,
    catalogVersion: manifest.catalogVersion,
    activeCatalog: active,
    batchSize,
    total: planned.length,
    preflightErrors,
    planned,
    batches: Math.ceil(planned.length / batchSize),
    writesPerformed: false,
    publishPerformed: false,
    reconcilePerformed: false,
  };
  if (preflightErrors.length > 0 || !apply) {
    await writeReport(report);
    console.log(
      `SEARCH_MAPPING_REVIEW_BATCH\n${JSON.stringify(report, null, 2)}`,
    );
    if (apply && preflightErrors.length > 0) process.exitCode = 2;
    return;
  }

  const grant = await prisma.platformAdministratorGrant.findFirst({
    where: {
      id: grantId,
      userId,
      state: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      user: { state: "ACTIVE", deletedAt: null },
      sessionPolicy: { is: { designatedSessionId: sessionId } },
    },
    include: { sessionPolicy: true },
  });
  const proofAt = grant?.sessionPolicy?.latestTwoFactorProofAt;
  if (
    !grant ||
    !grant.sessionPolicy?.initialTwoFactorAt ||
    !proofAt ||
    Date.now() - proofAt.getTime() > 15 * 60_000
  ) {
    throw new Error("ACTIVE_RECENT_ADMIN_STEP_UP_REQUIRED");
  }
  const authority: AdminAuthority = {
    userId: userId as string,
    sessionId: sessionId as string,
    grantId: grantId as string,
    proofAt,
  };
  const service = new SearchMappingReviewAdminService();
  const applied: unknown[] = [];
  const failed: Array<{ titleId: string; error: string }> = [];
  for (let offset = 0; offset < planned.length; offset += batchSize) {
    const batch = planned.slice(offset, offset + batchSize);
    for (const entry of batch) {
      if (entry.status !== "READY") continue;
      try {
        const result = await service.command(
          authority,
          entry.reviewId,
          entry.command,
          entry.expectedVersion,
          entry.idempotencyKey,
        );
        applied.push({
          titleId: entry.titleId,
          reviewId: entry.reviewId,
          ...result,
        });
      } catch (error) {
        failed.push({
          titleId: entry.titleId,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
    if (failed.length > 0) break;
  }
  report.writesPerformed = applied.length > 0;
  report.applied = applied;
  report.failed = failed;
  report.completed = failed.length === 0 && applied.length === planned.length;
  report.completedAt = new Date().toISOString();
  await writeReport(report);
  console.log(
    `SEARCH_MAPPING_REVIEW_BATCH\n${JSON.stringify(report, null, 2)}`,
  );
  if (failed.length > 0 || applied.length !== planned.length)
    process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(
      `SEARCH_MAPPING_REVIEW_BATCH_FAILED\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  })
  .finally(() => database?.$disconnect());
