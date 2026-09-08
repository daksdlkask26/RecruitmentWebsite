"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CvImportResource } from "@/shared/contracts/cv-import/upload";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";
import { cvCopy, cvKnownError } from "../i18n/cv-import-copy";
import styles from "./cv-failure-recovery.module.css";

export type CvFailureRecoveryResource = Readonly<{
  uploadId: string;
  status: CvImportResource["status"];
  availableActions: CvImportResource["availableActions"];
  scanRetriesRemaining: number;
  extractionRetriesRemaining?: number;
  parseRetriesRemaining: number;
  failure: CvImportResource["failure"];
}>;

export class CvRecoveryActionError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "CvRecoveryActionError";
  }
}

type ActiveAction = "retry" | "delete";

function retryDetails(
  resource: CvFailureRecoveryResource,
  locale: "vi" | "en",
) {
  if (resource.status === "SCAN_FAILED")
    return {
      count: resource.scanRetriesRemaining,
      label: locale === "vi" ? "quét" : "scan",
    } as const;
  if (resource.status === "EXTRACTION_FAILED")
    return {
      count: resource.extractionRetriesRemaining ?? 0,
      label: locale === "vi" ? "trích xuất" : "extraction",
    } as const;
  if (resource.status === "PARSE_FAILED")
    return {
      count: resource.parseRetriesRemaining,
      label: locale === "vi" ? "phân tích" : "parsing",
    } as const;
  return null;
}

function retryCountMessage(
  details: ReturnType<typeof retryDetails>,
  locale: "vi" | "en",
) {
  if (!details) return null;
  if (details.count === 0)
    return locale === "vi"
      ? `Không còn lượt thử lại cho ${details.label}.`
      : `No ${details.label} retries remaining.`;
  return locale === "vi"
    ? `Còn ${details.count} lượt thử lại cho ${details.label}.`
    : `${details.count} ${details.label} ${details.count === 1 ? "retry" : "retries"} remaining.`;
}

export function CvFailureRecovery({
  resource,
  retryAfterSeconds,
  onRetry,
  onDelete,
}: {
  resource: CvFailureRecoveryResource;
  retryAfterSeconds: number | null;
  onRetry: () => Promise<void>;
  onDelete: () => Promise<boolean | void> | boolean | void;
}) {
  const locale = useWorkspaceLocale();
  const copy = cvCopy(locale).failure;
  const heading = useRef<HTMLHeadingElement>(null);
  const activeAction = useRef<ActiveAction | null>(null);
  const [busy, setBusy] = useState<ActiveAction | null>(null);
  const [countdown, setCountdown] = useState(() =>
    Math.max(0, retryAfterSeconds ?? 0),
  );
  const [countdownRun, setCountdownRun] = useState(() =>
    retryAfterSeconds ? 1 : 0,
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const details = retryDetails(resource, locale);
  const canRetry = Boolean(
    resource.failure?.retryable &&
    resource.failure.suggestedActions.includes("RETRY") &&
    resource.availableActions.includes("RETRY") &&
    details &&
    details.count > 0,
  );

  useEffect(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) heading.current?.focus();
  }, [resource.failure?.code]);

  useEffect(() => {
    if (countdownRun === 0) return;
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        const next = Math.max(0, current - 1);
        if (next === 0) window.clearInterval(timer);
        return next;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [countdownRun]);

  const retry = async () => {
    if (activeAction.current || !canRetry || countdown > 0) return;
    activeAction.current = "retry";
    setBusy("retry");
    setActionMessage(null);
    try {
      await onRetry();
      setActionMessage(copy.retryQueued);
    } catch (error) {
      if (error instanceof CvRecoveryActionError) {
        if (error.retryAfterSeconds) {
          setCountdown(Math.max(1, error.retryAfterSeconds));
          setCountdownRun((current) => current + 1);
        }
        setActionMessage(cvKnownError(locale, error.message));
      } else {
        setActionMessage(
          locale === "vi"
            ? "Không thể xếp hàng thử lại. Lần nhập thất bại vẫn được giữ nguyên."
            : "Retry could not be queued. Your failed import is unchanged.",
        );
      }
      heading.current?.focus();
    } finally {
      activeAction.current = null;
      setBusy(null);
    }
  };

  const remove = async () => {
    if (activeAction.current) return;
    activeAction.current = "delete";
    setBusy("delete");
    setActionMessage(null);
    try {
      const deleted = await onDelete();
      setActionMessage(
        deleted === false ? copy.deleteCancelled : copy.deleteRequested,
      );
    } catch (error) {
      setActionMessage(
        error instanceof CvRecoveryActionError
          ? cvKnownError(locale, error.message)
          : copy.deleteFailed,
      );
      heading.current?.focus();
    } finally {
      activeAction.current = null;
      setBusy(null);
    }
  };

  const statusMessage = busy
    ? busy === "retry"
      ? copy.retryRequesting
      : copy.deleteRequesting
    : (actionMessage ??
      (canRetry
        ? countdown > 0
          ? `${copy.retryIn} ${countdown} ${countdown === 1 ? copy.second : copy.seconds}.`
          : copy.retryAvailable
        : copy.chooseAction));

  return (
    <section
      className={styles.root}
      data-testid="cv-failure-recovery"
      data-narrow-layout="320"
      data-reduced-motion-safe="true"
      aria-labelledby="cv-failure-heading"
    >
      <div
        className={styles.summary}
        role="alert"
        aria-labelledby="cv-failure-heading"
      >
        <h2 id="cv-failure-heading" ref={heading} tabIndex={-1}>
          {copy.heading}
        </h2>
        <p>
          {resource.failure
            ? cvKnownError(
                locale,
                resource.failure.message,
                resource.failure.code,
              )
            : null}
        </p>
        {resource.failure?.code ? (
          <details className={styles.technicalDetails}>
            <summary>
              {locale === "vi" ? "Chi tiết kỹ thuật" : "Technical details"}
            </summary>
            <p className={styles.code}>
              {copy.safeCode}: <code>{resource.failure.code}</code>
            </p>
          </details>
        ) : null}
      </div>

      {details ? (
        <p className={styles.counter}>{retryCountMessage(details, locale)}</p>
      ) : null}
      <p
        className={styles.status}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>

      <div className={styles.actions} aria-label={copy.actions}>
        {canRetry ? (
          <button
            type="button"
            disabled={Boolean(busy) || countdown > 0}
            aria-busy={busy === "retry"}
            onClick={() => void retry()}
          >
            {locale === "vi" ? "Thử lại" : "Retry"} {details?.label}
          </button>
        ) : null}
        <Link href="/profile/cv-imports">{copy.replacement}</Link>
        {resource.availableActions.includes("MANUAL_PROFILE") ||
        resource.failure?.suggestedActions.includes("MANUAL_PROFILE") ? (
          <Link href="/profile">{copy.manual}</Link>
        ) : null}
        {resource.availableActions.includes("DELETE") ||
        resource.failure?.suggestedActions.includes("DELETE") ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            aria-busy={busy === "delete"}
            onClick={() => void remove()}
          >
            {copy.delete}
          </button>
        ) : null}
      </div>
      <p className={styles.guidance}>{copy.guidance}</p>
    </section>
  );
}
