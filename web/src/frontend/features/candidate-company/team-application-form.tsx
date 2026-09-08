"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useEffect } from "react";
import { mutateWithCurrentCsrf } from "@/frontend/features/authentication/client/current-csrf-proof";
import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import type { CvUploadStatus } from "@/shared/contracts/cv-import/common";
import {
  candidateTeamApplicationSchema,
  type CandidateTeamApplication,
  type TeamRole,
} from "@/shared/contracts/company-members/team-applications";
import {
  clearCvSecurityUploadId,
  newCvSecurityIdempotencyKey,
  pollCvSecurityUpload,
  readCvSecurityUploadId,
  requestCvSecurityRetry,
  saveCvSecurityUploadId,
  CvSecurityUploadError,
} from "@/frontend/lib/cv-security-upload";
import type { CompanyCopy } from "./i18n/company-copy";
import styles from "./candidate-company-screen.module.css";
import { getCompanyCopy } from "./i18n/company-copy";

const MAX_CV_BYTES = 5_000_000;
const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fileKind(file: File) {
  const extension = file.name.toLowerCase().split(".").pop();
  if (file.type === PDF_MIME || extension === "pdf") return "PDF";
  if (file.type === DOCX_MIME || extension === "docx") return "DOCX";
  return null;
}

function validateFile(file: File | null, copy: CompanyCopy) {
  if (!file) return copy.attachCv;
  if (!fileKind(file)) return copy.unsupportedCv;
  if (file.size < 1) return copy.emptyCv;
  if (file.size > MAX_CV_BYTES) return copy.oversizedCv;
  return null;
}

function messageFrom(body: unknown, copy: CompanyCopy, fallback: string) {
  if (body && typeof body === "object") {
    const code =
      "code" in body && typeof body.code === "string" ? body.code : undefined;
    const localized = copy.teamApplicationError(code);
    if (localized) return localized;
    if ("message" in body && typeof body.message === "string")
      return body.message;
  }
  return fallback;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function TeamApplicationForm({
  companyId,
  companyName,
  teamRoles,
  initialRole,
}: {
  companyId: string;
  companyName: string;
  teamRoles: readonly TeamRole[];
  initialRole: TeamRole;
}) {
  const copy = getCompanyCopy(useWorkspaceLocale());
  const csrf = useCsrfProof();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const admissionIdempotencyKey = useRef<string | null>(null);
  const [role, setRole] = useState<TeamRole>(initialRole);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] =
    useState<CandidateTeamApplication | null>(null);
  const [busy, setBusy] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<CvUploadStatus | null>(
    null,
  );
  const [securityRetryable, setSecurityRetryable] = useState(false);
  const securityAbortController = useRef<AbortController | null>(null);
  const securityScope = `team-application:${companyId}`;

  function securityMessage(caught: unknown) {
    if (caught instanceof CvSecurityUploadError) {
      if (caught.status === "INFECTED") return copy.cvInfected;
      if (caught.retryable || securityRetryable) return copy.cvRetryable;
      return copy.cvStatusError;
    }
    return caught instanceof Error ? caught.message : copy.submitError;
  }

  async function finalizeCleanUpload(uploadId: string) {
    const finalizeRes = await mutateWithCurrentCsrf(
      "/api/candidate/team-applications",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, role, uploadId }),
      },
      csrf,
    );
    const finalBody: unknown = await finalizeRes.json().catch(() => null);
    const existing = candidateTeamApplicationSchema.safeParse(finalBody);
    if (existing.success) {
      clearCvSecurityUploadId(securityScope);
      setSecurityStatus("SECURITY_CLEAN");
      setSecurityRetryable(false);
      setApplication(existing.data);
      admissionIdempotencyKey.current = null;
      return;
    }
    throw new Error(messageFrom(finalBody, copy, copy.submitError));
  }

  async function waitForCleanUpload(uploadId: string) {
    saveCvSecurityUploadId(securityScope, uploadId);
    setSecurityStatus("SCANNING");
    setSecurityRetryable(false);
    const controller = new AbortController();
    securityAbortController.current = controller;
    try {
      const result = await pollCvSecurityUpload(uploadId, {
        signal: controller.signal,
      });
      setSecurityStatus(result.status);
      const retryable = [
        "SCAN_FAILED",
        "EXTRACTION_FAILED",
        "PARSE_FAILED",
      ].includes(result.status);
      setSecurityRetryable(retryable);
      if (!result.clean) {
        if (!retryable) clearCvSecurityUploadId(securityScope);
        throw new CvSecurityUploadError(
          "CV_SECURITY_REJECTED",
          result.status === "INFECTED" ? copy.cvInfected : copy.cvStatusError,
          { retryable, status: result.status },
        );
      }
      await finalizeCleanUpload(uploadId);
    } finally {
      if (securityAbortController.current === controller)
        securityAbortController.current = null;
    }
  }

  async function resumeSecurityUpload(uploadId: string) {
    setBusy(true);
    setError(null);
    try {
      await waitForCleanUpload(uploadId);
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(securityMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const uploadId = readCvSecurityUploadId(securityScope);
    if (!uploadId || application) return;
    const resumeTimer = window.setTimeout(
      () => void resumeSecurityUpload(uploadId),
      0,
    );
    return () => {
      window.clearTimeout(resumeTimer);
      securityAbortController.current?.abort();
    };
    // Resume only the opaque upload id for this company; form fields remain local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [securityScope]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    const validation = validateFile(next, copy);
    setFileError(validation);
    setFile(validation ? null : next);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateFile(file, copy);
    if (validation) {
      setFileError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      admissionIdempotencyKey.current ??=
        globalThis.crypto?.randomUUID?.() ??
        "team-cv-upload-" + Date.now() + "-key";
      const form = new FormData();
      form.append("companyId", companyId);
      form.append("role", role);
      form.append("cv", file!, file!.name);
      const response = await mutateWithCurrentCsrf(
        "/api/candidate/team-applications",
        {
          method: "POST",
          headers: { "Idempotency-Key": admissionIdempotencyKey.current },
          body: form,
        },
        csrf,
      );
      const body: unknown = await response.json().catch(() => null);

      // Handle 2-step admission: 202 Accepted with uploadId
      if (
        response.status === 202 &&
        body &&
        typeof body === "object" &&
        "uploadId" in body
      ) {
        const uploadIdValue = (body as { uploadId?: unknown }).uploadId;
        if (typeof uploadIdValue !== "string" || !uploadIdValue) {
          throw new Error(copy.submitError);
        }
        await waitForCleanUpload(uploadIdValue);
        return;
      }

      const existing = candidateTeamApplicationSchema.safeParse(body);
      if (existing.success) {
        setApplication(existing.data);
        admissionIdempotencyKey.current = null;
        return;
      }
      throw new Error(messageFrom(body, copy, copy.submitError));
    } catch (caught) {
      admissionIdempotencyKey.current = null;
      setError(securityMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function retrySecurityCheck() {
    const uploadId = readCvSecurityUploadId(securityScope);
    if (!uploadId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestCvSecurityRetry(
        uploadId,
        newCvSecurityIdempotencyKey("team-cv-retry"),
        (path, init) => mutateWithCurrentCsrf(path, init, csrf),
      );
      await waitForCleanUpload(uploadId);
    } catch (caught) {
      setError(securityMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (application) {
    return (
      <main
        className={styles.page}
        aria-labelledby="team-application-confirmation"
      >
        <section className={styles.formCard}>
          <p className={styles.eyebrow}>{copy.teamApplications}</p>
          <h1 id="team-application-confirmation">
            {application.status === "SUBMITTED"
              ? copy.applicationReceived
              : copy.applicationAlreadySubmitted}
          </h1>
          <p>
            {copy.cvSentToOwner(
              companyName,
              copy.roleLabel(application.appliedRole),
            )}
          </p>
          <p className={styles.success} role="status">
            {copy.currentStatus(copy.statusLabel(application.status))}
          </p>
          <div className={styles.teamLinks}>
            <Link className={styles.teamLink} href="/jobs/applied/team">
              {copy.viewTeamApplications}
            </Link>
            <Link
              className={`${styles.teamLink} ${styles.secondary}`}
              href={`/company/${encodeURIComponent(companyId)}`}
            >
              {copy.backToCompany}
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page} aria-labelledby="team-application-title">
      <Link
        className={styles.backLink}
        href={`/company/${encodeURIComponent(companyId)}`}
      >
        {copy.backToCompanies}
      </Link>
      <section className={styles.formCard}>
        <p className={styles.eyebrow}>{copy.teamApplications}</p>
        <h1 id="team-application-title">{copy.joinCompany(companyName)}</h1>
        <p className={styles.muted}>{copy.submitCvDescription}</p>
        <form onSubmit={submit} noValidate>
          <label className={styles.field}>
            {copy.teamRole}
            <select
              className={styles.select}
              value={role}
              onChange={(event) => setRole(event.target.value as TeamRole)}
              required
            >
              {teamRoles.map((item) => (
                <option key={item} value={item}>
                  {copy.roleLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {copy.cv}
            <input
              ref={fileInputRef}
              className={styles.input}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={chooseFile}
              aria-describedby="team-cv-help team-cv-error"
              aria-invalid={Boolean(fileError)}
              required
            />
          </label>
          <p id="team-cv-help" className={styles.fileHint}>
            {copy.cvRequirement}
          </p>
          {file ? (
            <p className={styles.fileHint}>
              {file.name} ({formatBytes(file.size)})
            </p>
          ) : null}
          {fileError ? (
            <p id="team-cv-error" className={styles.error} role="alert">
              {fileError}
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {securityStatus && !application ? (
            <p className={styles.fileHint} role="status" aria-live="polite">
              {busy
                ? copy.cvScanning
                : securityRetryable
                  ? copy.cvRetryable
                  : securityStatus === "SECURITY_CLEAN"
                    ? copy.cvReady
                    : copy.cvStatusError}
            </p>
          ) : null}
          {securityRetryable && !application ? (
            <button
              className={`${styles.button} ${styles.secondary}`}
              type="button"
              onClick={() => void retrySecurityCheck()}
              disabled={busy}
            >
              {copy.retryCv}
            </button>
          ) : null}
          <button className={styles.button} type="submit" disabled={busy}>
            {busy ? copy.submitting : copy.apply(copy.roleLabel(role))}
          </button>
        </form>
      </section>
    </main>
  );
}
