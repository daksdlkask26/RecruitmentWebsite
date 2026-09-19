"use client";

import Link from "next/link";
import { homeCopy } from "../home-copy";
import type { HomeLocale, HomePageModel } from "../home-page-model";
import { HomeMatchBreakdown, HomeMatchRing } from "./home-match-visuals";

export function HomeSmartMatch({
  model,
  locale,
}: {
  model: HomePageModel;
  locale: HomeLocale;
}) {
  const copy = homeCopy[locale];
  const match = model.smartMatch;
  const actual = match.kind === "personal";
  const hasScore = actual && match.scoreEligible && match.score !== null;
  const sourceLabel = hasScore
    ? match.scoreSource === "cv"
      ? copy.smartMatch.cvScore.replace("{score}", String(match.score))
      : copy.smartMatch.profileEstimate
    : null;
  const cvLimitation =
    actual &&
    match.scoreSource === "cv" &&
    match.presentationState !== "AVAILABLE"
      ? copy.smartMatch.cvMatchIncompleteLimitation
      : copy.smartMatch.cvMatchLimitation;
  const actionHref = model.viewer.kind === "candidate" ? "/profile" : "/jobs";
  const actionLabel =
    model.viewer.kind === "candidate"
      ? copy.jobs.completeProfileAction
      : copy.jobs.browseOpportunities;

  return (
    <section
      className={`home-section home-smart-match home-smart-match-v2 ${
        actual ? "home-smart-match--actual" : "home-smart-match--illustrative"
      }`}
      id="smart-match"
      aria-labelledby="smart-match-title"
    >
      <div className="home-smart-match-badge">
        <span aria-hidden="true">✦</span>
        <span>{copy.smartMatch.badge}</span>
      </div>
      <div className="home-smart-match-visual">
        <div className="home-smart-match-intro">
          <p>{copy.smartMatch.eyebrow}</p>
          <h2 id="smart-match-title">{copy.smartMatch.title}</h2>
        </div>

        {actual ? (
          <div
            className="home-smart-match-actual"
            data-match-source={match.scoreSource}
            data-match-presentation={match.presentationState}
            aria-live="polite"
          >
            {hasScore ? (
              <HomeMatchRing
                score={match.score}
                size="large"
                label={`${match.score}% ${sourceLabel ?? "match"} ${match.presentationState.toLowerCase()}`}
                scoreSuffix={copy.smartMatch.scoreSuffix}
              />
            ) : null}
            <div className="home-smart-match-actual-copy">
              {sourceLabel ? (
                <p className="home-match-source-label">{sourceLabel}</p>
              ) : null}
              <h3>{match.jobTitle}</h3>
              <p>
                {match.scoreSource === "cv"
                  ? cvLimitation
                  : copy.smartMatch.estimateLimitation}
              </p>
              {match.cvMatch ? (
                <Link
                  href={`/cv-match-check/${encodeURIComponent(match.cvMatch.checkId)}`}
                >
                  {copy.jobs.reviewCvMatch}
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="home-smart-match-explainer">
            <h3>{copy.smartMatch.title}</h3>
            <p>{copy.smartMatch.illustrativeLimitation}</p>
            <Link href={actionHref} className="home-smart-match-action">
              {actionLabel}
            </Link>
          </div>
        )}
      </div>

      {actual ? (
        <div className="home-smart-match-breakdown">
          {match.scoreEligible && match.matchBreakdown ? (
            <HomeMatchBreakdown
              items={[
                {
                  key: "roleAndSkills",
                  label: copy.smartMatch.roleAndSkillsContribution,
                  value: match.matchBreakdown.roleAndSkills,
                },
                {
                  key: "preferences",
                  label: copy.smartMatch.preferencesContribution,
                  value: match.matchBreakdown.preferences,
                },
                {
                  key: "experience",
                  label: copy.smartMatch.experienceContribution,
                  value: match.matchBreakdown.experience,
                },
                {
                  key: "unmatched",
                  label: copy.smartMatch.unmatchedContribution,
                  value: match.matchBreakdown.unmatched,
                },
              ]}
              size="small"
              label={copy.smartMatch.compositionTitle}
            />
          ) : null}
          {match.matchingSkills.length ? (
            <p className="home-match-insight">
              <strong>{copy.smartMatch.matchingSkills}</strong>{" "}
              {match.matchingSkills.join(" · ")}
            </p>
          ) : null}
          {match.scoreSource === "profile" ? (
            <p className="home-match-insight home-match-insight--source">
              <strong>{copy.smartMatch.profileSignalsCompared}</strong>{" "}
              {match.matchingSkills.length
                ? match.matchingSkills.join(" · ")
                : match.improvementAreas.length
                  ? match.improvementAreas.join(" · ")
                  : copy.smartMatch.profileLimitation}
            </p>
          ) : null}
          {match.improvementAreas.length ? (
            <p className="home-match-insight">
              <strong>{copy.smartMatch.improvementAreas}</strong>{" "}
              {match.improvementAreas.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="home-match-disclaimer">
        <span aria-hidden="true">ⓘ</span>
        {copy.smartMatch.decisionNotice}
      </p>
    </section>
  );
}
