import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRequestedTestDatabase } from "../../helpers/test-database-guard";

assertRequestedTestDatabase();

const { prisma } = await import("@/backend/database/prisma");
const { AdminMessagingReportReviewService } = await import(
  "@/backend/admin/messaging-reports/admin-messaging-report-review-service"
);

const suffix = crypto.randomUUID();
const reporterId = `report-perf-reporter-${suffix}`;
const targetId = `report-perf-target-${suffix}`;
const conversationId = `report-perf-conversation-${suffix}`;
const reportPrefix = `report-perf-${suffix}`;

describe("messaging-report queue performance", () => {
  beforeAll(async () => {
    await prisma.userAccount.createMany({
      data: [
        {
          id: reporterId,
          name: "Performance Reporter",
          email: `${reporterId}@example.test`,
          normalizedEmail: `${reporterId}@example.test`,
          emailVerified: true,
          state: "ACTIVE",
        },
        {
          id: targetId,
          name: "Performance Target",
          email: `${targetId}@example.test`,
          normalizedEmail: `${targetId}@example.test`,
          emailVerified: true,
          state: "ACTIVE",
        },
      ],
    });
    const [participantLowId, participantHighId] = [
      reporterId,
      targetId,
    ].sort();
    await prisma.messagingConversation.create({
      data: {
        id: conversationId,
        participantLowId: participantLowId!,
        participantHighId: participantHighId!,
        contextType: "PROFESSIONAL_CONNECTION",
        contextReference: `report-perf-connection-${suffix}`,
      },
    });
    const createdAt = new Date();
    await prisma.messagingReport.createMany({
      data: Array.from({ length: 10_000 }, (_, index) => ({
        id: `${reportPrefix}-${index.toString().padStart(5, "0")}`,
        reporterUserId: reporterId,
        targetUserId: targetId,
        conversationId,
        targetType: "CONVERSATION" as const,
        category: "OTHER" as const,
        createdAt,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.messagingReport.deleteMany({
      where: { id: { startsWith: reportPrefix } },
    });
    await prisma.messagingConversation.delete({ where: { id: conversationId } });
    await prisma.userAccount.deleteMany({
      where: { id: { in: [reporterId, targetId] } },
    });
  }, 60_000);

  it("keeps bounded list P95 at or below two seconds", async () => {
    const service = new AdminMessagingReportReviewService();
    const query = {
      page: 1,
      perPage: 100,
      filter: { reporterId },
    };
    for (let index = 0; index < 3; index += 1) await service.list(query);

    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      const page = await service.list(query);
      samples.push(performance.now() - startedAt);
      expect(page.data).toHaveLength(100);
      expect(page.total).toBe(10_000);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
    process.stdout.write(
      `${JSON.stringify({
        feature: "013-messaging-report-review",
        database: "local PostgreSQL",
        datasetSize: 10_000,
        warmupSamples: 3,
        measuredSamples: 20,
        concurrency: 1,
        p50Milliseconds: samples[Math.ceil(samples.length * 0.5) - 1],
        p95Milliseconds: p95,
        p99Milliseconds: samples.at(-1),
        maxMilliseconds: samples.at(-1),
        errorRate: 0,
      })}\n`,
    );
    expect(p95).toBeLessThanOrEqual(2_000);
  }, 60_000);
});
