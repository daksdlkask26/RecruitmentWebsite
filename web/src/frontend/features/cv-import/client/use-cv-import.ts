"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";
import {
  CV_UPLOAD_ATTEMPTS_PER_ROLLING_HOUR,
  cvApiErrorSchema,
  type CvImportStage,
  type CvParserClass,
  type CvProcessingMode,
  type CvUploadStatus,
} from "@/shared/contracts/cv-import/common";
import {
  cvContentAcceptedSchema,
  cvImportStatusResponseSchema,
  cvStatusPollingAfterMs,
  cvUploadReservationSchema,
  type CreateCvImportRequest,
} from "@/shared/contracts/cv-import/upload";
import { validateCvFile } from "@/shared/cv-file-validation";
import {
  cvKnownError,
  cvStageLabel,
  cvStatusLabel,
  cvCopy,
  type CvLocale,
} from "../i18n/cv-import-copy";

export type CvUploadProgress = Readonly<{
  state:
    | "IDLE"
    | "RESERVING"
    | "UPLOADING"
    | "PROCESSING"
    | "AWAITING_CONSENT"
    | "AI_PENDING"
    | "AI_PROCESSING"
    | "STATUS_ERROR"
    | "SUCCESS"
    | "COMPLETE"
    | "ERROR";
  percentage: number;
  title: string;
  message: string;
  uploadId: string | null;
  parserClass: CvParserClass | null;
}>;

function parserUnavailableMessage(
  locale: CvLocale,
  parserClass: CvParserClass,
): string {
  if (parserClass === "EXTERNAL_OPENAI") {
    return locale === "vi"
      ? "OpenAI hiện không khả dụng. Hãy kiểm tra OPENAI_API_KEY và cấu hình parser phía server, sau đó khởi động lại web server và CV worker."
      : "OpenAI parsing is unavailable. Check OPENAI_API_KEY and the server parser configuration, then restart the web server and CV worker.";
  }
  return locale === "vi"
    ? "Bộ phân tích SmartHire hiện không khả dụng trong môi trường này."
    : "SmartHire deterministic parsing is not available in this environment.";
}

function uploadRateLimitedMessage(
  locale: CvLocale,
  response: Response,
): string {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (!Number.isSafeInteger(retryAfter) || retryAfter < 1) {
    return cvKnownError(
      locale,
      "The upload attempt limit has been reached.",
      "UPLOAD_RATE_LIMITED",
    );
  }
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  if (locale === "vi") {
    return `Bạn đã đạt giới hạn ${CV_UPLOAD_ATTEMPTS_PER_ROLLING_HOUR} lượt tải CV trong một giờ. Hãy thử lại sau khoảng ${minutes} phút.`;
  }
  return `The upload attempt limit has been reached. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

async function admissionErrorMessage(
  response: Response,
  parserClass: CvParserClass,
  locale: CvLocale,
): Promise<string> {
  const payload = await response.json().catch(() => null);
  const parsed = cvApiErrorSchema.safeParse(payload);
  if (!parsed.success) return parserUnavailableMessage(locale, parserClass);

  const error = parsed.data.error;
  if (error.code === "UPLOAD_RATE_LIMITED") {
    return uploadRateLimitedMessage(locale, response);
  }
  if (
    parserClass === "EXTERNAL_OPENAI" &&
    error.code === "CV_PROCESSING_UNAVAILABLE"
  ) {
    return parserUnavailableMessage(locale, parserClass);
  }
  return cvKnownError(locale, error.message, error.code);
}

function requestKey() {
  return `cv-${crypto.randomUUID()}`;
}

type CvStatusResource = Readonly<{
  status: CvUploadStatus;
  stage?: CvImportStage;
  parserClass?: CvParserClass;
  processingMode?: CvProcessingMode;
  deleteAfter?: string | null;
  deletedAt?: string | null;
  failure?: Readonly<{
    code?: string;
    message: string;
    suggestedActions: readonly string[];
  }> | null;
}>;

const failureStatuses = new Set<CvUploadStatus>([
  "VALIDATION_FAILED",
  "INFECTED",
  "SCAN_FAILED",
  "EXTRACTION_FAILED",
  "PARSE_FAILED",
]);

function progressPercentage(resource: CvStatusResource): number {
  if (failureStatuses.has(resource.status)) return 100;
  if (
    ["REVIEW_READY", "CONFIRMED", "DELETED", "EXPIRED"].includes(
      resource.status,
    )
  )
    return 100;
  return (
    {
      UPLOAD: 10,
      VALIDATE: 20,
      SCAN: 35,
      EXTRACT: 55,
      OCR: 65,
      CONSENT: 65,
      PARSE: resource.status === "PARSING" ? 90 : 78,
      REVIEW: 100,
      COMPLETE: 100,
      TERMINAL: 100,
    }[resource.stage ?? "UPLOAD"] ?? 15
  );
}

function activeProgress(
  locale: CvLocale,
  resource: CvStatusResource,
): Pick<
  CvUploadProgress,
  "state" | "title" | "message" | "percentage" | "parserClass"
> {
  const external = resource.parserClass === "EXTERNAL_OPENAI";
  const percentage = progressPercentage(resource);
  const copy = cvCopy(locale);
  if (resource.status === "REVIEW_READY" || resource.status === "CONFIRMED") {
    return {
      state: "SUCCESS",
      percentage,
      title: external
        ? copy.status.openaiCompleted
        : locale === "vi"
          ? "Đã hoàn tất phân tích CV"
          : "CV parsing completed",
      message:
        locale === "vi"
          ? "Bản nháp riêng đã sẵn sàng. Hãy xem xét trước khi áp dụng thay đổi."
          : "Your private draft is ready. Review it before applying changes.",
      parserClass: resource.parserClass ?? null,
    };
  }
  if (failureStatuses.has(resource.status)) {
    return {
      state: "ERROR",
      percentage,
      title:
        external && resource.status === "PARSE_FAILED"
          ? locale === "vi"
            ? "Phân tích bằng OpenAI không thành công"
            : "OpenAI parsing failed"
          : locale === "vi"
            ? "Đã dừng xử lý CV"
            : "CV processing stopped",
      message: terminalMessage(locale, resource),
      parserClass: resource.parserClass ?? null,
    };
  }
  if (external && resource.status === "AWAITING_CONSENT") {
    return {
      state: "AWAITING_CONSENT",
      percentage,
      title:
        locale === "vi" ? "Đang chờ bạn cấp quyền" : "Waiting for your consent",
      message:
        locale === "vi"
          ? "OpenAI chưa nhận bất kỳ văn bản CV nào. Mở trạng thái nhập để xem xét và cấp quyền."
          : "OpenAI has not received any CV text. Open the import status to review and grant consent.",
      parserClass: resource.parserClass ?? null,
    };
  }
  if (external && resource.status === "PARSE_QUEUED") {
    return {
      state: "AI_PENDING",
      percentage,
      title:
        locale === "vi"
          ? "Yêu cầu OpenAI đã xếp hàng"
          : "OpenAI request queued",
      message:
        locale === "vi"
          ? "Quyền đồng ý hợp lệ. Worker đang chuẩn bị yêu cầu AI."
          : "Consent is valid. The worker is preparing the AI request.",
      parserClass: resource.parserClass ?? null,
    };
  }
  if (external && resource.status === "PARSING") {
    return {
      state: "AI_PROCESSING",
      percentage,
      title:
        locale === "vi"
          ? "OpenAI đang phân tích CV"
          : "OpenAI is parsing your CV",
      message:
        locale === "vi"
          ? "Yêu cầu API đang được xử lý. Hãy giữ trang này mở để theo dõi trạng thái."
          : "The API request is in progress. Keep this page open for live status.",
      parserClass: resource.parserClass ?? null,
    };
  }
  const stage = resource.stage
    ? cvStageLabel(locale, resource.stage)
    : cvStatusLabel(locale, resource.status);
  return {
    state: "PROCESSING",
    percentage,
    title: external
      ? copy.status.preparingOpenai
      : locale === "vi"
        ? "SmartHire đang xử lý CV"
        : "SmartHire is processing your CV",
    message: external
      ? locale === "vi"
        ? `SmartHire đang hoàn tất giai đoạn ${stage}. OpenAI chưa được gọi.`
        : `SmartHire is completing the ${stage} stage. OpenAI has not been called yet.`
      : locale === "vi"
        ? `Giai đoạn hiện tại: ${stage}.`
        : `Current stage: ${stage}.`,
    parserClass: resource.parserClass ?? null,
  };
}

function terminalMessage(locale: CvLocale, resource: CvStatusResource): string {
  const guidance: string[] = [];
  if (resource.failure?.suggestedActions.includes("REPLACE_DOCUMENT"))
    guidance.push(
      locale === "vi"
        ? "Hãy thay CV này bằng PDF hoặc DOCX khác."
        : "Replace this CV with another PDF, DOC, or DOCX.",
    );
  if (resource.failure?.suggestedActions.includes("RETRY"))
    guidance.push(
      locale === "vi"
        ? "Thử lại quá trình xử lý an toàn."
        : "Retry secure processing.",
    );
  if (resource.failure?.suggestedActions.includes("MANUAL_PROFILE"))
    guidance.push(
      locale === "vi"
        ? "Hoặc nhập hồ sơ thủ công."
        : "Or enter your profile manually.",
    );
  return [
    locale === "vi"
      ? `Trạng thái xử lý CV: ${cvStatusLabel(locale, resource.status)}.`
      : `CV processing status: ${cvStatusLabel(locale, resource.status)}.`,
    resource.failure
      ? cvKnownError(locale, resource.failure.message, resource.failure.code)
      : undefined,
    ...guidance,
  ]
    .filter(Boolean)
    .join(" ");
}

export function useCvImport(input: { csrfProof: string }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const [progress, setProgress] = useState<CvUploadProgress>(() => {
    return {
      state: "IDLE",
      percentage: 0,
      title: locale === "vi" ? "Sẵn sàng nhập CV" : "CV import ready",
      message:
        locale === "vi"
          ? "Chọn PDF hoặc DOCX để bắt đầu."
          : "Choose a PDF, DOC, or DOCX CV to begin.",
      uploadId: null,
      parserClass: null,
    };
  });
  const activeRequest = useRef<XMLHttpRequest | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const loadStatus = useCallback(async (uploadId: string) => {
    const response = await fetch(`/api/account/cv-imports/${uploadId}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("CV_STATUS_FAILED");
    return cvImportStatusResponseSchema.parse(await response.json());
  }, []);

  const poll = useCallback(
    async function next(uploadId: string): Promise<void> {
      let resource: Awaited<ReturnType<typeof loadStatus>>;
      try {
        resource = await loadStatus(uploadId);
      } catch {
        setProgress((current) => ({
          ...current,
          state: "STATUS_ERROR",
          title:
            locale === "vi"
              ? "API trạng thái tạm thời không khả dụng"
              : "Status API temporarily unavailable",
          message:
            locale === "vi"
              ? "SmartHire không thể làm mới trạng thái. Quá trình nền có thể vẫn đang chạy; hệ thống sẽ tự thử lại."
              : "SmartHire could not refresh this status. Background processing may still be running; retrying automatically.",
          uploadId,
        }));
        pollTimer.current = setTimeout(() => void next(uploadId), 2_000);
        return;
      }
      const cleanupDeadline = resource.deleteAfter
        ? new Date(resource.deleteAfter).getTime()
        : Number.NaN;
      const candidateCleanupPending =
        resource.status === "CANCELLED" &&
        resource.deletedAt === null &&
        !Number.isNaN(cleanupDeadline) &&
        Date.now() < cleanupDeadline;
      const terminal =
        cvStatusPollingAfterMs(
          resource.status,
          "processingMode" in resource ? resource.processingMode : undefined,
          resource,
        ) === null;
      const nextProgress = activeProgress(locale, resource);
      setProgress(
        candidateCleanupPending
          ? {
              state: "PROCESSING",
              percentage: nextProgress.percentage,
              title:
                locale === "vi"
                  ? "Đang xóa dữ liệu được bảo vệ"
                  : "Protected deletion in progress",
              message:
                locale === "vi"
                  ? "Nội dung không khả dụng trong khi quá trình dọn dẹp được bảo vệ tiếp tục."
                  : "Content is unavailable while protected cleanup continues.",
              uploadId,
              parserClass: nextProgress.parserClass,
            }
          : terminal &&
              !failureStatuses.has(resource.status) &&
              !["REVIEW_READY", "CONFIRMED"].includes(resource.status)
            ? {
                state: "COMPLETE",
                percentage: 100,
                title:
                  locale === "vi"
                    ? "Đã hoàn tất nhập CV"
                    : "CV import finished",
                message: terminalMessage(locale, resource),
                uploadId,
                parserClass: nextProgress.parserClass,
              }
            : { ...nextProgress, uploadId },
      );
      if (!terminal)
        pollTimer.current = setTimeout(() => void next(uploadId), 2_000);
    },
    [loadStatus, locale],
  );

  const resume = useCallback(
    async (uploadId: string) => {
      stop();
      setProgress((current) => ({
        ...current,
        state: "PROCESSING",
        percentage: Math.max(current.percentage, 15),
        title: locale === "vi" ? "Đang tiếp tục nhập CV" : "Resuming CV import",
        message:
          locale === "vi"
            ? "Đang làm mới trạng thái nhập CV…"
            : "Refreshing the CV import status…",
        uploadId,
      }));
      await poll(uploadId);
    },
    [locale, poll, stop],
  );

  const upload = useCallback(
    async (file: File, parserClass: CreateCvImportRequest["parserClass"]) => {
      stop();
      const validatedFile = await validateCvFile(file);
      const idempotencyKey = requestKey();
      setProgress({
        state: "RESERVING",
        percentage: 0,
        title:
          locale === "vi"
            ? `Đang chuẩn bị lần nhập ${parserClass === "EXTERNAL_OPENAI" ? "OpenAI" : "SmartHire"}`
            : parserClass === "EXTERNAL_OPENAI"
              ? "Preparing an OpenAI import"
              : "Preparing a SmartHire import",
        message:
          locale === "vi"
            ? "Đang giữ chỗ lưu trữ tạm thời được mã hóa…"
            : "Reserving encrypted temporary storage…",
        uploadId: null,
        parserClass,
      });
      try {
        const reservationResponse = await fetch("/api/account/cv-imports", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "x-csrf-token": input.csrfProof,
          },
          body: JSON.stringify({
            displayFilename: file.name,
            declaredMediaType: validatedFile.mimeType,
            declaredBytes: file.size,
            parserClass,
          }),
        });
        if (!reservationResponse.ok) {
          throw new Error(
            await admissionErrorMessage(
              reservationResponse,
              parserClass,
              locale,
            ),
          );
        }
        const reservation = cvUploadReservationSchema.parse(
          await reservationResponse.json(),
        );
        await new Promise<void>((resolve, reject) => {
          const request = new XMLHttpRequest();
          activeRequest.current = request;
          request.open("PUT", reservation.contentUrl);
          request.setRequestHeader("content-type", validatedFile.mimeType);
          request.setRequestHeader("idempotency-key", idempotencyKey);
          request.setRequestHeader("x-csrf-token", input.csrfProof);
          request.upload.onprogress = (event) => {
            const percentage = event.lengthComputable
              ? Math.round((event.loaded / event.total) * 90)
              : 0;
            setProgress({
              state: "UPLOADING",
              percentage,
              title:
                locale === "vi"
                  ? "Đang tải CV được mã hóa"
                  : "Uploading encrypted CV",
              message:
                locale === "vi"
                  ? `Đang tải CV: ${percentage}%.`
                  : `Uploading CV: ${percentage}%.`,
              uploadId: reservation.uploadId,
              parserClass,
            });
          };
          request.onerror = () => reject(new Error("CV_UPLOAD_FAILED"));
          request.onabort = () => reject(new Error("CV_UPLOAD_ABORTED"));
          request.onload = () => {
            if (request.status < 200 || request.status >= 300)
              return reject(new Error("CV_UPLOAD_FAILED"));
            try {
              const accepted = cvContentAcceptedSchema.parse(
                JSON.parse(request.responseText),
              );
              if (accepted.uploadId !== reservation.uploadId)
                return reject(new Error("CV_UPLOAD_FAILED"));
              resolve();
            } catch {
              reject(new Error("CV_UPLOAD_FAILED"));
            }
          };
          request.send(file);
        });
        activeRequest.current = null;
        setProgress({
          state: "PROCESSING",
          percentage: 15,
          title: locale === "vi" ? "Đã tải lên" : "Upload complete",
          message:
            locale === "vi"
              ? "SmartHire đang kiểm tra và quét CV…"
              : "SmartHire is validating and scanning the CV…",
          uploadId: reservation.uploadId,
          parserClass,
        });
        router.push(`/profile/cv-imports/${reservation.uploadId}`);
      } catch (error) {
        setProgress((current) => ({
          ...current,
          state: "ERROR",
          title:
            locale === "vi" ? "Tải CV không thành công" : "CV upload failed",
          message:
            error instanceof Error && error.message === "CV_UPLOAD_ABORTED"
              ? locale === "vi"
                ? "Đã hủy tải CV."
                : "CV upload cancelled."
              : error instanceof Error && !error.message.startsWith("CV_")
                ? cvKnownError(locale, error.message)
                : locale === "vi"
                  ? "Không thể hoàn tất tải CV."
                  : "CV upload could not be completed.",
        }));
        throw error;
      }
    },
    [input.csrfProof, locale, router, stop],
  );

  return Object.freeze({
    progress,
    upload,
    resume,
    cancel: stop,
    loadStatus,
  });
}
