"use client";

import Link from "next/link";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import { mutateWithCurrentCsrf } from "@/frontend/features/authentication/client/current-csrf-proof";
import { profileMutationOutcomeSchema } from "@/shared/contracts/account/profile";
import { candidateCvSummarySchema } from "@/shared/contracts/cv-import/candidate-cv";
import type { CvUploadStatus } from "@/shared/contracts/cv-import/common";
import type {
  ApplicationContactSnapshot,
  ApplicationForm,
  ApplicationOutcome,
} from "@/shared/contracts/jobs/actions";
import {
  DIRECT_APPLICATION_CV_ID,
  applicationFormSchema,
  applicationOutcomeSchema,
} from "@/shared/contracts/jobs/actions";
import { validateCvFile } from "@/shared/cv-file-validation";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import {
  jobApplicationCopy,
  type JobApplicationCopy,
  type JobApplicationLocale,
} from "./job-application-copy";
import { useOptionalJobInteraction } from "./job-interaction-provider";
import {
  clearCvSecurityUploadId,
  newCvSecurityIdempotencyKey,
  pollCvSecurityUpload,
  readCvSecurityUploadId,
  requestCvSecurityRetry,
  saveCvSecurityUploadId,
  CvSecurityUploadError,
} from "@/frontend/lib/cv-security-upload";

const MAX_CV_BYTES = 5_000_000;
const PHONE_INPUT_MAX_LENGTH = 15;
const ACCEPTED_CV_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function prefilledCvId(form: ApplicationForm) {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("jobId") === form.jobId) {
      const requested = params.get("cvVersionId");
      if (requested && form.cvs.some((cv) => cv.id === requested))
        return requested;
    }
  }
  return form.cvs.length === 1 ? form.cvs[0]!.id : "";
}
type FieldErrors = Record<string, string>;
function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function normalizePhone(value: string) {
  return value
    .replace(/[^\d+]/gu, "")
    .replace(/(?!^)\+/gu, "")
    .slice(0, PHONE_INPUT_MAX_LENGTH);
}

function canonicalizePhone(value: string) {
  const normalized = normalizePhone(value);
  return normalized.startsWith("0") ? "+84" + normalized.slice(1) : normalized;
}

function phoneValidationError(value: string, copy: JobApplicationCopy) {
  const phone = normalizePhone(value);
  if (!phone) return copy.errors.phoneRequired;
  if (!/^(?:0|\+84)(?:3|5|7|8|9)\d{8}$/u.test(phone)) {
    return copy.errors.phoneInvalid;
  }
  return null;
}

function validateContact(
  contact: ApplicationContactSnapshot,
  copy: JobApplicationCopy,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!contact.fullName.trim()) errors.fullName = copy.errors.fullNameRequired;
  if (!contact.email.trim()) {
    errors.email = copy.errors.emailRequired;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contact.email.trim())) {
    errors.email = copy.errors.emailInvalid;
  }
  const phoneError = phoneValidationError(contact.phone, copy);
  if (phoneError) errors.phone = phoneError;
  return errors;
}

function fieldA11y(field: string, errors: FieldErrors) {
  return {
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? field + "-error" : undefined,
  };
}

function RequiredMark() {
  return (
    <span className="job-required-mark" aria-hidden="true">
      *
    </span>
  );
}

function InlineApplicationForm({
  form,
  copy,
  locale,
  onProfileSaved,
  contactDraft,
  onContactChange,
  onSubmitted,
  onBusyChange,
}: {
  form: ApplicationForm;
  copy: JobApplicationCopy;
  locale: JobApplicationLocale;
  onProfileSaved: (profile: {
    revision: number;
    basics: ApplicationForm["profileBasics"];
  }) => void;
  contactDraft: ApplicationContactSnapshot | null;
  onContactChange: (contact: ApplicationContactSnapshot) => void;
  onSubmitted: (outcome: ApplicationOutcome) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const csrfProof = useCsrfProof();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const cvUploadIdempotencyKey = useRef<string | null>(null);
  const [selectedCvId, setSelectedCvId] = useState(() => prefilledCvId(form));
  const [savedCvs, setSavedCvs] = useState(() => form.cvs);
  const [newCvFile, setNewCvFile] = useState<File | null>(null);
  const [newCvAttached, setNewCvAttached] = useState(false);
  const [contact, setContact] = useState<ApplicationContactSnapshot>(
    contactDraft
      ? { ...contactDraft, phone: normalizePhone(contactDraft.phone) }
      : form.contact
        ? { ...form.contact, phone: normalizePhone(form.contact.phone) }
        : { fullName: "", email: "", phone: "" },
  );
  const [selectedLocation, setSelectedLocation] = useState(() =>
    form.profileBasics.location?.trim() === form.jobLocation.trim()
      ? form.jobLocation
      : "",
  );
  const [profileRevision, setProfileRevision] = useState(form.profileRevision);
  const [profileBasics, setProfileBasics] = useState(form.profileBasics);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationSaveError, setLocationSaveError] = useState<string | null>(
    null,
  );
  const [applicationConsent, setApplicationConsent] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [cvSaving, setCvSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [cvSelectionError, setCvSelectionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cvSecurityStatus, setCvSecurityStatus] =
    useState<CvUploadStatus | null>(null);
  const [cvSecurityRetryable, setCvSecurityRetryable] = useState(false);
  const [cvResuming, setCvResuming] = useState(false);
  const cvSecurityAbortController = useRef<AbortController | null>(null);
  const [directCvUploadId, setDirectCvUploadId] = useState<string | null>(null);
  const cvImportScope = `job-cv-import:${form.jobId}`;
  const directApplicationScope = `job-direct-application:${form.jobId}`;
  const formBusy = pending || locationSaving || cvSaving;

  useEffect(() => {
    onBusyChange(formBusy);
  }, [formBusy, onBusyChange]);

  useEffect(
    () => () => {
      onBusyChange(false);
    },
    [onBusyChange],
  );

  function updateContact(next: ApplicationContactSnapshot) {
    setContact(next);
    onContactChange(next);
  }

  function clearNewCvSelection() {
    setNewCvFile(null);
    setNewCvAttached(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function showCvUploadError(message: string) {
    setCvSelectionError(message);
    toast.error(message, { id: "candidate-cv-upload-error" });
  }

  function cvSecurityMessage(caught: unknown) {
    if (caught instanceof CvSecurityUploadError) {
      if (caught.status === "INFECTED") return copy.cvInfected;
      if (caught.retryable || cvSecurityRetryable) return copy.cvRetryable;
      return copy.cvStatusError;
    }
    return caught instanceof Error ? caught.message : copy.errors.saveCv;
  }

  async function finalizeImportedCv(uploadId: string) {
    const finalizeRes = await mutateWithCurrentCsrf(
      "/api/account/candidate-cvs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId }),
      },
      form.csrfToken || csrfProof,
    );
    const finalResult: unknown = await finalizeRes.json().catch(() => null);
    if (!finalizeRes.ok) {
      const problem = finalResult as { message?: unknown } | null;
      throw new Error(
        typeof problem?.message === "string" && locale === "en"
          ? problem.message
          : copy.errors.saveCv,
      );
    }
    const saved = candidateCvSummarySchema.parse(finalResult);
    setSavedCvs((current) => [
      saved,
      ...current.filter((cv) => cv.id !== saved.id),
    ]);
    setSelectedCvId(saved.id);
    setNewCvAttached(true);
    clearCvSecurityUploadId(cvImportScope);
    setCvSelectionError(null);
    setErrors((current) => {
      const next = { ...current };
      delete next.cv;
      return next;
    });
  }

  async function waitForCleanUpload(uploadId: string, scope: string) {
    saveCvSecurityUploadId(scope, uploadId);
    setCvSecurityStatus("SCANNING");
    setCvSecurityRetryable(false);
    const controller = new AbortController();
    cvSecurityAbortController.current = controller;
    try {
      const result = await pollCvSecurityUpload(uploadId, {
        signal: controller.signal,
      });
      setCvSecurityStatus(result.status);
      const retryable = [
        "SCAN_FAILED",
        "EXTRACTION_FAILED",
        "PARSE_FAILED",
      ].includes(result.status);
      setCvSecurityRetryable(retryable);
      if (!result.clean) {
        if (!retryable) clearCvSecurityUploadId(scope);
        throw new CvSecurityUploadError(
          "CV_SECURITY_REJECTED",
          result.status === "INFECTED" ? copy.cvInfected : copy.cvStatusError,
          { retryable, status: result.status },
        );
      }
      return result;
    } finally {
      if (cvSecurityAbortController.current === controller)
        cvSecurityAbortController.current = null;
    }
  }

  async function resumeCvUpload(uploadId: string, direct: boolean) {
    setCvResuming(true);
    if (direct) setPending(true);
    else setCvSaving(true);
    setError(null);
    try {
      const result = await waitForCleanUpload(
        uploadId,
        direct ? directApplicationScope : cvImportScope,
      );
      if (direct) {
        setDirectCvUploadId(uploadId);
      } else if (result.clean) {
        await finalizeImportedCv(uploadId);
      }
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      showCvUploadError(cvSecurityMessage(caught));
    } finally {
      setCvResuming(false);
      if (direct) setPending(false);
      else setCvSaving(false);
    }
  }

  useEffect(() => {
    const directUploadId = readCvSecurityUploadId(directApplicationScope);
    const importedUploadId = readCvSecurityUploadId(cvImportScope);
    const uploadId = directUploadId ?? importedUploadId;
    if (!uploadId) return;
    const direct = Boolean(directUploadId);
    const resumeTimer = window.setTimeout(
      () => void resumeCvUpload(uploadId, direct),
      0,
    );
    return () => {
      window.clearTimeout(resumeTimer);
      cvSecurityAbortController.current?.abort();
    };
    // Resume only the job-scoped opaque upload id; no file bytes or form data are stored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvImportScope, directApplicationScope]);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop();
    const accepted =
      ACCEPTED_CV_TYPES.has(file.type) ||
      extension === "pdf" ||
      extension === "doc" ||
      extension === "docx";
    if (!accepted) {
      clearNewCvSelection();
      showCvUploadError(copy.errors.unsupportedFile);
      setErrors((current) => {
        const next = { ...current };
        delete next.cv;
        return next;
      });
      return;
    }
    if (file.size < 1 || file.size > MAX_CV_BYTES) {
      clearNewCvSelection();
      showCvUploadError(
        file.size > MAX_CV_BYTES
          ? copy.errors.fileTooLarge
          : copy.errors.emptyFile,
      );
      setErrors((current) => {
        const next = { ...current };
        delete next.cv;
        return next;
      });
      return;
    }
    try {
      await validateCvFile(file);
    } catch {
      clearNewCvSelection();
      showCvUploadError(copy.errors.invalidFile);
      setErrors((current) => {
        const next = { ...current };
        delete next.cv;
        return next;
      });
      return;
    }
    setNewCvFile(file);
    setNewCvAttached(false);
    setCvSelectionError(null);
    cvUploadIdempotencyKey.current = null;
    setSelectedCvId("");
    setErrors((current) => {
      const next = { ...current };
      delete next.cv;
      return next;
    });
  }

  async function attachNewCv() {
    if (!newCvFile || newCvAttached || cvSaving) return;
    setCvSaving(true);
    setError(null);
    try {
      cvUploadIdempotencyKey.current ??=
        globalThis.crypto?.randomUUID?.() ?? "cv-upload-" + Date.now() + "-key";
      const multipart = new FormData();
      multipart.append("file", newCvFile, newCvFile.name);
      const response = await mutateWithCurrentCsrf(
        "/api/account/candidate-cvs",
        {
          method: "POST",
          headers: { "Idempotency-Key": cvUploadIdempotencyKey.current },
          body: multipart,
        },
        form.csrfToken || csrfProof,
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const problem = body as { message?: unknown } | null;
        throw new Error(
          typeof problem?.message === "string"
            ? locale === "en"
              ? problem.message
              : copy.errors.saveCv
            : copy.errors.saveCv,
        );
      }
      const finalResult = body;
      if (
        response.status === 202 &&
        body &&
        typeof body === "object" &&
        "uploadId" in body
      ) {
        const uploadId = String((body as { uploadId: string }).uploadId);
        await waitForCleanUpload(uploadId, cvImportScope);
        await finalizeImportedCv(uploadId);
        cvUploadIdempotencyKey.current = null;
        return;
      }
      const saved = candidateCvSummarySchema.parse(finalResult);
      setSavedCvs((current) => [
        saved,
        ...current.filter((cv) => cv.id !== saved.id),
      ]);
      setSelectedCvId(saved.id);
      setNewCvAttached(true);
      cvUploadIdempotencyKey.current = null;
      setCvSelectionError(null);
      setErrors((current) => {
        const next = { ...current };
        delete next.cv;
        return next;
      });
    } catch (caught) {
      const message = cvSecurityMessage(caught);
      clearNewCvSelection();
      setSelectedCvId("");
      cvUploadIdempotencyKey.current = null;
      showCvUploadError(message);
    } finally {
      setCvSaving(false);
    }
  }

  function validate(): boolean {
    const next = validateContact(
      {
        fullName: contact.fullName.trim(),
        email: contact.email.trim(),
        phone: normalizePhone(contact.phone),
      },
      copy,
    );
    if (!selectedCvId && !(newCvFile && newCvAttached)) {
      next.cv = newCvFile
        ? copy.errors.selectImportedCv
        : (cvSelectionError ?? copy.errors.selectSavedCv);
    }
    if (!locationReady) {
      next.location = selectedLocation
        ? copy.errors.saveLocation
        : copy.errors.selectLocation;
    }
    if (!applicationConsent) next.consent = copy.errors.acceptConsent;
    setErrors(next);
    const firstInvalidField = Object.keys(next)[0];
    if (firstInvalidField) {
      const fieldIds: Record<string, string> = {
        cv: "application-cv-id",
        fullName: "application-full-name",
        email: "application-email",
        phone: "application-phone",
        location: "application-location",
        consent: "application-consent",
      };
      window.requestAnimationFrame(() =>
        document.getElementById(fieldIds[firstInvalidField] ?? "")?.focus(),
      );
    }
    return Object.keys(next).length === 0;
  }

  async function retryCvSecurityCheck() {
    const directUploadId = readCvSecurityUploadId(directApplicationScope);
    const importedUploadId = readCvSecurityUploadId(cvImportScope);
    const uploadId = directUploadId ?? importedUploadId;
    if (!uploadId || formBusy) return;
    const direct = Boolean(directUploadId);
    setError(null);
    if (direct) setPending(true);
    else setCvSaving(true);
    try {
      await requestCvSecurityRetry(
        uploadId,
        newCvSecurityIdempotencyKey("job-cv-retry"),
        (path, init) =>
          mutateWithCurrentCsrf(path, init, form.csrfToken || csrfProof),
      );
      const result = await waitForCleanUpload(
        uploadId,
        direct ? directApplicationScope : cvImportScope,
      );
      if (direct) setDirectCvUploadId(uploadId);
      else if (result.clean) await finalizeImportedCv(uploadId);
    } catch (caught) {
      showCvUploadError(cvSecurityMessage(caught));
    } finally {
      if (direct) setPending(false);
      else setCvSaving(false);
    }
  }

  async function saveLocation(value: string) {
    const location = value.trim() || null;
    setSelectedLocation(value);
    setLocationSaveError(null);
    setErrors((current) => {
      const next = { ...current };
      delete next.location;
      return next;
    });
    setLocationSaving(true);
    try {
      const response = await mutateWithCurrentCsrf(
        "/api/account/profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section: "basics",
            baseRevision: profileRevision,
            basics: {
              ...profileBasics,
              location,
            },
          }),
        },
        form.csrfToken || csrfProof,
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const problem = body as { message?: unknown } | null;
        throw new Error(
          typeof problem?.message === "string"
            ? locale === "en"
              ? problem.message
              : copy.errors.saveLocation
            : copy.errors.saveLocation,
        );
      }
      const result = profileMutationOutcomeSchema.parse(body);
      const saved = {
        revision: result.profile.revision,
        basics: result.profile.basics,
      };
      setProfileRevision(saved.revision);
      setProfileBasics(saved.basics);
      setSelectedLocation(
        saved.basics.location?.trim() === form.jobLocation.trim()
          ? form.jobLocation
          : "",
      );
      onProfileSaved(saved);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? locale === "en"
            ? caught.message
            : copy.errors.saveLocation
          : copy.errors.saveLocation;
      setLocationSaveError(message);
      setErrors((current) => ({ ...current, location: message }));
    } finally {
      setLocationSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const answers = form.questions.map((question) => ({
      questionId: question.id,
      value:
        question.kind === "BOOLEAN"
          ? data.get("question-" + question.id) === "true"
          : String(data.get("question-" + question.id) ?? ""),
    }));
    const directCv =
      newCvFile && newCvAttached && !selectedCvId ? newCvFile : null;
    const storedDirectUploadId = directCvUploadId;
    const usesDirectUpload = Boolean(directCv || storedDirectUploadId);
    const cvFileRef = selectedCvId || null;
    const contactSnapshot = {
      fullName: contact.fullName.trim(),
      email: contact.email.trim(),
      phone: canonicalizePhone(contact.phone),
    };

    try {
      idempotencyKey.current ??=
        globalThis.crypto?.randomUUID?.() ??
        "application-" + Date.now() + "-key";
      const payload = {
        cvId: usesDirectUpload
          ? DIRECT_APPLICATION_CV_ID
          : selectedCvId || cvFileRef,
        cvUploadId: storedDirectUploadId ?? undefined,
        cvFileRef,
        contactSnapshot,
        answers,
        coverLetter: String(data.get("coverLetter") ?? "") || null,
        consentVersion: form.consentVersion,
        consentAccepted: applicationConsent,
        aiAnalysisConsent: aiConsent,
      };
      const requestBody = directCv
        ? (() => {
            const multipart = new FormData();
            multipart.append("application", JSON.stringify(payload));
            multipart.append("cvFile", directCv, directCv.name);
            return multipart;
          })()
        : JSON.stringify(payload);
      const response = await mutateWithCurrentCsrf(
        "/api/jobs/" + form.jobId + "/applications",
        {
          method: "POST",
          headers: {
            ...(directCv ? {} : { "Content-Type": "application/json" }),
            "Idempotency-Key": idempotencyKey.current,
          },
          body: requestBody,
        },
        form.csrfToken || csrfProof,
      );

      let body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const problem = body as { message?: unknown; fieldErrors?: unknown };
        if (problem.fieldErrors && typeof problem.fieldErrors === "object") {
          const serverErrors: FieldErrors = {};
          for (const [field, value] of Object.entries(
            problem.fieldErrors as Record<string, unknown>,
          )) {
            const first = Array.isArray(value) ? value[0] : value;
            if (typeof first === "string") serverErrors[field] = first;
          }
          setErrors((current) => ({ ...current, ...serverErrors }));
        }
        setError(
          typeof problem.message === "string" && locale === "en"
            ? problem.message
            : copy.errors.submit,
        );
        return;
      }

      if (
        response.status === 202 &&
        body &&
        typeof body === "object" &&
        "uploadId" in body
      ) {
        const uploadId = String((body as { uploadId: string }).uploadId);
        await waitForCleanUpload(uploadId, directApplicationScope);
        setDirectCvUploadId(uploadId);

        const finalizePayload = {
          ...payload,
          cvId: DIRECT_APPLICATION_CV_ID,
          cvUploadId: uploadId,
        };
        const finalizeResponse = await mutateWithCurrentCsrf(
          "/api/jobs/" + form.jobId + "/applications",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey.current,
            },
            body: JSON.stringify(finalizePayload),
          },
          form.csrfToken || csrfProof,
        );
        body = await finalizeResponse.json().catch(() => null);
        if (!finalizeResponse.ok) {
          const problem = body as { message?: unknown; fieldErrors?: unknown };
          if (problem.fieldErrors && typeof problem.fieldErrors === "object") {
            const serverErrors: FieldErrors = {};
            for (const [field, value] of Object.entries(
              problem.fieldErrors as Record<string, unknown>,
            )) {
              const first = Array.isArray(value) ? value[0] : value;
              if (typeof first === "string") serverErrors[field] = first;
            }
            setErrors((current) => ({ ...current, ...serverErrors }));
          }
          setError(
            typeof problem.message === "string" && locale === "en"
              ? problem.message
              : copy.errors.submit,
          );
          return;
        }
      }

      const outcome = applicationOutcomeSchema.parse(body);
      onSubmitted({
        ...outcome,
        aiAnalysisConsent: aiConsent,
        aiMatchScore: outcome.aiMatchScore,
      });
      clearCvSecurityUploadId(directApplicationScope);
      setDirectCvUploadId(null);
      setCvSecurityRetryable(false);
    } catch (caught) {
      setError(
        caught instanceof CvSecurityUploadError
          ? cvSecurityMessage(caught)
          : copy.errors.submitTryAgain,
      );
    } finally {
      setPending(false);
    }
  }

  const locationReady =
    !locationSaving &&
    Boolean(selectedLocation.trim()) &&
    profileBasics.location?.trim() === selectedLocation.trim();
  const missingProfileFields = Array.from(
    new Set([
      ...form.missingProfileFields.filter((field) => field !== "location"),
      ...(locationReady ? [] : ["location"]),
    ]),
  );
  const profileReady = missingProfileFields.length === 0;
  const submitDisabled = pending || locationSaving || cvSaving;
  const cvErrorMessage = errors.cv ?? cvSelectionError;

  return (
    <form
      className="job-form-grid"
      aria-label={copy.applyFor(form.jobTitle)}
      onSubmit={submit}
      onChange={() => {
        idempotencyKey.current = null;
        setError(null);
      }}
      noValidate
    >
      <p className="job-required-note">
        <RequiredMark /> {copy.requiredFields}
      </p>
      {!profileReady ? (
        <div role="alert">
          {copy.profileIncomplete(
            missingProfileFields
              .map((field) => copy.profileFields[field] ?? field)
              .join(", "),
          )}
        </div>
      ) : null}

      <fieldset className="job-application-fieldset">
        <legend>
          {copy.cvSection}
          <RequiredMark />
        </legend>
        <p className="job-form-help">{copy.cvHelp}</p>
        <label htmlFor="application-cv-id">
          {copy.selectCv}
          <select
            id="application-cv-id"
            name="cvId"
            required
            value={selectedCvId}
            disabled={pending || cvSaving}
            {...fieldA11y("cv", errors)}
            onChange={(event) => {
              setSelectedCvId(event.currentTarget.value);
              setNewCvFile(null);
              setNewCvAttached(false);
              setCvSelectionError(null);
              setErrors((current) => {
                const next = { ...current };
                delete next.cv;
                return next;
              });
            }}
          >
            <option value="">
              {savedCvs.length ? copy.savedCvPlaceholder : copy.noConfirmedCvs}
            </option>
            {savedCvs.map((cv) => (
              <option key={cv.id} value={cv.id}>
                {(cv.displayName.trim() || cv.fileName) +
                  ` (${formatBytes(cv.byteSize)})`}
              </option>
            ))}
          </select>
        </label>
        <label
          className="job-cv-dropzone"
          htmlFor="application-cv-upload"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            void chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <span className="job-cv-dropzone-title">
            {newCvFile ? copy.fileSelected : copy.chooseFile}
          </span>
          <span className="job-form-help">{copy.fileTypes}</span>
          <input
            ref={fileInputRef}
            id="application-cv-upload"
            name="newCvFile"
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-describedby={cvErrorMessage ? "cv-error" : undefined}
            disabled={pending || cvSaving}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              void chooseFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {newCvFile ? (
          <div className="job-selected-file" role="status">
            <span>
              <strong>{newCvFile.name}</strong> · {formatBytes(newCvFile.size)}
            </span>
            <span className="job-file-actions">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending || cvSaving}
              >
                {copy.changeFile}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewCvFile(null);
                  setNewCvAttached(false);
                  setSelectedCvId("");
                  cvUploadIdempotencyKey.current = null;
                  setCvSelectionError(null);
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.cv;
                    return next;
                  });
                }}
                disabled={pending || cvSaving}
              >
                {copy.removeFile}
              </button>
            </span>
          </div>
        ) : null}
        {newCvFile && !newCvAttached ? (
          <button
            type="button"
            onClick={() => void attachNewCv()}
            disabled={submitDisabled}
          >
            {cvSaving ? copy.savingCv : copy.importCv}
          </button>
        ) : null}
        {cvErrorMessage ? (
          <p id="cv-error" className="job-field-error" role="alert">
            {cvErrorMessage}
          </p>
        ) : null}
        {cvSecurityStatus || cvSecurityRetryable ? (
          <p className="job-form-help" role="status" aria-live="polite">
            {formBusy
              ? cvResuming
                ? copy.cvResuming
                : copy.cvScanning
              : cvSecurityRetryable
                ? copy.cvRetryable
                : cvSecurityStatus === "SECURITY_CLEAN"
                  ? copy.cvReady
                  : cvSecurityStatus === "INFECTED"
                    ? copy.cvInfected
                    : copy.cvStatusError}
          </p>
        ) : null}
        {cvSecurityRetryable ? (
          <button
            type="button"
            onClick={() => void retryCvSecurityCheck()}
            disabled={submitDisabled}
          >
            {copy.retryCv}
          </button>
        ) : null}
      </fieldset>

      <fieldset className="job-application-fieldset">
        <legend>{copy.contactInformation}</legend>
        <label htmlFor="application-full-name">
          <span className="job-field-label">
            {copy.fullName}
            <RequiredMark />
          </span>
          <input
            id="application-full-name"
            name="fullName"
            required
            autoComplete="name"
            value={contact.fullName}
            {...fieldA11y("fullName", errors)}
            onChange={(event) =>
              updateContact({
                ...contact,
                fullName: event.currentTarget.value,
              })
            }
          />
          {errors.fullName ? (
            <span id="fullName-error" className="job-field-error" role="alert">
              {errors.fullName}
            </span>
          ) : null}
        </label>
        <label htmlFor="application-email">
          <span className="job-field-label">
            {copy.email}
            <RequiredMark />
          </span>
          <input
            id="application-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={contact.email}
            {...fieldA11y("email", errors)}
            onChange={(event) =>
              updateContact({
                ...contact,
                email: event.currentTarget.value,
              })
            }
          />
          {errors.email ? (
            <span id="email-error" className="job-field-error" role="alert">
              {errors.email}
            </span>
          ) : null}
        </label>
        <label htmlFor="application-phone">
          <span className="job-field-label">
            {copy.phoneNumber}
            <RequiredMark />
          </span>
          <input
            id="application-phone"
            name="phone"
            type="tel"
            required
            inputMode="numeric"
            autoComplete="tel"
            maxLength={PHONE_INPUT_MAX_LENGTH}
            value={contact.phone}
            {...fieldA11y("phone", errors)}
            onChange={(event) => {
              const phone = normalizePhone(event.currentTarget.value);
              updateContact({ ...contact, phone });
              setErrors((current) => {
                const next = { ...current };
                delete next.phone;
                return next;
              });
            }}
            onBlur={() => {
              const phoneError = phoneValidationError(contact.phone, copy);
              setErrors((current) => {
                const next = { ...current };
                if (phoneError) next.phone = phoneError;
                else delete next.phone;
                return next;
              });
            }}
          />
          {errors.phone ? (
            <span id="phone-error" className="job-field-error" role="alert">
              {errors.phone}
            </span>
          ) : null}
        </label>
        <label htmlFor="application-location">
          <span className="job-field-label">
            {copy.location}
            <RequiredMark />
          </span>
          <select
            id="application-location"
            name="location"
            required
            value={selectedLocation}
            disabled={pending || locationSaving}
            {...fieldA11y("location", errors)}
            onChange={(event) => void saveLocation(event.currentTarget.value)}
          >
            <option value="">{copy.selectJobLocation}</option>
            <option value={form.jobLocation}>{form.jobLocation}</option>
          </select>
          {locationSaving ? (
            <span className="job-form-help">{copy.savingLocation}</span>
          ) : null}
          {locationSaveError ? (
            <span id="location-error" className="job-field-error" role="alert">
              {locationSaveError}
            </span>
          ) : errors.location ? (
            <span id="location-error" className="job-field-error" role="alert">
              {errors.location}
            </span>
          ) : null}
        </label>
      </fieldset>

      {form.questions.map((question) => (
        <label key={question.id} htmlFor={"question-" + question.id}>
          <span className="job-field-label">
            {question.prompt}
            {question.required ? <RequiredMark /> : null}
          </span>
          {question.kind === "BOOLEAN" ? (
            <select
              id={"question-" + question.id}
              name={"question-" + question.id}
              required={question.required}
              defaultValue=""
            >
              <option value="" disabled>
                {copy.chooseAnswer}
              </option>
              <option value="true">{copy.yes}</option>
              <option value="false">{copy.no}</option>
            </select>
          ) : question.kind === "SINGLE_CHOICE" ? (
            <select
              id={"question-" + question.id}
              name={"question-" + question.id}
              required={question.required}
              defaultValue=""
            >
              <option value="" disabled>
                {copy.chooseAnswer}
              </option>
              {question.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <textarea
              id={"question-" + question.id}
              name={"question-" + question.id}
              required={question.required}
              maxLength={3000}
              rows={3}
            />
          )}
        </label>
      ))}

      <label htmlFor="application-cover-letter">
        {copy.coverLetterOptional}
        <textarea
          id="application-cover-letter"
          name="coverLetter"
          maxLength={5000}
          rows={5}
        />
      </label>

      {error ? (
        <div role="alert" className="job-feedback">
          {error}
        </div>
      ) : null}
      <section
        className="job-application-transparency"
        aria-label={copy.transparencyAria}
      >
        <div className="job-application-transparency-heading">
          <ShieldCheck aria-hidden="true" />
          <strong>{copy.transparencyTitle}</strong>
        </div>
        <p>{copy.transparencyDescription}</p>
        <div className="job-application-private-note">
          <LockKeyhole aria-hidden="true" />
          <span>{copy.privateCvNote}</span>
        </div>
      </section>
      <div className="job-actions">
        <div className="job-ai-consent">
          <label className="job-checkbox-label" htmlFor="application-consent">
            <input
              id="application-consent"
              name="consentAccepted"
              type="checkbox"
              required
              aria-label={copy.consentAria}
              checked={applicationConsent}
              {...fieldA11y("consent", errors)}
              onChange={(event) => {
                setApplicationConsent(event.currentTarget.checked);
                setErrors((current) => {
                  const next = { ...current };
                  delete next.consent;
                  return next;
                });
              }}
            />
            <span>
              {copy.consentText}
              <RequiredMark />
            </span>
          </label>
          {errors.consent ? (
            <p id="consent-error" className="job-field-error" role="alert">
              {errors.consent}
            </p>
          ) : null}
        </div>
        <div className="job-ai-consent">
          <label
            className="job-checkbox-label"
            htmlFor="application-ai-consent"
          >
            <input
              id="application-ai-consent"
              name="aiAnalysisConsent"
              type="checkbox"
              aria-label={copy.aiConsentAria}
              checked={aiConsent}
              onChange={(event) => setAiConsent(event.currentTarget.checked)}
            />
            <span>
              {copy.aiConsentText}{" "}
              <Link href="/legal/ai-cv-analysis-policy" target="_blank">
                {copy.learnMore}
              </Link>
            </span>
          </label>
          <p className="job-form-help">{copy.aiConsentHint}</p>
        </div>
        <button type="submit" disabled={submitDisabled}>
          {pending ? copy.submitting : copy.submitApplication}
        </button>
      </div>
    </form>
  );
}

export function ApplyFormSection({
  jobId,
  jobTitle,
  open,
  applied,
  onOpenChange,
  onSubmitted,
}: {
  jobId: string;
  jobTitle: string;
  open: boolean;
  applied: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: (outcome: ApplicationOutcome) => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = jobApplicationCopy(locale);
  const shared = useOptionalJobInteraction();
  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [outcome, setOutcome] = useState<ApplicationOutcome | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [closing, setClosing] = useState(false);
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [contactDraft, setContactDraft] =
    useState<ApplicationContactSnapshot | null>(null);
  const wasOpenRef = useRef(false);

  const handleModalClose = useCallback(() => {
    if (closing || applicationBusy) return;
    setClosing(true);
    onOpenChange(false);
    setClosing(false);
  }, [applicationBusy, closing, onOpenChange]);

  useEffect(() => {
    const reopened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (reopened && form && form.cvs.length === 0 && !outcome && !applied) {
      setForm(null);
      setLoadError(null);
    }
  }, [applied, form, open, outcome]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleModalClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [handleModalClose, open]);

  useEffect(() => {
    if (!open || applied || form || outcome || loadError) return;
    let active = true;
    void fetch("/api/jobs/" + jobId + "/application-form", {
      cache: "no-store",
    })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          throw new Error(copy.errors.loadForm);
        }
        return body;
      })
      .then((body) => {
        if (active) setForm(applicationFormSchema.parse(body));
      })
      .catch((caught: unknown) => {
        if (active)
          setLoadError(
            locale === "en" && caught instanceof Error
              ? caught.message
              : copy.errors.loadForm,
          );
      });
    return () => {
      active = false;
    };
  }, [
    applied,
    copy.errors.loadForm,
    form,
    jobId,
    loadError,
    locale,
    open,
    outcome,
  ]);

  function handleSubmitted(submitted: ApplicationOutcome) {
    setOutcome(submitted);
    shared?.markApplied(jobId);
    onSubmitted?.(submitted);
  }

  function handleContactChange(contact: ApplicationContactSnapshot) {
    setContactDraft(contact);
  }

  function handleProfileSaved(profile: {
    revision: number;
    basics: ApplicationForm["profileBasics"];
  }) {
    setForm((current) => {
      if (!current) return current;
      const missing = new Set(
        current.missingProfileFields.filter((field) => field !== "location"),
      );
      if (!profile.basics.location?.trim()) missing.add("location");
      return {
        ...current,
        profileRevision: profile.revision,
        profileBasics: profile.basics,
        profileReady: missing.size === 0,
        missingProfileFields: Array.from(missing),
      };
    });
  }

  if (!open) return null;

  const headingId = "job-apply-heading-" + jobId;

  return (
    <div
      id="apply"
      className="job-apply-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleModalClose();
      }}
    >
      <section
        ref={dialogRef}
        className="job-apply-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <header className="job-apply-modal-header">
          <div>
            <p className="panel-kicker">{copy.applyKicker}</p>
            <h2 id={headingId}>{copy.applyFor(jobTitle)}</h2>
            <p>{copy.completeApplication}</p>
          </div>
          <button
            type="button"
            className="job-icon-button"
            aria-label={copy.closeApplicationForm}
            disabled={closing || applicationBusy}
            aria-describedby={
              applicationBusy ? "job-apply-close-hint" : undefined
            }
            onClick={() => void handleModalClose()}
          >
            ×
          </button>
        </header>

        {applicationBusy ? (
          <p id="job-apply-close-hint" className="sr-only">
            {copy.closeWait}
          </p>
        ) : null}

        <div className="job-apply-modal-body">
          {open && !form && !outcome && !applied && !loadError ? (
            <p className="job-feedback job-feedback-info" role="status">
              {copy.preparing}
            </p>
          ) : loadError ? (
            <div className="job-feedback" role="alert">
              <p>{loadError}</p>
              <button type="button" onClick={() => setLoadError(null)}>
                {copy.tryAgain}
              </button>
            </div>
          ) : outcome ? (
            <div className="job-application-confirmation" role="status">
              <strong>{copy.successTitle(form?.jobTitle ?? jobTitle)}</strong>
              <p>{copy.successDescription}</p>
            </div>
          ) : applied ? (
            <div className="job-application-confirmation" role="status">
              {copy.alreadyApplied}
            </div>
          ) : form ? (
            <InlineApplicationForm
              form={form}
              copy={copy}
              locale={locale}
              onProfileSaved={handleProfileSaved}
              contactDraft={contactDraft}
              onContactChange={handleContactChange}
              onSubmitted={handleSubmitted}
              onBusyChange={setApplicationBusy}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
