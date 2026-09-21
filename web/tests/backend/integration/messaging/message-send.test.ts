import { describe, expect, it } from "vitest";
import { SendMessageService } from "@/backend/messaging/services/send-message";

describe("message acceptance orchestration", () => {
  it("publishes only after durable acceptance and preserves deduplication", async () => {
    const order: string[] = [];
    const service = new SendMessageService(
      {
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
      { isEitherDirectionBlocked: async () => false },
      {
        findAccess: async () => ({
          id: "conversation-1",
          participantLowId: "sender",
          participantHighId: "recipient",
          contextType: "PROFESSIONAL_CONNECTION",
          contextReference: "connection-1",
          applicationId: null,
          companyId: null,
          professionalConnectionId: "connection-1",
          lastMessageSequence: null,
          archivedAt: null,
        }),
        listAuthorizedConversationIds: async () => [],
        open: async () => ({
          conversationId: "conversation-1",
          created: false,
        }),
      },
      {
        accept: async (input) => {
          order.push("commit");
          return {
            deduplicated: true,
            message: {
              id: "message-1",
              conversationId: input.conversationId,
              sequence: 1,
              senderId: input.senderId,
              content: input.content,
              createdAt: input.now,
            },
          };
        },
      },
      {
        admitConversationSockets: async () => undefined,
        publishMessage: async () => {
          order.push("publish");
        },
        publishRead: async () => undefined,
        revokeConversationAccess: async () => undefined,
      },
    );
    const result = await service.execute("sender", {
      conversationId: "conversation-1",
      clientOperationId: crypto.randomUUID(),
      content: "Committed text",
    });
    expect(order).toEqual(["commit", "publish"]);
    expect(result.deduplicated).toBe(true);
  });

  it("returns a committed message when realtime publication fails", async () => {
    const service = new SendMessageService(
      {
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
      { isEitherDirectionBlocked: async () => false },
      {
        findAccess: async () => ({
          id: "conversation-1",
          participantLowId: "sender",
          participantHighId: "recipient",
          contextType: "PROFESSIONAL_CONNECTION",
          contextReference: "connection-1",
          applicationId: null,
          companyId: null,
          professionalConnectionId: "connection-1",
          lastMessageSequence: null,
          archivedAt: null,
        }),
        listAuthorizedConversationIds: async () => [],
        open: async () => ({
          conversationId: "conversation-1",
          created: false,
        }),
      },
      {
        accept: async (input) => ({
          deduplicated: false,
          message: {
            id: "message-committed",
            conversationId: input.conversationId,
            sequence: 1,
            senderId: input.senderId,
            content: input.content,
            createdAt: input.now,
          },
        }),
      },
      {
        admitConversationSockets: async () => undefined,
        publishMessage: async () => {
          throw new Error("REALTIME_UNAVAILABLE");
        },
        publishRead: async () => undefined,
        revokeConversationAccess: async () => undefined,
      },
    );
    await expect(
      service.execute("sender", {
        conversationId: "conversation-1",
        clientOperationId: crypto.randomUUID(),
        content: "Durable text",
      }),
    ).resolves.toMatchObject({
      message: { id: "message-committed", delivery: "SENT" },
      deduplicated: false,
    });
  });
});
