"use client";

import type {
  CvDraftComparison,
  CvEditableProposals,
  CvReviewDecisions,
} from "@/shared/contracts/cv-import/review";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";
import { cvActionLabel, cvCopy, cvFieldLabel } from "../i18n/cv-import-copy";
import { CvEvidence } from "./cv-evidence";
import styles from "./cv-collection-review.module.css";

type CollectionGroup = "experiences" | "education" | "skills" | "socialLinks";
type EntryAction = "ADD" | "REPLACE" | "SKIP";

function reviewFieldProps(path: string, error: string | undefined, id: string) {
  return {
    id,
    "data-cv-review-field": path,
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${id}-error` : undefined,
  };
}

function ReviewFieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <span className={styles.fieldError} id={`${id}-error`}>
      {error}
    </span>
  ) : null;
}

function DecisionControls({
  proposalId,
  label,
  action,
  targetId,
  targets,
  fieldPath,
  fieldError,
  allowReplace = true,
  onChange,
}: {
  proposalId: string;
  label: string;
  action: EntryAction;
  targetId?: string | null;
  targets: readonly { id: string; label: string }[];
  fieldPath?: string;
  fieldError?: string;
  allowReplace?: boolean;
  onChange: (action: EntryAction, targetId: string | null) => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = cvCopy(locale).review;
  const replaceAvailable = allowReplace && targets.length > 0;
  const replaceUnavailable = allowReplace && !replaceAvailable;
  return (
    <fieldset className={styles.choices}>
      <legend className={styles.srOnly}>
        {copy.decisionFor} {label}
      </legend>
      <p className={styles.decisionTitle} aria-hidden="true">
        {copy.decisionFor} {label}
      </p>
      <div className={styles.actionOptions}>
        {(
          [
            "ADD",
            ...(replaceAvailable ? (["REPLACE"] as const) : []),
            "SKIP",
          ] as const
        ).map((candidate) => (
          <label key={candidate}>
            <input
              type="radio"
              name={`decision-${proposalId}`}
              checked={action === candidate}
              onChange={() =>
                onChange(
                  candidate,
                  candidate === "REPLACE"
                    ? (targetId ?? targets[0]?.id ?? null)
                    : null,
                )
              }
            />
            {cvActionLabel(locale, candidate)}
          </label>
        ))}
      </div>
      {replaceUnavailable ? (
        <p className={styles.replacementUnavailable} role="note">
          {copy.replacementUnavailable}
        </p>
      ) : null}
      {action === "REPLACE" ? (
        <label className={styles.target}>
          {copy.replaceCurrent}
          <select
            {...(fieldPath
              ? reviewFieldProps(
                  fieldPath,
                  fieldError,
                  `cv-decision-${proposalId}`,
                )
              : {})}
            value={targetId ?? ""}
            required
            onChange={(event) =>
              onChange("REPLACE", event.target.value || null)
            }
          >
            <option value="">{copy.chooseOwned}</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
          <ReviewFieldError
            id={`cv-decision-${proposalId}`}
            error={fieldError}
          />
        </label>
      ) : null}
    </fieldset>
  );
}

export function CvCollectionReview({
  currentProfile,
  proposals,
  decisions,
  fieldErrors,
  onValueChange,
  onDecisionChange,
  onSetGroupAction,
}: {
  currentProfile: CvDraftComparison["currentProfile"];
  proposals: CvEditableProposals;
  decisions: CvReviewDecisions;
  fieldErrors: Readonly<Record<string, string>>;
  onValueChange: (
    group: CollectionGroup,
    proposalId: string,
    field: string,
    value: string | boolean | null,
  ) => void;
  onDecisionChange: (
    group: CollectionGroup,
    proposalId: string,
    action: EntryAction,
    targetId: string | null,
  ) => void;
  onSetGroupAction: (group: CollectionGroup, action: "ADD" | "SKIP") => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = cvCopy(locale).review;
  const entryDecision = (group: CollectionGroup, proposalId: string) => {
    const values = decisions[group] as readonly {
      proposalId: string;
      action: EntryAction;
      targetId?: string | null;
    }[];
    return (
      values.find((value) => value.proposalId === proposalId) ?? {
        proposalId,
        action: "SKIP" as const,
        targetId: null,
      }
    );
  };
  const groupControls = (group: CollectionGroup, label: string) => (
    <div
      className={styles.groupControls}
      aria-label={`${label} ${locale === "vi" ? "thao tác hàng loạt" : "bulk controls"}`}
    >
      <button type="button" onClick={() => onSetGroupAction(group, "ADD")}>
        {copy.addAll} {label}
      </button>
      <button type="button" onClick={() => onSetGroupAction(group, "SKIP")}>
        {copy.skipAll} {label}
      </button>
    </div>
  );
  return (
    <section className={styles.root} aria-labelledby="cv-collections-heading">
      <h2 id="cv-collections-heading">{copy.collections}</h2>

      <section className={styles.group} aria-labelledby="cv-experience-heading">
        <h3 id="cv-experience-heading">{copy.experience}</h3>
        {groupControls("experiences", copy.experienceGroup)}
        {proposals.experiences.map((proposal, index) => {
          const decision = entryDecision("experiences", proposal.proposalId);
          const decisionIndex = decisions.experiences.findIndex(
            (item) => item.proposalId === proposal.proposalId,
          );
          const fieldPath = (field: string) =>
            `proposals.experiences.${index}.value.${field}`;
          const fieldId = (field: string) =>
            `cv-experience-${proposal.proposalId}-${field}`;
          const fieldError = (field: string) => fieldErrors[fieldPath(field)];
          return (
            <article className={styles.card} key={proposal.proposalId}>
              <div className={styles.fields}>
                <label>
                  {cvFieldLabel(locale, "title")}
                  <input
                    {...reviewFieldProps(
                      fieldPath("title"),
                      fieldError("title"),
                      fieldId("title"),
                    )}
                    value={proposal.value.title}
                    maxLength={200}
                    onChange={(event) =>
                      onValueChange(
                        "experiences",
                        proposal.proposalId,
                        "title",
                        event.target.value,
                      )
                    }
                  />
                  <ReviewFieldError
                    id={fieldId("title")}
                    error={fieldError("title")}
                  />
                </label>
                <label>
                  {cvFieldLabel(locale, "company")}
                  <input
                    {...reviewFieldProps(
                      fieldPath("company"),
                      fieldError("company"),
                      fieldId("company"),
                    )}
                    value={proposal.value.company}
                    maxLength={200}
                    onChange={(event) =>
                      onValueChange(
                        "experiences",
                        proposal.proposalId,
                        "company",
                        event.target.value,
                      )
                    }
                  />
                  <ReviewFieldError
                    id={fieldId("company")}
                    error={fieldError("company")}
                  />
                </label>
                <label>
                  {cvFieldLabel(locale, "startDate")}
                  <input
                    {...reviewFieldProps(
                      fieldPath("startDate"),
                      fieldError("startDate"),
                      fieldId("startDate"),
                    )}
                    type="date"
                    value={proposal.value.startDate}
                    onChange={(event) =>
                      onValueChange(
                        "experiences",
                        proposal.proposalId,
                        "startDate",
                        event.target.value,
                      )
                    }
                  />
                  <ReviewFieldError
                    id={fieldId("startDate")}
                    error={fieldError("startDate")}
                  />
                </label>
                <label>
                  {cvFieldLabel(locale, "endDate")}
                  <input
                    {...reviewFieldProps(
                      fieldPath("endDate"),
                      fieldError("endDate"),
                      fieldId("endDate"),
                    )}
                    type="date"
                    disabled={proposal.value.isCurrent}
                    value={proposal.value.endDate ?? ""}
                    onChange={(event) =>
                      onValueChange(
                        "experiences",
                        proposal.proposalId,
                        "endDate",
                        event.target.value || null,
                      )
                    }
                  />
                  <ReviewFieldError
                    id={fieldId("endDate")}
                    error={fieldError("endDate")}
                  />
                </label>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={proposal.value.isCurrent}
                    onChange={(event) =>
                      onValueChange(
                        "experiences",
                        proposal.proposalId,
                        "isCurrent",
                        event.target.checked,
                      )
                    }
                  />
                  {copy.currentRole}
                </label>
                <label className={styles.fullWidth}>
                  {cvFieldLabel(locale, "description")}
                  <textarea
                    {...reviewFieldProps(
                      fieldPath("description"),
                      fieldError("description"),
                      fieldId("description"),
                    )}
                    value={proposal.value.description ?? ""}
                    maxLength={3_000}
                    onChange={(event) =>
                      onValueChange(
                        "experiences",
                        proposal.proposalId,
                        "description",
                        event.target.value || null,
                      )
                    }
                  />
                  <ReviewFieldError
                    id={fieldId("description")}
                    error={fieldError("description")}
                  />
                </label>
              </div>
              <DecisionControls
                proposalId={proposal.proposalId}
                label={`${proposal.value.title} at ${proposal.value.company}`}
                action={decision.action}
                targetId={decision.targetId}
                targets={currentProfile.experiences.map((entry) => ({
                  id: entry.id,
                  label: `${entry.title} at ${entry.company}`,
                }))}
                fieldPath={
                  decisionIndex >= 0
                    ? `reviewDecisions.experiences.${decisionIndex}.targetId`
                    : undefined
                }
                fieldError={
                  decisionIndex >= 0
                    ? fieldErrors[
                        `reviewDecisions.experiences.${decisionIndex}.targetId`
                      ]
                    : undefined
                }
                onChange={(action, targetId) =>
                  onDecisionChange(
                    "experiences",
                    proposal.proposalId,
                    action,
                    targetId,
                  )
                }
              />
              <CvEvidence evidence={proposal.evidence} />
            </article>
          );
        })}
      </section>

      <section className={styles.group} aria-labelledby="cv-education-heading">
        <h3 id="cv-education-heading">{copy.education}</h3>
        {groupControls("education", copy.educationGroup)}
        {proposals.education.map((proposal, index) => {
          const decision = entryDecision("education", proposal.proposalId);
          const decisionIndex = decisions.education.findIndex(
            (item) => item.proposalId === proposal.proposalId,
          );
          const fieldPath = (field: string) =>
            `proposals.education.${index}.value.${field}`;
          const fieldId = (field: string) =>
            `cv-education-${proposal.proposalId}-${field}`;
          const fieldError = (field: string) => fieldErrors[fieldPath(field)];
          return (
            <article className={styles.card} key={proposal.proposalId}>
              <div className={styles.fields}>
                {(["institution", "degree", "field"] as const).map((field) => {
                  const path = fieldPath(field);
                  const id = fieldId(field);
                  const error = fieldError(field);
                  return (
                    <label key={field}>
                      {cvFieldLabel(locale, field)}
                      <input
                        {...reviewFieldProps(path, error, id)}
                        value={proposal.value[field] ?? ""}
                        maxLength={200}
                        onChange={(event) =>
                          onValueChange(
                            "education",
                            proposal.proposalId,
                            field,
                            event.target.value ||
                              (field === "field" ? null : ""),
                          )
                        }
                      />
                      <ReviewFieldError id={id} error={error} />
                    </label>
                  );
                })}
                <label>
                  {cvFieldLabel(locale, "startDate")}
                  <input
                    {...reviewFieldProps(
                      fieldPath("startDate"),
                      fieldError("startDate"),
                      fieldId("startDate"),
                    )}
                    type="date"
                    value={proposal.value.startDate}
                    onChange={(event) =>
                      onValueChange(
                        "education",
                        proposal.proposalId,
                        "startDate",
                        event.target.value,
                      )
                    }
                  />
                  <ReviewFieldError
                    id={fieldId("startDate")}
                    error={fieldError("startDate")}
                  />
                </label>
                <label>
                  {cvFieldLabel(locale, "endDate")}
                  <input
                    {...reviewFieldProps(
                      fieldPath("endDate"),
                      fieldError("endDate"),
                      fieldId("endDate"),
                    )}
                    type="date"
                    disabled={proposal.value.isCurrent}
                    value={proposal.value.endDate ?? ""}
                    onChange={(event) =>
                      onValueChange(
                        "education",
                        proposal.proposalId,
                        "endDate",
                        event.target.value || null,
                      )
                    }
                  />
                  <ReviewFieldError
                    id={fieldId("endDate")}
                    error={fieldError("endDate")}
                  />
                </label>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={proposal.value.isCurrent}
                    onChange={(event) =>
                      onValueChange(
                        "education",
                        proposal.proposalId,
                        "isCurrent",
                        event.target.checked,
                      )
                    }
                  />
                  {copy.currentStudy}
                </label>
              </div>
              <DecisionControls
                proposalId={proposal.proposalId}
                label={`${proposal.value.degree} at ${proposal.value.institution}`}
                action={decision.action}
                targetId={decision.targetId}
                targets={currentProfile.education.map((entry) => ({
                  id: entry.id,
                  label: `${entry.degree} at ${entry.institution}`,
                }))}
                fieldPath={
                  decisionIndex >= 0
                    ? `reviewDecisions.education.${decisionIndex}.targetId`
                    : undefined
                }
                fieldError={
                  decisionIndex >= 0
                    ? fieldErrors[
                        `reviewDecisions.education.${decisionIndex}.targetId`
                      ]
                    : undefined
                }
                onChange={(action, targetId) =>
                  onDecisionChange(
                    "education",
                    proposal.proposalId,
                    action,
                    targetId,
                  )
                }
              />
              <CvEvidence evidence={proposal.evidence} />
            </article>
          );
        })}
      </section>

      <section className={styles.group} aria-labelledby="cv-skills-heading">
        <h3 id="cv-skills-heading">{copy.skills}</h3>
        {groupControls("skills", copy.skillsGroup)}
        {proposals.skills.map((proposal, index) => {
          const decision = entryDecision("skills", proposal.proposalId);
          const fieldPath = `proposals.skills.${index}.value`;
          const fieldId = `cv-skill-${proposal.proposalId}`;
          const fieldError = fieldErrors[fieldPath];
          return (
            <article className={styles.card} key={proposal.proposalId}>
              <label>
                {locale === "vi" ? "Kỹ năng đề xuất" : "Proposed skill"}
                <input
                  {...reviewFieldProps(fieldPath, fieldError, fieldId)}
                  value={proposal.value}
                  maxLength={80}
                  onChange={(event) =>
                    onValueChange(
                      "skills",
                      proposal.proposalId,
                      "value",
                      event.target.value,
                    )
                  }
                />
                <ReviewFieldError id={fieldId} error={fieldError} />
              </label>
              {proposal.duplicate ? (
                <p role="note">{copy.matchingSkill}</p>
              ) : null}
              <DecisionControls
                proposalId={proposal.proposalId}
                label={proposal.value}
                action={decision.action}
                targets={[]}
                allowReplace={false}
                onChange={(action) =>
                  onDecisionChange("skills", proposal.proposalId, action, null)
                }
              />
              <CvEvidence evidence={proposal.evidence} />
            </article>
          );
        })}
      </section>

      <section className={styles.group} aria-labelledby="cv-links-heading">
        <h3 id="cv-links-heading">{copy.socialLinks}</h3>
        {groupControls("socialLinks", copy.links)}
        {proposals.socialLinks.map((proposal, index) => {
          const decision = entryDecision("socialLinks", proposal.proposalId);
          const decisionIndex = decisions.socialLinks.findIndex(
            (item) => item.proposalId === proposal.proposalId,
          );
          const fieldPath = `proposals.socialLinks.${index}.value`;
          const fieldId = `cv-social-link-${proposal.proposalId}`;
          const fieldError = fieldErrors[fieldPath];
          return (
            <article className={styles.card} key={proposal.proposalId}>
              <label>
                {locale === "vi" ? "URL đề xuất" : "Proposed URL"}
                <input
                  {...reviewFieldProps(fieldPath, fieldError, fieldId)}
                  type="url"
                  value={proposal.value}
                  maxLength={2_048}
                  onChange={(event) =>
                    onValueChange(
                      "socialLinks",
                      proposal.proposalId,
                      "value",
                      event.target.value,
                    )
                  }
                />
                <ReviewFieldError id={fieldId} error={fieldError} />
              </label>
              <DecisionControls
                proposalId={proposal.proposalId}
                label={proposal.value}
                action={decision.action}
                targetId={decision.targetId}
                targets={currentProfile.socialLinks.map((entry) => ({
                  id: entry.id,
                  label: entry.url,
                }))}
                fieldPath={
                  decisionIndex >= 0
                    ? `reviewDecisions.socialLinks.${decisionIndex}.targetId`
                    : undefined
                }
                fieldError={
                  decisionIndex >= 0
                    ? fieldErrors[
                        `reviewDecisions.socialLinks.${decisionIndex}.targetId`
                      ]
                    : undefined
                }
                onChange={(action, targetId) =>
                  onDecisionChange(
                    "socialLinks",
                    proposal.proposalId,
                    action,
                    targetId,
                  )
                }
              />
              <CvEvidence evidence={proposal.evidence} />
            </article>
          );
        })}
      </section>
    </section>
  );
}
