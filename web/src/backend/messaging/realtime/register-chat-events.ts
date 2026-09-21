import "server-only";
import type { Socket } from "socket.io";
import type { MessagingEligibilityPort } from "@/backend/messaging/ports/eligibility-provider";
import type {
  MessagingBlockRepositoryPort,
  MessagingConversationRepositoryPort,
} from "@/backend/messaging/ports/messaging-repository";
import type { MessagingSocketRegistryPort } from "@/backend/messaging/ports/realtime-publisher";
import type {
  ChatClientToServerEvents,
  ChatInterServerEvents,
  ChatServerToClientEvents,
  ChatSocketData,
  SocketAck,
} from "@/shared/contracts/messaging/socket-events";
import { conversationRoomInputSchema } from "@/shared/contracts/messaging/socket-events";
import { sendMessageInputSchema } from "@/shared/contracts/messaging/messages";
import {
  MessagingError,
  unavailableConversation,
} from "@/backend/messaging/messaging-errors";
import { SendMessageService } from "@/backend/messaging/services/send-message";
import { conversationRoom } from "./messaging-realtime-publisher";

type ChatSocket = Socket<
  ChatClientToServerEvents,
  ChatServerToClientEvents,
  ChatInterServerEvents,
  ChatSocketData
>;

function failure(error: unknown): SocketAck<never> {
  const safe =
    error instanceof MessagingError
      ? error
      : new MessagingError("PERSISTENCE_UNAVAILABLE", 503, true);
  return {
    ok: false,
    error: {
      code: safe.code,
      message:
        safe.code === "VALIDATION_ERROR"
          ? "The request is invalid."
          : safe.code === "RATE_LIMITED"
            ? "Please wait before trying again."
            : safe.code === "BLOCKED"
              ? "Messaging is unavailable for this conversation."
              : safe.code === "AUTH_REQUIRED"
                ? "Authentication is required."
                : safe.code === "PERSISTENCE_UNAVAILABLE"
                  ? "Messaging is temporarily unavailable."
                  : "This conversation is unavailable.",
      retryable: safe.retryable,
      retryAfterSeconds: safe.retryAfterSeconds,
    },
  };
}

export async function authorizeSocketConversation(input: {
  conversationId: string;
  userId: string;
  conversations: MessagingConversationRepositoryPort;
  eligibility: MessagingEligibilityPort;
  blocks: MessagingBlockRepositoryPort;
}) {
  const access = await input.conversations.findAccess(
    input.conversationId,
    input.userId,
  );
  if (!access) throw unavailableConversation();
  if (access.archivedAt) throw unavailableConversation();
  const otherUserId =
    access.participantLowId === input.userId
      ? access.participantHighId
      : access.participantLowId;
  const [context, blocked] = await Promise.all([
    input.eligibility.authorizeContext({
      userA: input.userId,
      userB: otherUserId,
      type: access.contextType,
      reference: access.contextReference,
    }),
    input.blocks.isEitherDirectionBlocked(input.userId, otherUserId),
  ]);
  if (!context) throw unavailableConversation();
  if (blocked) throw new MessagingError("BLOCKED", 403);
  return { access, otherUserId };
}

export function registerChatEvents(
  socket: ChatSocket,
  dependencies: {
    registry: MessagingSocketRegistryPort;
    conversations: MessagingConversationRepositoryPort;
    eligibility: MessagingEligibilityPort;
    blocks: MessagingBlockRepositoryPort;
    send: SendMessageService;
    revalidateSession: () => Promise<boolean>;
    joinConversationRoom?: (room: string) => void | Promise<void>;
  },
) {
  socket.on("conversation:join", async (raw, acknowledge) => {
    try {
      if (!(await dependencies.revalidateSession())) {
        throw new MessagingError("AUTH_REQUIRED", 401);
      }
      const input = conversationRoomInputSchema.parse(raw);
      const { otherUserId } = await authorizeSocketConversation({
        ...input,
        userId: socket.data.userId,
        ...dependencies,
      });
      if (dependencies.joinConversationRoom) {
        await dependencies.joinConversationRoom(
          conversationRoom(input.conversationId),
        );
      } else {
        await socket.join(conversationRoom(input.conversationId));
      }
      dependencies.registry.joinConversation(socket.id, input.conversationId);
      acknowledge({
        ok: true,
        data: {
          conversationId: input.conversationId,
          otherParticipantPresence: dependencies.registry.isOnline(otherUserId)
            ? "ONLINE"
            : "OFFLINE",
        },
      });
    } catch (error) {
      acknowledge(failure(error));
    }
  });

  socket.on("conversation:leave", async (raw, acknowledge) => {
    try {
      const input = conversationRoomInputSchema.parse(raw);
      await socket.leave(conversationRoom(input.conversationId));
      dependencies.registry.leaveConversation(socket.id, input.conversationId);
      acknowledge({ ok: true, data: { conversationId: input.conversationId } });
    } catch (error) {
      acknowledge(failure(error));
    }
  });

  socket.on("message:send", async (raw, acknowledge) => {
    try {
      if (!(await dependencies.revalidateSession())) {
        throw new MessagingError("AUTH_REQUIRED", 401);
      }
      const input = sendMessageInputSchema.parse(raw);
      const result = await dependencies.send.execute(socket.data.userId, input);
      acknowledge({ ok: true, data: result });
    } catch (error) {
      acknowledge(failure(error));
    }
  });
}
