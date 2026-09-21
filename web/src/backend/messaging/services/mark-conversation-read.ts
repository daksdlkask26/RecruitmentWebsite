import "server-only";
import { MessagingEligibilityService } from "@/backend/messaging/authorization/messaging-eligibility-service";
import { PrismaMessagingConversationRepository } from "@/backend/repositories/messaging/prisma-messaging-conversation-repository";
import {
  MessagingError,
  unavailableConversation,
} from "@/backend/messaging/messaging-errors";
import { publishCommittedRead } from "@/backend/messaging/realtime/messaging-realtime-hub";
import type { MessagingEligibilityPort } from "@/backend/messaging/ports/eligibility-provider";
import type { PrismaMessagingConversationRepository as PrismaMessagingConversationRepositoryType } from "@/backend/repositories/messaging/prisma-messaging-conversation-repository";

type MarkReadRepository = Pick<
  PrismaMessagingConversationRepositoryType,
  "findAccess" | "markRead"
>;

export class MarkConversationReadService {
  constructor(
    private readonly repository: MarkReadRepository = new PrismaMessagingConversationRepository(),
    private readonly eligibility: MessagingEligibilityPort = new MessagingEligibilityService(),
  ) {}

  async execute(input: {
    conversationId: string;
    userId: string;
    lastReadSequence: number;
    now?: Date;
  }) {
    const access = await this.repository.findAccess(
      input.conversationId,
      input.userId,
    );
    if (!access) throw unavailableConversation();
    const otherUserId =
      access.participantLowId === input.userId
        ? access.participantHighId
        : access.participantLowId;
    if (
      !(await this.eligibility.authorizeContext({
        userA: input.userId,
        userB: otherUserId,
        type: access.contextType,
        reference: access.contextReference,
      }))
    ) {
      throw unavailableConversation();
    }
    try {
      const boundary = await this.repository.markRead({
        ...input,
        now: input.now ?? new Date(),
      });
      if (!boundary) throw unavailableConversation();
      try {
        await publishCommittedRead(boundary);
      } catch {
        // The read boundary is durable; a later history/list refetch converges
        // clients if realtime fan-out is unavailable.
      }
      return boundary;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "READ_SEQUENCE_CONFLICT"
      ) {
        throw new MessagingError("CONFLICT", 409);
      }
      throw error;
    }
  }
}
