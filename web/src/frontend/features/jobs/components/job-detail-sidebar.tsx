"use client";

import Link from "next/link";
import { CollapsibleCard } from "@/frontend/components/ui/collapsible-card";
import { RatingRow } from "@/frontend/components/ui/rating-row";
import { RelatedJobRow } from "@/frontend/components/ui/related-job-row";
import type { JobCard, JobDetail } from "@/shared/contracts/jobs/discovery";
import { formatSalary } from "@/shared/utils/jobs/job-display";
import { CompanyAvatar } from "./company-avatar";
import { JobMetaIcon, type JobMetaIconName } from "./job-meta-icon";
import { ReportJobDialog } from "./report-job-dialog";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { jobCopy } from "./job-copy";

export type CompanyWithMeta = JobDetail["company"] & {
  logo?: string | null;
  rating?: { score: number; reviewCount?: number };
};

function companyWithMeta(company: JobDetail["company"]): CompanyWithMeta {
  return company as CompanyWithMeta;
}

function nonEmpty(value: string | null | undefined) {
  return value?.trim() ? value : null;
}

function resolveSidebarCompany(company: CompanyWithMeta): CompanyWithMeta {
  // Job detail data is database-backed. Keep this client component independent
  // from the removed static catalogue so a valid job never fails to render
  // because an optional local fixture file is absent from a deployment image.
  return {
    ...company,
    displayName: nonEmpty(company.displayName) ?? "Company",
    logoUrl:
      nonEmpty(company.logoUrl) ??
      nonEmpty(company.logo) ??
      null,
    websiteUrl: nonEmpty(company.websiteUrl) ?? null,
    publicDescription: nonEmpty(company.publicDescription) ?? null,
    publicLocation: nonEmpty(company.publicLocation) ?? null,
    size: nonEmpty(company.size) ?? undefined,
    industry: nonEmpty(company.industry) ?? undefined,
    address: nonEmpty(company.address) ?? undefined,
    rating: company.rating,
  };
}

function SidebarCompanyLogo({
  company,
  large = false,
}: {
  company: CompanyWithMeta;
  large?: boolean;
}) {
  const data = resolveSidebarCompany(company);
  return (
    <CompanyAvatar
      name={data.displayName}
      imageUrl={data.logoUrl ?? data.logo}
      size={large ? "lg" : "md"}
      className={"job-sidebar-company-logo" + (large ? " is-large" : "")}
      loading={large ? "eager" : "lazy"}
    />
  );
}

export function CompanyLogo({
  company,
  large = false,
}: {
  company: JobDetail["company"] | JobCard["company"];
  large?: boolean;
}) {
  const data = companyWithMeta(company);
  return (
    <CompanyAvatar
      name={data.displayName}
      imageUrl={data.logoUrl ?? data.logo}
      size={large ? "lg" : "md"}
      className={"job-company-logo" + (large ? " is-large" : "")}
      loading={large ? "eager" : "lazy"}
    />
  );
}

function displayValue(value: string | null | undefined, emptyLabel: string) {
  return value?.trim() ? value : emptyLabel;
}

function SidebarCardHeading({
  eyebrow,
  title,
  mark,
  headingId,
}: {
  eyebrow: string;
  title: string;
  mark: string;
  headingId: string;
}) {
  return (
    <div className="job-sidebar-card-heading">
      <div>
        <p className="panel-kicker">{eyebrow}</p>
        <h2 id={headingId}>{title}</h2>
      </div>
      <span className="job-sidebar-card-mark" aria-hidden="true">
        {mark}
      </span>
    </div>
  );
}

export function CompanyCard({ job }: { job: JobDetail }) {
  const locale = useWorkspaceLocale();
  const copy = jobCopy(locale);
  const company = resolveSidebarCompany(job.company);
  const rating = company.rating;

  return (
    <CollapsibleCard
      id="company"
      className="job-sidebar-card job-company-card job-sidebar-card--redesign job-company-accordion"
      defaultExpanded
      titleId="company-card-heading"
      triggerClassName="job-company-accordion-summary"
      contentClassName="job-company-accordion-content"
      title={
        <span className="job-company-accordion-heading">
          <span className="panel-kicker">{copy.company}</span>
          <span
            className="job-company-accordion-title"
            role="heading"
            aria-level={2}
          >
            {copy.companyInfo}
          </span>
        </span>
      }
      persistentContent={
        <div className="job-company-accordion-identity">
          <SidebarCompanyLogo company={company} large />
          <div className="job-company-accordion-copy">
            <p className="job-company-accordion-name">{company.displayName}</p>
            {job.isVerified ? (
              <span className="job-verified-inline">
                <span aria-hidden="true">✓</span> {copy.verifiedEmployer}
              </span>
            ) : null}
          </div>
        </div>
      }
    >
      {rating ? (
        <RatingRow score={rating.score} reviewCount={rating.reviewCount} />
      ) : null}

      <p className="job-sidebar-company-copy">
        {displayValue(company.publicDescription, copy.notListed)}
      </p>

      <dl className="job-sidebar-company-facts">
        <div>
          <dt>
            <span className="job-sidebar-fact-icon" aria-hidden="true">
              <JobMetaIcon name="company-size" />
            </span>
            {copy.scale}
          </dt>
          <dd>{displayValue(company.size, copy.notListed)}</dd>
        </div>
        <div>
          <dt>
            <span className="job-sidebar-fact-icon" aria-hidden="true">
              <JobMetaIcon name="industry" />
            </span>
            {copy.industry}
          </dt>
          <dd>{displayValue(company.industry, copy.notListed)}</dd>
        </div>
        <div>
          <dt>
            <span className="job-sidebar-fact-icon" aria-hidden="true">
              <JobMetaIcon name="location" />
            </span>
            {copy.address}
          </dt>
          <dd>
            {displayValue(
              company.address ?? company.publicLocation,
              copy.notListed,
            )}
          </dd>
        </div>
      </dl>

      {company.websiteUrl ? (
        <a
          className="sh-button sh-button--outline job-company-profile-button"
          href={company.websiteUrl}
          target="_blank"
          rel="noreferrer"
        >
          {copy.visitCompanyWebsite} <span aria-hidden="true">→</span>
        </a>
      ) : null}
    </CollapsibleCard>
  );
}

function InfoRow({
  icon,
  label,
  value,
  emptyLabel,
}: {
  icon: JobMetaIconName;
  label: string;
  value: string;
  emptyLabel: string;
}) {
  return (
    <div className="job-general-info-row">
      <span className="job-general-info-icon" aria-hidden="true">
        <JobMetaIcon name={icon} />
      </span>
      <dt>{label}</dt>
      <dd>{displayValue(value, emptyLabel)}</dd>
    </div>
  );
}

export function GeneralInfoCard({ job }: { job: JobDetail }) {
  const locale = useWorkspaceLocale();
  const copy = jobCopy(locale);
  const experienceLabels = copy.experienceLevelLabels;
  const workArrangementLabels = copy.workArrangementLabels;
  const employmentTypeLabels = copy.employmentTypeLabels;
  return (
    <section
      className="job-sidebar-card job-sidebar-card--redesign"
      aria-labelledby="general-information-heading"
    >
      <SidebarCardHeading
        eyebrow={copy.atAGlance}
        title={copy.generalInformation}
        mark="◆"
        headingId="general-information-heading"
      />
      <dl className="job-general-info-list">
        <InfoRow
          icon="level"
          label={copy.level}
          value={experienceLabels[job.experienceLevel] ?? copy.notListed}
          emptyLabel={copy.notListed}
        />
        <InfoRow
          icon="education"
          label={copy.education}
          value={job.education?.trim() || copy.notListed}
          emptyLabel={copy.notListed}
        />
        <InfoRow
          icon="hires"
          label={copy.numberOfHires}
          value={
            job.numberOfHires === undefined || job.numberOfHires === null
              ? copy.notListed
              : copy.positions(job.numberOfHires)
          }
          emptyLabel={copy.notListed}
        />
        <InfoRow
          icon="arrangement"
          label={copy.workArrangement}
          value={workArrangementLabels[job.workArrangement] ?? copy.notListed}
          emptyLabel={copy.notListed}
        />
        <InfoRow
          icon="employment"
          label={copy.employmentType}
          value={employmentTypeLabels[job.employmentType] ?? copy.notListed}
          emptyLabel={copy.notListed}
        />
      </dl>
    </section>
  );
}

function SimilarJobRow({ job }: { job: JobCard }) {
  const locale = useWorkspaceLocale();
  const company = resolveSidebarCompany(job.company);
  return (
    <RelatedJobRow
      compact
      href={`/jobs/${job.slug}`}
      avatarLabel={company.displayName.slice(0, 2).toUpperCase()}
      avatar={<SidebarCompanyLogo company={company} />}
      title={job.title}
      company={company.displayName}
      location={job.location}
      salaryRange={formatSalary(job.salary, locale)}
    />
  );
}

export function SimilarJobsCard({ job }: { job: JobDetail }) {
  const copy = jobCopy(useWorkspaceLocale());
  const relatedJobIds = new Set((job.relatedJobs ?? []).map((item) => item.id));
  const similarJobs = (job.recommendedJobs ?? [])
    .filter((item) => !relatedJobIds.has(item.id))
    .slice(0, 5);

  return (
    <section
      className="job-sidebar-card job-sidebar-card--redesign job-similar-jobs-card"
      aria-labelledby="similar-jobs-heading"
    >
      <SidebarCardHeading
        eyebrow={copy.exploreMore}
        title={copy.similarJobs}
        mark="↗"
        headingId="similar-jobs-heading"
      />
      {similarJobs.length ? (
        <div className="job-sidebar-similar-list">
          {similarJobs.map((item) => (
            <SimilarJobRow key={item.id} job={item} />
          ))}
        </div>
      ) : (
        <p className="job-section-muted">{copy.similarJobsEmpty}</p>
      )}
      <Link className="job-similar-more-link" href="/jobs">
        {copy.seeMore} <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

export function ReportJobWidget({ job }: { job: JobDetail }) {
  const copy = jobCopy(useWorkspaceLocale());
  return (
    <section
      className="job-sidebar-card job-sidebar-card--redesign job-report-widget"
      aria-labelledby="report-this-job-heading"
    >
      <div className="job-report-widget-heading">
        <span className="job-report-widget-icon" aria-hidden="true">
          !
        </span>
        <div>
          <p className="panel-kicker">{copy.safetyCheck}</p>
          <h2 id="report-this-job-heading">{copy.reportJob}</h2>
        </div>
      </div>
      <p>{copy.reportJobDescription}</p>
      <ReportJobDialog jobId={job.id} className="job-report-widget-button" />
    </section>
  );
}

export function JobDetailSidebar({ job }: { job: JobDetail }) {
  const copy = jobCopy(useWorkspaceLocale());
  return (
    <aside
      className="job-detail-sidebar job-detail-sidebar--redesign job-detail-sidebar--board"
      aria-label={copy.jobContext}
      data-job-detail-sidebar="true"
    >
      <CompanyCard job={job} />
      <GeneralInfoCard job={job} />
      <SimilarJobsCard job={job} />
      <ReportJobWidget job={job} />
    </aside>
  );
}
