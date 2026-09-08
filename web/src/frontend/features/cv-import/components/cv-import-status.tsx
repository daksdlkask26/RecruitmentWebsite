"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CvParserClass,
  CvProcessingMode,
  CvUploadStatus,
} from "@/shared/contracts/cv-import/common";
import {
  cvConsentOutcomeSchema,
  cvDeletionOutcomeSchema,
  type CvConsentGrantRequest,
  type CvConsentNotice,
  type CvDeletionOutcome,
} from "@/shared/contracts/cv-import/consent-retention";
import { cvRetryAcceptedSchema } from "@/shared/contracts/cv-import/retry";
import {
  cvImportStatusResponseSchema,
  cvImportTombstoneSchema,
  cvStatusPollingAfterMs,
  type CvImportResource,
} from "@/shared/contracts/cv-import/upload";
import { nextCvPollingDelay } from "../client/cv-import-polling-policy";
import {
  cvImportFailureCategoryLabel,
  cvImportStepLabel,
  mapCvImportPresentation,
} from "../client/cv-import-presentation";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";
import {
  cvCopy,
  cvKnownError,
  cvParserLabel,
  cvStatusLabel,
} from "../i18n/cv-import-copy";
import {
  CvFailureRecovery,
  CvRecoveryActionError,
} from "./cv-failure-recovery";
import { CvConsentRequiredRecovery } from "./cv-consent-required-recovery";
import { CvProcessingConsent } from "./cv-processing-consent";
import { CvRetentionActions } from "./cv-retention-actions";
import styles from "./cv-import-status.module.css";

type StatusResource = Readonly<{
  uploadId: string;
  parserClass?: CvParserClass;
  processingMode?: CvProcessingMode;
  status: CvUploadStatus;
  stage?: string;
  availableActions?: readonly string[];
  pollingAfterMs?: number | null;
  scanRetriesRemaining?: number;
  extractionRetriesRemaining?: number;
  parseRetriesRemaining?: number;
  failure?: CvImportResource["failure"];
  ocr?: CvImportResource["ocr"];
  draft?: CvImportResource["draft"];
  consent?: CvConsentNotice | null;
  expiresAt?: string | null;
  contentInaccessibleAt?: string | null;
  deleteAfter?: string | null;
  deletedAt?: string | null;
}>;

function newRetryKey() {
  return `cv-retry-${crypto.randomUUID()}`;
}

function retryAfterSeconds(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function aiPresentation(
  locale: "vi" | "en",
  resource: StatusResource,
): Readonly<{
  tone: "pending" | "processing" | "success" | "error" | "preparing";
  badge: string;
  title: string;
  message: string;
}> | null {
  const copy = cvCopy(locale).status;
  if (resource.parserClass !== "EXTERNAL_OPENAI") return null;
  if (resource.status === "AWAITING_CONSENT")
    return {
      tone: "pending",
      badge: copy.consentNeeded,
      title: copy.openaiWaiting,
      message:
        locale === "vi"
          ? "Chưa có văn bản CV nào được gửi đến OpenAI. Hãy xem xét thông báo đồng ý bên dưới để tiếp tục."
          : "No CV text has been sent to OpenAI. Review the consent notice below to continue.",
    };
  if (resource.status === "PARSE_QUEUED")
    return {
      tone: "pending",
      badge: copy.queued,
      title: copy.openaiQueued,
      message:
        locale === "vi"
          ? "Quyền đồng ý hợp lệ và worker đang chuẩn bị yêu cầu. Trang này sẽ tự động làm mới."
          : "Consent is valid and the worker is preparing the request. This page refreshes automatically.",
    };
  if (resource.status === "PARSING")
    return {
      tone: "processing",
      badge: copy.apiInProgress,
      title: copy.openaiExtracting,
      message: copy.openaiRunning,
    };
  if (resource.status === "REVIEW_READY" || resource.status === "CONFIRMED")
    return {
      tone: "success",
      badge: copy.success,
      title: copy.openaiCompleted,
      message: copy.draftReady,
    };
  if (resource.status === "PARSE_FAILED")
    return {
      tone: "error",
      badge: resource.failure?.code ?? copy.apiError,
      title: copy.openaiFailed,
      message: resource.failure
        ? cvKnownError(locale, resource.failure.message, resource.failure.code)
        : copy.providerFailed,
    };
  return {
    tone: "preparing",
    badge: copy.preparing,
    title: copy.preparingOpenai,
    message: copy.preparingMessage,
  };
}

export function CvImportStatus({
  resource,
  loadStatus,
  csrfProof,
}: {
  resource: StatusResource;
  loadStatus?: () => Promise<StatusResource>;
  csrfProof?: string;
}) {
  const locale = useWorkspaceLocale();
  const copy = cvCopy(locale);
  const [current, setCurrent] = useState(resource);
  const [pollError, setPollError] = useState<string | null>(null);
  const retryKey = useRef<string | null>(null);
  const mounted = useRef(true);
  const pollInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    if (loadStatus) {
      const next = await loadStatus();
      if (mounted.current) {
        setCurrent(next);
        setPollError(null);
      }
      return next;
    }
    const response = await fetch(
      `/api/account/cv-imports/${current.uploadId}`,
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    );
    if (!response.ok) throw new Error("CV_STATUS_REFRESH_FAILED");
    const parsed = cvImportStatusResponseSchema.parse(await response.json());
    const next: StatusResource = {
      ...parsed,
      pollingAfterMs: cvStatusPollingAfterMs(
        parsed.status,
        "processingMode" in parsed ? parsed.processingMode : undefined,
        parsed,
      ),
    };
    if (mounted.current) {
      setCurrent(next);
      setPollError(null);
    }
    return next;
  }, [current.uploadId, loadStatus]);

  useEffect(() => {
    if (!current.pollingAfterMs) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let previousDelayMs: number | null = current.pollingAfterMs;
    let previousSnapshot = {
      status: current.status,
      stage: current.stage,
    };
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = (delayMs: number) => {
      clearTimer();
      if (!active || document.hidden || !delayMs) return;
      timer = setTimeout(() => {
        timer = null;
        void poll();
      }, delayMs);
    };
    const poll = async () => {
      if (
        !active ||
        !mounted.current ||
        document.hidden ||
        pollInFlight.current
      )
        return;
      pollInFlight.current = true;
      try {
        const next = await refreshStatus();
        if (!active) return;
        const advanced =
          next.status !== previousSnapshot.status ||
          next.stage !== previousSnapshot.stage;
        const outcome = advanced ? "advanced" : "unchanged";
        const baseDelayMs =
          next.pollingAfterMs ?? current.pollingAfterMs ?? 2_000;
        const delayMs = next.pollingAfterMs
          ? nextCvPollingDelay({
              baseDelayMs,
              previousDelayMs: advanced ? null : previousDelayMs,
              outcome,
            })
          : null;
        previousSnapshot = { status: next.status, stage: next.stage };
        previousDelayMs = delayMs;
        if (delayMs) schedule(delayMs);
      } catch {
        if (!active) return;
        setPollError(
          locale === "vi"
            ? "Không thể làm mới trạng thái. SmartHire sẽ tiếp tục thử lại."
            : "Status could not be refreshed. SmartHire will keep trying.",
        );
        const delayMs = nextCvPollingDelay({
          baseDelayMs: current.pollingAfterMs ?? 2_000,
          previousDelayMs,
          outcome: "error",
        });
        previousDelayMs = delayMs;
        schedule(delayMs);
      } finally {
        pollInFlight.current = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
        return;
      }
      void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(current.pollingAfterMs);
    return () => {
      active = false;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [current.pollingAfterMs, current.stage, current.status, locale, refreshStatus]);

  const requestRetry = useCallback(async () => {
    if (!csrfProof)
      throw new CvRecoveryActionError(
        locale === "vi"
          ? "Không thể xếp hàng thử lại. Hãy tải lại trang và thử lại."
          : "Retry could not be queued. Refresh this page and try again.",
      );
    retryKey.current ??= newRetryKey();
    const response = await fetch(
      `/api/account/cv-imports/${current.uploadId}/retries`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": retryKey.current,
          "x-csrf-token": csrfProof,
        },
        body: "{}",
      },
    );
    if (!response.ok) {
      const wait = retryAfterSeconds(response);
      throw new CvRecoveryActionError(
        wait
          ? locale === "vi"
            ? "Tạm thời không thể thử lại. Bộ đếm cho biết khi nào có thể thử."
            : "Retry is temporarily unavailable. The countdown shows when to try again."
          : locale === "vi"
            ? "Không thể xếp hàng thử lại. Lần nhập thất bại vẫn được giữ nguyên."
            : "Retry could not be queued. Your failed import is unchanged.",
        wait,
      );
    }
    const outcome = cvRetryAcceptedSchema.parse(await response.json());
    if (outcome.uploadId !== current.uploadId)
      throw new CvRecoveryActionError(
        locale === "vi"
          ? "Không thể xác minh lần thử lại. Lần nhập thất bại vẫn được giữ nguyên."
          : "Retry could not be verified. Your failed import is unchanged.",
      );
    await refreshStatus();
    retryKey.current = null;
  }, [csrfProof, current.uploadId, locale, refreshStatus]);

  const deleteImport = useCallback(
    async (confirmed = false): Promise<CvDeletionOutcome | false> => {
      if (!csrfProof)
        throw new CvRecoveryActionError(
          locale === "vi"
            ? "Không thể xóa lần nhập. Hãy tải lại trang và thử lại."
            : "The import could not be deleted. Refresh this page and try again.",
        );
      if (
        !confirmed &&
        !window.confirm(
          locale === "vi"
            ? "Xóa lần nhập CV này? Quyền truy cập kết thúc ngay và quá trình dọn dẹp vật lý được bảo vệ sẽ tiếp tục ở chế độ nền."
            : "Delete this CV import? Access ends immediately, and protected physical cleanup continues in the background.",
        )
      )
        return false;
      const response = await fetch(
        `/api/account/cv-imports/${current.uploadId}`,
        {
          method: "DELETE",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "x-csrf-token": csrfProof },
        },
      );
      if (!response.ok)
        throw new CvRecoveryActionError(
          locale === "vi"
            ? "Không thể xóa lần nhập. Lần nhập vẫn có trong lịch sử của bạn."
            : "The import could not be deleted. It remains available in your history.",
        );
      const outcome = cvDeletionOutcomeSchema.parse(await response.json());
      const tombstone = cvImportTombstoneSchema.parse({
        uploadId: outcome.uploadId,
        status: outcome.status,
        contentInaccessibleAt: outcome.contentInaccessibleAt,
        deleteAfter: outcome.deleteAfter,
        deletedAt: outcome.deletedAt,
      });
      if (mounted.current) {
        setCurrent({
          ...tombstone,
          pollingAfterMs: cvStatusPollingAfterMs(
            tombstone.status,
            undefined,
            tombstone,
          ),
        });
        setPollError(null);
      }
      retryKey.current = null;
      return outcome;
    },
    [csrfProof, current.uploadId, locale],
  );

  const grantConsent = useCallback(
    async (request: CvConsentGrantRequest) => {
      if (!csrfProof) throw new Error("CV_CONSENT_UNAVAILABLE");
      const response = await fetch(
        `/api/account/cv-imports/${current.uploadId}/consent`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfProof,
          },
          body: JSON.stringify(request),
        },
      );
      if (response.status === 401) throw new Error("CV_SESSION_EXPIRED");
      if (!response.ok) throw new Error("CV_CONSENT_GRANT_FAILED");
      const outcome = cvConsentOutcomeSchema.parse(await response.json());
      if (outcome.uploadId !== current.uploadId)
        throw new Error("CV_CONSENT_GRANT_FAILED");
      await refreshStatus();
    },
    [csrfProof, current.uploadId, refreshStatus],
  );

  const revokeConsent = useCallback(async () => {
    if (!csrfProof) throw new Error("CV_CONSENT_UNAVAILABLE");
    const response = await fetch(
      `/api/account/cv-imports/${current.uploadId}/consent`,
      {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfProof },
      },
    );
    if (response.status === 401) throw new Error("CV_SESSION_EXPIRED");
    if (response.status !== 204) throw new Error("CV_CONSENT_REVOKE_FAILED");
    await refreshStatus();
  }, [csrfProof, current.uploadId, refreshStatus]);

  const label = cvStatusLabel(locale, current.status);
  const availableActions = current.availableActions ?? [];
  const presentation = mapCvImportPresentation({
    status: current.status,
    processingMode: current.processingMode,
    stage: current.stage,
    failureCode: current.failure?.code,
    availableActions,
  });
  const aiStatus = aiPresentation(locale, current);
  const hasFailureRecovery = Boolean(
    current.failure &&
    typeof current.scanRetriesRemaining === "number" &&
    typeof current.parseRetriesRemaining === "number" &&
    (current.status !== "EXTRACTION_FAILED" ||
      typeof current.extractionRetriesRemaining === "number"),
  );
  const consentRequiredRecoveryNotice =
    current.failure?.code === "CONSENT_REQUIRED" &&
    current.consent &&
    !current.consent.granted
      ? current.consent
      : null;
  return (
    <section className={styles.root} aria-labelledby="cv-status-heading">
      <h2 id="cv-status-heading">{copy.status.heading}</h2>
      <p
        className={styles.state}
        role={
          !aiStatus && !hasFailureRecovery && current.stage
            ? "status"
            : undefined
        }
        aria-live={
          !aiStatus && !hasFailureRecovery && current.stage
            ? "polite"
            : undefined
        }
      >
        <strong>{label}</strong>
        {current.stage
          ? ` — ${copy.status.stage} ${cvImportStepLabel(locale, presentation.currentStep)}.`
          : `. ${copy.status.contentUnavailable}`}
      </p>
      {current.stage ? (
        <details className={styles.technicalDetails}>
          <summary>
            {locale === "vi" ? "Chi tiết xử lý" : "Processing details"}
          </summary>
          <dl>
            <div>
              <dt>{locale === "vi" ? "Phương thức" : "Method"}</dt>
              <dd>
                {cvParserLabel(
                  locale,
                  current.parserClass ?? "DETERMINISTIC_INTERNAL",
                )}
              </dd>
            </div>
            <div>
              <dt>{locale === "vi" ? "Mã bản nhập" : "Import reference"}</dt>
              <dd>{current.uploadId}</dd>
            </div>
          </dl>
        </details>
      ) : null}
      {aiStatus ? (
        <div
          key={`${current.status}:${aiStatus.tone}`}
          className={styles.aiStatus}
          data-tone={aiStatus.tone}
          role={aiStatus.tone === "error" ? "alert" : "status"}
          aria-live={aiStatus.tone === "error" ? "assertive" : "polite"}
          data-testid="openai-status"
        >
          <span className={styles.aiIndicator} aria-hidden="true">
            <span />
          </span>
          <div className={styles.aiCopy}>
            <small>{copy.status.openaiExternal}</small>
            <strong>{aiStatus.title}</strong>
            <p>{aiStatus.message}</p>
          </div>
          <span className={styles.aiBadge}>{aiStatus.badge}</span>
        </div>
      ) : null}
      {current.stage ? (
        <ol
          className={styles.timeline}
          aria-label={copy.common.processingTimeline}
        >
          {presentation.steps.map((step, index) => {
            const state = step.state;
            return (
              <li
                key={step.key}
                data-state={state}
                aria-current={
                  state === "current" ||
                  state === "error" ||
                  state === "action-required"
                    ? "step"
                    : undefined
                }
              >
                <span className={styles.timelineMarker} aria-hidden="true">
                  {state === "complete" ? "✓" : index + 1}
                </span>
                <span>
                  {state === "current" ? copy.status.current : ""}
                  {state === "error" ? copy.status.failed : ""}
                  {state === "action-required" ? `${copy.common.current} ` : ""}
                  {cvImportStepLabel(locale, step.key)}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {presentation.failureCategory && current.stage ? (
        <p className={styles.failureCategory} data-testid="cv-failure-category">
          <strong>{copy.common.failed}:</strong>{" "}
          {cvImportFailureCategoryLabel(locale, presentation.failureCategory)}
        </p>
      ) : null}
      {pollError ? (
        <p className={styles.pollError} role="alert">
          {pollError}
        </p>
      ) : null}
      {consentRequiredRecoveryNotice ? (
        <CvConsentRequiredRecovery
          resource={{
            uploadId: current.uploadId,
            availableActions:
              availableActions as CvImportResource["availableActions"],
            failure: current.failure ?? null,
          }}
          notice={consentRequiredRecoveryNotice}
          canGrant={Boolean(
            csrfProof && availableActions.includes("GRANT_CONSENT"),
          )}
          onGrant={grantConsent}
          onDelete={async () => (await deleteImport()) !== false}
        />
      ) : hasFailureRecovery ? (
        <CvFailureRecovery
          key={`${current.status}:${current.failure?.code}:${current.scanRetriesRemaining}:${current.extractionRetriesRemaining}:${current.parseRetriesRemaining}`}
          resource={{
            uploadId: current.uploadId,
            status: current.status,
            availableActions:
              availableActions as CvImportResource["availableActions"],
            scanRetriesRemaining: current.scanRetriesRemaining ?? 0,
            extractionRetriesRemaining:
              current.extractionRetriesRemaining ?? 0,
            parseRetriesRemaining: current.parseRetriesRemaining ?? 0,
            failure: current.failure ?? null,
          }}
          retryAfterSeconds={null}
          onRetry={requestRetry}
          onDelete={async () => (await deleteImport()) !== false}
        />
      ) : (
        <div className={styles.actions}>
          {availableActions.includes("RETRY") ? (
            <button type="button">{copy.status.retry}</button>
          ) : null}
          {availableActions.includes("REVIEW") ? (
            <a href={`/profile/cv-imports/${current.uploadId}/review`}>
              {copy.status.reviewDraft}
            </a>
          ) : null}
          {availableActions.includes("MANUAL_PROFILE") ? (
            <a href="/profile">{copy.common.manualProfile}</a>
          ) : null}
        </div>
      )}
      {current.consent && !consentRequiredRecoveryNotice ? (
        <CvProcessingConsent
          notice={current.consent}
          canGrant={Boolean(
            csrfProof && availableActions.includes("GRANT_CONSENT"),
          )}
          canRevoke={Boolean(
            csrfProof && availableActions.includes("REVOKE_CONSENT"),
          )}
          onGrant={grantConsent}
          onRevoke={revokeConsent}
        />
      ) : null}
      {current.expiresAt ||
      current.deleteAfter ||
      current.contentInaccessibleAt ||
      !current.stage ? (
        <CvRetentionActions
          resource={{
            uploadId: current.uploadId,
            status: current.status,
            expiresAt: current.expiresAt ?? null,
            contentInaccessibleAt: current.contentInaccessibleAt ?? null,
            deleteAfter: current.deleteAfter ?? null,
            deletedAt: current.deletedAt ?? null,
          }}
          canDelete={Boolean(
            csrfProof &&
            availableActions.includes("DELETE") &&
            !hasFailureRecovery,
          )}
          onDelete={async () => deleteImport(true)}
        />
      ) : null}
    </section>
  );
}
