import Link from "next/link";
import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import type { MessageHistoryPage } from "../client/use-message-history";
import {
  getConversationContextLabel,
  getJobContextLabel,
} from "../messaging-context";
import { messagingCopy } from "../messaging-copy";
import { MessageComposer } from "./message-composer";
import { BlockParticipantDialog } from "./block-participant-dialog";
import { ReportMessagingDialog } from "./report-messaging-dialog";
import { ConversationHeader } from "./conversation-header";
import { useNotificationContextRead } from "@/frontend/features/notifications/client/use-notification-context-read";

export function MessageThread({
  currentUserId,
  page,
  error,
  onLoadOlder,
  onBack,
  onViewProfile = () => undefined,
  csrfProof,
  onBlockedChanged,
  hasConversations = true,
  locale = "en",
}: {
  currentUserId?: string;
  page: MessageHistoryPage | null;
  error: string | null;
  onLoadOlder: () => void;
  onBack: () => void;
  onViewProfile?: () => void;
  csrfProof: string;
  onBlockedChanged: (blocked: boolean) => void;
  hasConversations?: boolean;
  locale?: WorkspaceLocale;
}) {
  const copy = messagingCopy(locale);

  useNotificationContextRead({
    enabled: Boolean(page) && !error,
    contextType: "CONVERSATION",
    contextId: page?.conversation.id,
    csrfProof,
  });
  if (error) {
    return (
      <section
        className="messaging-thread-state messaging-thread-error"
        role="alert"
      >
        <span aria-hidden="true">!</span>
        <h2>{copy.loadConversationError}</h2>
        <p>{error}</p>
      </section>
    );
  }
  if (!page) {
    return (
      <section className="messaging-thread-state" role="status">
        <span className="messaging-thread-state-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            <path d="M8 9h8M8 13h5" />
          </svg>
        </span>
        <h2>{hasConversations ? copy.inboxTitle : copy.noConversations}</h2>
        <p>
          {hasConversations
            ? copy.selectConversation
            : copy.noConversationsDescription}
        </p>
        {hasConversations ? (
          <small>{copy.privacyNotice}</small>
        ) : (
          <div className="messaging-empty-actions">
            <Link className="messaging-primary-button" href="/jobs">
              {copy.applyForJobs}
            </Link>
            <Link className="messaging-secondary-button" href="/connections">
              {copy.viewConnections}
            </Link>
          </div>
        )}
      </section>
    );
  }

  const jobContextLabel = getJobContextLabel(page.conversation.context);
  const formatter = new Intl.DateTimeFormat(
    locale === "vi" ? "vi-VN" : "en-US",
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  );
  return (
    <section
      className="messaging-thread"
      aria-label={`${copy.threadWith} ${page.conversation.otherParticipant.name}`}
    >
      <header className="messaging-thread-header">
        <button
          type="button"
          className="messaging-mobile-back messaging-icon-button"
          aria-label={copy.backToConversations}
          onClick={onBack}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span className="sr-only">{copy.backToConversations}</span>
        </button>
        {/*
         * TODO: cần API trả về jobSlug — context.reference là application ID,
         * nên chưa thể tạo liên kết chi tiết việc làm một cách an toàn.
         */}
        <ConversationHeader
          name={page.conversation.otherParticipant.name}
          image={page.conversation.otherParticipant.image}
          onViewProfile={onViewProfile}
          contextLabel={
            jobContextLabel
              ? copy.jobConversation
              : getConversationContextLabel(page.conversation.context, locale)
          }
          jobContextLabel={jobContextLabel}
          presence={page.conversation.presence}
          locale={locale}
        />
        <div className="messaging-thread-actions">
          <BlockParticipantDialog
            csrfProof={csrfProof}
            targetUserId={page.conversation.otherParticipant.id}
            targetName={page.conversation.otherParticipant.name}
            blocked={page.conversation.blocked}
            locale={locale}
            onChanged={onBlockedChanged}
          />
          <ReportMessagingDialog
            csrfProof={csrfProof}
            conversationId={page.conversation.id}
            targetUserId={page.conversation.otherParticipant.id}
            messages={page.items}
            locale={locale}
          />
        </div>
      </header>
      {page.conversation.accessMode === "READ_ONLY" ? (
        <p className="messaging-blocked-banner" role="status">
          {copy.connectionEnded}
        </p>
      ) : page.conversation.blocked ? (
        <p className="messaging-blocked-banner" role="status">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="m6 6 12 12" />
          </svg>
          {copy.blockedConversation}
        </p>
      ) : null}
      <div className="messaging-history" tabIndex={0}>
        {page.nextCursor ? (
          <button
            className="messaging-load-older"
            type="button"
            onClick={onLoadOlder}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m8 12 4-4 4 4M12 8v9" />
            </svg>
            {copy.loadOlder}
          </button>
        ) : (
          <p className="messaging-history-start">{copy.conversationStarted}</p>
        )}
        <ol aria-label={copy.pageTitle}>
          {page.items.map((message) => {
            const outgoing = message.senderId === currentUserId;
            return (
              <li
                key={message.id}
                data-direction={outgoing ? "outgoing" : "incoming"}
              >
                <div className="messaging-message-bubble">
                  <span className="messaging-message-avatar" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="8" r="3.25" />
                      <path d="M5.5 20c.65-3.4 3.15-5.25 6.5-5.25S17.85 16.6 18.5 20" />
                    </svg>
                  </span>
                  <p>{message.content}</p>
                  <span className="messaging-message-meta">
                    <time dateTime={message.createdAt}>
                      {formatter.format(new Date(message.createdAt))}
                    </time>
                    {!currentUserId || outgoing ? (
                      <span className="messaging-delivery-state">
                        {message.delivery === "READ" ? (
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="m2 13 4 4L14 9M10 17l2 2 10-10" />
                          </svg>
                        ) : (
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        )}
                        {message.delivery === "READ"
                          ? copy.deliveryRead
                          : copy.deliverySent}
                      </span>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <MessageComposer
        conversationId={page.conversation.id}
        locale={locale}
        disabled={
          page.conversation.blocked ||
          page.conversation.accessMode === "READ_ONLY"
        }
      />
    </section>
  );
}
