import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Namespace } from "socket.io";
import type { MessagingEligibilityPort } from "@/backend/messaging/ports/eligibility-provider";
import type {
  MessagingBlockRepositoryPort,
  MessagingConversationRepositoryPort,
} from "@/backend/messaging/ports/messaging-repository";
import type {
  MessagingRealtimePublisherPort,
  MessagingSocketRegistryPort,
} from "@/backend/messaging/ports/realtime-publisher";
import type {
  ChatClientToServerEvents,
  ChatInterServerEvents,
  ChatServerToClientEvents,
  ChatSocketData,
} from "@/shared/contracts/messaging/socket-events";
import type {
  MessagingMessage,
  ReadBoundary,
} from "@/shared/contracts/messaging/messages";

type ChatNamespace = Namespace<
  ChatClientToServerEvents,
  ChatServerToClientEvents,
  ChatInterServerEvents,
  ChatSocketData
>;

function runtimeProbePath() {
  return process.env.PHASE6A_REVOCATION_EVIDENCE_FILE;
}

function targetSnapshot(
  registry: MessagingSocketRegistryPort,
  socketIds: readonly string[],
  sessionIds: readonly string[],
) {
  return {
    targetSocketIdentityCount: socketIds.filter(
      (socketId) => registry.userIdForSocket(socketId) !== null,
    ).length,
    targetSessionMembershipCount: sessionIds.reduce(
      (count, sessionId) =>
        count + registry.socketIdsForSession(sessionId).size,
      0,
    ),
    targetConversationMembershipCount: socketIds.reduce(
      (count, socketId) =>
        count + registry.conversationIdsForSocket(socketId).size,
      0,
    ),
  };
}

async function waitForTargetCleanup(
  registry: MessagingSocketRegistryPort,
  socketIds: readonly string[],
  sessionIds: readonly string[],
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = targetSnapshot(registry, socketIds, sessionIds);
    if (
      snapshot.targetSocketIdentityCount === 0 &&
      snapshot.targetSessionMembershipCount === 0 &&
      snapshot.targetConversationMembershipCount === 0
    )
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return targetSnapshot(registry, socketIds, sessionIds);
}

async function appendRuntimeProbe(record: Record<string, unknown>) {
  const path = runtimeProbePath();
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Evidence capture is optional and must never affect authorization.
  }
}

export class MessagingRealtimePublisher implements MessagingRealtimePublisherPort {
  constructor(
    private readonly namespace: ChatNamespace,
    private readonly registry: MessagingSocketRegistryPort,
    private readonly conversations: MessagingConversationRepositoryPort,
    private readonly eligibility: MessagingEligibilityPort,
    private readonly blocks: MessagingBlockRepositoryPort,
  ) {}

  private emitAccountInvalidation(
    userIds: Iterable<string>,
    reason: "MESSAGE" | "READ" | "PRESENCE" | "ACCESS_REVOKED",
  ) {
    for (const userId of new Set(userIds)) {
      const event = { reason };
      for (const socketId of this.registry.socketIdsForUser(userId)) {
        this.namespace.sockets.get(socketId)?.emit("messaging:changed", event);
      }
    }
  }

  async admitConversationSockets(input: {
    conversationId: string;
    userIds: string[];
  }) {
    for (const userId of input.userIds) {
      const access = await this.conversations.findAccess(
        input.conversationId,
        userId,
      );
      if (!access) continue;
      const otherId =
        access.participantLowId === userId
          ? access.participantHighId
          : access.participantLowId;
      const [context, blocked] = await Promise.all([
        this.eligibility.authorizeContext({
          userA: userId,
          userB: otherId,
          type: access.contextType,
          reference: access.contextReference,
        }),
        this.blocks.isEitherDirectionBlocked(userId, otherId),
      ]);
      if (!context || blocked) continue;
      for (const socketId of this.registry.socketIdsForUser(userId)) {
        const socket = this.namespace.sockets.get(socketId);
        if (!socket) continue;
        await socket.join(conversationRoom(input.conversationId));
        this.registry.joinConversation(socketId, input.conversationId);
      }
    }
  }

  async publishMessage(message: MessagingMessage, senderId: string) {
    const senderAccess = await this.conversations.findAccess(
      message.conversationId,
      senderId,
    );
    if (!senderAccess) return;
    const recipientId =
      senderAccess.participantLowId === senderId
        ? senderAccess.participantHighId
        : senderAccess.participantLowId;
    this.emitAccountInvalidation([senderId, recipientId], "MESSAGE");

    const authorizationByUser = new Map<string, Promise<boolean>>();
    const canDeliverTo = (userId: string) => {
      const existing = authorizationByUser.get(userId);
      if (existing) return existing;
      const authorization = (async () => {
        if (userId === senderId) return true;
        const access = await this.conversations.findAccess(
          message.conversationId,
          userId,
        );
        if (!access || access.archivedAt) return false;
        const otherId =
          access.participantLowId === userId
            ? access.participantHighId
            : access.participantLowId;
        const [context, blocked, canMessage] = await Promise.all([
          this.eligibility.authorizeContext({
            userA: userId,
            userB: otherId,
            type: access.contextType,
            reference: access.contextReference,
          }),
          this.blocks.isEitherDirectionBlocked(userId, otherId),
          this.eligibility.canMessage(senderId, userId),
        ]);
        return Boolean(context && !blocked && canMessage);
      })();
      authorizationByUser.set(userId, authorization);
      return authorization;
    };

    const sockets = [
      ...this.registry.socketIdsForConversation(message.conversationId),
    ];
    for (const socketId of sockets) {
      const userId = this.registry.userIdForSocket(socketId);
      if (!userId || !(await canDeliverTo(userId))) continue;
      this.namespace.sockets.get(socketId)?.emit("message:new", { message });
    }
  }

  async publishRead(boundary: ReadBoundary) {
    const access = await this.conversations.findAccess(
      boundary.conversationId,
      boundary.readerId,
    );
    if (access) {
      const otherId =
        access.participantLowId === boundary.readerId
          ? access.participantHighId
          : access.participantLowId;
      this.emitAccountInvalidation([boundary.readerId, otherId], "READ");
    }
    const sockets = [
      ...this.registry.socketIdsForConversation(boundary.conversationId),
    ];
    for (const socketId of sockets) {
      const userId = this.registry.userIdForSocket(socketId);
      if (!userId) continue;
      if (
        await this.conversations.findAccess(boundary.conversationId, userId)
      ) {
        this.namespace.sockets.get(socketId)?.emit("message:read", boundary);
      }
    }
  }

  async revokeConversationAccess(input: {
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
  }) {
    const affectedSocketIds = new Set<string>();
    for (const userId of input.affectedUserIds) {
      for (const socketId of this.registry.socketIdsForUser(userId)) {
        affectedSocketIds.add(socketId);
      }
    }
    for (const sessionId of input.affectedSessionIds ?? []) {
      for (const socketId of this.registry.socketIdsForSession(sessionId)) {
        affectedSocketIds.add(socketId);
      }
    }
    const trackedSocketIds = [...affectedSocketIds];
    const trackedSessionIds = input.affectedSessionIds ?? [];
    const probePath = runtimeProbePath();
    const before = probePath
      ? targetSnapshot(this.registry, trackedSocketIds, trackedSessionIds)
      : null;
    for (const socketId of affectedSocketIds) {
      const socket = this.namespace.sockets.get(socketId);
      for (const conversationId of input.affectedConversationIds) {
        if (
          !this.registry.conversationIdsForSocket(socketId).has(conversationId)
        )
          continue;
        await socket?.leave(conversationRoom(conversationId));
        this.registry.leaveConversation(socketId, conversationId);
        socket?.emit("conversation:access_revoked", {
          conversationId,
          code: "AUTHORITY_CHANGED",
        });
      }
      if (
        input.cause === "SESSION" ||
        input.cause === "ACCOUNT" ||
        input.cause === "MODERATION"
      ) {
        socket?.disconnect(true);
      }
    }
    this.emitAccountInvalidation(input.affectedUserIds, "ACCESS_REVOKED");
    for (const socketId of affectedSocketIds) {
      const userId = this.registry.userIdForSocket(socketId);
      if (userId) {
        this.emitAccountInvalidation([userId], "ACCESS_REVOKED");
      }
    }
    if (probePath) {
      const after = await waitForTargetCleanup(
        this.registry,
        trackedSocketIds,
        trackedSessionIds,
      );
      await appendRuntimeProbe({
        schema: "candidate-first-phase6a-revocation-runtime-v1",
        cause: input.cause,
        affectedUserCount: input.affectedUserIds.length,
        affectedSessionCount: trackedSessionIds.length,
        affectedConversationCount: input.affectedConversationIds.length,
        before,
        after,
      });
    }
  }
}

export const conversationRoom = (conversationId: string) =>
  `conversation:${conversationId}`;
export const accountRoom = (userId: string) => `account:${userId}`;
