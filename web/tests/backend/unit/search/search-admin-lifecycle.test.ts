import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

type StoredReceipt = {
  actorSubjectDigest: string;
  commandKind: string;
  targetReference: string;
  idempotencyKey: string;
  normalizedBodyDigest: string;
  resultCode: "SUCCESS" | "DENIED";
  resultingVersion: number | null;
  resultPayload: Record<string, unknown>;
  correlationId: string;
};

const { receiptStore, create, transaction } = vi.hoisted(() => {
  const store = new Map<string, StoredReceipt>();
  const keyFor = (value: {
    actorSubjectDigest: string;
    idempotencyKey: string;
  }) => `${value.actorSubjectDigest}\u0000${value.idempotencyKey}`;
  const findUnique = vi.fn(
    async (input: {
      where: {
        actorSubjectDigest_idempotencyKey: {
          actorSubjectDigest: string;
          idempotencyKey: string;
        };
      };
    }) => {
      const key = input.where.actorSubjectDigest_idempotencyKey;
      return store.get(keyFor(key)) ?? null;
    },
  );
  const create = vi.fn(async (input: { data: StoredReceipt }) => {
    const key = keyFor(input.data);
    if (store.has(key)) throw new Error("P2002");
    store.set(key, input.data);
    return input.data;
  });
  const transaction = vi.fn(async <T>(operation: (tx: unknown) => Promise<T>) =>
    operation({ adminCommandReceipt: { findUnique, create } }),
  );
  return { receiptStore: store, create, transaction };
});

vi.mock("@/backend/database/prisma", () => ({
  prisma: { $transaction: transaction },
}));

function identity(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: "admin-1",
    actorSessionId: "session-1",
    grantId: "grant-1",
    commandKind: "SEARCH_CATALOG_VERSION_PUBLISH",
    targetReference: "catalog-1",
    idempotencyKey: "idem-1",
    normalizedBody: { id: "catalog-1", expectedVersion: 1 },
    ...overrides,
  };
}

describe("Search admin lifecycle contracts", () => {
  it("executes a command once and replays the immutable receipt", async () => {
    const { PrismaAdminCommandRepository } =
      await import("@/backend/repositories/admin/prisma-admin-command-repository");
    const operation = vi.fn(async () => ({ version: 2, status: "PUBLISHED" }));
    const repository = new PrismaAdminCommandRepository();

    const first = await repository.execute(identity(), operation);
    const replay = await repository.execute(identity(), operation);

    expect(operation).toHaveBeenCalledOnce();
    expect(first).toMatchObject({ version: 2, status: "PUBLISHED" });
    expect(replay).toMatchObject({
      version: 2,
      status: "PUBLISHED",
      correlationId: first.correlationId,
      replayed: true,
    });
    expect(receiptStore.size).toBe(1);
    expect(create).toHaveBeenCalledOnce();
  });

  it("rejects idempotency-key reuse for a different command body", async () => {
    const { PrismaAdminCommandRepository } =
      await import("@/backend/repositories/admin/prisma-admin-command-repository");
    const repository = new PrismaAdminCommandRepository();
    const operation = vi.fn(async () => ({ version: 3 }));

    await expect(
      repository.execute(
        identity({ normalizedBody: { id: "catalog-1", expectedVersion: 2 } }),
        operation,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("does not persist a receipt when the command rolls back", async () => {
    const { PrismaAdminCommandRepository } =
      await import("@/backend/repositories/admin/prisma-admin-command-repository");
    const repository = new PrismaAdminCommandRepository();
    const failed = identity({ idempotencyKey: "rollback-idem" });
    await expect(
      repository.execute(failed, async () => {
        throw new Error("CATALOG_INVALID_RUNTIME");
      }),
    ).rejects.toThrow("CATALOG_INVALID_RUNTIME");
    expect(
      [...receiptStore.values()].some(
        (receipt) => receipt.idempotencyKey === "rollback-idem",
      ),
    ).toBe(false);
  });

  it("protects publish and review command routes with step-up and strict headers", () => {
    const routeFiles = [
      "src/app/api/admin/search-catalog-versions/[versionId]/[action]/route.ts",
      "src/app/api/admin/search-mapping-reviews/[reviewId]/[action]/route.ts",
    ];
    for (const relative of routeFiles) {
      const source = readFileSync(relative, "utf8");
      expect(source).toContain("require(request, {\n      sensitive: true,");
      expect(source).toContain(
        "commandHeaders(request, { strictIfMatch: true })",
      );
      expect(source).toContain("headers.idempotencyKey");
      expect(source).toContain("Number.isInteger(headers.expectedVersion)");
    }
  });

  it("maps stale and idempotency conflicts to HTTP 409", async () => {
    const { AdminCommandConflict } =
      await import("@/backend/repositories/admin/prisma-admin-command-repository");
    const { adminRouteError } =
      await import("@/backend/admin/http/admin-route");

    const stale = await adminRouteError(
      new AdminCommandConflict("STALE_CONFLICT", 7),
    );
    const idempotency = await adminRouteError(
      new AdminCommandConflict("IDEMPOTENCY_CONFLICT"),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "STALE_CONFLICT",
      currentVersion: 7,
    });
    expect(idempotency.status).toBe(409);
    expect(await idempotency.json()).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
});
