import { z } from "zod";
import { messagingErrorEnvelopeSchema, opaqueIdSchema } from "./common";
import {
  messageSchema,
  readBoundarySchema,
  sendMessageInputSchema,
} from "./messages";

export const conversationRoomInputSchema = z
  .object({ conversationId: opaqueIdSchema })
  .strict();

export const messageNewEventSchema = z
  .object({ message: messageSchema })
  .strict();
export const messageReadEventSchema = readBoundarySchema;
export const presenceChangedEventSchema = z
  .object({ userId: opaqueIdSchema, presence: z.enum(["ONLINE", "OFFLINE"]) })
  .strict();
export const messagingChangedEventSchema = z
  .object({
    reason: z.enum(["MESSAGE", "READ", "PRESENCE", "ACCESS_REVOKED"]),
  })
  .strict();
export const conversationAccessRevokedEventSchema = z
  .object({
    conversationId: opaqueIdSchema,
    code: z.literal("AUTHORITY_CHANGED"),
  })
  .strict();

export type SocketFailure = z.infer<typeof messagingErrorEnvelopeSchema> & {
  ok: false;
};
export type SocketSuccess<T> = { ok: true; data: T };
export type SocketAck<T> = SocketSuccess<T> | SocketFailure;

export interface ChatClientToServerEvents {
  "conversation:join": (
    input: z.infer<typeof conversationRoomInputSchema>,
    acknowledge: (
      result: SocketAck<{
        conversationId: string;
        otherParticipantPresence: "ONLINE" | "OFFLINE";
      }>,
    ) => void,
  ) => void;
  "conversation:leave": (
    input: z.infer<typeof conversationRoomInputSchema>,
    acknowledge: (result: SocketAck<{ conversationId: string }>) => void,
  ) => void;
  "message:send": (
    input: z.infer<typeof sendMessageInputSchema>,
    acknowledge: (
      result: SocketAck<{
        message: z.infer<typeof messageSchema>;
        deduplicated: boolean;
      }>,
    ) => void,
  ) => void;
}

export interface ChatServerToClientEvents {
  "message:new": (event: z.infer<typeof messageNewEventSchema>) => void;
  "message:read": (event: z.infer<typeof messageReadEventSchema>) => void;
  "presence:changed": (
    event: z.infer<typeof presenceChangedEventSchema>,
  ) => void;
  "messaging:changed": (
    event: z.infer<typeof messagingChangedEventSchema>,
  ) => void;
  "conversation:access_revoked": (
    event: z.infer<typeof conversationAccessRevokedEventSchema>,
  ) => void;
}

export interface ChatInterServerEvents {
  "internal:conversation-access-revoked": (event: {
    affectedUserIds: string[];
    affectedSessionIds?: string[];
    affectedConversationIds: string[];
    cause:
      | "BLOCK"
      | "CONNECTION"
      | "MEMBERSHIP"
      | "SESSION"
      | "ACCOUNT"
      | "MODERATION";
    correlationId: string;
  }) => void;
}

export type ChatSocketData = {
  userId: string;
  sessionId: string;
};
