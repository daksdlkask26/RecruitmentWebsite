import "server-only";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { serverEnvironment } from "@/backend/env/runtime";
import { MessagingRequestBoundary } from "@/backend/messaging/authorization/messaging-request-boundary";
import { MessagingEligibilityService } from "@/backend/messaging/authorization/messaging-eligibility-service";
import { PrismaMessagingBlockRepository } from "@/backend/repositories/messaging/prisma-messaging-block-repository";
import { PrismaMessagingConversationRepository } from "@/backend/repositories/messaging/prisma-messaging-conversation-repository";
import { PrismaMessagingMessageRepository } from "@/backend/repositories/messaging/prisma-messaging-message-repository";
import { SendMessageService } from "@/backend/messaging/services/send-message";
import type { MessagingEligibilityPort } from "@/backend/messaging/ports/eligibility-provider";
import type {
  MessagingBlockRepositoryPort,
  MessagingConversationRepositoryPort,
  MessagingMessageRepositoryPort,
} from "@/backend/messaging/ports/messaging-repository";
import type {
  ChatClientToServerEvents,
  ChatInterServerEvents,
  ChatServerToClientEvents,
  ChatSocketData,
} from "@/shared/contracts/messaging/socket-events";
import { MessagingSocketRegistry } from "./messaging-socket-registry";
import {
  accountRoom,
  conversationRoom,
  MessagingRealtimePublisher,
} from "./messaging-realtime-publisher";
import { registerChatEvents } from "./register-chat-events";
import { installMessagingRealtimePublisher } from "./messaging-realtime-hub";
import { MessagingPresenceRegistry } from "./messaging-presence-registry";
import { attachSupportNamespace } from "@/backend/support/realtime/socket-io-support-gateway";
import { attachConnectionNamespace } from "@/backend/connections/realtime/socket-io-connection-gateway";

type Actor = { userId: string; sessionId: string };

function handshakeHeaders(raw: Record<string, string | string[] | undefined>) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

export type ChatGatewayDependencies = {
  authenticate?: (headers: Headers) => Promise<Actor | null>;
  conversations?: MessagingConversationRepositoryPort;
  eligibility?: MessagingEligibilityPort;
  blocks?: MessagingBlockRepositoryPort;
  messages?: MessagingMessageRepositoryPort;
  registry?: MessagingSocketRegistry;
  presence?: MessagingPresenceRegistry;
  joinAccountRoom?: (
    socket: { join(room: string): void | Promise<void> },
    room: string,
  ) => Promise<void>;
  joinConversationRoom?: (room: string) => void | Promise<void>;
};

export function attachSocketIoChatGateway(
  httpServer: HttpServer,
  supplied: ChatGatewayDependencies = {},
) {
  const io = new Server<
    ChatClientToServerEvents,
    ChatServerToClientEvents,
    ChatInterServerEvents,
    ChatSocketData
  >(httpServer, {
    path: serverEnvironment.MESSAGING_SOCKET_PATH,
    serveClient: false,
    transports: ["websocket"],
    allowUpgrades: false,
    maxHttpBufferSize: 32 * 1024,
  });
  const chat = io.of("/chat");
  attachSupportNamespace(io as unknown as Server);
  attachConnectionNamespace(io as unknown as Server);
  const conversations =
    supplied.conversations ?? new PrismaMessagingConversationRepository();
  const eligibility = supplied.eligibility ?? new MessagingEligibilityService();
  const blocks = supplied.blocks ?? new PrismaMessagingBlockRepository();
  const messages = supplied.messages ?? new PrismaMessagingMessageRepository();
  const registry = supplied.registry ?? new MessagingSocketRegistry();
  const authenticate =
    supplied.authenticate ??
    (async (headers: Headers) => {
      try {
        return await new MessagingRequestBoundary().requireSocket(headers);
      } catch {
        return null;
      }
    });
  const publisher = new MessagingRealtimePublisher(
    chat,
    registry,
    conversations,
    eligibility,
    blocks,
  );
  const joinAccountRoom =
    supplied.joinAccountRoom ??
    (async (
      socket: { join(room: string): void | Promise<void> },
      room: string,
    ) => {
      await socket.join(room);
    });
  installMessagingRealtimePublisher(publisher);
  const emitPresence = async (event: {
    userId: string;
    presence: "ONLINE" | "OFFLINE";
  }) => {
    const conversationIds = registry.conversationIdsForUser(event.userId);
    const affectedUsers = new Set<string>([event.userId]);
    for (const conversationId of conversationIds) {
      for (const userId of registry.userIdsForConversation(conversationId)) {
        affectedUsers.add(userId);
      }
      for (const socketId of registry.socketIdsForConversation(
        conversationId,
      )) {
        if (registry.userIdForSocket(socketId) === event.userId) continue;
        chat.sockets.get(socketId)?.emit("presence:changed", event);
      }
    }
    for (const userId of affectedUsers) {
      for (const socketId of registry.socketIdsForUser(userId)) {
        chat.sockets.get(socketId)?.emit("messaging:changed", {
          reason: "PRESENCE",
        });
      }
    }
  };
  const presence =
    supplied.presence ??
    new MessagingPresenceRegistry(
      serverEnvironment.MESSAGING_DISCONNECT_GRACE_MS,
      emitPresence,
    );
  const send = new SendMessageService(
    eligibility,
    blocks,
    conversations,
    messages,
    publisher,
  );

  chat.use(async (socket, next) => {
    let actor: Actor | null;
    try {
      actor = await authenticate(handshakeHeaders(socket.handshake.headers));
    } catch {
      return next(new Error("AUTH_REQUIRED"));
    }
    if (!actor) return next(new Error("AUTH_REQUIRED"));
    socket.data.userId = actor.userId;
    socket.data.sessionId = actor.sessionId;
    return next();
  });

  chat.on("connection", async (socket) => {
    let disconnectRequested = false;
    let presenceRegistered = false;
    let cleanupPromise: Promise<void> | null = null;
    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        const roomNames = [
          accountRoom(socket.data.userId),
          ...[...registry.conversationIdsForSocket(socket.id)].map(
            conversationRoom,
          ),
        ];
        await Promise.allSettled(
          [...new Set(roomNames)].map(async (room) => {
            try {
              await socket.leave(room);
            } catch {
              // Socket.IO may already have removed the room during disconnect.
            }
          }),
        );
        registry.unregister(socket.id);
        if (presenceRegistered) presence.unregister(socket.id);
      })();
      return cleanupPromise;
    };

    // Install cleanup before any await. A disconnect during room admission must
    // not leave registry, room, session, or presence state behind.
    const requestCleanup = () => {
      disconnectRequested = true;
      void cleanup();
    };
    socket.once("disconnecting", requestCleanup);
    socket.once("disconnect", requestCleanup);

    try {
      registry.register({ socketId: socket.id, ...socket.data });
      if (disconnectRequested || socket.disconnected) {
        await cleanup();
        return;
      }
      await joinAccountRoom(socket, accountRoom(socket.data.userId));
      if (disconnectRequested || socket.disconnected) {
        await cleanup();
        return;
      }

      const currentHeaders = () => handshakeHeaders(socket.handshake.headers);
      registerChatEvents(socket, {
        registry,
        conversations,
        eligibility,
        blocks,
        send,
        joinConversationRoom: supplied.joinConversationRoom,
        revalidateSession: async () =>
          Boolean(await authenticate(currentHeaders())),
      });
      if (disconnectRequested || socket.disconnected) {
        await cleanup();
        return;
      }
      presence.register(socket.id, socket.data.userId);
      presenceRegistered = true;
      if (socket.disconnected) await cleanup();
    } catch {
      await cleanup();
      if (socket.connected) socket.disconnect(true);
    }
  });

  return io;
}
