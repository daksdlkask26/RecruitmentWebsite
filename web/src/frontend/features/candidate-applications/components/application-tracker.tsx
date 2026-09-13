"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Copy,
  Eye,
  FileText,
  Handshake,
  ListChecks,
  LockKeyhole,
  Mail,
  MessageCircle,
  PauseCircle,
  SearchCheck,
  Send,
  ToggleLeft,
  ToggleRight,
  Undo2,
  XCircle,
} from "lucide-react";
import { Modal } from "@/frontend/components/ui/modal";
import { mutateWithCurrentCsrf } from "@/frontend/features/authentication/client/current-csrf-proof";
import { NOTIFICATION_CHANGED_EVENT } from "@/frontend/features/notifications/client/use-notification-context-read";
import { useOptionalJobInteraction } from "@/frontend/features/jobs/components/job-interaction-provider";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { ANALYTICS_PLATFORM_TIME_ZONE } from "@/shared/contracts/analytics";
import {
  applicationCopy,
  applicationErrorMessage,
  type ApplicationCopy,
  type ApplicationLocale,
} from "../i18n/application-copy";
import { jobCopy } from "@/frontend/features/jobs/components/job-copy";
import {
  applicationTrackerSchema,
  notificationPreferenceSchema,
  type ApplicationTracker,
} from "@/shared/contracts/candidate-applications";

const canonicalStepIndex: Record<ApplicationTracker["canonicalStage"], number> =
  {
    APPLIED: 0,
    VIEWED: 1,
    SHORTLISTED: 1,
    INTERVIEWING: 2,
    OFFERED: 2,
    HIRED: 3,
    OFFER_DECLINED: 3,
    REJECTED: 3,
    WAITLISTED: 3,
  };

function date(value: string, locale: ApplicationLocale) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ANALYTICS_PLATFORM_TIME_ZONE,
  }).format(new Date(value));
}

function profileDate(
  value: string | null,
  locale: ApplicationLocale,
  present: string,
) {
  if (!value) return present;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
}

function label(value: string, locale: ApplicationLocale) {
  const copy = jobCopy(locale);
  const labels: Record<string, string> = {
    ...copy.employmentTypeLabels,
    ...copy.experienceLevelLabels,
    ...copy.workArrangementLabels,
  };
  if (labels[value]) return labels[value];
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function availabilityLabel(
  value: "EXPIRED" | "DELETED" | "HELD" | "TEMPORARILY_UNAVAILABLE",
  copy: ApplicationCopy["tracker"],
) {
  return copy.availability[value];
}

function stageCopy(
  canonicalStage: ApplicationTracker["canonicalStage"],
  outcome: ApplicationTracker["publicOutcome"],
  copy: ApplicationCopy,
) {
  if (outcome === "WITHDRAWN") {
    return [copy.tracker.withdrawnHeadline, copy.tracker.withdrawnDescription];
  }
  const stage = canonicalStage as Exclude<
    ApplicationTracker["canonicalStage"],
    "WITHDRAWN"
  >;
  return [
    copy.applicationsList.statuses[stage] ?? copy.tracker.defaultHeadline,
    copy.stageNextStep[stage] ?? copy.tracker.defaultDescription,
  ];
}

function updateDescription(
  update: ApplicationTracker["updates"][number],
  copy: ApplicationCopy,
) {
  if (update.userMessage !== undefined && update.userMessage !== null)
    return update.userMessage;
  return copy.tracker.timelineDescriptions[update.eventCode];
}

function updateTitle(
  update: ApplicationTracker["updates"][number],
  copy: ApplicationCopy,
) {
  return copy.tracker.timelineTitles[update.eventCode];
}

function legacyUpdateDescription(
  update: ApplicationTracker["updates"][number],
  copy: ApplicationCopy,
) {
  if (update.kind === "WITHDRAWN") return copy.tracker.updateWithdrawn;
  const stage = update.canonicalStage as keyof typeof copy.stageNextStep;
  return copy.stageNextStep[stage] ?? copy.tracker.updateDefault;
}

function updateIcon(update: ApplicationTracker["updates"][number]) {
  switch (update.canonicalStage) {
    case "VIEWED":
      return <Eye aria-hidden="true" />;
    case "SHORTLISTED":
      return <ListChecks aria-hidden="true" />;
    case "INTERVIEWING":
      return <Clock3 aria-hidden="true" />;
    case "OFFERED":
      return <Send aria-hidden="true" />;
    case "HIRED":
      return <CheckCircle2 aria-hidden="true" />;
    case "OFFER_DECLINED":
      return <CircleSlash aria-hidden="true" />;
    case "REJECTED":
      return <XCircle aria-hidden="true" />;
    case "WAITLISTED":
      return <PauseCircle aria-hidden="true" />;
    case "APPLIED":
      return <Check aria-hidden="true" />;
  }
  if (update.eventCode === "FILE_PROCESSING_UPDATED")
    return <FileText aria-hidden="true" />;
  if (update.kind === "UNDER_REVIEW") return <SearchCheck aria-hidden="true" />;
  if (update.kind === "INTERVIEW" || update.kind === "OUTCOME")
    return <Clock3 aria-hidden="true" />;
  return <Check aria-hidden="true" />;
}

function isAtLeastAsFresh(
  current: ApplicationTracker,
  next: ApplicationTracker,
) {
  // Withdrawal is a terminal candidate-owned outcome. A response that was
  // already in flight before the withdrawal must not restore the old view.
  if (
    current.publicOutcome === "WITHDRAWN" &&
    next.publicOutcome !== "WITHDRAWN"
  ) {
    return false;
  }
  if (
    next.stageVersion < current.stageVersion ||
    next.intake.progressPercent < current.intake.progressPercent
  ) {
    return false;
  }
  if (
    next.stageVersion === current.stageVersion &&
    next.intake.progressPercent === current.intake.progressPercent &&
    new Date(next.lastUpdatedAt).getTime() <
      new Date(current.lastUpdatedAt).getTime()
  ) {
    return false;
  }
  return true;
}

export function ApplicationTracker({
  initialTracker,
  csrfProof,
}: {
  initialTracker: ApplicationTracker;
  csrfProof: string;
}) {
  const [tracker, setTracker] = useState(initialTracker);
  const [pending, setPending] = useState<string | null>(null);
  const [offerDecision, setOfferDecision] = useState<
    "ACCEPT" | "DECLINE" | null
  >(null);
  const [withdrawConfirmationOpen, setWithdrawConfirmationOpen] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const applicationId = tracker.applicationId;
  const shared = useOptionalJobInteraction();
  const locale = useWorkspaceLocale();
  const copy = applicationCopy(locale);
  const trackerCopy = copy.tracker;
  const steps = [
    { id: 0, label: trackerCopy.steps.submitted },
    { id: 1, label: trackerCopy.steps.underReview },
    { id: 2, label: trackerCopy.steps.interview },
    { id: 3, label: trackerCopy.steps.outcome },
  ];

  const poll = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/candidate/applications/${encodeURIComponent(applicationId)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) return;
      const next = applicationTrackerSchema.parse(await response.json());
      setTracker((current) =>
        isAtLeastAsFresh(current, next) ? next : current,
      );
    } catch {
      // Preserve the last safe projection during a transient poll failure.
    }
  }, [applicationId]);

  useEffect(() => {
    let timer: number | undefined;
    let mounted = true;
    const schedule = () => {
      if (!mounted || document.hidden) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await poll();
        schedule();
      }, 4000);
    };
    const visibility = () => {
      if (document.hidden) {
        if (timer) window.clearTimeout(timer);
        return;
      }
      if (timer) window.clearTimeout(timer);
      void poll();
      schedule();
    };
    const refreshOnNotification = () => {
      if (!document.hidden) void poll();
    };
    schedule();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", refreshOnNotification);
    window.addEventListener(NOTIFICATION_CHANGED_EVENT, refreshOnNotification);
    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", refreshOnNotification);
      window.removeEventListener(
        NOTIFICATION_CHANGED_EVENT,
        refreshOnNotification,
      );
    };
  }, [poll]);

  async function setPreference(
    field: "emailEnabled" | "inAppEnabled",
    value: boolean,
  ) {
    setPending(field);
    setError(null);
    const current = tracker.notificationPreference;
    try {
      const response = await mutateWithCurrentCsrf(
        `/api/candidate/applications/${encodeURIComponent(applicationId)}/notification-preferences`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emailEnabled:
              field === "emailEnabled" ? value : current.emailEnabled,
            inAppEnabled:
              field === "inAppEnabled" ? value : current.inAppEnabled,
            expectedVersion: current.version,
          }),
        },
        csrfProof,
      );
      if (!response.ok) {
        throw new Error(trackerCopy.preferenceError);
      }
      const preference = notificationPreferenceSchema.parse(
        await response.json(),
      );
      setTracker((currentTracker) => ({
        ...currentTracker,
        notificationPreference: preference,
      }));
    } catch (caught) {
      setError(
        applicationErrorMessage(locale, caught, trackerCopy.preferenceError),
      );
    } finally {
      setPending(null);
    }
  }

  async function withdraw() {
    if (!tracker.canWithdraw || pending) {
      return;
    }
    setPending("withdraw");
    setError(null);
    try {
      const response = await mutateWithCurrentCsrf(
        `/api/candidate/applications/${encodeURIComponent(applicationId)}/withdraw`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedVersion: tracker.stageVersion,
            confirmed: true,
          }),
        },
        csrfProof,
      );
      if (!response.ok) {
        throw new Error(trackerCopy.withdrawError);
      }
      shared?.clearApplied(tracker.job.jobId);
      await poll();
      setWithdrawConfirmationOpen(false);
    } catch (caught) {
      setWithdrawConfirmationOpen(false);
      setError(
        applicationErrorMessage(locale, caught, trackerCopy.withdrawError),
      );
    } finally {
      setPending(null);
    }
  }

  async function setContactConsent(shared: boolean) {
    setPending("contact-consent");
    setError(null);
    try {
      const response = await mutateWithCurrentCsrf(
        `/api/candidate/applications/${encodeURIComponent(applicationId)}/contact-consent`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shared,
            expectedVersion: tracker.contactConsent?.version,
          }),
        },
        csrfProof,
      );
      if (!response.ok) throw new Error(trackerCopy.contactConsentError);
      const next = (await response.json()) as {
        shared: boolean;
        version: number;
      };
      setTracker((current) => ({ ...current, contactConsent: next }));
    } catch (caught) {
      setError(
        applicationErrorMessage(
          locale,
          caught,
          trackerCopy.contactConsentError,
        ),
      );
    } finally {
      setPending(null);
    }
  }

  async function respondToOffer(decision: "ACCEPT" | "DECLINE") {
    if (tracker.canonicalStage !== "OFFERED" || pending) return;
    setPending(decision === "ACCEPT" ? "accept-offer" : "decline-offer");
    setError(null);
    try {
      const response = await mutateWithCurrentCsrf(
        `/api/candidate/applications/${encodeURIComponent(applicationId)}/offer-response`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            decision,
            expectedVersion: tracker.stageVersion,
          }),
        },
        csrfProof,
      );
      await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(trackerCopy.offerResponseError);
      }
      await poll();
      setOfferDecision(null);
    } catch (caught) {
      setOfferDecision(null);
      setError(
        applicationErrorMessage(locale, caught, trackerCopy.offerResponseError),
      );
    } finally {
      setPending(null);
    }
  }

  function requestOfferResponse(decision: "ACCEPT" | "DECLINE") {
    if (tracker.canonicalStage !== "OFFERED" || pending) return;
    setError(null);
    setOfferDecision(decision);
  }
  const isWithdrawn = tracker.publicOutcome === "WITHDRAWN";
  const isBranchOutcome =
    isWithdrawn ||
    tracker.canonicalStage === "REJECTED" ||
    tracker.canonicalStage === "WAITLISTED";
  const transitionOriginIndex = isWithdrawn
    ? tracker.canonicalStage === "APPLIED"
      ? 0
      : 1
    : tracker.transitionFromStage
      ? canonicalStepIndex[tracker.transitionFromStage]
      : tracker.canonicalStage === "REJECTED"
        ? 0
        : 1;
  const activeIndex =
    tracker.publicOutcome === "WITHDRAWN"
      ? 3
      : tracker.canonicalStage === "OFFERED"
        ? 3
        : canonicalStepIndex[tracker.canonicalStage];
  const outcomeDetail =
    tracker.publicOutcome === "WITHDRAWN"
      ? copy.applicationsList.statuses.WITHDRAWN
      : tracker.canonicalStage === "OFFERED"
        ? trackerCopy.awaitingResponse
        : tracker.canonicalStage === "HIRED"
          ? copy.applicationsList.statuses.HIRED
          : tracker.canonicalStage === "OFFER_DECLINED"
            ? copy.applicationsList.statuses.OFFER_DECLINED
            : tracker.canonicalStage === "REJECTED"
              ? copy.applicationsList.statuses.REJECTED
              : tracker.canonicalStage === "WAITLISTED"
                ? copy.applicationsList.statuses.WAITLISTED
                : trackerCopy.notStarted;
  const [headline, description] = stageCopy(
    tracker.canonicalStage,
    tracker.publicOutcome,
    copy,
  );

  return (
    <main
      className="application-ui application-ui--tracker"
      aria-labelledby="application-tracker-title"
    >
      <header className="application-ui__header">
        <div>
          <nav
            className="application-ui__breadcrumb"
            aria-label={trackerCopy.breadcrumb}
          >
            <Link href="/jobs/applied">{trackerCopy.applications}</Link>
            <span>/</span>
            <span>{tracker.job.title}</span>
          </nav>
          <h1 id="application-tracker-title">{trackerCopy.title}</h1>
          <p>{trackerCopy.subtitle}</p>
        </div>
        <Link
          className="application-ui-button application-ui-button--secondary"
          href={`/jobs/applied/${encodeURIComponent(tracker.applicationId)}/messages`}
        >
          <MessageCircle aria-hidden="true" />
          {trackerCopy.contactRecruiter}
        </Link>
      </header>

      {error ? (
        <p
          className="application-ui-alert application-ui-alert--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section
        className="application-ui-status-hero"
        aria-labelledby="current-status-title"
      >
        <span className="application-ui-status-hero__icon">
          {tracker.publicOutcome === "WITHDRAWN" ? (
            <Clock3 aria-hidden="true" />
          ) : (
            <SearchCheck aria-hidden="true" />
          )}
        </span>
        <div>
          <span>{trackerCopy.currentStatus}</span>
          <h2 id="current-status-title">{headline}</h2>
          <p>{description}</p>
        </div>
        <aside aria-label={trackerCopy.latestUpdate}>
          <small>{trackerCopy.latestUpdate}</small>
          <strong>{date(tracker.lastUpdatedAt, locale)}</strong>
          <code>{applicationId}</code>
        </aside>
      </section>

      <section
        className="application-ui-card application-ui-progress-card"
        aria-labelledby="recruitment-progress-title"
      >
        <h2 id="recruitment-progress-title">{trackerCopy.progress}</h2>
        <ol className="application-ui-stage-progress">
          {steps.map((step, index) => {
            const skipped =
              isBranchOutcome && index > transitionOriginIndex && index < 3;
            const complete =
              !skipped &&
              (isBranchOutcome
                ? index <= transitionOriginIndex
                : index < activeIndex);
            const active = !skipped && index === activeIndex;
            const detail = skipped
              ? trackerCopy.skipped
              : index === 1 &&
                  (tracker.canonicalStage === "VIEWED" ||
                    tracker.canonicalStage === "SHORTLISTED" ||
                    (isBranchOutcome && transitionOriginIndex === 1))
                ? tracker.canonicalStage === "VIEWED" ||
                  (isBranchOutcome && tracker.transitionFromStage === "VIEWED")
                  ? trackerCopy.viewed
                  : trackerCopy.shortlisted
                : index === 2 &&
                    (tracker.canonicalStage === "INTERVIEWING" ||
                      (isBranchOutcome &&
                        tracker.transitionFromStage === "INTERVIEWING"))
                  ? trackerCopy.interviewing
                  : index === 3
                    ? outcomeDetail
                    : complete
                      ? trackerCopy.complete
                      : active
                        ? trackerCopy.current
                        : trackerCopy.notStarted;
            return (
              <li
                key={step.id}
                className={
                  [
                    complete && "is-complete",
                    active && "is-active",
                    skipped && "is-skipped",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                data-step-state={
                  skipped
                    ? "skipped"
                    : active
                      ? "active"
                      : complete
                        ? "complete"
                        : "upcoming"
                }
              >
                <span>
                  {complete ? <Check aria-hidden="true" /> : index + 1}
                </span>
                <strong>{step.label}</strong>
                <small>{detail}</small>
              </li>
            );
          })}
        </ol>
      </section>

      {tracker.canonicalStage === "OFFERED" ? (
        <section
          className="application-ui-offer-response"
          aria-labelledby="offer-response-title"
          role="status"
        >
          <div className="application-ui-offer-response__badge">
            <Send aria-hidden="true" />
            <span>{trackerCopy.offerSent}</span>
          </div>
          <div className="application-ui-offer-response__copy">
            <h2 id="offer-response-title">{trackerCopy.offerTitle}</h2>
            <p>{trackerCopy.offerDescription}</p>
          </div>
          <div className="application-ui-offer-response__actions">
            <button
              type="button"
              className="application-ui-button application-ui-button--primary"
              disabled={pending !== null}
              aria-haspopup="dialog"
              onClick={() => requestOfferResponse("ACCEPT")}
            >
              <Handshake aria-hidden="true" />
              {pending === "accept-offer"
                ? trackerCopy.accepting
                : trackerCopy.acceptOffer}
            </button>
            <button
              type="button"
              className="application-ui-button application-ui-button--secondary"
              disabled={pending !== null}
              aria-haspopup="dialog"
              onClick={() => requestOfferResponse("DECLINE")}
            >
              <CircleSlash aria-hidden="true" />
              {pending === "decline-offer"
                ? trackerCopy.declining
                : trackerCopy.declineOffer}
            </button>
          </div>
        </section>
      ) : null}

      <Modal
        open={offerDecision !== null}
        title={
          offerDecision === "ACCEPT"
            ? trackerCopy.acceptTitle
            : trackerCopy.declineTitle
        }
        description={
          offerDecision === "ACCEPT"
            ? trackerCopy.acceptDescription
            : trackerCopy.declineDescription
        }
        tone={offerDecision === "DECLINE" ? "destructive" : "standard"}
        icon={
          offerDecision === "ACCEPT" ? (
            <Handshake aria-hidden="true" />
          ) : (
            <CircleSlash aria-hidden="true" />
          )
        }
        busy={pending !== null}
        onClose={() => setOfferDecision(null)}
      >
        <div className="sh-modal-actions">
          <button
            type="button"
            className="application-ui-button application-ui-button--secondary"
            data-autofocus
            disabled={pending !== null}
            onClick={() => setOfferDecision(null)}
          >
            {trackerCopy.cancel}
          </button>
          <button
            type="button"
            className="application-ui-button application-ui-button--primary"
            disabled={pending !== null}
            onClick={() => {
              if (offerDecision) void respondToOffer(offerDecision);
            }}
          >
            {pending !== null
              ? trackerCopy.confirming
              : offerDecision === "ACCEPT"
                ? trackerCopy.confirmAcceptance
                : trackerCopy.confirmDecline}
          </button>
        </div>
      </Modal>
      <Modal
        open={withdrawConfirmationOpen}
        title={trackerCopy.withdrawTitle}
        description={trackerCopy.withdrawDescription}
        tone="destructive"
        icon={<Undo2 aria-hidden="true" />}
        busy={pending === "withdraw"}
        onClose={() => {
          if (!pending) setWithdrawConfirmationOpen(false);
        }}
      >
        <div className="sh-modal-actions">
          <button
            type="button"
            className="application-ui-button application-ui-button--secondary"
            data-autofocus
            disabled={pending !== null}
            onClick={() => setWithdrawConfirmationOpen(false)}
          >
            {trackerCopy.cancel}
          </button>
          <button
            type="button"
            className="application-ui-button application-ui-button--primary"
            disabled={pending !== null}
            onClick={() => void withdraw()}
          >
            {pending === "withdraw"
              ? trackerCopy.withdrawing
              : trackerCopy.confirmWithdrawal}
          </button>
        </div>
      </Modal>
      <div className="application-ui__columns">
        <div className="application-ui__main">
          <section
            className="application-ui-card"
            aria-labelledby="recent-updates-title"
          >
            <h2 id="recent-updates-title">{trackerCopy.recentUpdates}</h2>
            {tracker.updates.length ? (
              <ol className="application-ui-timeline">
                {[...tracker.updates].reverse().map((update, index) => (
                  <li
                    key={update.id}
                    className={
                      [
                        index === 0 ? "is-highlighted" : "",
                        update.eventCode === "FILE_PROCESSING_UPDATED"
                          ? "is-technical"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    data-event-code={update.eventCode}
                  >
                    <span
                      className={
                        update.canonicalStage === "APPLIED"
                          ? "is-complete"
                          : undefined
                      }
                    >
                      {updateIcon(update)}
                    </span>
                    <div>
                      <strong>{updateTitle(update, copy)}</strong>
                      <p>
                        {update.userMessage !== null &&
                        update.userMessage !== undefined
                          ? update.userMessage
                          : updateDescription(update, copy) ||
                            legacyUpdateDescription(update, copy)}
                      </p>
                    </div>
                    <time dateTime={update.occurredAt}>
                      {date(update.occurredAt, locale)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="application-ui-muted">
                {trackerCopy.noPublicUpdates}
              </p>
            )}
          </section>

          <section
            id="submitted-files"
            className="application-ui-card"
            aria-labelledby="submitted-files-title"
          >
            <div className="application-ui-card__heading">
              <h2 id="submitted-files-title">{trackerCopy.submittedFiles}</h2>
              <span className="application-ui-lock">
                <LockKeyhole aria-hidden="true" />
                {trackerCopy.versionLocked}
              </span>
            </div>
            {tracker.submission.job.available ? (
              <div className="application-ui-disclosure application-ui-disclosure--compact">
                <div>
                  <strong>{trackerCopy.submittedEvidence}</strong>
                  <p>
                    {tracker.submission.job.title} ·{" "}
                    {tracker.submission.job.companyName}
                  </p>
                  <p>
                    {tracker.submission.job.location} ·{" "}
                    {label(tracker.submission.job.employmentType!, locale)} ·{" "}
                    {label(tracker.submission.job.experienceLevel!, locale)} ·{" "}
                    {label(tracker.submission.job.workArrangement!, locale)}
                  </p>
                  <p>
                    {trackerCopy.jobVersion}: {tracker.submission.job.version}
                  </p>
                  {tracker.submission.job.requiredSkills.length ? (
                    <p>
                      {trackerCopy.requiredSkills}:{" "}
                      {tracker.submission.job.requiredSkills.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="application-ui-muted">
                {trackerCopy.snapshotUnavailable}
              </p>
            )}
            <div className="application-ui-submission-evidence">
              <section
                className="application-ui-disclosure application-ui-disclosure--compact"
                aria-labelledby="submitted-profile-title"
              >
                <div>
                  <h3 id="submitted-profile-title">
                    {trackerCopy.submittedProfile}
                  </h3>
                  {tracker.submission.profile.status === "AVAILABLE" ? (
                    <>
                      <dl className="application-ui-personal">
                        <div>
                          <dt>{trackerCopy.fullName}</dt>
                          <dd>{tracker.submission.profile.fullName}</dd>
                        </div>
                        {tracker.submission.profile.headline ? (
                          <div>
                            <dt>{trackerCopy.headline}</dt>
                            <dd>{tracker.submission.profile.headline}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {tracker.submission.profile.summary ? (
                        <p>
                          <strong>{trackerCopy.summary}:</strong>{" "}
                          {tracker.submission.profile.summary}
                        </p>
                      ) : null}
                      {tracker.submission.profile.skills.length ? (
                        <p>
                          <strong>{trackerCopy.skills}:</strong>{" "}
                          {tracker.submission.profile.skills.join(", ")}
                        </p>
                      ) : null}
                      {tracker.submission.profile.experience.length ? (
                        <div>
                          <strong>{trackerCopy.experience}</strong>
                          {tracker.submission.profile.experience.map(
                            (entry) => (
                              <p key={`${entry.title}:${entry.company}`}>
                                {entry.title} · {entry.company} ·{" "}
                                {profileDate(
                                  entry.startDate,
                                  locale,
                                  trackerCopy.present,
                                )}{" "}
                                –{" "}
                                {profileDate(
                                  entry.endDate,
                                  locale,
                                  trackerCopy.present,
                                )}
                              </p>
                            ),
                          )}
                        </div>
                      ) : null}
                      {tracker.submission.profile.education.length ? (
                        <div>
                          <strong>{trackerCopy.education}</strong>
                          {tracker.submission.profile.education.map((entry) => (
                            <p key={`${entry.institution}:${entry.degree}`}>
                              {entry.institution} · {entry.degree}
                              {entry.field ? ` · ${entry.field}` : ""}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="application-ui-muted" role="status">
                      {trackerCopy.submittedProfileUnavailable}
                    </p>
                  )}
                </div>
              </section>
              <section
                className="application-ui-disclosure application-ui-disclosure--compact"
                aria-labelledby="submitted-contact-title"
              >
                <div>
                  <h3 id="submitted-contact-title">
                    {trackerCopy.submittedContact}
                  </h3>
                  {tracker.submission.contact.status === "AVAILABLE" ? (
                    <dl className="application-ui-personal">
                      <div>
                        <dt>{trackerCopy.fullName}</dt>
                        <dd>{tracker.submission.contact.fullName}</dd>
                      </div>
                      <div>
                        <dt>{trackerCopy.emailAddress}</dt>
                        <dd>{tracker.submission.contact.email}</dd>
                      </div>
                      <div>
                        <dt>{trackerCopy.phone}</dt>
                        <dd>{tracker.submission.contact.phone}</dd>
                      </div>
                      {tracker.submission.contact.location ? (
                        <div>
                          <dt>{trackerCopy.location}</dt>
                          <dd>{tracker.submission.contact.location}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="application-ui-muted" role="status">
                      {trackerCopy.submittedContactUnavailable}
                    </p>
                  )}
                </div>
              </section>
              <section
                className="application-ui-disclosure application-ui-disclosure--compact"
                aria-labelledby="submitted-consent-title"
              >
                <div>
                  <h3 id="submitted-consent-title">
                    {trackerCopy.submittedConsent}
                  </h3>
                  {tracker.submission.consent.status === "AVAILABLE" ? (
                    <dl className="application-ui-personal">
                      <div>
                        <dt>{trackerCopy.consentVersion}</dt>
                        <dd>{tracker.submission.consent.version}</dd>
                      </div>
                      <div>
                        <dt>{trackerCopy.consentedAt}</dt>
                        <dd>
                          {date(tracker.submission.consent.consentedAt, locale)}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="application-ui-muted" role="status">
                      {trackerCopy.submittedConsentUnavailable}
                    </p>
                  )}
                </div>
              </section>
            </div>
            <ul className="application-ui-file-list">
              {[
                tracker.submission.cv,
                tracker.submission.coverLetter.kind === "FILE"
                  ? tracker.submission.coverLetter
                  : null,
              ]
                .filter(
                  (item): item is NonNullable<typeof item> => item !== null,
                )
                .map((item) => {
                  const file = item.file;
                  const kind =
                    item === tracker.submission.cv ? "cv" : "cover-letter";
                  return (
                    <li key={`${kind}:${file?.versionId ?? "unavailable"}`}>
                      <span className="application-ui-file-icon">
                        <FileText aria-hidden="true" />
                      </span>
                      <span>
                        <strong>
                          {file?.displayName ??
                            (kind === "cv"
                              ? copy.applicationDetail.cv
                              : trackerCopy.coverLetter)}
                        </strong>
                      </span>
                      {item.availability === "AVAILABLE" && file ? (
                        <span>
                          {item.previewSupported ? (
                            <>
                              <a
                                className="application-ui-file-action"
                                href={`/api/candidate/applications/${tracker.applicationId}/documents/${kind}`}
                              >
                                {trackerCopy.open}
                              </a>{" "}
                            </>
                          ) : null}
                          <a
                            className="application-ui-file-action"
                            href={`/api/candidate/applications/${tracker.applicationId}/documents/${kind}?download=1`}
                          >
                            {trackerCopy.download}
                          </a>
                        </span>
                      ) : (
                        <span className="application-ui-muted" role="status">
                          {item.availability === "AVAILABLE"
                            ? trackerCopy.documentUnavailable
                            : availabilityLabel(item.availability, trackerCopy)}
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
            {tracker.submission.cv.file ? (
              <p className="application-ui-muted">
                {trackerCopy.cvVersion}: {tracker.submission.cv.file.version}
              </p>
            ) : null}
            {tracker.submission.coverLetter.kind === "TEXT" ? (
              <div className="application-ui-disclosure application-ui-disclosure--compact">
                <strong>{trackerCopy.coverLetter}</strong>
                <p>
                  {tracker.submission.coverLetter.text ??
                    (tracker.submission.coverLetter.availability === "AVAILABLE"
                      ? trackerCopy.documentUnavailable
                      : availabilityLabel(
                          tracker.submission.coverLetter.availability,
                          trackerCopy,
                        ))}
                </p>
              </div>
            ) : null}
            {tracker.submission.coverLetter.kind === "NONE" ? (
              <p className="application-ui-muted">
                {trackerCopy.coverLetter}: {trackerCopy.notProvided}
              </p>
            ) : null}
            {tracker.submission.answers.length ? (
              <div className="application-ui-disclosure application-ui-disclosure--compact">
                <strong>{trackerCopy.screeningAnswers}</strong>
                {tracker.submission.answers.map((answer) => (
                  <p key={answer.question}>
                    {answer.question}: {String(answer.answer)}
                  </p>
                ))}
              </div>
            ) : null}
            {tracker.submission.message ? (
              <div className="application-ui-disclosure application-ui-disclosure--compact">
                <strong>{trackerCopy.message}</strong>
                <p>{tracker.submission.message}</p>
              </div>
            ) : null}
            <div className="application-ui-disclosure application-ui-disclosure--compact">
              <LockKeyhole aria-hidden="true" />
              <p>
                <strong>{trackerCopy.screeningStatus}</strong>{" "}
                {trackerCopy.screeningPrivacy}
              </p>
            </div>
          </section>
        </div>

        <aside className="application-ui__sidebar">
          <section className="application-ui-card application-ui-job-card">
            <span className="application-ui-job-card__eyebrow">
              {tracker.job.jobAvailable
                ? trackerCopy.currentListing
                : trackerCopy.applicationEyebrow}
            </span>
            <h2>{tracker.job.title}</h2>
            <p>{tracker.job.companyName}</p>
            <small>
              {tracker.job.location} ·{" "}
              {label(tracker.job.workArrangement, locale)}
            </small>
            <div className="application-ui-tags">
              <span>{label(tracker.job.employmentType, locale)}</span>
              <span>{label(tracker.job.experienceLevel, locale)}</span>
            </div>
            {tracker.job.jobAvailable && tracker.job.slug ? (
              <Link
                className="application-ui-file-action"
                href={`/jobs/${encodeURIComponent(tracker.job.slug)}`}
              >
                {trackerCopy.currentListing}
              </Link>
            ) : (
              <p className="application-ui-muted" role="status">
                {trackerCopy.jobNoLongerAvailable}
              </p>
            )}
            <div className="application-ui-job-info">
              <div>
                <span>{trackerCopy.submitted}</span>
                <time dateTime={tracker.submittedAt}>
                  {date(tracker.submittedAt, locale)}
                </time>
              </div>
              <div>
                <span>{trackerCopy.applicationId}</span>
                <code>{applicationId}</code>
              </div>
            </div>
          </section>

          <section
            className="application-ui-card"
            aria-labelledby="status-notifications-title"
          >
            <h2 id="status-notifications-title">
              {trackerCopy.statusNotifications}
            </h2>
            <button
              type="button"
              className="application-ui-toggle"
              disabled={pending !== null}
              aria-pressed={tracker.notificationPreference.emailEnabled}
              onClick={() =>
                void setPreference(
                  "emailEnabled",
                  !tracker.notificationPreference.emailEnabled,
                )
              }
            >
              <span className="application-ui-toggle__content">
                <Mail aria-hidden="true" />
                <span>
                  <strong>{trackerCopy.email}</strong>
                  <small>
                    {tracker.notificationPreference.emailEnabled
                      ? trackerCopy.enabled
                      : trackerCopy.disabled}
                  </small>
                </span>
              </span>
              {tracker.notificationPreference.emailEnabled ? (
                <ToggleRight aria-hidden="true" />
              ) : (
                <ToggleLeft aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="application-ui-toggle"
              disabled={pending !== null}
              aria-pressed={tracker.notificationPreference.inAppEnabled}
              onClick={() =>
                void setPreference(
                  "inAppEnabled",
                  !tracker.notificationPreference.inAppEnabled,
                )
              }
            >
              <span className="application-ui-toggle__content">
                <Bell aria-hidden="true" />
                <span>
                  <strong>{trackerCopy.inAppNotifications}</strong>
                  <small>
                    {tracker.notificationPreference.inAppEnabled
                      ? trackerCopy.enabled
                      : trackerCopy.disabled}
                  </small>
                </span>
              </span>
              {tracker.notificationPreference.inAppEnabled ? (
                <ToggleRight aria-hidden="true" />
              ) : (
                <ToggleLeft aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="application-ui-toggle"
              disabled={pending !== null}
              aria-pressed={tracker.contactConsent?.shared ?? false}
              onClick={() =>
                void setContactConsent(
                  !(tracker.contactConsent?.shared ?? false),
                )
              }
            >
              <span className="application-ui-toggle__content">
                <Mail aria-hidden="true" />
                <span>
                  <strong>{trackerCopy.shareContact}</strong>
                  <small>
                    {tracker.contactConsent?.shared
                      ? trackerCopy.enabledForApplication
                      : trackerCopy.private}
                  </small>
                </span>
              </span>
              {tracker.contactConsent?.shared ? (
                <ToggleRight aria-hidden="true" />
              ) : (
                <ToggleLeft aria-hidden="true" />
              )}
            </button>
          </section>

          <div className="application-ui-actions-stack">
            <Link
              className="application-ui-button application-ui-button--primary"
              href={`/jobs/applied/${encodeURIComponent(applicationId)}/submitted`}
            >
              <Copy aria-hidden="true" />
              {trackerCopy.viewSubmittedApplication}
            </Link>
            {tracker.canWithdraw ? (
              <button
                type="button"
                className="application-ui-button application-ui-button--secondary"
                disabled={pending !== null}
                aria-haspopup="dialog"
                onClick={() => setWithdrawConfirmationOpen(true)}
              >
                <Undo2 aria-hidden="true" />
                {pending === "withdraw"
                  ? trackerCopy.withdrawing
                  : trackerCopy.withdrawApplication}
              </button>
            ) : (
              <p className="application-ui-withdraw-note">
                {trackerCopy.withdrawalUnavailable}
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
