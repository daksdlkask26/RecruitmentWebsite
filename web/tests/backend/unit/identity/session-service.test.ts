import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertTestDatabaseEnvironment } from "../../../helpers/test-database-guard";
import { prisma } from "@/backend/database/prisma";
import { SessionService } from "@/backend/services/session/session-service";

assertTestDatabaseEnvironment();

async function user() {
  return prisma.userAccount.create({
    data: {
      id: randomUUID(),
      name: "Session User",
      email: `session-${randomUUID()}@example.test`,
      normalizedEmail: `session-${randomUUID()}@example.test`,
      emailVerified: true,
      state: "ACTIVE",
    },
  });
}
async function session(userId: string, index: number, now = new Date()) {
  return prisma.session.create({
    data: {
      id: randomUUID(),
      token: randomUUID(),
      userId,
      createdAt: new Date(now.getTime() - 86400000),
      expiresAt: new Date(now.getTime() + 7 * 86400000),
      absoluteExpiresAt: new Date(now.getTime() + 7 * 86400000),
      lastActivityAt: new Date(now.getTime() - index * 1000),
    },
  });
}
describe("session policy", () => {
  it("atomically retains at most five deterministic recent sessions", async () => {
    const u = await user(),
      now = new Date();
    for (let i = 0; i < 7; i++) await session(u.id, i, now);
    await Promise.all([
      new SessionService().enforceCreated(u.id),
      new SessionService().enforceCreated(u.id),
    ]);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(5);
  });
  it("rejects idle and absolute expiry and accepts active ownership", async () => {
    const u = await user(),
      other = await user(),
      now = new Date(),
      service = new SessionService();
    const active = await session(u.id, 0, now);
    expect(
      await service.validate(active.id, u.id, new Date(now.getTime() + 1000)),
    ).not.toBeNull();
    expect(
      (
        await prisma.session.findUniqueOrThrow({
          where: { id: active.id },
          select: { lastActivityAt: true },
        })
      ).lastActivityAt,
    ).toEqual(active.lastActivityAt);
    const touchAt = new Date(now.getTime() + 61 * 1000);
    expect(await service.validate(active.id, u.id, touchAt)).not.toBeNull();
    expect(
      (
        await prisma.session.findUniqueOrThrow({
          where: { id: active.id },
          select: { lastActivityAt: true },
        })
      ).lastActivityAt,
    ).toEqual(touchAt);
    expect(await service.validate(active.id, other.id, now)).toBeNull();
    const idle = await session(u.id, 0, now);
    await prisma.session.update({
      where: { id: idle.id },
      data: { lastActivityAt: new Date(now.getTime() - 30 * 60000) },
    });
    expect(await service.validate(idle.id, u.id, now)).toBeNull();
    const absolute = await session(u.id, 0, now);
    const past = new Date(now.getTime() - 1000);
    await prisma.session.update({
      where: { id: absolute.id },
      data: { expiresAt: past, absoluteExpiresAt: past },
    });
    expect(await service.validate(absolute.id, u.id, now)).toBeNull();
  });
});
