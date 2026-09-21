"use client";

import { useCallback, useMemo, useState } from "react";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { WorkspacePageHeader } from "@/frontend/features/dashboard/components/page-header";
import type {
  ConversationSummary,
  EligibleParticipant,
} from "@/shared/contracts/messaging/conversations";
import { useConversations } from "../client/use-conversations";
import { useMessageHistory } from "../client/use-message-history";
import { useChatConnection } from "../client/use-chat-connection";
import { useChatEvents } from "../client/use-chat-events";
import { messagingCopy } from "../messaging-copy";
import { MessageThread } from "./message-thread";
import { StartConversation } from "./start-conversation";
import { ConversationDetails } from "./conversation-details";

export function MessagingWorkspace({
  currentUserId,
  csrfProof,
  initialConversations,
  initialEligibleParticipants,
  initialConversationId = null,
}: {
  currentUserId: string;
  csrfProof: string;
  initialConversations: ConversationSummary[];
  initialEligibleParticipants: EligibleParticipant[];
  initialConversationId?: string | null;
}) {
  const locale = useWorkspaceLocale();
  const copy = messagingCopy(locale);
  const conversations = useConversations(initialConversations, locale);
  const [selectedId, setSelectedId] = useState(initialConversationId);
  const [query, setQuery] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const history = useMessageHistory(
    selectedId,
    csrfProof,
    conversations.clearUnread,
    locale,
  );
  const {
    addMessage,
    loadOlder,
    markReadThrough,
    refresh: refreshHistory,
    setPage,
    setPresence,
  } = history;
  const {
    refresh: refreshConversations,
    setPresence: setConversationPresence,
  } = conversations;
  const purge = useCallback(
    (conversationId?: string) => {
      if (!conversationId || conversationId === selectedId) setPage(null);
    },
    [selectedId, setPage],
  );
  const connectionInput = useMemo(
    () => ({
      onAuthoritativeRefetch: refreshConversations,
      onAuthoritativeHistoryRefetch: refreshHistory,
      onProtectedCachePurge: purge,
    }),
    [purge, refreshConversations, refreshHistory],
  );
  const connectionState = useChatConnection(connectionInput);
  const onMessage = useCallback(
    (message: Parameters<typeof addMessage>[0]) => {
      addMessage(message);
      if (
        message.conversationId === selectedId &&
        message.senderId !== currentUserId &&
        document.visibilityState === "visible"
      ) {
        void markReadThrough(message.sequence).finally(refreshConversations);
      } else {
        void refreshConversations();
      }
    },
    [
      addMessage,
      currentUserId,
      markReadThrough,
      refreshConversations,
      selectedId,
    ],
  );
  const onRead = useCallback(() => void refreshHistory(), [refreshHistory]);
  const onAccessRevoked = useCallback(
    (conversationId: string) => {
      purge(conversationId);
      void refreshConversations();
    },
    [purge, refreshConversations],
  );
  const onPresence = useCallback(
    (event: { userId: string; presence: "ONLINE" | "OFFLINE" }) => {
      setPresence(event.userId, event.presence);
      setConversationPresence(event.userId, event.presence);
    },
    [setConversationPresence, setPresence],
  );
  const eventInput = useMemo(
    () => ({ onMessage, onRead, onAccessRevoked, onPresence }),
    [onAccessRevoked, onMessage, onPresence, onRead],
  );
  useChatEvents(eventInput);

  const connectionLabel =
    connectionState === "CONNECTED"
      ? copy.connected
      : connectionState === "CONNECTING"
        ? copy.connecting
        : connectionState === "RECONNECTING"
          ? copy.reconnecting
          : copy.offline;
  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return conversations.items;
    return conversations.items.filter((item) =>
      [item.otherParticipant.name, item.lastMessage?.content ?? ""].some(
        (value) => value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [conversations.items, query]);
  const selectConversation = useCallback(
    (conversationId: string) => {
      setShowDetails(false);
      if (conversationId === selectedId) {
        setPage(null);
        void refreshHistory();
        return;
      }
      setSelectedId(conversationId);
    },
    [refreshHistory, selectedId, setPage],
  );

  return (
    <main
      className="messaging-workspace"
      data-thread-open={Boolean(selectedId)}
    >
      <WorkspacePageHeader
        eyebrow={copy.workspaceKicker}
        title={copy.pageTitle}
        subtitle={copy.pageDescription}
        statusBadge={{
          label: connectionLabel,
          state: connectionState.toLocaleLowerCase() as
            | "connected"
            | "connecting"
            | "reconnecting"
            | "offline",
        }}
      />
      {conversations.error ? (
        <p className="messaging-page-alert" role="alert">
          {conversations.error}
        </p>
      ) : null}
      <div className="messaging-grid">
        <aside
          className="messaging-sidebar"
          aria-label={
            locale === "vi" ? "Điều hướng tin nhắn" : "Messaging navigation"
          }
        >
          <StartConversation
            csrfProof={csrfProof}
            initialItems={initialEligibleParticipants}
            query={query}
            onQueryChange={setQuery}
            locale={locale}
            onOpened={(conversationId) => {
              setSelectedId(conversationId);
              setShowDetails(false);
              void refreshConversations();
            }}
          />
        </aside>
        <MessageThread
          currentUserId={currentUserId}
          csrfProof={csrfProof}
          locale={locale}
          page={history.page}
          error={history.error}
          onLoadOlder={() => void loadOlder()}
          onBack={() => setSelectedId(null)}
          onViewProfile={() => setShowDetails(true)}
          onBlockedChanged={() => {
            void refreshHistory();
            void refreshConversations();
          }}
          hasConversations={conversations.items.length > 0}
        />
        <ConversationDetails
          page={history.page}
          locale={locale}
          showDetails={showDetails}
          items={filteredConversations}
          selectedId={selectedId}
          onSelect={selectConversation}
          onBack={() => setShowDetails(false)}
        />
      </div>
    </main>
  );
}
