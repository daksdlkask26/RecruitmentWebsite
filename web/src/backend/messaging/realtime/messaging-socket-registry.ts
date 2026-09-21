import type { MessagingSocketRegistryPort } from "@/backend/messaging/ports/realtime-publisher";

type SocketIdentity = { userId: string; sessionId: string };

export class MessagingSocketRegistry implements MessagingSocketRegistryPort {
  private readonly identities = new Map<string, SocketIdentity>();
  private readonly socketsByUser = new Map<string, Set<string>>();
  private readonly socketsBySession = new Map<string, Set<string>>();
  private readonly conversationsBySocket = new Map<string, Set<string>>();
  private readonly socketsByConversation = new Map<string, Set<string>>();

  register(input: { socketId: string; userId: string; sessionId: string }) {
    this.unregister(input.socketId);
    this.identities.set(input.socketId, {
      userId: input.userId,
      sessionId: input.sessionId,
    });
    const sockets = this.socketsByUser.get(input.userId) ?? new Set<string>();
    sockets.add(input.socketId);
    this.socketsByUser.set(input.userId, sockets);
    const sessionSockets =
      this.socketsBySession.get(input.sessionId) ?? new Set<string>();
    sessionSockets.add(input.socketId);
    this.socketsBySession.set(input.sessionId, sessionSockets);
    this.conversationsBySocket.set(input.socketId, new Set());
  }

  unregister(socketId: string) {
    const identity = this.identities.get(socketId);
    if (identity) {
      const sockets = this.socketsByUser.get(identity.userId);
      sockets?.delete(socketId);
      if (sockets?.size === 0) this.socketsByUser.delete(identity.userId);
      const sessionSockets = this.socketsBySession.get(identity.sessionId);
      sessionSockets?.delete(socketId);
      if (sessionSockets?.size === 0) {
        this.socketsBySession.delete(identity.sessionId);
      }
    }
    for (const conversationId of this.conversationsBySocket.get(socketId) ??
      []) {
      this.leaveConversation(socketId, conversationId);
    }
    this.conversationsBySocket.delete(socketId);
    this.identities.delete(socketId);
  }

  joinConversation(socketId: string, conversationId: string) {
    if (!this.identities.has(socketId)) return;
    const conversations =
      this.conversationsBySocket.get(socketId) ?? new Set<string>();
    conversations.add(conversationId);
    this.conversationsBySocket.set(socketId, conversations);
    const sockets =
      this.socketsByConversation.get(conversationId) ?? new Set<string>();
    sockets.add(socketId);
    this.socketsByConversation.set(conversationId, sockets);
  }

  leaveConversation(socketId: string, conversationId: string) {
    this.conversationsBySocket.get(socketId)?.delete(conversationId);
    const sockets = this.socketsByConversation.get(conversationId);
    sockets?.delete(socketId);
    if (sockets?.size === 0) this.socketsByConversation.delete(conversationId);
  }

  socketIdsForUser(userId: string): ReadonlySet<string> {
    return this.socketsByUser.get(userId) ?? new Set();
  }

  socketIdsForSession(sessionId: string): ReadonlySet<string> {
    return this.socketsBySession.get(sessionId) ?? new Set();
  }

  socketIdsForConversation(conversationId: string): ReadonlySet<string> {
    return this.socketsByConversation.get(conversationId) ?? new Set();
  }

  userIdsForConversation(conversationId: string): ReadonlySet<string> {
    const userIds = new Set<string>();
    for (const socketId of this.socketIdsForConversation(conversationId)) {
      const userId = this.userIdForSocket(socketId);
      if (userId) userIds.add(userId);
    }
    return userIds;
  }

  conversationIdsForUser(userId: string): ReadonlySet<string> {
    const conversationIds = new Set<string>();
    for (const socketId of this.socketIdsForUser(userId)) {
      for (const conversationId of this.conversationIdsForSocket(socketId)) {
        conversationIds.add(conversationId);
      }
    }
    return conversationIds;
  }

  userIdForSocket(socketId: string) {
    return this.identities.get(socketId)?.userId ?? null;
  }

  sessionIdForSocket(socketId: string) {
    return this.identities.get(socketId)?.sessionId ?? null;
  }

  conversationIdsForSocket(socketId: string): ReadonlySet<string> {
    return this.conversationsBySocket.get(socketId) ?? new Set();
  }

  isOnline(userId: string) {
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }
}
