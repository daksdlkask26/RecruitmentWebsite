import "server-only";
import type { MessagingEligibilityPort } from "@/backend/messaging/ports/eligibility-provider";
import type {
  MessagingBlockRepositoryPort,
  MessagingConversationRepositoryPort,
  MessagingMessageRepositoryPort,
} from "@/backend/messaging/ports/messaging-repository";
import type { MessagingRealtimePublisherPort } from "@/backend/messaging/ports/realtime-publisher";
import { MessagingEligibilityService } from "@/backend/messaging/authorization/messaging-eligibility-service";
import { PrismaMessagingBlockRepository } from "@/backend/repositories/messaging/prisma-messaging-block-repository";
import { PrismaMessagingConversationRepository } from "@/backend/repositories/messaging/prisma-messaging-conversation-repository";
import { PrismaMessagingMessageRepository } from "@/backend/repositories/messaging/prisma-messaging-message-repository";
import {
  unavailableConversation,
  MessagingError,
} from "@/backend/messaging/messaging-errors";
import type { SendMessageInput } from "@/shared/contracts/messaging/messages";

const noPublisher: MessagingRealtimePublisherPort = {
  admitConversationSockets: async () => undefined,
  publishMessage: async () => undefined,
  publishRead: async () => undefined,
  revokeConversationAccess: async () => undefined,
};

export class SendMessageService {
  constructor(
    private readonly eligibility: MessagingEligibilityPort = new MessagingEligibilityService(),
    private readonly blocks: MessagingBlockRepositoryPort = new PrismaMessagingBlockRepository(),
    private readonly conversations: MessagingConversationRepositoryPort = new PrismaMessagingConversationRepository(),
    private readonly messages: MessagingMessageRepositoryPort = new PrismaMessagingMessageRepository(),
    private readonly publisher: MessagingRealtimePublisherPort = noPublisher,
  ) {}

  async execute(senderId: string, input: SendMessageInput, now = new Date()) {
    const conversation = await this.conversations.findAccess(
      input.conversationId,
      senderId,
    );
    if (!conversation) throw unavailableConversation();
    const recipientId =
      conversation.participantLowId === senderId
        ? conversation.participantHighId
        : conversation.participantLowId;
    const context = await this.eligibility.authorizeContext({
      userA: senderId,
      userB: recipientId,
      type: conversation.contextType,
      reference: conversation.contextReference,
    });
    if (!context) throw unavailableConversation();
    if (await this.blocks.isEitherDirectionBlocked(senderId, recipientId)) {
      throw new MessagingError("BLOCKED", 403);
    }
    const accepted = await this.messages.accept({
      ...input,
      senderId,
      now,
    });
    const message = {
      ...accepted.message,
      createdAt: accepted.message.createdAt.toISOString(),
      delivery: "SENT" as const,
    };
    // Durable acceptance is authoritative. Realtime delivery is a best-effort
    // projection and must not turn a committed send into a retryable failure.
    try {
      await this.publisher.publishMessage(message, senderId);
    } catch {
      // REST history and the next authoritative refetch recover the event.
    }
    return { message, deduplicated: accepted.deduplicated };
  }
}
