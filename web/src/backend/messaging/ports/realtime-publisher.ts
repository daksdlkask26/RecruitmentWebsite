import type {
  MessagingMessage,
  ReadBoundary,
} from "@/shared/contracts/messaging";

export type MessagingAccessRevocationCause =
  | "BLOCK"
  | "CONNECTION"
  | "MEMBERSHIP"
  | "SESSION"
  | "ACCOUNT"
  | "MODERATION";

export interface MessagingRealtimePublisherPort {
  admitConversationSockets(input: {
    conversationId: string;
    userIds: string[];
  }): Promise<void>;
  publishMessage(message: MessagingMessage, senderId: string): Promise<void>;
  publishRead(boundary: ReadBoundary): Promise<void>;
  revokeConversationAccess(input: {
    affectedUserIds: string[];
    affectedSessionIds?: string[];
    affectedConversationIds: string[];
    cause: MessagingAccessRevocationCause;
    correlationId: string;
  }): Promise<void>;
}

export interface MessagingPresencePort {
  register(input: {
    socketId: string;
    userId: string;
    sessionId: string;
  }): void;
  unregister(socketId: string): void;
  isOnline(userId: string): boolean;
}

export interface MessagingSocketRegistryPort extends MessagingPresencePort {
  joinConversation(socketId: string, conversationId: string): void;
  leaveConversation(socketId: string, conversationId: string): void;
  socketIdsForUser(userId: string): ReadonlySet<string>;
  socketIdsForSession(sessionId: string): ReadonlySet<string>;
  socketIdsForConversation(conversationId: string): ReadonlySet<string>;
  userIdsForConversation(conversationId: string): ReadonlySet<string>;
  conversationIdsForUser(userId: string): ReadonlySet<string>;
  userIdForSocket(socketId: string): string | null;
  conversationIdsForSocket(socketId: string): ReadonlySet<string>;
}
