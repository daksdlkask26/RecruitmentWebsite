"use client";

import { useState } from "react";
import { ListOrdered, ShieldCheck, Trash2 } from "lucide-react";
import type { RankedApplicationRow } from "@/shared/contracts/scoring";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { mutateWithCurrentCsrf } from "@/frontend/features/authentication/client/current-csrf-proof";
import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import { RankingModalFrame } from "./ranking-modal-frame";
import { applicationDetailCopy } from "./application-detail-copy";

let idempotencySequence = 0;

function createIdempotencyKey(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  idempotencySequence += 1;
  return `${prefix}-${idempotencySequence}`;
}

export function ManualPriorityModal({
  candidate,
  suggestedRank,
  onCancel,
  onCompleted,
}: {
  candidate: RankedApplicationRow;
  suggestedRank?: number;
  onCancel: () => void;
  onCompleted: () => void;
}) {
  const copy = applicationDetailCopy(useWorkspaceLocale()).priority;
  const csrfProof = useCsrfProof();
  const [value, setValue] = useState<"HIGH" | "NORMAL" | "LOW" | "HOLD" | "">(
    candidate.manualPriority?.value ?? "",
  );
  const [reason, setReason] = useState(candidate.manualPriority?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!value || !reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await mutateWithCurrentCsrf(
        "/api/recruiter/applications/" +
          encodeURIComponent(candidate.applicationId) +
          "/priority",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": createIdempotencyKey("priority"),
          },
          body: JSON.stringify({
            confirmed: true,
            value,
            reason: reason.trim(),
            expectedVersion: candidate.manualPriority?.version ?? 0,
          }),
        },
        csrfProof,
      );
      if (!response.ok) throw new Error(copy.saveError);
      onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.saveError);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!candidate.manualPriority) return;
    setSaving(true);
    setError(null);
    try {
      const response = await mutateWithCurrentCsrf(
        "/api/recruiter/applications/" +
          encodeURIComponent(candidate.applicationId) +
          "/priority",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": createIdempotencyKey("priority-remove"),
          },
          body: JSON.stringify({
            action: "remove",
            confirmed: true,
            reason: "Recruiter removed manual priority.",
            expectedVersion: candidate.manualPriority.version,
          }),
        },
        csrfProof,
      );
      if (!response.ok) throw new Error(copy.removeError);
      onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.removeError);
    } finally {
      setSaving(false);
    }
  };
  return (
    <RankingModalFrame
      title={copy.title}
      subtitle={copy.subtitle(candidate.candidate.displayName)}
      icon="≡"
      info={
        <>
          <ShieldCheck aria-hidden="true" /> <span>{copy.info}</span>
        </>
      }
      confirmLabel={saving ? copy.saving : copy.save}
      cancelLabel={copy.cancel}
      onCancel={onCancel}
      onConfirm={() => void save()}
      confirmDisabled={!value || !reason.trim() || saving}
    >
      <div className="ai-ranking-reference-block">
        <span>
          <ListOrdered aria-hidden="true" /> {copy.reference}
        </span>
        <strong>
          {suggestedRank ? `#${suggestedRank} · ` : ""}
          {candidate.scoreSummary.final === null
            ? copy.notCalculated
            : copy.finalScore(candidate.scoreSummary.final)}
        </strong>
        <small>
          {copy.aiScore}{" "}
          {candidate.scoreSummary.ai === null
            ? copy.notCalculated
            : `${candidate.scoreSummary.ai}/100`}
        </small>
      </div>
      <label className="ai-ranking-field">
        <span>
          {copy.manual} <em>{copy.required}</em>
        </span>
        <select
          value={value}
          onChange={(event) => setValue(event.target.value as typeof value)}
        >
          <option value="">{copy.select}</option>
          {(
            Object.entries(copy.options) as Array<
              ["HIGH" | "NORMAL" | "LOW" | "HOLD", string]
            >
          ).map(([option, label]) => (
            <option key={option} value={option}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="ai-ranking-field">
        <span>
          {copy.reason} <em>{copy.required}</em>
        </span>
        <textarea
          value={reason}
          maxLength={1_000}
          onChange={(event) => setReason(event.target.value)}
          placeholder={copy.placeholder}
          rows={4}
        />
      </label>
      {candidate.manualPriority ? (
        <button
          type="button"
          className="ai-ranking-text-button ai-ranking-text-button--danger"
          onClick={() => void remove()}
          disabled={saving}
        >
          <Trash2 aria-hidden="true" /> {copy.remove}
        </button>
      ) : null}
      {error ? (
        <p className="ai-ranking-error" role="alert">
          {error}
        </p>
      ) : null}
    </RankingModalFrame>
  );
}
