import { createServer } from "node:http";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { attachSocketIoChatGateway } from "@/backend/messaging/realtime/socket-io-chat-gateway";
import { MessagingPresenceRegistry } from "@/backend/messaging/realtime/messaging-presence-registry";
import { MessagingSocketRegistry } from "@/backend/messaging/realtime/messaging-socket-registry";

const closeCallbacks: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function once(socket: Socket, event: string) {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      3_000,
    );
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

describe("same-process chat gateway", () => {
  const baseDependencies = () => ({
    authenticate: async (headers: Headers) => {
      const userId = headers.get("x-test-user");
      return userId ? { userId, sessionId: `session-${userId}` } : null;
    },
    conversations: {
      findAccess: async () => null,
      listAuthorizedConversationIds: async () => [],
      open: async () => ({ conversationId: "unused", created: false }),
    },
    eligibility: {
      canMessage: async () => true,
      authorizeContext: async () => null,
    },
    blocks: { isEitherDirectionBlocked: async () => false },
    messages: {
      accept: async (input: {
        conversationId: string;
        senderId: string;
        content: string;
        now: Date;
        clientOperationId: string;
      }) => ({
        deduplicated: false,
        message: {
          id: "unused",
          conversationId: input.conversationId,
          sequence: 1,
          senderId: input.senderId,
          content: input.content,
          createdAt: input.now,
        },
      }),
    },
  });

  it("denies unauthenticated sockets before registry or presence state exists", async () => {
    const server = createServer();
    const registry = new MessagingSocketRegistry();
    const presence = new MessagingPresenceRegistry(0, () => undefined);
    const gateway = attachSocketIoChatGateway(server, {
      ...baseDependencies(),
      authenticate: async () => null,
      registry,
      presence,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const client = createClient(`http://127.0.0.1:${address.port}/chat`, {
      path: "/chat",
      transports: ["websocket"],
      reconnection: false,
    });
    const failure = once(client, "connect_error");
    closeCallbacks.push(async () => {
      client.disconnect();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await expect(failure).resolves.toMatchObject({ message: "AUTH_REQUIRED" });
    expect(registry.isOnline("anonymous")).toBe(false);
  }, 10_000);

  it("contains conversation-room and authorization failures without joining a room", async () => {
    const server = createServer();
    const registry = new MessagingSocketRegistry();
    const access = {
      id: "conversation-fault",
      participantLowId: "fault-a",
      participantHighId: "fault-b",
      contextType: "PROFESSIONAL_CONNECTION" as const,
      contextReference: "connection-fault",
      applicationId: null,
      companyId: null,
      professionalConnectionId: "connection-fault",
      lastMessageSequence: null,
      archivedAt: null,
    };
    const gateway = attachSocketIoChatGateway(server, {
      ...baseDependencies(),
      conversations: {
        ...baseDependencies().conversations,
        findAccess: async () => access,
      },
      eligibility: {
        canMessage: async () => true,
        authorizeContext: async () => ({
          type: "PROFESSIONAL_CONNECTION",
          reference: "connection-fault",
          professionalConnectionId: "connection-fault",
          label: "Fault fixture",
          companyName: null,
          jobTitle: null,
        }),
      },
      registry,
      joinConversationRoom: async () => {
        throw new Error("CONVERSATION_ROOM_UNAVAILABLE");
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const client = createClient(`http://127.0.0.1:${address.port}/chat`, {
      path: "/chat",
      transports: ["websocket"],
      extraHeaders: { "x-test-user": "fault-a" },
      reconnection: false,
    });
    closeCallbacks.push(async () => {
      client.disconnect();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await once(client, "connect");
    const roomFailure = await client.emitWithAck("conversation:join", {
      conversationId: access.id,
    });
    expect(roomFailure).toMatchObject({ ok: false });
    expect(registry.conversationIdsForSocket(client.id ?? "missing").size).toBe(
      0,
    );
  }, 10_000);

  it("cleans registry state when account-room initialization fails", async () => {
    const server = createServer();
    const registry = new MessagingSocketRegistry();
    const presenceEvents: unknown[] = [];
    const presence = new MessagingPresenceRegistry(0, (event) => {
      presenceEvents.push(event);
    });
    const gateway = attachSocketIoChatGateway(server, {
      ...baseDependencies(),
      registry,
      presence,
      joinAccountRoom: async () => {
        throw new Error("ACCOUNT_ROOM_UNAVAILABLE");
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const client = createClient(`http://127.0.0.1:${address.port}/chat`, {
      path: "/chat",
      transports: ["websocket"],
      extraHeaders: { "x-test-user": "fault-user" },
    });
    const disconnected = once(client, "disconnect");
    closeCallbacks.push(async () => {
      client.disconnect();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await disconnected;
    expect(registry.userIdForSocket(client.id ?? "missing")).toBeNull();
    expect(registry.isOnline("fault-user")).toBe(false);
    expect(presenceEvents).toEqual([]);
  }, 10_000);

  it("cleans a disconnect that happens while the first room is pending", async () => {
    const server = createServer();
    const registry = new MessagingSocketRegistry();
    const presenceEvents: unknown[] = [];
    const presence = new MessagingPresenceRegistry(0, (event) => {
      presenceEvents.push(event);
    });
    let releaseJoin!: () => void;
    const joinPending = new Promise<void>((resolve) => {
      releaseJoin = resolve;
    });
    const gateway = attachSocketIoChatGateway(server, {
      ...baseDependencies(),
      registry,
      presence,
      joinAccountRoom: async () => joinPending,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const client = createClient(`http://127.0.0.1:${address.port}/chat`, {
      path: "/chat",
      transports: ["websocket"],
      extraHeaders: { "x-test-user": "pending-user" },
    });
    const connected = once(client, "connect");
    const disconnected = once(client, "disconnect");
    closeCallbacks.push(async () => {
      client.disconnect();
      releaseJoin();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await connected;
    const socketId = client.id;
    client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseJoin();
    await disconnected;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(socketId).toBeTruthy();
    expect(registry.userIdForSocket(socketId ?? "missing")).toBeNull();
    expect(registry.isOnline("pending-user")).toBe(false);
    expect(presenceEvents).toEqual([]);
  }, 10_000);

  it("keeps list-only users on account invalidation until they join a conversation", async () => {
    const server = createServer();
    let sequence = 0;
    const access = {
      id: "conversation-1",
      participantLowId: "user-a",
      participantHighId: "user-b",
      contextType: "PROFESSIONAL_CONNECTION" as const,
      contextReference: "connection-1",
      applicationId: null,
      companyId: null,
      professionalConnectionId: "connection-1",
      lastMessageSequence: null,
      archivedAt: null,
    };
    const gateway = attachSocketIoChatGateway(server, {
      authenticate: async (headers) => {
        const userId = headers.get("x-test-user");
        return userId ? { userId, sessionId: `session-${userId}` } : null;
      },
      conversations: {
        findAccess: async (conversationId, userId) =>
          conversationId === access.id && ["user-a", "user-b"].includes(userId)
            ? access
            : null,
        listAuthorizedConversationIds: async () => [access.id],
        open: async () => ({ conversationId: access.id, created: false }),
      },
      eligibility: {
        canMessage: async () => true,
        authorizeContext: async () => ({
          type: "PROFESSIONAL_CONNECTION",
          reference: "connection-1",
          professionalConnectionId: "connection-1",
          label: "Professional connection",
          companyName: null,
          jobTitle: null,
        }),
      },
      blocks: { isEitherDirectionBlocked: async () => false },
      messages: {
        accept: async (input) => ({
          deduplicated: false,
          message: {
            id: `message-${++sequence}`,
            conversationId: input.conversationId,
            sequence,
            senderId: input.senderId,
            content: input.content,
            createdAt: input.now,
          },
        }),
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test address");
    const url = `http://127.0.0.1:${address.port}/chat`;
    const client = (userId: string) =>
      createClient(url, {
        path: "/chat",
        transports: ["websocket"],
        extraHeaders: { "x-test-user": userId },
      });
    const sender = client("user-a");
    const receiver = client("user-b");
    closeCallbacks.push(async () => {
      sender.disconnect();
      receiver.disconnect();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await Promise.all([once(sender, "connect"), once(receiver, "connect")]);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const invalidated = once(receiver, "messaging:changed");
    const acknowledgement = await sender.emitWithAck("message:send", {
      conversationId: access.id,
      clientOperationId: crypto.randomUUID(),
      content: "Hello from the conversation list",
    });
    expect(acknowledgement).toMatchObject({ ok: true });
    await expect(invalidated).resolves.toEqual({
      reason: "MESSAGE",
    });
  }, 10_000);
});
