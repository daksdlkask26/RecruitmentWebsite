import "server-only";
import { createHash } from "node:crypto";
import {
  jobReviewSnapshotSchema,
  type JobReviewSnapshot,
} from "@/shared/contracts/recruiter-job-posting";
import type { JobPostReviewState } from "@/shared/contracts/admin/job-post-review";
import type { JobCatalogItem } from "@/shared/contracts/jobs/catalog";
import { buildJobSearchProfile } from "@/backend/services/search/job-search-profile";
import type { SearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";

export const JOB_REVIEW_SNAPSHOT_SCHEMA_VERSION = "1";

function normalizeValue(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        normalizeValue(nested),
      ]),
    );
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function normalizeJobReviewSnapshot(value: unknown): JobReviewSnapshot {
  return jobReviewSnapshotSchema.parse(normalizeValue(value));
}

export function withoutJobSearchProfile(
  value: JobReviewSnapshot,
): Omit<JobReviewSnapshot, "searchProfile"> {
  const content = { ...value };
  delete content.searchProfile;
  return content;
}

export function jobReviewSnapshotFromCatalog(
  value: JobCatalogItem,
  authoritativeCompanyId: string,
  catalogIndex?: SearchCatalogIndex,
) {
  const candidate = {
    ...value,
    companyId: authoritativeCompanyId,
  } as Record<string, unknown>;
  for (const field of [
    "status",
    "approvalComment",
    "isVerified",
    "postedAt",
    "updatedAt",
    "stats",
  ])
    delete candidate[field];
  candidate.searchProfile = buildJobSearchProfile(
    {
      title: value.title,
      industryCode: value.industryCode,
      categoryFamily: value.categoryFamily,
      categoryIds: value.categoryIds,
      skills: value.skillTags,
      description: [
        value.description.overview,
        ...value.description.responsibilities,
        ...value.description.requirements,
      ],
    },
    catalogIndex ? { index: catalogIndex } : undefined,
  );
  return normalizeJobReviewSnapshot(candidate);
}

export function jobReviewSnapshotSha256(value: unknown): string {
  const snapshot = normalizeJobReviewSnapshot(value);
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

export function jobReviewMaterialIdentity(value: unknown): string {
  return `${JOB_REVIEW_SNAPSHOT_SCHEMA_VERSION}:${jobReviewSnapshotSha256(value)}`;
}

export function canTransitionJobPostReview(
  current: JobPostReviewState,
  target: JobPostReviewState,
): boolean {
  return (
    current === "PENDING_REVIEW" &&
    (target === "APPROVED" || target === "REJECTED")
  );
}

export type JobPostDecisionPolicyCode =
  | "ACTION_BLOCKED"
  | "STALE_CONFLICT"
  | "TARGET_UNAVAILABLE"
  | "CONTENT_INTEGRITY_BLOCKED"
  | "COMPANY_INELIGIBLE"
  | "SUBMITTER_INELIGIBLE"
  | "DEADLINE_EXPIRED";

export class JobPostDecisionPolicyError extends Error {
  constructor(public readonly code: JobPostDecisionPolicyCode) {
    super(code);
  }
}

export function validateJobPostDecision(input: {
  decision: "APPROVE" | "REJECT";
  reviewState: JobPostReviewState;
  assignedAdminUserId: string | null;
  actorUserId: string;
  administratorEligible: boolean;
  companyEligible: boolean;
  submitterEligible: boolean;
  currentAggregateVersion: number;
  expectedAggregateVersion: number;
  snapshot: unknown;
  storedSnapshotSha256: string;
  now: Date;
}) {
  if (!input.administratorEligible)
    throw new JobPostDecisionPolicyError("TARGET_UNAVAILABLE");
  if (input.reviewState !== "PENDING_REVIEW")
    throw new JobPostDecisionPolicyError("ACTION_BLOCKED");
  if (input.assignedAdminUserId !== input.actorUserId)
    throw new JobPostDecisionPolicyError("ACTION_BLOCKED");
  if (input.currentAggregateVersion !== input.expectedAggregateVersion)
    throw new JobPostDecisionPolicyError("STALE_CONFLICT");
  const snapshot = normalizeJobReviewSnapshot(input.snapshot);
  if (jobReviewSnapshotSha256(snapshot) !== input.storedSnapshotSha256)
    throw new JobPostDecisionPolicyError("CONTENT_INTEGRITY_BLOCKED");
  if (input.decision === "APPROVE") {
    if (!input.companyEligible)
      throw new JobPostDecisionPolicyError("COMPANY_INELIGIBLE");
    if (!input.submitterEligible)
      throw new JobPostDecisionPolicyError("SUBMITTER_INELIGIBLE");
    const deadline = snapshot.applyDeadline
      ? new Date(snapshot.applyDeadline)
      : null;
    if (!deadline || deadline <= input.now)
      throw new JobPostDecisionPolicyError("DEADLINE_EXPIRED");
  }
  return { snapshot };
}
