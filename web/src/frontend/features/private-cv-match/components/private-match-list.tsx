"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  FileText,
  LockKeyhole,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { PrivateMatchListItem } from "@/shared/contracts/private-cv-match";
import { PageHeader } from "@/frontend/components/layout/page-header";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import {
  privateMatchErrorMessage,
  usePrivateCvMatchList,
} from "../client/use-private-cv-match";
import {
  privateMatchCopy,
  type PrivateMatchLocale,
} from "../i18n/private-match-copy";
import { PrivateMatchDeleteControl } from "./private-match-delete-control";

function formatDate(value: string, locale: PrivateMatchLocale) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function daysUntil(value: string) {
  return Math.max(
    0,
    Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000),
  );
}

function statusCopy(
  state: PrivateMatchListItem["state"],
  locale: PrivateMatchLocale,
) {
  const states = privateMatchCopy(locale).list.states;
  switch (state) {
    case "READY":
      return { label: states.READY, className: "private-match-badge--success" };
    case "LIMITED":
      return {
        label: states.LIMITED,
        className: "private-match-badge--yellow",
      };
    case "FAILED":
      return { label: states.FAILED, className: "private-match-badge--error" };
    case "ANALYZING":
      return {
        label: states.ANALYZING,
        className: "private-match-badge--blue",
      };
    default:
      return { label: states.QUEUED, className: "private-match-badge--blue" };
  }
}

function ListSkeleton() {
  const copy = privateMatchCopy(useWorkspaceLocale()).list;
  return (
    <div className="private-match-list" aria-busy="true" aria-live="polite">
      {[1, 2, 3].map((item) => (
        <div
          className="private-match-list-row private-match-list-row--skeleton"
          key={item}
        >
          <span />
          <div>
            <span />
            <span />
          </div>
          <span />
        </div>
      ))}
      <span className="private-match-visually-hidden">{copy.loading}</span>
    </div>
  );
}

function ListItem({
  item,
  onDeleted,
}: {
  item: PrivateMatchListItem;
  onDeleted: () => void;
}) {
  const locale = useWorkspaceLocale();
  const copy = privateMatchCopy(locale).list;
  const status = statusCopy(item.state, locale);
  return (
    <article className="private-match-list-row">
      <span className="private-match-list-icon" aria-hidden="true">
        <BriefcaseBusiness />
      </span>
      <div className="private-match-list-main">
        <div className="private-match-list-title">
          <Link href={`/cv-match-check/${encodeURIComponent(item.checkId)}`}>
            {item.job.title}
          </Link>
          <span className={`private-match-badge ${status.className}`}>
            <i aria-hidden="true" />
            {status.label}
          </span>
        </div>
        <div className="private-match-list-job-meta">
          <span>{item.job.company}</span>
          <span aria-hidden="true">·</span>
          <span>
            <MapPin aria-hidden="true" />
            {item.job.location}
          </span>
        </div>
        <div className="private-match-list-check-meta">
          <span className="private-match-file-chip">
            <FileText aria-hidden="true" />
            <span>{item.cv.fileName}</span>
            <small>v{item.cv.version}</small>
          </span>
          <span>
            <CalendarDays aria-hidden="true" />
            {copy.created(formatDate(item.createdAt, locale))}
          </span>
          <span className="private-match-expiry-meta">
            <Clock3 aria-hidden="true" />
            {copy.expiresIn(daysUntil(item.expiresAt))}
          </span>
        </div>
      </div>
      <div className="private-match-list-actions">
        <Link
          className="private-match-preview-link"
          href={`/cv-match-check/${encodeURIComponent(item.checkId)}`}
        >
          {copy.viewPreview} <ArrowRight aria-hidden="true" />
        </Link>
        <PrivateMatchDeleteControl
          checkId={item.checkId}
          compact
          onDeleted={onDeleted}
        />
      </div>
    </article>
  );
}

export function PrivateMatchList() {
  const locale = useWorkspaceLocale();
  const copy = privateMatchCopy(locale).list;
  const query = usePrivateCvMatchList();
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const items =
    query.data?.items.filter((item) => !removedIds.has(item.checkId)) ?? [];
  return (
    <main className="private-match-page">
      <PageHeader
        className="private-match-page-header"
        eyebrow={copy.eyebrow}
        title={copy.title}
        subtitle={copy.subtitle}
        rightSlot={
          <Link
            className="private-match-primary-button"
            href="/cv-match-check/new"
          >
            <Plus aria-hidden="true" /> {copy.newCheck}
          </Link>
        }
      />

      <section className="private-match-card private-match-list-intro">
        <span className="private-match-list-intro-icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <div>
          <div className="private-match-list-intro-title">
            <h2>{copy.privatePreviews}</h2>
            <span className="private-match-list-private-badge">
              <LockKeyhole aria-hidden="true" /> {copy.privateBadge}
            </span>
          </div>
          <p>{copy.privateDescription}</p>
        </div>
      </section>

      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <section className="private-match-limit-card" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div>
            <h2>{copy.loadFailed}</h2>
            <p>{privateMatchErrorMessage(query.error, locale)}</p>
            <button
              className="private-match-secondary-button"
              type="button"
              onClick={() => void query.refetch()}
            >
              <RefreshCw aria-hidden="true" />{" "}
              {privateMatchCopy(locale).common.tryAgain}
            </button>
          </div>
        </section>
      ) : items.length === 0 ? (
        <section className="private-match-card private-match-empty private-match-list-empty">
          <GaugeIcon />
          <h2>{copy.firstTitle}</h2>
          <p>{copy.firstDescription}</p>
          <Link
            className="private-match-primary-button"
            href="/cv-match-check/new"
          >
            <Sparkles aria-hidden="true" /> {copy.startNew}
            <ArrowRight aria-hidden="true" />
          </Link>
          <div className="private-match-empty-benefits">
            <div>
              <span className="private-match-empty-benefit-icon is-amber">
                <Zap aria-hidden="true" />
              </span>
              <p>{copy.benefits[0][0]}</p>
              <small>{copy.benefits[0][1]}</small>
            </div>
            <div>
              <span className="private-match-empty-benefit-icon is-blue">
                <Target aria-hidden="true" />
              </span>
              <p>{copy.benefits[1][0]}</p>
              <small>{copy.benefits[1][1]}</small>
            </div>
            <div>
              <span className="private-match-empty-benefit-icon is-green">
                <ShieldCheck aria-hidden="true" />
              </span>
              <p>{copy.benefits[2][0]}</p>
              <small>{copy.benefits[2][1]}</small>
            </div>
          </div>
        </section>
      ) : (
        <section aria-labelledby="saved-checks-heading">
          <div className="private-match-list-heading">
            <h2 id="saved-checks-heading">{copy.savedTitle}</h2>
            <span className="private-match-storage-meter">
              <span>{copy.storage}</span>
              <strong>{items.length}</strong>
              <i aria-hidden="true">/</i>
              <b>50</b>
              <em aria-hidden="true">
                <i style={{ width: `${(items.length / 50) * 100}%` }} />
              </em>
            </span>
          </div>
          <div className="private-match-list">
            {items.map((item) => (
              <ListItem
                item={item}
                key={item.checkId}
                onDeleted={() =>
                  setRemovedIds((current) => new Set(current).add(item.checkId))
                }
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function GaugeIcon() {
  return (
    <span className="private-match-list-empty-icon" aria-hidden="true">
      <span>%</span>
    </span>
  );
}
