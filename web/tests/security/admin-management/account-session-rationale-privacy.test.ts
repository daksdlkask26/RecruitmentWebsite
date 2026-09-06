import { afterEach, describe, expect, it } from "vitest";
import { assertRequestedTestDatabase } from "../../helpers/test-database-guard";

assertRequestedTestDatabase();

const { prisma } = await import("@/backend/database/prisma");
const { PrivilegedRationaleService } = await import(
  "@/backend/admin/rationales/privileged-rationale-service"
);
const { runRationaleRetentionCycle } = await import(
  "@/backend/admin/workers/rationale-retention-loop"
);

describe("privileged rationale retention", () => {
  const correlations: string[] = [];
  afterEach(() =>
    prisma.privilegedActionRationale.deleteMany({
      where: { correlationId: { in: correlations.splice(0) } },
    }),
  );
  it("requires a proof no older than 15 minutes and becomes inaccessible at 365 days", async () => {
    const actionAt = new Date("2026-01-01T00:00:00.000Z");
    const correlationId = crypto.randomUUID();
    correlations.push(correlationId);
    await prisma.$transaction((tx) =>
      new PrivilegedRationaleService().create(tx, {
        correlationId,
        explanation: "Approved security investigation rationale.",
        actionAt,
      }),
    );
    await expect(
      new PrivilegedRationaleService().read(
        correlationId,
        new Date(actionAt.getTime() + 10 * 60_000),
        actionAt,
      ),
    ).resolves.toContain("security investigation");
    await expect(
      new PrivilegedRationaleService().read(
        correlationId,
        new Date(actionAt.getTime() + 15 * 60_000 + 1),
        actionAt,
      ),
    ).rejects.toThrow("STEP_UP_REQUIRED");
    await expect(
      new PrivilegedRationaleService().read(
        correlationId,
        new Date(actionAt.getTime() + 365 * 86_400_000),
        new Date(actionAt.getTime() + 365 * 86_400_000),
      ),
    ).resolves.toBeNull();
  });
  it("deletes encrypted payload during the following 24 hours", async () => {
    const actionAt = new Date("2025-01-01T00:00:00.000Z");
    const correlationId = crypto.randomUUID();
    correlations.push(correlationId);
    await prisma.$transaction((tx) =>
      new PrivilegedRationaleService().create(tx, {
        correlationId,
        explanation: "Approved retention cleanup rationale.",
        actionAt,
      }),
    );
    await runRationaleRetentionCycle(
      new Date(actionAt.getTime() + 366 * 86_400_000),
    );
    const row = await prisma.privilegedActionRationale.findUniqueOrThrow({
      where: { correlationId },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.ciphertext).toBe("");
  });
});
