"use client";

import { useLayoutEffect, useRef } from "react";

import type { CvReviewConflict } from "../client/use-cv-draft-review";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";
import { cvCopy, cvFormatDate, cvKnownError } from "../i18n/cv-import-copy";
import styles from "./cv-review-conflict.module.css";

export function CvReviewConflictPanel({
  conflict,
  unsavedSummary,
  unsavedPreview,
  latestCompared,
  pending,
  onCompareLatest,
  onReapplyLatest,
  onDiscardAndReload,
}: {
  conflict: CvReviewConflict;
  unsavedSummary: string;
  unsavedPreview: readonly { id: string; label: string; value: string }[];
  latestCompared: boolean;
  pending: boolean;
  onCompareLatest: () => void;
  onReapplyLatest: () => void;
  onDiscardAndReload: () => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = cvCopy(locale).review;
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => heading.current?.focus(), []);
  return (
    <section
      className={styles.root}
      aria-labelledby="cv-conflict-heading"
      aria-live="assertive"
    >
      <h2 id="cv-conflict-heading" ref={heading} tabIndex={-1}>
        {copy.conflict}
      </h2>
      <p role="alert">
        {cvKnownError(locale, conflict.message, conflict.code)}
      </p>
      <p>
        {unsavedSummary}{" "}
        {locale === "vi"
          ? "Các chỉnh sửa trong bộ nhớ của bạn chưa bị ghi đè."
          : "Your in-memory edits have not been overwritten."}
      </p>
      {unsavedPreview.length ? (
        <section
          className={styles.preview}
          aria-labelledby="cv-unsaved-preview-heading"
        >
          <h3 id="cv-unsaved-preview-heading">{copy.unsavedKept}</h3>
          <dl>
            {unsavedPreview.map((item) => (
              <div key={item.id}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {conflict.latest ? (
        <div className={styles.metadata}>
          <p>
            {locale === "vi"
              ? "Bản nháp đã lưu mới nhất"
              : "Latest saved draft revision"}{" "}
            {conflict.latest.draftRevision};{" "}
            {locale === "vi" ? "phiên bản hồ sơ" : "Profile revision"}{" "}
            {conflict.latest.profileRevision}.
          </p>
          {conflict.latest.draftUpdatedAt ? (
            <p>
              {locale === "vi" ? "Bản nháp cập nhật" : "Draft updated"}{" "}
              <time dateTime={conflict.latest.draftUpdatedAt}>
                {cvFormatDate(locale, conflict.latest.draftUpdatedAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              .
            </p>
          ) : null}
          {conflict.latest.profileUpdatedAt ? (
            <p>
              {locale === "vi" ? "Hồ sơ cập nhật" : "Profile updated"}{" "}
              <time dateTime={conflict.latest.profileUpdatedAt}>
                {cvFormatDate(locale, conflict.latest.profileUpdatedAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              .
            </p>
          ) : null}
        </div>
      ) : null}
      <div className={styles.actions}>
        <button type="button" disabled={pending} onClick={onCompareLatest}>
          {copy.compare}
        </button>
        <button
          type="button"
          disabled={pending || !latestCompared}
          onClick={onReapplyLatest}
        >
          {copy.reapply}
        </button>
        <button type="button" disabled={pending} onClick={onDiscardAndReload}>
          {copy.discard}
        </button>
      </div>
    </section>
  );
}
