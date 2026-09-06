"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/frontend/components/ui/button";
import type { CvParserClass } from "@/shared/contracts/cv-import/common";
import { CV_SOURCE_MAX_BYTES } from "@/shared/contracts/cv-import/common";
import {
  CvFileValidationError,
  validateCvFile,
} from "@/shared/cv-file-validation";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";
import { cvCopy, cvKnownError } from "../i18n/cv-import-copy";
import { CvProcessingNotice } from "./cv-processing-notice";
import styles from "./cv-upload-form.module.css";

const acceptedExtensions = new Set(["pdf", "doc", "docx"]);
const subscribeToHydration = () => () => {};
const getClientHydration = () => true;
const getServerHydration = () => false;

export function CvUploadForm({
  csrfProof,
  onUpload,
  parserAvailability = { deterministic: true, external: true },
}: {
  csrfProof: string;
  parserAvailability?: Readonly<{ deterministic: boolean; external: boolean }>;
  onUpload(
    file: File,
    parserClass: CvParserClass,
    csrfProof: string,
  ): Promise<void>;
}) {
  const locale = useWorkspaceLocale();
  const copy = cvCopy(locale);
  const [file, setFile] = useState<File | null>(null);
  const [parserClass, setParserClass] = useState<CvParserClass | null>(() => {
    if (parserAvailability.deterministic) return "DETERMINISTIC_INTERNAL";
    if (parserAvailability.external) return "EXTERNAL_OPENAI";
    return null;
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(copy.upload.ready);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydration,
    getServerHydration,
  );
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const focusFileAfterError = useRef(false);

  useEffect(() => {
    if (!error) return;
    if (focusFileAfterError.current) fileRef.current?.focus();
    else errorRef.current?.focus();
  }, [error]);

  function showError(value: string, focusFile = false) {
    focusFileAfterError.current = focusFile;
    setError(value);
    toast.error(value, { id: "candidate-cv-upload-error" });
  }

  function clearSelection() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function choose(candidate: File | null) {
    setError(null);
    if (!candidate) {
      clearSelection();
      setMessage(copy.upload.ready);
      return;
    }
    const extension = candidate.name.toLowerCase().split(".").pop();
    if (!extension || !acceptedExtensions.has(extension)) {
      clearSelection();
      setMessage(copy.upload.ready);
      return showError(
        locale === "vi"
          ? "Hãy chọn tệp PDF hoặc DOCX có phần mở rộng phù hợp."
          : "Only PDF, DOC, or DOCX files are supported.",
        true,
      );
    }
    if (candidate.size < 1 || candidate.size > CV_SOURCE_MAX_BYTES) {
      clearSelection();
      setMessage(copy.upload.ready);
      return showError(
        locale === "vi"
          ? "CV không được lớn hơn 5 MB (5.000.000 byte)."
          : candidate.size > CV_SOURCE_MAX_BYTES
            ? "File size must not exceed 5MB."
            : "The uploaded file is empty.",
        true,
      );
    }
    try {
      await validateCvFile(candidate);
    } catch (cause) {
      clearSelection();
      setMessage(copy.upload.ready);
      return showError(
        cause instanceof Error
          ? cause.message
          : locale === "vi"
            ? "Chỉ hỗ trợ tệp PDF hoặc DOCX hợp lệ."
            : "Only valid PDF, DOC, or DOCX files are supported.",
        true,
      );
    }
    setFile(candidate);
    setMessage(
      locale === "vi"
        ? `${candidate.name} sẵn sàng để tải lên.`
        : `${candidate.name} is ready to upload.`,
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file)
      return showError(
        locale === "vi"
          ? "Hãy chọn CV PDF hoặc DOCX trước khi tải lên."
          : "Choose a PDF, DOC, or DOCX CV before uploading.",
      );
    if (!parserClass)
      return showError(
        locale === "vi"
          ? "Hiện không có bộ phân tích CV khả dụng."
          : "No CV parser is currently available.",
      );
    setBusy(true);
    setError(null);
    setMessage(locale === "vi" ? "Đang tải CV…" : "Uploading CV…");
    try {
      await onUpload(file, parserClass, csrfProof);
      setMessage(
        locale === "vi"
          ? "Đã gửi CV để xử lý an toàn."
          : "CV upload submitted for secure processing.",
      );
    } catch (cause) {
      clearSelection();
      const errorCode =
        cause instanceof CvFileValidationError
          ? cause.code
          : cause instanceof Error && cause.message.startsWith("CV_")
            ? cause.message
            : undefined;
      showError(
        cause instanceof Error
          ? cvKnownError(locale, cause.message, errorCode)
          : locale === "vi"
            ? "Tải CV không thành công. Hãy thử lại hoặc nhập hồ sơ thủ công."
            : "The CV upload failed. Try again or enter your profile manually.",
      );
      setMessage(
        locale === "vi" ? "Tải lên không thành công." : "Upload failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      data-testid="cv-upload-form"
      data-narrow-layout="320"
      data-reduced-motion-safe="true"
      noValidate
    >
      {parserClass ? <CvProcessingNotice parserClass={parserClass} /> : null}
      {error ? (
        <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </div>
      ) : null}
      <div className={styles.field}>
        <label htmlFor="cv-upload-file">{copy.upload.file}</label>
        <input
          id="cv-upload-file"
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) =>
            void choose(event.currentTarget.files?.[0] ?? null)
          }
          disabled={busy || !hydrated}
        />
        <small id="cv-upload-guidance">{copy.upload.fileGuidance}</small>
      </div>
      <fieldset className={styles.parserFieldset}>
        <legend>{copy.upload.chooseParser}</legend>
        <p className={styles.parserGuidance}>
          {parserClass === "DETERMINISTIC_INTERNAL"
            ? copy.upload.deterministicHint
            : copy.upload.parserGuidance}
        </p>
        <div className={styles.parserOptions} role="radiogroup">
          {parserAvailability.deterministic ? (
            <button
              type="button"
              className={styles.parserOption}
              data-selected={parserClass === "DETERMINISTIC_INTERNAL"}
              role="radio"
              aria-checked={parserClass === "DETERMINISTIC_INTERNAL"}
              aria-label={copy.upload.deterministic}
              onClick={() => setParserClass("DETERMINISTIC_INTERNAL")}
            >
              <span className={styles.parserMark} aria-hidden="true">
                SH
              </span>
              <span className={styles.parserCopy}>
                <strong>{copy.upload.deterministic}</strong>
                <small>{copy.upload.deterministicHint}</small>
              </span>
              <span className={styles.parserBadge}>{copy.upload.local}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={styles.parserOption}
            data-selected={parserClass === "EXTERNAL_OPENAI"}
            data-disabled={!parserAvailability.external}
            role="radio"
            aria-checked={parserClass === "EXTERNAL_OPENAI"}
            aria-disabled={!parserAvailability.external}
            tabIndex={parserAvailability.external ? 0 : -1}
            disabled={!parserAvailability.external}
            aria-label={copy.upload.external}
            onClick={() => setParserClass("EXTERNAL_OPENAI")}
          >
            <span className={styles.parserMark} aria-hidden="true">
              AI
            </span>
            <span className={styles.parserCopy}>
              <strong>{copy.upload.external}</strong>
              <small>{copy.upload.externalHint}</small>
            </span>
            <span className={styles.parserBadge}>
              {parserAvailability.external
                ? copy.upload.required
                : copy.upload.notConfigured}
            </span>
          </button>
        </div>
      </fieldset>
      <div className={styles.actions}>
        <Button type="submit" disabled={!hydrated || busy || !parserClass}>
          {busy ? copy.upload.uploading : copy.upload.upload}
        </Button>
        <a href="/profile">{copy.upload.manual}</a>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
