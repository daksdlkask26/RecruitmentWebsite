import { vi } from "vitest";

const notificationMock = vi.hoisted(() => ({
  createInAppNotification: vi.fn(),
}));

vi.mock("@/backend/notifications/notification-service", () => notificationMock);

import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/backend/database/prisma";
import { PrismaMessagingMessageRepository } from "@/backend/repositories/messaging/prisma-messaging-message-repository";
import { PrismaMessagingConversationRepository } from "@/backend/repositories/messaging/prisma-messaging-conversation-repository";
import { MarkConversationReadService } from "@/backend/messaging/services/mark-conversation-read";
import { installMessagingRealtimePublisher } from "@/backend/messaging/realtime/messaging-realtime-hub";
import type { MessagingRealtimePublisherPort } from "@/backend/messaging/ports/realtime-publisher";
import { cleanupMessagingFixture, seedMessagingFixture } from "./fixtures";

describe("Phase 6A durable message recovery", () => {
  const fixtures: string[] = [];

  afterEach(async () => {
    notificationMock.createInAppNotification.mockReset();
    for (const prefix of fixtures.splice(0)) {
      await cleanupMessagingFixture(prefix);
    }
  });

  it("keeps the message and idempotency result when notification publication fails", async () => {
    const fixture = await seedMessagingFixture();
    fixtures.push(fixture.prefix);
    const conversationId = `${fixture.prefix}-conversation`;
    const participantLowId = [
      fixture.candidateId,
      fixture.recruiterId,
    ].sort()[0]!;
    const participantHighId = [
      fixture.candidateId,
      fixture.recruiterId,
    ].sort()[1]!;
    await prisma.messagingConversation.create({
      data: {
        id: conversationId,
        participantLowId,
        participantHighId,
        contextType: "PROFESSIONAL_CONNECTION",
        contextReference: fixture.connectionId,
        professionalConnectionId: fixture.connectionId,
        participants: {
          create: [{ userId: participantLowId }, { userId: participantHighId }],
        },
      },
    });
    notificationMock.createInAppNotification.mockRejectedValue(
      new Error("NOTIFICATION_STORE_UNAVAILABLE"),
    );
    const repository = new PrismaMessagingMessageRepository(prisma);
    const input = {
      conversationId,
      senderId: fixture.candidateId,
      clientOperationId: crypto.randomUUID(),
      content: "Durable recovery fixture message",
      now: new Date(),
    };

    const first = await repository.accept(input);
    const replay = await repository.accept(input);

    expect(first.deduplicated).toBe(false);
    expect(replay.deduplicated).toBe(true);
    expect(replay.message.id).toBe(first.message.id);
    expect(
      await prisma.messagingMessage.count({ where: { conversationId } }),
    ).toBe(1);
    expect(notificationMock.createInAppNotification).toHaveBeenCalled();
  });

  it("keeps a committed read boundary when realtime publication fails", async () => {
    const fixture = await seedMessagingFixture();
    fixtures.push(fixture.prefix);
    const conversationId = `${fixture.prefix}-conversation-read`;
    const participantLowId = [
      fixture.candidateId,
      fixture.recruiterId,
    ].sort()[0]!;
    const participantHighId = [
      fixture.candidateId,
      fixture.recruiterId,
    ].sort()[1]!;
    const now = new Date();
    await prisma.messagingConversation.create({
      data: {
        id: conversationId,
        participantLowId,
        participantHighId,
        contextType: "PROFESSIONAL_CONNECTION",
        contextReference: fixture.connectionId,
        professionalConnectionId: fixture.connectionId,
        participants: {
          create: [{ userId: participantLowId }, { userId: participantHighId }],
        },
      },
    });
    await prisma.messagingMessage.create({
      data: {
        conversationId,
        sequence: 1,
        senderId: fixture.candidateId,
        clientOperationId: crypto.randomUUID(),
        content: "Read-boundary recovery fixture",
        createdAt: now,
      },
    });
    await prisma.messagingConversation.update({
      where: { id: conversationId },
      data: {
        nextMessageSequence: 2,
        lastMessageSequence: 1,
        lastMessageAt: now,
      },
    });
    const failingPublisher: MessagingRealtimePublisherPort = {
      admitConversationSockets: async () => undefined,
      publishMessage: async () => undefined,
      publishRead: async () => {
        throw new Error("REALTIME_READ_UNAVAILABLE");
      },
      revokeConversationAccess: async () => undefined,
    };
    installMessagingRealtimePublisher(failingPublisher);
    try {
      const service = new MarkConversationReadService(
        new PrismaMessagingConversationRepository(prisma),
        {
          canMessage: async () => true,
          authorizeContext: async () => ({
            type: "PROFESSIONAL_CONNECTION" as const,
            reference: fixture.connectionId,
            professionalConnectionId: fixture.connectionId,
            label: "Read recovery fixture",
            companyName: null,
            jobTitle: null,
          }),
        },
      );
      await expect(
        service.execute({
          conversationId,
          userId: fixture.recruiterId,
          lastReadSequence: 1,
          now,
        }),
      ).resolves.toMatchObject({
        conversationId,
        readerId: fixture.recruiterId,
        lastReadSequence: 1,
      });
      const participant =
        await prisma.messagingConversationParticipant.findUnique({
          where: {
            conversationId_userId: {
              conversationId,
              userId: fixture.recruiterId,
            },
          },
          select: { lastReadSequence: true },
        });
      expect(participant?.lastReadSequence).toBe(1);
    } finally {
      installMessagingRealtimePublisher({
        admitConversationSockets: async () => undefined,
        publishMessage: async () => undefined,
        publishRead: async () => undefined,
        revokeConversationAccess: async () => undefined,
      });
    }
  });
});
