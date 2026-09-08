import "server-only";

import { randomUUID } from "node:crypto";

import { prisma } from "@/backend/database/prisma";
import {
  CvStorageError,
  type PrivateCvStorage,
} from "@/backend/cv/storage/private-cv-storage";
import { systemClock, type Clock } from "@/backend/time/clock";
import { createCvWorkerStorage } from "./cv-worker-resources";

export const CV_RECONCILIATION_ORPHAN_GRACE_MS = 60 * 60_000;

const storageLocatorPattern = /^[A-Za-z0-9_-]{16,128}$/u;

function draftCoverLetterStorageKey(value: unknown): string | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { kind?: unknown }).kind !== "FILE"
  ) {
    return null;
  }
  const file = (value as { file?: unknown }).file;
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  const storageKey = (file as { storageKey?: unknown }).storageKey;
  return typeof storageKey === "string" &&
    storageLocatorPattern.test(storageKey)
    ? storageKey
    : null;
}

export type CvReconciliationResult = Readonly<{
  referencesChecked: number;
  missingScheduled: number;
  inventoryChecked: number;
  orphansDeleted: number;
  nextCursor?: string;
}>;

function isMissing(error: unknown): boolean {
  return (
    error instanceof CvStorageError &&
    error.code === "CV_STORAGE_OBJECT_NOT_FOUND"
  );
}

export class CvStorageReconciliation {
  constructor(
    private readonly storage: PrivateCvStorage = createCvWorkerStorage(),
    private readonly clock: Clock = systemClock,
  ) {}

  async runOnce(
    input: {
      now?: Date;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<CvReconciliationResult> {
    const now = input.now ?? this.clock.now();
    const limit = input.limit ?? 25;
    if (
      Number.isNaN(now.getTime()) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new Error("CV_RECONCILIATION_RUN_INVALID");
    }
    await this.storage.assertReady();
    const references = await prisma.cvStoredArtifact.findMany({
      where: {
        status: { in: ["QUARANTINED", "AVAILABLE"] },
        contentInaccessibleAt: null,
        deletedAt: null,
        createdAt: {
          lte: new Date(now.getTime() - CV_RECONCILIATION_ORPHAN_GRACE_MS),
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(limit, 5),
      select: {
        id: true,
        uploadId: true,
        accountId: true,
        storageLocator: true,
        ciphertextBytes: true,
      },
    });
    let missingScheduled = 0;
    for (const reference of references) {
      try {
        for await (const chunk of this.storage.open(
          reference.storageLocator,
          reference.ciphertextBytes,
        )) {
          // Presence and exact byte count are validated by the adapter.
          void chunk;
        }
      } catch (error) {
        if (!isMissing(error)) continue;
        const changed = await prisma.$transaction(async (transaction) => {
          const artifact = await transaction.cvStoredArtifact.updateMany({
            where: {
              id: reference.id,
              uploadId: reference.uploadId,
              accountId: reference.accountId,
              status: { in: ["QUARANTINED", "AVAILABLE"] },
              contentInaccessibleAt: null,
              deletedAt: null,
            },
            data: {
              status: "DELETE_PENDING",
              contentInaccessibleAt: now,
              deleteAfter: now,
              deleteFailureCode: "STORAGE_OBJECT_MISSING",
            },
          });
          if (artifact.count !== 1) return false;
          await transaction.cvUpload.updateMany({
            where: {
              id: reference.uploadId,
              accountId: reference.accountId,
              contentInaccessibleAt: null,
              deletedAt: null,
            },
            data: {
              status: "VALIDATION_FAILED",
              failureCode: "ARTIFACT_INTEGRITY_FAILED",
              contentInaccessibleAt: now,
              deleteAfter: now,
            },
          });
          await transaction.auditEvent.createMany({
            data: [
              {
                id: `cv_missing_${reference.id}`.slice(0, 80),
                occurredAt: now,
                actorType: "system",
                action: "cv_import.reconciled",
                targetType: "cv_import",
                targetId: reference.uploadId,
                result: "FAILURE",
                correlationId: `cv_missing_${reference.id}`.slice(0, 128),
                context: {
                  state: "MISSING_REFERENCE",
                  failureCode: "STORAGE_OBJECT_MISSING",
                },
              },
            ],
            skipDuplicates: true,
          });
          return true;
        });
        if (changed) missingScheduled += 1;
      }
    }

    const inventory = await this.storage.inventory({
      limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    const locators = inventory.items.map((item) => String(item.locator));
    // The local CV storage adapter is also used by CandidateCv materialized
    // copies, application-document promotion, active application drafts, and
    // a deterministic upload reservation while a provider response is
    // ambiguous. Reconciliation must treat all six namespaces as owned;
    // otherwise a valid draft cover letter is classified as an untracked
    // artifact and deleted after the orphan grace period.
    const [
      trackedCvArtifacts,
      trackedCandidateCvs,
      trackedApplicationDocuments,
      trackedPromotions,
      trackedDrafts,
      trackedPendingUploads,
    ] = locators.length
      ? await Promise.all([
          prisma.cvStoredArtifact.findMany({
            where: { storageLocator: { in: locators } },
            select: { storageLocator: true },
          }),
          prisma.candidateCv.findMany({
            where: { storageKey: { in: locators } },
            select: { storageKey: true },
          }),
          prisma.applicationDocument.findMany({
            where: { storageKeyEncrypted: { in: locators }, deletedAt: null },
            select: { storageKeyEncrypted: true },
          }),
          prisma.applicationArtifactPromotion.findMany({
            where: { storageKeyEncrypted: { in: locators }, deletedAt: null },
            select: { storageKeyEncrypted: true },
          }),
          prisma.candidateApplicationDraft.findMany({
            where: { expiresAt: { gt: now } },
            select: { coverLetterDraft: true },
          }),
          prisma.cvUpload.findMany({
            where: {
              id: { in: locators },
              status: {
                in: [
                  "AWAITING_CONTENT",
                  "VALIDATION_QUEUED",
                  "SCAN_QUEUED",
                  "SCANNING",
                ],
              },
              contentInaccessibleAt: null,
              deletedAt: null,
            },
            select: { id: true },
          }),
        ])
      : [[], [], [], [], [], []];
    const trackedLocators = new Set([
      ...trackedCvArtifacts.map((item) => item.storageLocator),
      ...trackedCandidateCvs.map((item) => item.storageKey),
      ...trackedApplicationDocuments.map((item) => item.storageKeyEncrypted),
      ...trackedPromotions.map((item) => item.storageKeyEncrypted),
      ...trackedDrafts.flatMap(({ coverLetterDraft }) => {
        const storageKey = draftCoverLetterStorageKey(coverLetterDraft);
        return storageKey ? [storageKey] : [];
      }),
      ...trackedPendingUploads.map((item) => item.id),
    ]);
    let orphansDeleted = 0;
    for (const item of inventory.items) {
      if (
        trackedLocators.has(String(item.locator)) ||
        !item.createdAt ||
        item.createdAt.getTime() >
          now.getTime() - CV_RECONCILIATION_ORPHAN_GRACE_MS
      ) {
        continue;
      }
      try {
        const outcome = await this.storage.delete(String(item.locator));
        if (!outcome.deleted) continue;
        orphansDeleted += 1;
        await prisma.auditEvent.create({
          data: {
            occurredAt: now,
            actorType: "system",
            action: "cv_import.reconciled",
            targetType: "cv_import",
            targetId: null,
            result: "SUCCESS",
            correlationId: `cv_reconcile_${randomUUID()}`.slice(0, 128),
            context: { state: "GRACE_AGED_ORPHAN_DELETED", count: 1 },
          },
        });
      } catch (error) {
        if (!(error instanceof CvStorageError)) throw error;
        // A stale inventory entry must not stop the worker from processing CVs.
        // Keep the locator out of logs/audit context because it is sensitive.
        console.warn(
          `[cv-worker] orphan cleanup skipped: ${error.code}`,
        );
      }
    }
    return Object.freeze({
      referencesChecked: references.length,
      missingScheduled,
      inventoryChecked: inventory.items.length,
      orphansDeleted,
      ...(inventory.nextCursor ? { nextCursor: inventory.nextCursor } : {}),
    });
  }
}
