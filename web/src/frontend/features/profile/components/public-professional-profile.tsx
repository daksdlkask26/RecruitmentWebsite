"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import {
  BriefcaseBusiness,
  GraduationCap,
  Link2,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  EligibleContext,
  SafeParticipant,
} from "@/shared/contracts/messaging/common";
import type { DiscoverableProfile } from "@/shared/contracts/profile-discovery";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";
import { ProfileMessageAction } from "./profile-message-action";

function publicProfileCopy(locale: "vi" | "en") {
  return locale === "vi"
    ? {
        kicker: "HỒ SƠ NGHỀ NGHIỆP",
        fallbackHeadline: "Hồ sơ nghề nghiệp",
        about: "VỀ BẠN",
        summary: "Tóm tắt nghề nghiệp",
        skills: "Kỹ năng",
        experience: "Kinh nghiệm",
        education: "Học vấn",
        details: "CHI TIẾT HỒ SƠ",
        links: "Liên kết nghề nghiệp",
        inProgress: "Hồ sơ đang được hoàn thiện",
        inProgressDescription:
          "Người này đã bật tính năng khám phá hồ sơ nhưng chưa thêm thông tin nghề nghiệp công khai.",
      }
    : {
        kicker: "PROFESSIONAL PROFILE",
        fallbackHeadline: "Professional profile",
        about: "ABOUT",
        summary: "Professional summary",
        skills: "Skills",
        experience: "Experience",
        education: "Education",
        details: "PROFILE DETAILS",
        links: "Professional links",
        inProgress: "Profile in progress",
        inProgressDescription:
          "This person has enabled profile discovery but has not added public professional details yet.",
      };
}

type PublicProfileProps = {
  participant: SafeParticipant;
  profile: {
    headline: string | null;
    summary: string | null;
    location: string | null;
  } | null;
  contexts: EligibleContext[];
  csrfProof: string;
  canMessage?: boolean;
  visibleSections?: DiscoverableProfile["sections"];
};

export function PublicProfessionalProfile({
  participant,
  profile,
  contexts,
  csrfProof,
  canMessage = true,
  visibleSections,
}: PublicProfileProps) {
  const copy = publicProfileCopy(useWorkspaceLocale());
  const empty =
    !profile?.summary &&
    !visibleSections?.skills?.length &&
    !visibleSections?.experience?.length &&
    !visibleSections?.education?.length &&
    !visibleSections?.links?.length;

  return (
    <main className="profile-page professional-profile-page public-profile-page">
      <header className="public-profile-hero">
        <div className="public-profile-hero__identity">
          <div className="public-profile-avatar" aria-hidden="true">
            {participant.image ? (
              <Image
                src={participant.image}
                alt=""
                width={76}
                height={76}
                unoptimized
              />
            ) : (
              participant.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div>
            <p className="workspace-kicker">{copy.kicker}</p>
            <h1 id="workspace-page-title">{participant.name}</h1>
            <p
              className={`public-profile-hero__headline${profile?.headline ? "" : "is-empty"}`}
            >
              {profile?.headline ?? copy.fallbackHeadline}
            </p>
            {profile?.location ? (
              <p className="public-profile-hero__location">
                <MapPin aria-hidden="true" /> {profile.location}
              </p>
            ) : null}
          </div>
        </div>
        {canMessage ? (
          <div className="public-profile-actions">
            <ProfileMessageAction
              csrfProof={csrfProof}
              participantId={participant.id}
              participantName={participant.name}
              contexts={contexts}
            />
          </div>
        ) : null}
      </header>

      <section
        className="public-profile-grid"
        aria-labelledby="professional-summary-title"
      >
        {profile?.summary ? (
          <article className="public-profile-card public-profile-card--summary">
            <span className="public-profile-card__icon">
              <Sparkles aria-hidden="true" />
            </span>
            <div>
              <p className="workspace-kicker">{copy.about}</p>
              <h2 id="professional-summary-title">{copy.summary}</h2>
              <p>{profile.summary}</p>
            </div>
          </article>
        ) : null}
        {visibleSections?.skills?.length ? (
          <ProfileList
            title={copy.skills}
            detailsLabel={copy.details}
            isSkills
            icon={<ShieldCheck aria-hidden="true" />}
            items={visibleSections.skills}
          />
        ) : null}
        {visibleSections?.experience?.length ? (
          <ProfileList
            title={copy.experience}
            detailsLabel={copy.details}
            icon={<BriefcaseBusiness aria-hidden="true" />}
            items={visibleSections.experience.map(
              (item) => `${item.title} · ${item.company}`,
            )}
          />
        ) : null}
        {visibleSections?.education?.length ? (
          <ProfileList
            title={copy.education}
            detailsLabel={copy.details}
            icon={<GraduationCap aria-hidden="true" />}
            items={visibleSections.education.map(
              (item) => `${item.degree} · ${item.institution}`,
            )}
          />
        ) : null}
        {visibleSections?.links?.length ? (
          <ProfileLinks
            detailsLabel={copy.details}
            title={copy.links}
            links={visibleSections.links}
          />
        ) : null}
        {empty ? (
          <article className="public-profile-empty">
            <span>
              <Sparkles aria-hidden="true" />
            </span>
            <div>
              <h2 id="professional-summary-title">{copy.inProgress}</h2>
              <p>{copy.inProgressDescription}</p>
            </div>
          </article>
        ) : null}
      </section>
    </main>
  );
}

function ProfileList({
  title,
  detailsLabel,
  isSkills = false,
  icon,
  items,
}: {
  title: string;
  detailsLabel: string;
  isSkills?: boolean;
  icon: ReactNode;
  items: string[];
}) {
  return (
    <article className="public-profile-card">
      <header>
        <span className="public-profile-card__icon">{icon}</span>
        <div>
          <p className="workspace-kicker">{detailsLabel}</p>
          <h2>{title}</h2>
        </div>
      </header>
      <ul
        className={isSkills ? "public-profile-skills" : "public-profile-list"}
      >
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function ProfileLinks({
  detailsLabel,
  title,
  links,
}: {
  detailsLabel: string;
  title: string;
  links: string[];
}) {
  return (
    <article className="public-profile-card">
      <header>
        <span className="public-profile-card__icon">
          <Link2 aria-hidden="true" />
        </span>
        <div>
          <p className="workspace-kicker">{detailsLabel}</p>
          <h2>{title}</h2>
        </div>
      </header>
      <ul className="public-profile-list">
        {links.map((link) => (
          <li key={link}>
            <a href={link} target="_blank" rel="noreferrer">
              {link}
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}
