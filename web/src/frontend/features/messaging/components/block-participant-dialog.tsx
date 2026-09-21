"use client";

import { useId, useRef, useState } from "react";
import { useModalA11y } from "@/frontend/components/ui/use-modal-a11y";
import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { messagingCopy } from "../messaging-copy";

export function BlockParticipantDialog({
  csrfProof,
  targetUserId,
  targetName,
  blocked,
  onChanged,
  onReport,
  locale = "en",
}: {
  csrfProof: string;
  targetUserId: string;
  targetName: string;
  blocked: boolean;
  onChanged: (blocked: boolean) => void;
  onReport?: () => void;
  locale?: WorkspaceLocale;
}) {
  const copy = messagingCopy(locale);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const action = blocked ? copy.unblock : copy.block;
  function close() {
    setOpen(false);
  }
  const dialogRef = useModalA11y({
    open,
    busy,
    onClose: close,
    initialFocusRef: cancelButton,
    returnFocusRef: trigger,
  });
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/messaging/blocks/${encodeURIComponent(targetUserId)}`,
        {
          method: blocked ? "DELETE" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "x-csrf-proof": csrfProof,
            ...(blocked ? {} : { "idempotency-key": crypto.randomUUID() }),
          },
        },
      );
      if (!response.ok) throw new Error("BLOCK_CHANGE_FAILED");
      const projection = (await response.json()) as { blocked: boolean };
      onChanged(projection.blocked);
      close();
    } catch {
      setError(copy.safetyError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="messaging-safety-control">
      <button
        ref={trigger}
        className="messaging-icon-button"
        type="button"
        aria-label={`${action} ${targetName}`}
        title={`${action} ${targetName}`}
        onClick={() => setOpen(true)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="m6 6 12 12" />
        </svg>
        <span className="sr-only">
          {action} {targetName}
        </span>
      </button>
      {open ? (
        <div className="messaging-modal-layer">
          <section
            ref={dialogRef}
            className="messaging-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <div
              className="messaging-modal-icon"
              data-tone={blocked ? "info" : "danger"}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="m6 6 12 12" />
              </svg>
            </div>
            <h3 id={titleId}>
              {blocked ? copy.continueMessaging : copy.stopContact}
            </h3>
            <p id={descriptionId}>{copy.blockDescription}</p>
            {error ? (
              <p className="messaging-inline-alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="messaging-modal-actions">
              <button
                className={
                  blocked
                    ? "messaging-primary-button"
                    : "messaging-danger-button"
                }
                type="button"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy
                  ? copy.saving
                  : `${copy.confirm} ${action.toLocaleLowerCase()}`}
              </button>
              <button
                ref={cancelButton}
                className="messaging-secondary-button"
                type="button"
                disabled={busy}
                onClick={close}
              >
                {copy.cancel}
              </button>
              {onReport ? (
                <button
                  className="messaging-text-button"
                  type="button"
                  onClick={onReport}
                >
                  {copy.reportConversation}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
