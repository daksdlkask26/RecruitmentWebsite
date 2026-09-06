import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

const { assertTestDatabaseEnvironment } = await import(
  "../tests/helpers/test-database-guard.ts"
);
assertTestDatabaseEnvironment();

const { prisma } = await import("../src/backend/database/prisma.ts");
const { PrismaNotificationRepository } =
  await import("../src/backend/repositories/notifications/prisma-notification-repository.ts");

const fixtureSize = 5_000;
const warmupSamples = 5;
const measuredSamples = 30;
const pageTargetMs = 500;
const unreadTargetMs = 500;

const percentile = (values, fraction) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
};

const timed = async (operation) => {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
};

const fixtureId = `notification-perf-${randomUUID()}`;
const now = new Date();
const repository = new PrismaNotificationRepository(prisma);

try {
  await prisma.userAccount.create({
    data: {
      id: fixtureId,
      name: "Notification performance fixture",
      email: `${fixtureId}@example.invalid`,
      normalizedEmail: `${fixtureId}@example.invalid`,
      state: "ACTIVE",
      emailVerified: true,
    },
  });
  await prisma.inAppNotification.createMany({
    data: Array.from({ length: fixtureSize }, (_, index) => {
      const occurredAt = new Date(now.getTime() - index * 1_000);
      return {
        recipientUserId: fixtureId,
        kind: "APPLICATION_STAGE_CHANGED",
        category: "APPLICATION",
        severity: index % 10 === 0 ? "HIGH" : "MEDIUM",
        title: "Application updated",
        summary: "Your application has a new status.",
        href: `/jobs/applied/perf-${index}`,
        contextType: "APPLICATION",
        contextId: `perf-${index}`,
        deduplicationKey: `${fixtureId}:${index}`,
        correlationId: `perf-${index}`,
        expiresAt: new Date(occurredAt.getTime() + 90 * 86_400_000),
        createdAt: occurredAt,
        lastOccurredAt: occurredAt,
      };
    }),
  });

  const list = () =>
    repository.list({
      recipientUserId: fixtureId,
      limit: 20,
      state: "all",
      now,
    });
  const unread = () => repository.unreadCount(fixtureId, now);
  for (let index = 0; index < warmupSamples; index += 1) {
    await list();
    await unread();
  }
  const listSamples = [];
  const unreadSamples = [];
  for (let index = 0; index < measuredSamples; index += 1) {
    listSamples.push(await timed(list));
    unreadSamples.push(await timed(unread));
  }
  const result = {
    fixtureSize,
    warmupSamples,
    measuredSamples,
    listPageP95Ms: Number(percentile(listSamples, 0.95).toFixed(2)),
    unreadCountP95Ms: Number(percentile(unreadSamples, 0.95).toFixed(2)),
    targets: { pageTargetMs, unreadTargetMs },
  };
  console.info(JSON.stringify(result));
  if (
    result.listPageP95Ms > pageTargetMs ||
    result.unreadCountP95Ms > unreadTargetMs
  ) {
    process.exitCode = 1;
  }
} finally {
  await prisma.inAppNotification.deleteMany({
    where: { recipientUserId: fixtureId },
  });
  await prisma.userAccount.deleteMany({ where: { id: fixtureId } });
  await prisma.$disconnect();
}
