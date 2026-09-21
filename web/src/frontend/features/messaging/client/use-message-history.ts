"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import type { ConversationDetail } from "@/shared/contracts/messaging/conversations";
import type { MessagingMessage } from "@/shared/contracts/messaging/messages";
import { messagingCopy } from "../messaging-copy";
import { getChatSocket } from "./chat-socket";

export type MessageHistoryPage = {
  conversation: ConversationDetail;
  items: MessagingMessage[];
  nextCursor: string | null;
};

export function useMessageHistory(
  conversationId: string | null,
  csrfProof: string,
  onReadCommitted?: (conversationId: string) => void,
  locale: WorkspaceLocale = "en",
) {
  const copy = messagingCopy(locale);
  const [page, setPage] = useState<MessageHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markReadThrough = useCallback(
    async (lastReadSequence: number) => {
      if (!conversationId) return false;
      const response = await fetch(
        `/api/messaging/conversations/${encodeURIComponent(conversationId)}/read`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-csrf-proof": csrfProof,
          },
          body: JSON.stringify({ lastReadSequence }),
        },
      );
      if (!response.ok) return false;
      setPage((current) =>
        current?.conversation.id === conversationId
          ? {
              ...current,
              conversation: {
                ...current.conversation,
                unreadCount: 0,
                currentUserLastReadSequence: Math.max(
                  current.conversation.currentUserLastReadSequence,
                  lastReadSequence,
                ),
              },
            }
          : current,
      );
      onReadCommitted?.(conversationId);
      return true;
    },
    [conversationId, csrfProof, onReadCommitted],
  );

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    try {
      const response = await fetch(
        `/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages?limit=20`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) throw new Error("HISTORY_FAILED");
      const nextPage = (await response.json()) as MessageHistoryPage;
      setPage(nextPage);
      const socket = getChatSocket();
      if (socket.connected) {
        await socket
          .emitWithAck("conversation:join", { conversationId })
          .catch(() => undefined);
      }
      if (
        nextPage.conversation.currentLastSequence >
        nextPage.conversation.currentUserLastReadSequence
      ) {
        await markReadThrough(nextPage.conversation.currentLastSequence);
      }
      setError(null);
    } catch {
      setError(copy.messagesLoadError);
    }
  }, [conversationId, copy.messagesLoadError, markReadThrough]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const loadOlder = async () => {
    if (!conversationId || !page?.nextCursor) return;
    const response = await fetch(
      `/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages?limit=20&cursor=${encodeURIComponent(page.nextCursor)}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    if (!response.ok) {
      setError(copy.olderMessagesError);
      return;
    }
    const older = (await response.json()) as MessageHistoryPage;
    setPage((current) =>
      current
        ? {
            ...current,
            conversation: older.conversation,
            items: [
              ...older.items,
              ...current.items.filter(
                (message) =>
                  !older.items.some((candidate) => candidate.id === message.id),
              ),
            ],
            nextCursor: older.nextCursor,
          }
        : older,
    );
  };

  const addMessage = useCallback((message: MessagingMessage) => {
    setPage((current) =>
      current && current.conversation.id === message.conversationId
        ? current.items.some(
            (item) =>
              item.id === message.id || item.sequence === message.sequence,
          )
          ? current
          : {
              ...current,
              items: [...current.items, message].toSorted(
                (left, right) => left.sequence - right.sequence,
              ),
            }
        : current,
    );
  }, []);
  const setPresence = useCallback(
    (userId: string, presence: "ONLINE" | "OFFLINE") => {
      setPage((current) =>
        current?.conversation.otherParticipant.id === userId
          ? { ...current, conversation: { ...current.conversation, presence } }
          : current,
      );
    },
    [],
  );
  const visiblePage = page?.conversation.id === conversationId ? page : null;
  return {
    page: visiblePage,
    error,
    refresh,
    loadOlder,
    addMessage,
    markReadThrough,
    setPresence,
    setPage,
  };
}
