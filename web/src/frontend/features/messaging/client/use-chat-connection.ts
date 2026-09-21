"use client";

import { useEffect, useState } from "react";
import { disconnectChatSocket, getChatSocket } from "./chat-socket";
import { NOTIFICATION_CHANGED_EVENT } from "@/frontend/features/notifications/client/use-notification-context-read";

export function useChatConnection(input: {
  onAuthoritativeRefetch: () => void | Promise<void>;
  onAuthoritativeHistoryRefetch?: () => void | Promise<void>;
  onProtectedCachePurge: (conversationId?: string) => void;
}) {
  const [state, setState] = useState<
    "CONNECTING" | "CONNECTED" | "RECONNECTING" | "OFFLINE"
  >("CONNECTING");
  useEffect(() => {
    const socket = getChatSocket();
    const connected = () => {
      setState("CONNECTED");
      input.onProtectedCachePurge();
      void input.onAuthoritativeRefetch();
      void input.onAuthoritativeHistoryRefetch?.();
    };
    const disconnected = () => setState("RECONNECTING");
    const failed = () => setState("OFFLINE");
    const revoked = ({ conversationId }: { conversationId: string }) => {
      input.onProtectedCachePurge(conversationId);
      void input.onAuthoritativeRefetch();
    };
    const messagingChanged = () => {
      void input.onAuthoritativeRefetch();
      window.dispatchEvent(new Event(NOTIFICATION_CHANGED_EVENT));
    };
    socket.on("connect", connected);
    socket.on("disconnect", disconnected);
    socket.on("connect_error", failed);
    socket.on("conversation:access_revoked", revoked);
    socket.on("messaging:changed", messagingChanged);
    socket.connect();
    return () => {
      socket.off("connect", connected);
      socket.off("disconnect", disconnected);
      socket.off("connect_error", failed);
      socket.off("conversation:access_revoked", revoked);
      socket.off("messaging:changed", messagingChanged);
    };
  }, [input]);
  return state;
}

export function closeMessagingConnectionOnLogout() {
  disconnectChatSocket();
}
