import "server-only";

import type { Prisma } from "@/backend/generated/prisma/client";

/**
 * Object locators are shared across application documents and promotion rows.
 * A transaction-scoped PostgreSQL advisory lock gives every writer and the
 * deletion reconciler one atomic claim point without changing the storage
 * adapters or storing CV content in the database.
 */
export async function acquireCompanyDeletionObjectLock(
  transaction: Prisma.TransactionClient,
  objectKeyEncrypted: string,
) {
  if (!objectKeyEncrypted.trim()) throw new Error("OBJECT_KEY_MISSING");
  await transaction.$queryRaw`
    SELECT 1::integer AS locked
    FROM (
      SELECT pg_advisory_xact_lock(hashtextextended(${objectKeyEncrypted}, 0))
    ) AS advisory_lock
  `;
}

/**
 * A locator recorded by an unfinished deletion manifest is reserved. Writers
 * must choose a fresh locator (or retry after the manifest is terminal) rather
 * than creating a reference to bytes that the reconciler may be deleting.
 */
export async function assertCompanyDeletionObjectCanBeReferenced(
  transaction: Prisma.TransactionClient,
  objectKeyEncrypted: string,
) {
  const reserved = await transaction.companyDeletionManifestEntry.findFirst({
    where: {
      objectKeyEncrypted,
      state: {
        in: ["PENDING", "RETRYABLE", "BLOCKED_BY_LEGAL_HOLD", "CONFLICT"],
      },
    },
    select: { id: true },
  });
  if (reserved) throw new Error("APPLICATION_OBJECT_LOCATOR_RESERVED");
}
