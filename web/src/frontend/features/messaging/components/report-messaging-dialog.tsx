"use client";

import { useId, useRef, useState } from "react";
import { useModalA11y } from "@/frontend/components/ui/use-modal-a11y";
import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import type { MessagingMessage } from "@/shared/contracts/messaging/messages";
import { messagingReportInputSchema } from "@/shared/contracts/messaging/safety";
import { messagingCopy } from "../messaging-copy";
import { submitMessagingReport } from "../client/messaging-api";

type ReportCategory =
  | "FRAUD_OR_IMPERSONATION"
  | "MISLEADING_CONTENT"
  | "DISCRIMINATION_OR_HARASSMENT"
  | "ABUSE_OR_THREATS"
  | "SPAM_OR_DUPLICATE"
  | "PRIVACY_OR_DATA_MISUSE"
  | "OTHER";

export function ReportMessagingDialog({
  csrfProof,
  conversationId,
  targetUserId,
  messages,
  locale = "en",
}: {
  csrfProof: string;
  conversationId: string;
  targetUserId: string;
  messages: MessagingMessage[];
  locale?: WorkspaceLocale;
}) {
  const copy = messagingCopy(locale);
  const categories = copy.reportCategories as unknown as ReadonlyArray<
    readonly [ReportCategory, string]
  >;
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("SPAM_OR_DUPLICATE");
  const [detail, setDetail] = useState("");
  const [evidenceMessageId, setEvidenceMessageId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function close() {
    setOpen(false);
  }
  const managedDialogRef = useModalA11y({
    open,
    busy,
    onClose: close,
    initialFocusRef: closeButton,
    returnFocusRef: trigger,
  });
  async function submit() {
    const parsed = messagingReportInputSchema.safeParse({
      conversationId,
      targetUserId,
      targetType: "CONVERSATION",
      evidenceMessageId: evidenceMessageId || null,
      category,
      detail,
    });
    if (!parsed.success) {
      setStatus(copy.reportValidation);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await submitMessagingReport(parsed.data, csrfProof);
      setStatus(copy.reportSuccess);
    } catch {
      setStatus(copy.reportError);
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
        aria-label={copy.report}
        title={copy.reportConversation}
        onClick={() => setOpen(true)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 21V4m0 1h12l-2 4 2 4H5" />
        </svg>
        <span className="sr-only">{copy.report}</span>
      </button>
      {open ? (
        <div className="messaging-modal-layer">
          <section
            ref={managedDialogRef}
            className="messaging-modal messaging-report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <div className="messaging-modal-heading">
              <div
                className="messaging-modal-icon"
                data-tone="warning"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M5 21V4m0 1h12l-2 4 2 4H5" />
                </svg>
              </div>
              <div>
                <h3 id={titleId}>{copy.reportInappropriate}</h3>
                <p id={descriptionId}>{copy.reportDescription}</p>
              </div>
            </div>
            <div className="messaging-report-fields">
              <label>
                <span>{copy.category}</span>
                <select
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as ReportCategory)
                  }
                >
                  {categories.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{copy.evidence}</span>
                <select
                  value={evidenceMessageId}
                  onChange={(event) => setEvidenceMessageId(event.target.value)}
                >
                  <option value="">{copy.noEvidence}</option>
                  {messages.map((message) => (
                    <option key={message.id} value={message.id}>
                      {message.content.slice(0, 80)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{copy.detail}</span>
                <textarea
                  aria-label={copy.detail}
                  maxLength={500}
                  placeholder={copy.detailPlaceholder}
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                />
                <small>{detail.length}/500</small>
              </label>
            </div>
            {status ? (
              <p className="messaging-report-status" role="status">
                {status}
              </p>
            ) : null}
            <div className="messaging-modal-actions messaging-modal-actions-inline">
              <button
                className="messaging-danger-button"
                type="button"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? copy.sending : copy.submitReport}
              </button>
              <button
                ref={closeButton}
                className="messaging-secondary-button"
                type="button"
                disabled={busy}
                onClick={close}
              >
                {copy.close}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
