import {
  CV_AVAILABLE_ACTIONS,
  type CvProcessingMode,
  type CvUploadStatus,
} from "@/shared/contracts/cv-import/common";

export const CV_IMPORT_PRESENTATION_STEPS = [
  "UPLOAD",
  "SCAN",
  "EXTRACT",
  "REVIEW",
  "CONFIRM",
] as const;

export type CvImportPresentationStep =
  (typeof CV_IMPORT_PRESENTATION_STEPS)[number];
export type CvImportFailureCategory =
  | "FILE"
  | "MALWARE"
  | "SCANNER"
  | "EXTRACTION"
  | "CONSENT"
  | "CONFLICT"
  | "RETENTION"
  | "SYSTEM";
export type CvImportPresentationState =
  | "pending"
  | "active"
  | "complete"
  | "error"
  | "action-required";
export type CvImportStepState =
  | "complete"
  | "current"
  | "upcoming"
  | "error"
  | "action-required";

type Bilingual = Readonly<{ en: string; vi: string }>;

const stepLabels: Record<CvImportPresentationStep, Bilingual> = {
  UPLOAD: { en: "Upload", vi: "Tải lên" },
  SCAN: { en: "Scan", vi: "Quét bảo mật" },
  EXTRACT: { en: "Extract", vi: "Trích xuất" },
  REVIEW: { en: "Review", vi: "Xem xét" },
  CONFIRM: { en: "Confirm", vi: "Xác nhận" },
};

const failureCategoryLabels: Record<CvImportFailureCategory, Bilingual> = {
  FILE: { en: "File or structure", vi: "Tệp hoặc cấu trúc" },
  MALWARE: { en: "Malware", vi: "Mã độc" },
  SCANNER: { en: "Scanner unavailable", vi: "Bộ quét không khả dụng" },
  EXTRACTION: { en: "Text extraction", vi: "Trích xuất văn bản" },
  CONSENT: { en: "Consent", vi: "Quyền đồng ý" },
  CONFLICT: {
    en: "Draft or Profile conflict",
    vi: "Xung đột bản nháp hoặc Hồ sơ",
  },
  RETENTION: { en: "Expired or deleted", vi: "Đã hết hạn hoặc đã xóa" },
  SYSTEM: { en: "Temporary system issue", vi: "Sự cố hệ thống tạm thời" },
};

const fileCodes = new Set([
  "CONTENT_REQUIRED",
  "CONTENT_LENGTH_MISMATCH",
  "ARTIFACT_INTEGRITY_FAILED",
  "UNSUPPORTED_DOCUMENT",
  "MALFORMED_DOCUMENT",
  "DOCUMENT_ENCRYPTED",
  "DOCUMENT_ACTIVE_CONTENT",
  "DOCUMENT_LIMIT_EXCEEDED",
]);
const scannerCodes = new Set([
  "SCANNER_UNAVAILABLE",
  "SCANNER_DEFINITIONS_STALE",
]);
const extractionCodes = new Set([
  "EXTRACTION_EMPTY",
  "EXTRACTION_TIMEOUT",
  "EXTRACTION_FAILED",
  "OCR_UNAVAILABLE",
  "OCR_TIMEOUT",
  "OCR_OUTPUT_INVALID",
  "OCR_LOW_CONFIDENCE",
  "PARSER_TIMEOUT",
  "PARSER_UNAVAILABLE",
  "PARSER_OUTPUT_INVALID",
  "PARSER_OUTPUT_LIMIT_EXCEEDED",
]);
const consentCodes = new Set(["CONSENT_REQUIRED", "CONSENT_REVOKED"]);
const conflictCodes = new Set([
  "DRAFT_REVISION_CONFLICT",
  "PROFILE_REVISION_CONFLICT",
  "IMPORT_STATE_CONFLICT",
]);

export function cvImportStepLabel(
  locale: "vi" | "en",
  step: CvImportPresentationStep,
) {
  return stepLabels[step][locale];
}

export function cvImportFailureCategoryLabel(
  locale: "vi" | "en",
  category: CvImportFailureCategory,
) {
  return failureCategoryLabels[category][locale];
}

function failureCategory(
  status: CvUploadStatus,
  code?: string | null,
): CvImportFailureCategory | null {
  const value = code ?? "";
  if (fileCodes.has(value) || status === "VALIDATION_FAILED") return "FILE";
  if (value === "MALWARE_DETECTED" || status === "INFECTED") return "MALWARE";
  if (scannerCodes.has(value) || status === "SCAN_FAILED") return "SCANNER";
  if (value === "CV_PROCESSING_FAILED" || value === "RETRY_LIMIT_REACHED")
    return "SYSTEM";
  if (consentCodes.has(value) || status === "AWAITING_CONSENT")
    return "CONSENT";
  if (conflictCodes.has(value)) return "CONFLICT";
  if (
    value === "IMPORT_EXPIRED" ||
    value === "IMPORT_DELETED" ||
    ["EXPIRED", "DELETED", "CANCELLED"].includes(status)
  )
    return "RETENTION";
  if (
    extractionCodes.has(value) ||
    status === "EXTRACTION_FAILED" ||
    status === "PARSE_FAILED"
  )
    return "EXTRACTION";
  if (status.endsWith("_FAILED")) return "SYSTEM";
  return null;
}

function currentStep(input: {
  status: CvUploadStatus;
  processingMode?: CvProcessingMode;
  stage?: string;
  failureCode?: string | null;
}): CvImportPresentationStep {
  const category = failureCategory(input.status, input.failureCode);
  if (category === "FILE") return "UPLOAD";
  if (category === "MALWARE" || category === "SCANNER") return "SCAN";
  if (category === "CONFLICT") return "REVIEW";
  if (category === "RETENTION") return "REVIEW";
  if (category === "EXTRACTION" || category === "CONSENT") return "EXTRACT";
  if (category === "SYSTEM") {
    if (input.status === "SCAN_FAILED") return "SCAN";
    if (input.status === "EXTRACTION_FAILED" || input.status === "PARSE_FAILED")
      return "EXTRACT";
  }
  switch (input.status) {
    case "AWAITING_CONTENT":
    case "VALIDATION_QUEUED":
      return "UPLOAD";
    case "SCAN_QUEUED":
    case "SCANNING":
      return "SCAN";
    case "SECURITY_CLEAN":
      return input.processingMode === "SCAN_ONLY" ? "SCAN" : "EXTRACT";
    case "EXTRACTION_QUEUED":
    case "EXTRACTING":
    case "AWAITING_CONSENT":
    case "PARSE_QUEUED":
    case "PARSING":
      return "EXTRACT";
    case "REVIEW_READY":
      return "REVIEW";
    case "CONFIRMED":
      return "CONFIRM";
    default: {
      const stageStep: Partial<Record<string, CvImportPresentationStep>> = {
        UPLOAD: "UPLOAD",
        VALIDATE: "UPLOAD",
        SCAN: "SCAN",
        EXTRACT: "EXTRACT",
        OCR: "EXTRACT",
        CONSENT: "EXTRACT",
        PARSE: "EXTRACT",
        REVIEW: "REVIEW",
        COMPLETE: "CONFIRM",
      };
      return (input.stage ? stageStep[input.stage] : undefined) ?? "REVIEW";
    }
  }
}

function isAuthorizedAction(value: string) {
  return (CV_AVAILABLE_ACTIONS as readonly string[]).includes(value);
}

export function mapCvImportPresentation(input: {
  status: CvUploadStatus;
  processingMode?: CvProcessingMode;
  stage?: string;
  failureCode?: string | null;
  availableActions?: readonly string[];
}) {
  const current = currentStep(input);
  const category = failureCategory(input.status, input.failureCode);
  const authorizedActions = (input.availableActions ?? []).filter(
    isAuthorizedAction,
  ) as (typeof CV_AVAILABLE_ACTIONS)[number][];
  const failed = [
    "VALIDATION_FAILED",
    "INFECTED",
    "SCAN_FAILED",
    "EXTRACTION_FAILED",
    "PARSE_FAILED",
    "DELETED",
    "EXPIRED",
  ].includes(input.status);
  const terminal =
    input.status === "CONFIRMED" ||
    input.status === "DELETED" ||
    input.status === "EXPIRED" ||
    input.status === "CANCELLED" ||
    (input.status === "SECURITY_CLEAN" && input.processingMode === "SCAN_ONLY");
  const actionRequired =
    input.status === "AWAITING_CONSENT" ||
    input.status === "REVIEW_READY" ||
    (failed && authorizedActions.length > 0);
  const state: CvImportPresentationState =
    terminal && !failed
      ? "complete"
      : actionRequired
        ? "action-required"
        : failed
          ? "error"
          : [
                "AWAITING_CONTENT",
                "VALIDATION_QUEUED",
                "SCAN_QUEUED",
                "EXTRACTION_QUEUED",
                "PARSE_QUEUED",
              ].includes(input.status)
            ? "pending"
            : "active";
  const currentIndex = CV_IMPORT_PRESENTATION_STEPS.indexOf(current);
  const completedThrough =
    input.status === "CONFIRMED"
      ? CV_IMPORT_PRESENTATION_STEPS.length - 1
      : input.status === "SECURITY_CLEAN" &&
          input.processingMode === "SCAN_ONLY"
        ? currentIndex
        : currentIndex - 1;
  const steps = CV_IMPORT_PRESENTATION_STEPS.map((step, index) => ({
    key: step,
    state: (failed && index === currentIndex
      ? "error"
      : actionRequired && index === currentIndex
        ? "action-required"
        : index <= completedThrough
          ? "complete"
          : index === currentIndex
            ? "current"
            : "upcoming") as CvImportStepState,
  }));
  return Object.freeze({
    currentStep: current,
    state,
    steps,
    terminal,
    failureCategory: category,
    availableActions: authorizedActions,
  });
}
