import type {
  ApplicationOutcome,
  JobProblem,
} from "@/shared/contracts/jobs/actions";
import type {
  JobCard,
  JobDetail,
  JobSearchResponse,
} from "@/shared/contracts/jobs/discovery";
import type { CareerPathSlug } from "@/shared/contracts/jobs/career-paths";

export type CandidateActor = { userId: string; sessionId: string };
export type JobActor =
  | { kind: "visitor" }
  | ({ kind: "user" } & CandidateActor);
export type PublicJobState = "ACTIVE" | "CLOSED" | "EXPIRED";

export type NormalizedJobSearch = {
  /** Internal scope used by public company pages; never accepted from the
   * unrestricted Find Jobs query string. */
  companyId?: string;
  normalizedQuery: string;
  searchVariants?: import("@/backend/services/search/search-query-resolver").SearchQueryVariant[];
  searchInterpretation?: import("@/backend/services/search/search-query-resolver").SearchInterpretation;
  resolverVersion?: string;
  searchBy?: "TITLE" | "COMPANY" | "BOTH";
  normalizedLocation: string;
  normalizedDistricts?: string[];
  categoryFamily?: string[];
  /** Exact role-category identifiers selected from the job taxonomy. */
  categoryIds?: string[];
  /** Exact normalized public job titles selected from the role explorer. */
  normalizedRoleTitles?: string[];
  normalizedSkills: string[];
  employmentType: Array<
    "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERNSHIP" | "TEMPORARY"
  >;
  experienceLevel: Array<
    "ENTRY" | "JUNIOR" | "MID" | "SENIOR" | "LEAD" | "MANAGER"
  >;
  workArrangement: Array<"ONSITE" | "HYBRID" | "REMOTE">;
  careerPath?: CareerPathSlug;
  salaryMin?: number;
  salaryMax?: number;
  /** Matches public cards without a complete numeric salary range. */
  salaryNegotiable?: true;
  salaryCurrency: string;
  salaryPeriod: "HOUR" | "MONTH" | "YEAR";
  postedWithinDays?: number;
  sort: "RELEVANCE" | "NEWEST" | "SALARY_DESC" | "UPDATED" | "URGENT";
  cursor?: import("./search-normalization").JobSearchCursor;
  page?: number;
  limit: number;
};
export type {
  ApplicationOutcome,
  JobCard,
  JobDetail,
  JobProblem,
  JobSearchResponse,
};

export type JobServiceStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503;

export class JobServiceError extends Error {
  constructor(
    readonly status: JobServiceStatus,
    readonly body: JobProblem,
  ) {
    super(body.code);
  }
}
