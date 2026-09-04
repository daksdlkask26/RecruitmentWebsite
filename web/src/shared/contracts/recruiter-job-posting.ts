import {
  companyCatalogSchema,
  jobDraftCatalogSchema,
  jobCatalogSchema,
  jobPostingStatusSchema,
  type CompanyCatalogItem,
  type JobCatalogItem,
  type JobPostingStatus,
  type RecruiterCompanyRole,
} from "./jobs/catalog";
import {
  deriveRecruiterClassification,
  isRecruiterIndustrySelectionValid,
} from "./jobs/industry-taxonomy";
import { z } from "zod";
import type { RecruiterReviewProjection } from "./admin/job-post-review";
import type { RecruiterJobTaxonomy } from "./jobs/job-taxonomy";
import { jobSearchProfileSchema } from "./search/job-search-intent";

export {
  companyCatalogSchema,
  jobDraftCatalogSchema,
  jobCatalogSchema,
  jobPostingStatusSchema,
};
export type { CompanyCatalogItem, JobCatalogItem, JobPostingStatus };

export type RecruiterJobStatus = JobPostingStatus;

const serverOwnedJobFields = {
  status: true,
  approvalComment: true,
  isVerified: true,
  postedAt: true,
  updatedAt: true,
  stats: true,
} as const;

/** Immutable, normalized content captured by the server at submission time. */
export const jobReviewSnapshotSchema = jobCatalogSchema
  .omit(serverOwnedJobFields)
  .extend({ searchProfile: jobSearchProfileSchema.optional() })
  .strict();

/** Fields a Recruiter may author. Identity and lifecycle facts are server-derived. */
export const recruiterJobReviewInputSchema = jobReviewSnapshotSchema
  .omit({ id: true, slug: true, companyId: true, searchProfile: true })
  .strict();

export const submitJobReviewCommandSchema = z
  .object({ expectedWorkingUpdatedAt: z.string().datetime() })
  .extend({
    job: jobCatalogSchema.optional(),
    expectedCatalogueUpdatedAt: z.string().datetime().optional(),
  })
  .strict();

export type JobReviewSnapshot = z.infer<typeof jobReviewSnapshotSchema>;
export type RecruiterJobReviewInput = z.infer<
  typeof recruiterJobReviewInputSchema
>;

export const recruiterJobStatusMeta: Record<
  RecruiterJobStatus,
  {
    label: string;
    description: string;
    tone: "info" | "warning" | "success" | "error" | "neutral";
  }
> = {
  active: {
    label: "Active",
    description: "Visible to candidates",
    tone: "success",
  },
  draft: {
    label: "Draft",
    description: "Not submitted",
    tone: "neutral",
  },
  pending_approval: {
    label: "Pending approval",
    description: "Waiting for admin review",
    tone: "warning",
  },
  rejected: {
    label: "Rejected",
    description: "Needs revision",
    tone: "error",
  },
  closed: {
    label: "Closed",
    description: "No longer accepting applications",
    tone: "neutral",
  },
};

export type RecruiterCompanyView = Omit<
  CompanyCatalogItem,
  "memberUserIds" | "taxCode" | "verificationStatus"
> &
  Partial<
    Pick<CompanyCatalogItem, "memberUserIds" | "taxCode" | "verificationStatus">
  > & {
    /** Persistent company id used by company-team APIs when the job catalogue id differs. */
    databaseId?: string;
    role?: RecruiterCompanyRole;
    profileComplete?: boolean;
    missingProfileFields?: Array<
      "name" | "industry" | "size" | "address" | "logo"
    >;
  };
export type RecruiterJob = JobCatalogItem & {
  company: RecruiterCompanyView;
  review?: RecruiterReviewProjection;
  correctionRequest?: {
    id: string;
    publicExplanation: string;
    hideImmediately: boolean;
    createdAt: string;
  };
};

export type RecruiterJobManagementData = {
  jobs: RecruiterJob[];
  companies: RecruiterCompanyView[];
  /** Active platform taxonomy used by every recruiter company. */
  jobTaxonomy?: RecruiterJobTaxonomy;
  companyId: string | null;
  recruiterUserId?: string;
  companyProfileComplete?: boolean;
  missingCompanyProfileFields?: Array<
    "name" | "industry" | "size" | "address" | "logo"
  >;
};

export type RecruiterJobFieldErrors = Record<string, string>;

const vndInputFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});
const vndPreviewFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function parseVndInput(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 0;

  const millionSuffix = /(?:tr|trieu|triệu|m)\s*$/iu;
  const hasMillionSuffix = millionSuffix.test(normalized);
  if (hasMillionSuffix) {
    const numericPart = normalized
      .replace(millionSuffix, "")
      .replace(/\s+/gu, "")
      .replace(",", ".");
    const millions = Number.parseFloat(numericPart);
    return Number.isFinite(millions) && millions >= 0
      ? Math.round(millions * 1_000_000)
      : 0;
  }

  const digits = normalized.replace(/\D+/gu, "");
  if (!digits) return 0;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

export function formatVndInput(value: number): string {
  return Number.isFinite(value) && value > 0
    ? vndInputFormatter.format(Math.round(value))
    : "";
}

export function formatRecruiterSalary(
  salary: JobCatalogItem["salary"],
): string | null {
  const minimum = salary.min > 0 ? salary.min : null;
  const maximum = salary.max > 0 ? salary.max : null;
  if (minimum === null && maximum === null) return null;

  const suffix = `${salary.currency}/${salary.period}`;
  if (minimum !== null && maximum !== null) {
    return `${vndPreviewFormatter.format(minimum)} - ${vndPreviewFormatter.format(maximum)} ${suffix}`;
  }
  if (minimum !== null) {
    return `From ${vndPreviewFormatter.format(minimum)} ${suffix}`;
  }
  return `Up to ${vndPreviewFormatter.format(maximum ?? 0)} ${suffix}`;
}
const requiredFieldMessages: Record<string, string> = {
  title: "Enter a job title.",
  shortPitch: "Add a short pitch.",
  industry: "Enter an industry.",
  subIndustry: "Enter a sub-industry.",
  "location.city": "Enter a city.",
  "description.overview": "Add a role overview.",
  "description.responsibilities": "Add at least one responsibility.",
  "description.requirements": "Add at least one requirement.",
  "experience.label": "Enter an experience level.",
  level: "Enter a job level.",
  employmentType: "Choose an employment type.",
  workArrangement: "Choose a work arrangement.",
  education: "Enter an education requirement.",
};

function uniqueTrimmed(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function nullableTrimmed(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function prepareRecruiterJobForSave(
  job: JobCatalogItem,
): JobCatalogItem {
  const classification = deriveRecruiterClassification(job);
  const sharedSubIndustryCode =
    job.subIndustryCode?.trim() || job.subIndustryId?.trim() || null;
  const hasSharedSubIndustry = Boolean(
    job.subIndustryId && sharedSubIndustryCode,
  );
  const subIndustry = hasSharedSubIndustry
    ? job.subIndustry.trim()
    : classification.subIndustry;
  return {
    ...job,
    title: job.title.trim(),
    shortPitch: job.shortPitch.trim(),
    industry: classification.industry,
    industryCode: classification.industryCode,
    industryId: job.industryId?.trim() || classification.industryId,
    subIndustry,
    subIndustryId: hasSharedSubIndustry
      ? job.subIndustryId
      : classification.subIndustryId,
    subIndustryCode: hasSharedSubIndustry
      ? sharedSubIndustryCode
      : classification.subIndustryCode,
    categoryIds: hasSharedSubIndustry
      ? [sharedSubIndustryCode!]
      : classification.categoryIds,
    categoryFamily: classification.categoryFamily,
    skillTags: uniqueTrimmed(job.skillTags),
    location: {
      ...job.location,
      city: job.location.city.trim(),
      district: nullableTrimmed(job.location.district),
    },
    experience: {
      ...job.experience,
      label: job.experience.label.trim(),
    },
    level: job.level.trim(),
    employmentType: job.employmentType.trim(),
    workArrangement: job.workArrangement.trim(),
    education: job.education.trim(),
    age: job.age.trim(),
    description: {
      ...job.description,
      overview: job.description.overview.trim(),
      topReasonsToJoin: uniqueTrimmed(job.description.topReasonsToJoin),
      responsibilities: uniqueTrimmed(job.description.responsibilities),
      requirements: uniqueTrimmed(job.description.requirements),
      benefits: job.description.benefits
        .map((benefit) => ({
          icon: benefit.icon.trim(),
          label: benefit.label.trim(),
        }))
        .filter((benefit) => benefit.icon && benefit.label),
      generalInfo: {
        reportsTo: nullableTrimmed(job.description.generalInfo.reportsTo),
        department: hasSharedSubIndustry
          ? subIndustry || null
          : classification.department,
        workingHours: nullableTrimmed(job.description.generalInfo.workingHours),
        workAddress: nullableTrimmed(job.description.generalInfo.workAddress),
      },
    },
  };
}

export function validateRecruiterJobForSave(
  job: JobCatalogItem,
  targetStatus: JobPostingStatus,
  now = new Date(),
): RecruiterJobFieldErrors {
  const prepared = prepareRecruiterJobForSave(job);
  const classification = deriveRecruiterClassification(job);
  const errors: RecruiterJobFieldErrors = {};

  if (!isRecruiterIndustrySelectionValid(job)) {
    errors.industry = "Choose an industry from the list.";
  }
  if (targetStatus !== "draft" && !classification.valid) {
    errors.subIndustry = classification.subIndustry
      ? "Enter a valid sub-industry."
      : "Enter a sub-industry.";
  }

  if (targetStatus !== "draft") {
    for (const [path, message] of Object.entries(requiredFieldMessages)) {
      const value =
        path === "location.city"
          ? prepared.location.city
          : path === "description.overview"
            ? prepared.description.overview
            : path === "experience.label"
              ? prepared.experience.label
              : prepared[path as keyof JobCatalogItem];
      if (typeof value === "string" && !value) errors[path] = message;
    }
    if (!prepared.description.responsibilities.length) {
      errors["description.responsibilities"] =
        requiredFieldMessages["description.responsibilities"];
    }
    if (!prepared.description.requirements.length) {
      errors["description.requirements"] =
        requiredFieldMessages["description.requirements"];
    }
  }

  if (targetStatus !== "draft" && prepared.numberOfHires < 1) {
    errors.numberOfHires = "Number of hires must be at least 1.";
  }
  if (prepared.experience.minYears < 0) {
    errors["experience.minYears"] = "Minimum experience cannot be less than 0.";
  }
  if (prepared.salary.min < 0) {
    errors["salary.min"] = "Minimum salary cannot be less than 0.";
  }
  if (targetStatus !== "draft" && prepared.salary.max < prepared.salary.min) {
    errors["salary.max"] =
      "Maximum salary must be greater than or equal to minimum salary.";
  }
  if (targetStatus === "pending_approval" && !prepared.applyDeadline) {
    errors.applyDeadline = "Choose an application deadline.";
  } else if (
    targetStatus !== "draft" &&
    prepared.applyDeadline &&
    new Date(prepared.applyDeadline).getTime() <= now.getTime()
  ) {
    errors.applyDeadline = "Application deadline must be in the future.";
  }

  const parsed = (
    targetStatus === "draft" ? jobDraftCatalogSchema : jobCatalogSchema
  ).safeParse({
    ...prepared,
    status: targetStatus,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (path && !errors[path]) {
        errors[path] =
          requiredFieldMessages[path] ?? "Review this field and try again.";
      }
    }
  }

  return errors;
}

export function createEmptyJobPosting(
  companyId = "",
  now = new Date(),
): JobCatalogItem {
  const timestamp = now.toISOString();
  return {
    id: "new-job",
    slug: "new-job",
    companyId,
    title: "",
    shortPitch: "",
    industry: "Information Technology (IT)",
    industryCode: "r03",
    subIndustry: "Software Development",
    categoryIds: ["r03-software-development"],
    categoryFamily: "r03",
    skillTags: [],
    location: {
      city: "Ho Chi Minh City",
      district: null,
      isNationwideRemote: false,
    },
    salary: {
      min: 0,
      max: 0,
      currency: "VND",
      period: "month",
      isNegotiable: true,
    },
    experience: { minYears: 0, label: "Entry level" },
    level: "staff",
    employmentType: "full_time",
    workArrangement: "onsite",
    workOnSaturday: false,
    education: "College degree or above",
    age: "",
    numberOfHires: 1,
    status: "draft",
    approvalComment: null,
    isUrgent: false,
    isVerified: false,
    postedAt: timestamp,
    updatedAt: timestamp,
    applyDeadline: null,
    description: {
      overview: "",
      topReasonsToJoin: [],
      responsibilities: [],
      requirements: [],
      benefits: [],
      generalInfo: {
        reportsTo: null,
        department: "Software Development",
        workingHours: null,
        workAddress: null,
      },
    },
    stats: { viewCount: 0, applicantCount: 0 },
  };
}
