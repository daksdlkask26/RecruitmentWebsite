"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  FileText,
  Info,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { applicationCopy } from "@/frontend/features/candidate-applications/i18n/application-copy";
import { jobAttributeLabel } from "@/frontend/features/jobs/components/job-copy";
import {
  ApplicationProgressChecklist,
  ApplicationStepper,
} from "./application-stepper";
import {
  ApplicationFlowHeader,
  FileSelectionCard,
  RequirementTag,
} from "./application-wizard-primitives";
import type { ApplicationWizardJob } from "./application-personal-information";
import type { ApplicationDraft } from "@/shared/contracts/candidate-applications";
import type { CandidateCvSummary } from "@/shared/contracts/cv-import/candidate-cv";

const MAX_COVER_LETTER_CHARACTERS = 2_000;

function formatFileSize(byteSize: number, locale: "en" | "vi") {
  if (byteSize < 1_000) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "byte",
      unitDisplay: "short",
    }).format(byteSize);
  }
  if (byteSize < 1_000_000) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "kilobyte",
      unitDisplay: "short",
      maximumFractionDigits: 1,
    }).format(byteSize / 1_000);
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(byteSize / 1_000_000);
}

function formatUpdatedAt(value: string, locale: "en" | "vi") {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function jobTags(job: ApplicationWizardJob, locale: "en" | "vi") {
  const dueDate = job.applicationDeadline
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(job.applicationDeadline),
      )
    : null;
  const copy = applicationCopy(locale);
  return [
    job.employmentType ? jobAttributeLabel(job.employmentType, locale) : null,
    job.experienceLevel ? jobAttributeLabel(job.experienceLevel, locale) : null,
    dueDate ? copy.stepper.dueDate(dueDate) : null,
  ].filter((tag): tag is string => Boolean(tag));
}

function sourceFile(
  event: ChangeEvent<HTMLInputElement> | DragEvent<HTMLElement>,
) {
  if ("dataTransfer" in event) return event.dataTransfer.files.item(0);
  return event.currentTarget.files?.item(0) ?? null;
}

type CvMode = "PROFILE" | "UPLOAD";
type CoverMode = "FILE" | "TEXT";

export function ApplicationFiles({
  job,
  draft,
  cvs,
  selectedCvId,
  cvMode,
  coverMode,
  coverText,
   pending,
   error,
   cvStatusMessage,
   cvRetryable,
   retryCvLabel,
   onCvRetry,
  onCvModeChange,
  onCvSelectionChange,
  onCvUpload,
  onCoverModeChange,
  onCoverTextChange,
  onCoverLetterUpload,
  onCoverLetterRemove,
  onBack,
  onSaveDraft,
  onContinue,
}: {
  slug: string;
  job: ApplicationWizardJob;
  draft: ApplicationDraft;
  cvs: readonly CandidateCvSummary[];
  selectedCvId: string;
  cvMode: CvMode;
  coverMode: CoverMode;
  coverText: string;
   pending: string | null;
   error: string | null;
   cvStatusMessage?: string | null;
   cvRetryable?: boolean;
   retryCvLabel?: string;
   onCvRetry?: () => void;
  onCvModeChange: (mode: CvMode) => void;
  onCvSelectionChange: (cvId: string) => void;
  onCvUpload: (file: File) => void;
  onCoverModeChange: (mode: CoverMode) => void;
  onCoverTextChange: (value: string) => void;
  onCoverLetterUpload: (file: File) => void;
  onCoverLetterRemove: () => void;
  onBack: () => void;
  onSaveDraft: () => void;
  onContinue: () => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = applicationCopy(locale);
  const [cvDragActive, setCvDragActive] = useState(false);
  const [coverDragActive, setCoverDragActive] = useState(false);
  const cvInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const selectedCv = cvs.find((cv) => cv.id === selectedCvId) ?? null;
  const tags = jobTags(job, locale);
  const jobLocation = job.workArrangement
    ? `${job.location} · ${jobAttributeLabel(job.workArrangement, locale)}`
    : job.location;
  const canContinue = pending === null && Boolean(selectedCvId);
  const coverLetterFile =
    coverMode === "FILE" && draft.coverLetter?.kind === "FILE"
      ? draft.coverLetter.file
      : null;

  function chooseCv(file: File | null) {
    if (file) onCvUpload(file);
  }

  function chooseCoverLetter(file: File | null) {
    if (file) onCoverLetterUpload(file);
  }

  function handleCvDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setCvDragActive(false);
    chooseCv(sourceFile(event));
  }

  function handleCoverDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setCoverDragActive(false);
    chooseCoverLetter(sourceFile(event));
  }

  return (
    <main
      className="candidate-application-flow application-files"
      aria-labelledby="application-flow-title"
    >
      <ApplicationFlowHeader
        titleId="application-flow-title"
        eyebrow={copy.applicationFiles.eyebrow}
        title={copy.applicationFiles.title(job.title)}
        subtitle={copy.applicationFiles.subtitle}
        saveLabel={copy.common.saveDraft}
        savingLabel={copy.common.saving}
        pending={pending !== null}
        onSave={onSaveDraft}
      />

      <ApplicationStepper currentStep={2} />

      {error ? (
        <p className="candidate-application-error" role="alert">
          {error}
        </p>
      ) : null}
      {cvStatusMessage ? (
        <p className="candidate-application-status" role="status" aria-live="polite">
          {cvStatusMessage}
        </p>
      ) : null}
      {cvRetryable && onCvRetry ? (
        <button
          className="application-files__button application-files__button--secondary"
          type="button"
          onClick={onCvRetry}
          disabled={pending !== null}
        >
          {retryCvLabel}
        </button>
      ) : null}

      <div className="application-files__grid">
        <div className="application-files__main">
          <section
            className="application-files__card"
            aria-labelledby="cv-title"
          >
            <div className="application-files__title-row">
              <h2 id="cv-title">{copy.applicationFiles.cvTitle}</h2>
              <RequirementTag level="required">
                {copy.applicationFiles.required}
              </RequirementTag>
            </div>
            <p className="application-files__description">
              {copy.applicationFiles.cvDescription}
            </p>

            <div
              className="application-files__segmented"
              role="tablist"
              aria-label={copy.applicationFiles.cvTitle}
            >
              <button
                id="application-cv-profile-tab"
                type="button"
                role="tab"
                aria-selected={cvMode === "PROFILE"}
                aria-controls="application-cv-profile-panel"
                className={cvMode === "PROFILE" ? "is-active" : undefined}
                onClick={() => onCvModeChange("PROFILE")}
                disabled={pending !== null}
              >
                {copy.applicationFiles.fromProfile}
              </button>
              <button
                id="application-cv-upload-tab"
                type="button"
                role="tab"
                aria-selected={cvMode === "UPLOAD"}
                aria-controls="application-cv-upload-panel"
                className={cvMode === "UPLOAD" ? "is-active" : undefined}
                onClick={() => onCvModeChange("UPLOAD")}
                disabled={pending !== null}
              >
                {copy.applicationFiles.uploadFromDevice}
              </button>
            </div>

            {cvMode === "PROFILE" ? (
              <div
                id="application-cv-profile-panel"
                role="tabpanel"
                aria-labelledby="application-cv-profile-tab"
              >
                <div className="application-files__cv-list" role="radiogroup">
                  {cvs.map((cv) => {
                    const selected = cv.id === selectedCvId;
                    return (
                      <FileSelectionCard
                        key={cv.id}
                        fileName={cv.fileName}
                        selected={selected}
                        disabled={pending !== null}
                        onSelect={() => onCvSelectionChange(cv.id)}
                        meta={
                          <>
                          {/* TODO(application-files): CandidateCvSummary does not
                              expose a page count or parser lifecycle. Confirmed
                              profile CVs are the only currently selectable
                              records, so this copy intentionally reports
                              application readiness rather than inventing a
                              parser result. */}
                            {copy.applicationFiles.profileCvMeta(
                              formatFileSize(cv.byteSize, locale),
                              formatUpdatedAt(cv.confirmedAt, locale),
                            )}
                            <em>{copy.applicationFiles.cvReady}</em>
                          </>
                        }
                      />
                    );
                  })}
                </div>
                {!cvs.length ? (
                  <p className="application-files__empty">
                    {copy.applicationFiles.noProfileCvs}
                  </p>
                ) : null}
                <Link
                  className="application-files__manage-link"
                  href="/profile/cv-imports"
                >
                  {copy.applicationFiles.manageCvs}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <div
                id="application-cv-upload-panel"
                role="tabpanel"
                aria-labelledby="application-cv-upload-tab"
              >
                {pending === "cv" ? (
                  <div className="application-files__file-row" role="status">
                    <span className="application-files__file-icon">
                      <FileText aria-hidden="true" />
                    </span>
                    <span className="application-files__file-copy">
                      <strong>{copy.applicationFiles.uploadingCv}</strong>
                    </span>
                  </div>
                ) : selectedCv ? (
                  <div className="application-files__file-row">
                    <span className="application-files__file-icon">
                      <FileText aria-hidden="true" />
                    </span>
                    <span className="application-files__file-copy">
                      <strong>{selectedCv.fileName}</strong>
                      <small>
                        {copy.applicationFiles.uploadedCvMeta(
                          formatFileSize(selectedCv.byteSize, locale),
                        )}
                      </small>
                    </span>
                  </div>
                ) : (
                  <div
                    className={`application-files__dropzone${cvDragActive ? "is-dragging" : ""}`}
                    role="button"
                    tabIndex={pending === null ? 0 : -1}
                    onClick={() => cvInput.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        cvInput.current?.click();
                      }
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setCvDragActive(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setCvDragActive(false)}
                    onDrop={handleCvDrop}
                    aria-label={copy.applicationFiles.uploadDropTitle}
                  >
                    <span className="application-files__dropzone-icon">
                      <Upload aria-hidden="true" />
                    </span>
                    <strong>{copy.applicationFiles.uploadDropTitle}</strong>
                    <small>{copy.applicationFiles.uploadDropHint}</small>
                    <input
                      ref={cvInput}
                      type="file"
                      tabIndex={-1}
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(event) => {
                        chooseCv(sourceFile(event));
                        event.currentTarget.value = "";
                      }}
                      disabled={pending !== null}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="application-files__callout" role="note">
              <span className="application-files__callout-icon">
                <AlertTriangle aria-hidden="true" />
              </span>
              <p>
                <strong>{copy.applicationFiles.cvParsingNoteTitle}</strong>
                <span>{copy.applicationFiles.cvParsingNote}</span>
              </p>
            </div>
          </section>

          <section
            className="application-files__card"
            aria-labelledby="cover-letter-title"
          >
            <div className="application-files__title-row">
              <h2 id="cover-letter-title">
                {copy.applicationFiles.coverLetterTitle}
              </h2>
              <RequirementTag level="optional">
                {copy.applicationFiles.optional}
              </RequirementTag>
            </div>
            <p className="application-files__description">
              {copy.applicationFiles.coverLetterDescription}
            </p>

            <div
              className="application-files__segmented"
              role="tablist"
              aria-label={copy.applicationFiles.coverLetterTitle}
            >
              <button
                id="application-cover-file-tab"
                type="button"
                role="tab"
                aria-selected={coverMode === "FILE"}
                aria-controls="application-cover-file-panel"
                className={coverMode === "FILE" ? "is-active" : undefined}
                onClick={() => onCoverModeChange("FILE")}
                disabled={pending !== null}
              >
                {copy.applicationFiles.attachFile}
              </button>
              <button
                id="application-cover-text-tab"
                type="button"
                role="tab"
                aria-selected={coverMode === "TEXT"}
                aria-controls="application-cover-text-panel"
                className={coverMode === "TEXT" ? "is-active" : undefined}
                onClick={() => onCoverModeChange("TEXT")}
                disabled={pending !== null}
              >
                {copy.applicationFiles.writeText}
              </button>
            </div>

            {coverMode === "FILE" ? (
              <div
                id="application-cover-file-panel"
                role="tabpanel"
                aria-labelledby="application-cover-file-tab"
              >
                {coverLetterFile ? (
                  <div className="application-files__file-row">
                    <span className="application-files__file-icon">
                      <FileText aria-hidden="true" />
                    </span>
                    <span className="application-files__file-copy">
                      <strong>
                        {coverLetterFile.fileName ??
                          coverLetterFile.displayName}
                      </strong>
                      <small>
                        {formatFileSize(coverLetterFile.byteSize, locale)}
                        <em>{copy.applicationFiles.noParsingRequired}</em>
                      </small>
                    </span>
                    <span className="application-files__file-actions">
                      <button
                        type="button"
                        onClick={() => coverInput.current?.click()}
                        disabled={pending !== null}
                      >
                        {copy.applicationFiles.change}
                      </button>
                      <button
                        type="button"
                        onClick={onCoverLetterRemove}
                        disabled={pending !== null}
                      >
                        <X aria-hidden="true" />
                        {copy.applicationFiles.remove}
                      </button>
                    </span>
                  </div>
                ) : (
                  <div
                    className={`application-files__dropzone application-files__dropzone--compact${coverDragActive ? "is-dragging" : ""}`}
                    role="button"
                    tabIndex={pending === null ? 0 : -1}
                    onClick={() => coverInput.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        coverInput.current?.click();
                      }
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setCoverDragActive(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setCoverDragActive(false)}
                    onDrop={handleCoverDrop}
                    aria-label={copy.applicationFiles.coverLetterDropTitle}
                  >
                    <span className="application-files__dropzone-icon">
                      <Upload aria-hidden="true" />
                    </span>
                    <strong>
                      {copy.applicationFiles.coverLetterDropTitle}
                    </strong>
                    <small>{copy.applicationFiles.coverLetterDropHint}</small>
                  </div>
                )}
                <input
                  ref={coverInput}
                  className="application-files__visually-hidden"
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => {
                    chooseCoverLetter(sourceFile(event));
                    event.currentTarget.value = "";
                  }}
                  disabled={pending !== null}
                />
              </div>
            ) : (
              <div
                id="application-cover-text-panel"
                role="tabpanel"
                aria-labelledby="application-cover-text-tab"
              >
                <label
                  className="application-files__visually-hidden"
                  htmlFor="application-cover-letter-text"
                >
                  {copy.applicationFiles.coverLetterTitle}
                </label>
                <textarea
                  id="application-cover-letter-text"
                  className="application-files__textarea"
                  value={coverText}
                  maxLength={MAX_COVER_LETTER_CHARACTERS}
                  rows={7}
                  onChange={(event) =>
                    onCoverTextChange(
                      event.target.value.slice(0, MAX_COVER_LETTER_CHARACTERS),
                    )
                  }
                  placeholder={copy.applicationFiles.coverLetterPlaceholder}
                  disabled={pending !== null}
                />
                <p
                  className="application-files__character-count"
                  aria-live="polite"
                >
                  {copy.applicationFiles.characters(
                    coverText.length,
                    MAX_COVER_LETTER_CHARACTERS,
                  )}
                </p>
              </div>
            )}
          </section>

          <footer className="application-files__actions">
            <button
              type="button"
              className="application-files__button application-files__button--secondary"
              onClick={onBack}
              disabled={pending !== null}
            >
              <ArrowLeft aria-hidden="true" />
              {copy.applicationFiles.backToPersonalInformation}
            </button>
            <button
              type="button"
              className="application-files__button application-files__button--primary"
              onClick={onContinue}
              disabled={!canContinue}
            >
              {pending === "review"
                ? copy.common.saving
                : copy.applicationFiles.continueToReview}
              <ArrowRight aria-hidden="true" />
            </button>
          </footer>
        </div>

        <aside className="application-files__sidebar">
          <section className="application-files__card application-files__job-card">
            <span className="application-files__job-icon">
              <BriefcaseBusiness aria-hidden="true" />
            </span>
            <h2>{copy.applicationFiles.jobSummary}</h2>
            <strong>{job.title}</strong>
            <p>{job.companyName}</p>
            <small>{jobLocation}</small>
            {tags.length ? (
              <div className="application-files__tags">
                {tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="application-files__card">
            <h2>{copy.applicationFiles.applicationProgress}</h2>
            <ApplicationProgressChecklist
              currentStep={2}
              className="application-files__checklist"
            />
          </section>

          <section className="application-files__card application-files__info-card">
            <div className="application-files__info-heading">
              <Info aria-hidden="true" />
              <h2>{copy.applicationFiles.fileRequirements}</h2>
            </div>
            <ul>
              <li>{copy.applicationFiles.fileRequirementFormat}</li>
              <li>{copy.applicationFiles.fileRequirementSize}</li>
              <li>{copy.applicationFiles.fileRequirementText}</li>
              <li>{copy.applicationFiles.fileRequirementReplace}</li>
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
