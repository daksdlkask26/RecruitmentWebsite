"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { RankingModalFrame } from "./ranking-modal-frame";
import { applicationDetailCopy } from "./application-detail-copy";

let idempotencySequence = 0;

function createIdempotencyKey(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  idempotencySequence += 1;
  return `${prefix}-${idempotencySequence}`;
}

export function RescoreConfirmModal({
  jobId,
  jobTitle,
  totalCount,
  onCancel,
  onCompleted,
}: {
  jobId: string;
  jobTitle: string;
  totalCount: number;
  onCancel: () => void;
  onCompleted: () => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = applicationDetailCopy(locale).rescore;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const start = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/recruiter/jobs/" + encodeURIComponent(jobId) + "/scoring/rescore",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": createIdempotencyKey("rescore"),
          },
          body: JSON.stringify({
            confirmed: true,
            jdVersion: "JD-v3",
            scoringConfigVersion: "HS-40/60-v1",
          }),
        },
      );
      if (!response.ok) throw new Error(copy.error);
      onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <RankingModalFrame
      title={copy.title}
      subtitle={copy.subtitle(jobTitle)}
      icon="↻"
      info={<>{copy.currentVisible}</>}
      confirmLabel={saving ? copy.starting : copy.start}
      cancelLabel={copy.cancel}
      onCancel={onCancel}
      onConfirm={() => void start()}
      confirmDisabled={saving}
    >
      <p className="ai-ranking-modal__lead">
        {copy.lead(
          `${totalCount.toLocaleString(locale === "vi" ? "vi-VN" : "en-US")} ${
            locale === "vi" ? "đơn ứng tuyển" : "applications"
          }`,
        )}
      </p>
      <dl className="ai-ranking-modal__facts">
        <div>
          <dt>
            <span>
              <CheckCircle2 aria-hidden="true" /> {copy.jobDescription}
            </span>
          </dt>
          <dd>JD v3</dd>
        </div>
        <div>
          <dt>
            <ShieldCheck aria-hidden="true" />
            <span>{copy.scoringConfig}</span>
          </dt>
          <dd>HS-40/60-v1</dd>
        </div>
        <div>
          <dt>
            <Clock3 aria-hidden="true" />
            <span>{copy.executionMode}</span>
          </dt>
          <dd>{copy.backgroundJob}</dd>
        </div>
      </dl>
      <div className="rescore-modal-notes">
        <span>
          <RefreshCw aria-hidden="true" /> {copy.existingVisible}
        </span>
        <span>
          <AlertCircle aria-hidden="true" /> {copy.aiFailureSafe}
        </span>
      </div>
      {error ? (
        <p className="ai-ranking-error" role="alert">
          {error}
        </p>
      ) : null}
    </RankingModalFrame>
  );
}
