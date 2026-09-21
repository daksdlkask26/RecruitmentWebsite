"use client";

import { useState } from "react";
import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { messageContentSchema } from "@/shared/contracts/messaging/messages";
import { messagingCopy } from "../messaging-copy";
import { useSendMessage } from "../client/use-send-message";

export function MessageComposer({
  conversationId,
  disabled = false,
  locale = "en",
}: {
  conversationId: string;
  disabled?: boolean;
  locale?: WorkspaceLocale;
}) {
  const copy = messagingCopy(locale);
  const [content, setContent] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const { send, outbox } = useSendMessage(conversationId);
  const latest = outbox.at(-1);

  async function submit() {
    const parsed = messageContentSchema.safeParse(content);
    if (!parsed.success) {
      setValidation(copy.validation);
      return;
    }
    setValidation(null);
    setContent("");
    await send(parsed.data);
  }

  return (
    <section className="messaging-composer" aria-label={copy.composeMessage}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="messaging-composer-field">
          <span className="sr-only">{copy.message}</span>
          <textarea
            aria-label={copy.message}
            placeholder={
              disabled ? copy.readOnlyConversation : copy.writeMessage
            }
            value={content}
            maxLength={2_000}
            disabled={disabled}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          <span className="messaging-character-count" aria-live="polite">
            {content.length}/2,000
          </span>
        </label>
        <button
          className="messaging-send-button"
          type="submit"
          disabled={disabled}
        >
          <span>{copy.send}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />
          </svg>
        </button>
      </form>
      <p className="messaging-composer-hint">{copy.sendHint}</p>
      {latest?.status === "SENT" ? (
        <p className="messaging-inline-status" role="status" aria-live="polite">
          {copy.deliverySent}
        </p>
      ) : null}
      {latest?.status === "FAILED" ? (
        <p className="messaging-inline-alert" role="alert">
          <span>{copy.sendFailed}</span>
          <button
            type="button"
            onClick={() => void send(latest.content, latest.clientOperationId)}
          >
            {copy.retry}
          </button>
        </p>
      ) : null}
      {validation ? (
        <p className="messaging-inline-alert" role="alert">
          {validation}
        </p>
      ) : null}
    </section>
  );
}
