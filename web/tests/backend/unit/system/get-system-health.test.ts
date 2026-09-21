import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(),
    imageSearchOperationalEvidence: { findMany: vi.fn() },
  },
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));

import { getSystemHealth } from "@/backend/services/system/get-system-health";

describe("system health readiness", () => {
  beforeEach(() => {
    mocks.prisma.$queryRaw.mockReset();
    mocks.prisma.imageSearchOperationalEvidence.findMany.mockReset();
    mocks.prisma.imageSearchOperationalEvidence.findMany.mockResolvedValue([]);
  });

  it("returns non-ready without exposing the database error", async () => {
    mocks.prisma.$queryRaw.mockRejectedValue(new Error("connection secret"));

    await expect(
      getSystemHealth({ dependencyTimeoutMs: 10 }),
    ).resolves.toMatchObject({
      status: "not_ready",
      liveness: { status: "ok" },
      readiness: {
        status: "not_ready",
        dependencies: { database: "unavailable" },
      },
    });
    expect(
      JSON.stringify(await getSystemHealth({ dependencyTimeoutMs: 10 })),
    ).not.toContain("connection secret");
  });

  it("keeps optional capability readiness separate from database readiness", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);

    await expect(getSystemHealth()).resolves.toMatchObject({
      status: "ok",
      liveness: { status: "ok" },
      readiness: { status: "ok", dependencies: { database: "ok" } },
      capabilities: expect.objectContaining({ ordinaryJobSearch: true }),
    });
  });
});
