import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { serverEnvironment } from "@/backend/env/runtime";
import { JobDiscoveryService } from "@/backend/services/jobs/job-discovery-service";
import { JobServiceError } from "@/backend/services/jobs/job-types";
import { optionalJobActor } from "@/backend/security/job-request-boundary";
import { QualifiedViewService } from "@/backend/analytics/qualified-view-service";
import { JobDetailView } from "@/frontend/features/jobs/components/job-detail";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { jobCopy } from "@/frontend/features/jobs/components/job-copy";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function load(slug: string) {
  const requestHeaders = await headers();
  const actor = await optionalJobActor(requestHeaders);
  const job = await new JobDiscoveryService().detail(
    slug,
    actor,
    new Date(),
    serverEnvironment.NEXT_PUBLIC_APP_URL,
  );
  void new QualifiedViewService()
    .admit({
      jobPostingId: job.id,
      headers: new Headers(requestHeaders),
      actorUserId: actor.kind === "user" ? actor.userId : null,
    })
    .catch(() => undefined);
  return job;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const context = await getWorkspaceContext();
  const copy = jobCopy(context?.initialLocale ?? "en");
  try {
    const job = await load((await params).slug);
    return {
      title: `${job.title} · ${job.company.displayName}`,
      description: job.summary,
      alternates: { canonical: job.canonicalUrl },
    };
  } catch {
    return {
      title: `${copy.unavailableTitle} · SmartHire`,
      robots: { index: false, follow: false },
    };
  }
}

export default async function JobDetailPage({ params }: Props) {
  const context = await getWorkspaceContext();
  const copy = jobCopy(context?.initialLocale ?? "en");
  let job: Awaited<ReturnType<typeof load>> | null = null;
  let failed = false;
  try {
    job = await load((await params).slug);
  } catch (error) {
    // Production bundles can materialize an error class through a separate
    // route chunk, so keep the public-unavailable boundary structural as well
    // as instanceof-based. A revoked Company/Job must return the neutral 404
    // page instead of a generic 200 error shell.
    if (
      (error instanceof JobServiceError && error.status === 404) ||
      (error &&
        typeof error === "object" &&
        "status" in error &&
        (error as { status?: unknown }).status === 404)
    )
      return notFound();
    failed = true;
  }
  if (failed || !job) {
    return (
      <div className="jobs-page jobs-detail-page">
        <div className="job-panel job-feedback" role="alert">
          <h1>{copy.detailsLoadError}</h1>
          <p>{copy.tryAgainLater}</p>
          <Link className="job-secondary-link" href="/jobs">
            {copy.backToJobs}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="jobs-page jobs-detail-page">
      <JobDetailView job={job} />
    </div>
  );
}
