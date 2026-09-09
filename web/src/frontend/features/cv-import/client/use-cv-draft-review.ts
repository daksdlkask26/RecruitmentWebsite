"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  CvDraftComparison,
  CvEditableProposals,
  CvReviewDecisions,
} from "@/shared/contracts/cv-import/review";
import type { z } from "zod";
import {
  cvConflictLatestSchema,
  type CvApiError,
} from "@/shared/contracts/cv-import/common";
import { cvConfirmationReceiptSchema } from "@/shared/contracts/cv-import/review";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";
import { cvFieldLabel, cvKnownError } from "../i18n/cv-import-copy";

type Receipt = z.infer<typeof cvConfirmationReceiptSchema>;
type ConflictLatest = z.infer<typeof cvConflictLatestSchema>;
export type CvReviewFieldError = CvApiError["error"]["fieldErrors"][number];

type SafeApiError = Readonly<{
  error?: Readonly<{
    code?: string;
    message?: string;
    requestId?: string;
    fieldErrors?: CvReviewFieldError[];
    latest?: ConflictLatest | null;
  }>;
}>;

export function presentCvReviewFieldError(
  fieldError: CvReviewFieldError,
  locale: "vi" | "en" = "en",
): CvReviewFieldError {
  const genericMessage = [
    "Enter a valid value.",
    "This field is required.",
    "This value is invalid.",
  ].includes(fieldError.message);
  if (!genericMessage) return fieldError;
  const label = cvFieldLabel(locale, fieldError.path);
  const message =
    {
      CURRENT_HAS_END:
        locale === "vi"
          ? `${label} phải để trống khi đây là mục hiện tại.`
          : `${label} must be empty for a current entry.`,
      DATE:
        locale === "vi"
          ? `${label} phải là ngày hợp lệ.`
          : `${label} must be a valid date.`,
      DATE_RANGE:
        locale === "vi"
          ? `${label} phải sau ngày bắt đầu và không thể ở tương lai.`
          : `${label} must be after the start date and cannot be in the future.`,
      DUPLICATE:
        locale === "vi"
          ? `${label} trùng với một giá trị đề xuất khác.`
          : `${label} duplicates another proposed value.`,
      FORMAT:
        locale === "vi"
          ? `${label} có định dạng không hợp lệ.`
          : `${label} has an invalid format.`,
      FUTURE:
        locale === "vi"
          ? `${label} không thể ở tương lai.`
          : `${label} cannot be in the future.`,
      INCOMPLETE:
        locale === "vi"
          ? `${label} phải bao gồm URL hồ sơ đầy đủ.`
          : `${label} must include a complete profile URL.`,
      LENGTH:
        locale === "vi"
          ? `${label} có độ dài không hợp lệ.`
          : `${label} has an invalid length.`,
      REQUIRED: fieldError.path.endsWith("endDate")
        ? locale === "vi"
          ? `${label} là bắt buộc trừ khi mục này đang hiện tại.`
          : `${label} is required unless the entry is current.`
        : locale === "vi"
          ? `${label} là bắt buộc.`
          : `${label} is required.`,
      URL:
        locale === "vi"
          ? `${label} phải là URL http hoặc https hợp lệ.`
          : `${label} must be a valid http or https URL.`,
    }[fieldError.code] ?? fieldError.message;
  return { ...fieldError, message };
}

function saveErrorSummary(
  message: string,
  fieldErrors: readonly CvReviewFieldError[],
  locale: "vi" | "en",
) {
  if (!fieldErrors.length) return message;
  const first = fieldErrors[0]?.message ?? message;
  return fieldErrors.length === 1
    ? first
    : locale === "vi"
      ? `${first} Hãy kiểm tra ${fieldErrors.length} trường được đánh dấu.`
      : `${first} Check ${fieldErrors.length} highlighted fields.`;
}

function requestReference(requestId: string | undefined, locale: "vi" | "en") {
  if (!requestId) return "";
  return locale === "vi"
    ? ` Mã tham chiếu: ${requestId}.`
    : ` Reference ID: ${requestId}.`;
}

export type CvReviewConflict = Readonly<{
  code: "DRAFT_REVISION_CONFLICT" | "PROFILE_REVISION_CONFLICT";
  message: string;
  latest: ConflictLatest | null;
}>;

function newRequestKey() {
  return `cv-confirm-${crypto.randomUUID()}`;
}

async function safeError(response: Response): Promise<SafeApiError> {
  try {
    return (await response.json()) as SafeApiError;
  } catch {
    return {};
  }
}

export function useCvDraftReview(input: {
  initial: CvDraftComparison;
  csrfProof: string;
}) {
  const router = useRouter();
  const locale = useWorkspaceLocale();
  const [authoritative, setAuthoritative] = useState(input.initial);
  const [proposals, setProposals] = useState<CvEditableProposals>(
    input.initial.proposals,
  );
  const [decisions, setDecisions] = useState<CvReviewDecisions>(
    input.initial.reviewDecisions,
  );
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<"save" | "confirm" | "reload" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CvReviewFieldError[]>([]);
  const [conflict, setConflict] = useState<CvReviewConflict | null>(null);
  const [latestComparison, setLatestComparison] =
    useState<CvDraftComparison | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const confirmationKey = useRef(newRequestKey());
  const activeOperation = useRef<"save" | "confirm" | "reload" | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mutateProposals = useCallback(
    (
      next:
        | CvEditableProposals
        | ((value: CvEditableProposals) => CvEditableProposals),
    ) => {
      setProposals(next);
      setDirty(true);
      setMessage(null);
      setError(null);
    },
    [],
  );

  const mutateDecisions = useCallback(
    (
      next:
        | CvReviewDecisions
        | ((value: CvReviewDecisions) => CvReviewDecisions),
    ) => {
      setDecisions(next);
      setDirty(true);
      setMessage(null);
      setError(null);
    },
    [],
  );

  const applyAuthoritative = useCallback((next: CvDraftComparison) => {
    setAuthoritative(next);
    setProposals(next.proposals);
    setDecisions(next.reviewDecisions);
    setDirty(false);
    setConflict(null);
    setLatestComparison(null);
    setError(null);
    setFieldErrors([]);
  }, []);

  const loadLatest = useCallback(async () => {
    const response = await fetch(
      `/api/account/cv-drafts/${authoritative.draftId}`,
      { cache: "no-store", credentials: "same-origin" },
    );
    if (!response.ok)
      throw new Error(
        locale === "vi"
          ? "Không thể tải bản xem xét mới nhất."
          : "The latest review could not be loaded.",
      );
    return (await response.json()) as CvDraftComparison;
  }, [authoritative.draftId, locale]);

  const clearFieldErrors = useCallback((paths: readonly string[]) => {
    if (!paths.length) return;
    const selected = new Set(paths);
    setFieldErrors((current) =>
      current.filter((fieldError) => !selected.has(fieldError.path)),
    );
  }, []);

  const save = useCallback(async () => {
    if (activeOperation.current || conflict) return false;
    activeOperation.current = "save";
    setPending("save");
    setError(null);
    setMessage(null);
    setFieldErrors([]);
    try {
      const response = await fetch(
        `/api/account/cv-drafts/${authoritative.draftId}`,
        {
          method: "PATCH",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": input.csrfProof,
          },
          body: JSON.stringify({
            baseDraftRevision: authoritative.draftRevision,
            reviewedProfileRevision: authoritative.currentProfile.revision,
            proposals,
            reviewDecisions: decisions,
          }),
        },
      );
      if (!response.ok) {
        const failure = await safeError(response);
        const code = failure.error?.code;
        if (
          code === "DRAFT_REVISION_CONFLICT" ||
          code === "PROFILE_REVISION_CONFLICT"
        ) {
          setConflict({
            code,
            message:
              failure.error?.message ??
              (locale === "vi"
                ? "Bản xem xét đã thay đổi trong một phiên khác."
                : "The review changed in another session."),
            latest: failure.error?.latest ?? null,
          });
          setLatestComparison(null);
          return false;
        }
        const nextFieldErrors = (failure.error?.fieldErrors ?? []).map(
          (fieldError) => presentCvReviewFieldError(fieldError, locale),
        );
        const summary = saveErrorSummary(
          failure.error?.message
            ? cvKnownError(locale, failure.error.message, code)
            : locale === "vi"
              ? "Không thể lưu bản xem xét."
              : "The review could not be saved.",
          nextFieldErrors,
          locale,
        );
        setFieldErrors(nextFieldErrors);
        setError(summary);
        return false;
      }
      const next = await loadLatest();
      applyAuthoritative(next);
      confirmationKey.current = newRequestKey();
      setMessage(locale === "vi" ? "Đã lưu bản xem xét." : "Review saved.");
      return true;
    } catch (caught) {
      const summary =
        caught instanceof Error
          ? caught.message
          : locale === "vi"
            ? "Không thể lưu bản xem xét."
            : "The review could not be saved.";
      setError(summary);
      setFieldErrors([]);
      return false;
    } finally {
      activeOperation.current = null;
      setPending(null);
    }
  }, [
    applyAuthoritative,
    authoritative.currentProfile.revision,
    authoritative.draftId,
    authoritative.draftRevision,
    conflict,
    decisions,
    input.csrfProof,
    loadLatest,
    locale,
    proposals,
  ]);

  const confirm = useCallback(async () => {
    if (
      activeOperation.current ||
      conflict ||
      dirty ||
      !decisions.reviewComplete
    )
      return null;
    activeOperation.current = "confirm";
    setPending("confirm");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/account/cv-drafts/${authoritative.draftId}/confirm`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": confirmationKey.current,
            "x-csrf-token": input.csrfProof,
          },
          body: JSON.stringify({
            draftRevision: authoritative.draftRevision,
            sourceProfileRevision: authoritative.sourceProfileRevision,
            reviewedProfileRevision: authoritative.reviewedProfileRevision,
          }),
        },
      );
      if (!response.ok) {
        const failure = await safeError(response);
        const code = failure.error?.code;
        if (
          code === "DRAFT_REVISION_CONFLICT" ||
          code === "PROFILE_REVISION_CONFLICT"
        ) {
          setConflict({
            code,
            message:
              failure.error?.message ??
              (locale === "vi"
                ? "Bản xem xét đã thay đổi trước khi xác nhận."
                : "The review changed before confirmation."),
            latest: failure.error?.latest ?? null,
          });
          setLatestComparison(null);
          return null;
        }
        setFieldErrors(
          (failure.error?.fieldErrors ?? []).map((fieldError) =>
            presentCvReviewFieldError(fieldError, locale),
          ),
        );
        throw new Error(
          (failure.error?.message
            ? cvKnownError(locale, failure.error.message, code)
            : locale === "vi"
              ? "Không thể cập nhật hồ sơ."
              : "The profile could not be updated.") +
            requestReference(failure.error?.requestId, locale),
        );
      }
      const next = cvConfirmationReceiptSchema.parse(await response.json());
      setReceipt(next);
      router.replace(`/profile/cv-imports/${next.uploadId}/receipt`);
      setMessage(
        locale === "vi"
          ? "Đã xác nhận và áp dụng thay đổi CV vào hồ sơ của bạn."
          : "CV changes were confirmed and applied to your profile.",
      );
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? cvKnownError(locale, caught.message)
          : locale === "vi"
            ? "Không thể cập nhật hồ sơ."
            : "The profile could not be updated.",
      );
      return null;
    } finally {
      activeOperation.current = null;
      setPending(null);
    }
  }, [
    authoritative,
    conflict,
    decisions.reviewComplete,
    dirty,
    input.csrfProof,
    locale,
    router,
  ]);

  const compareLatest = useCallback(async () => {
    if (activeOperation.current) return null;
    activeOperation.current = "reload";
    setPending("reload");
    setError(null);
    try {
      const next = await loadLatest();
      setLatestComparison(next);
      setConflict((current) =>
        current
          ? {
              ...current,
              latest: {
                draftRevision: next.draftRevision,
                profileRevision: next.currentProfile.revision,
                draftUpdatedAt: current.latest?.draftUpdatedAt ?? null,
                profileUpdatedAt: current.latest?.profileUpdatedAt ?? null,
              },
            }
          : null,
      );
      setMessage(
        locale === "vi"
          ? "Đã tải bản xem xét mới nhất để so sánh; các chỉnh sửa của bạn vẫn còn trong bộ nhớ."
          : "Latest saved review loaded for comparison; your edits remain in memory.",
      );
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? cvKnownError(locale, caught.message)
          : locale === "vi"
            ? "Tải lại không thành công."
            : "Reload failed.",
      );
      return null;
    } finally {
      activeOperation.current = null;
      setPending(null);
    }
  }, [loadLatest, locale]);

  const reapplyLatest = useCallback(() => {
    if (activeOperation.current || !conflict || !latestComparison) return false;
    setAuthoritative(latestComparison);
    setLatestComparison(null);
    setConflict(null);
    setDirty(true);
    setError(null);
    setMessage(
      locale === "vi"
        ? "Các chỉnh sửa trong bộ nhớ đã sẵn sàng để lưu vào bản xem xét mới nhất."
        : "Your in-memory edits are ready to save against the latest review.",
    );
    confirmationKey.current = newRequestKey();
    return true;
  }, [conflict, latestComparison, locale]);

  const discardAndReload = useCallback(async () => {
    if (activeOperation.current) return false;
    activeOperation.current = "reload";
    setPending("reload");
    try {
      const next = await loadLatest();
      applyAuthoritative(next);
      setMessage(
        locale === "vi"
          ? "Đã tải bản xem xét mới nhất."
          : "Latest saved review loaded.",
      );
      confirmationKey.current = newRequestKey();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? cvKnownError(locale, caught.message)
          : locale === "vi"
            ? "Tải lại không thành công."
            : "Reload failed.",
      );
      return false;
    } finally {
      activeOperation.current = null;
      setPending(null);
    }
  }, [applyAuthoritative, loadLatest, locale]);

  return useMemo(
    () => ({
      authoritative,
      proposals,
      decisions,
      dirty,
      pending,
      message,
      error,
      fieldErrors,
      conflict,
      latestComparison,
      receipt,
      setProposals: mutateProposals,
      setDecisions: mutateDecisions,
      clearFieldErrors,
      save,
      confirm,
      compareLatest,
      reapplyLatest,
      discardAndReload,
    }),
    [
      authoritative,
      clearFieldErrors,
      compareLatest,
      confirm,
      conflict,
      decisions,
      dirty,
      discardAndReload,
      error,
      fieldErrors,
      latestComparison,
      message,
      mutateDecisions,
      mutateProposals,
      pending,
      proposals,
      receipt,
      reapplyLatest,
      save,
    ],
  );
}
