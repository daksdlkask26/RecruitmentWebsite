import "server-only";
import { normalizeJobReviewSnapshot } from "./job-post-review-policy";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";

const employmentTypes = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACT",
  internship: "INTERNSHIP",
  temporary: "TEMPORARY",
} as const;
const experienceLevels = {
  intern: "ENTRY",
  staff: "MID",
  entry: "ENTRY",
  junior: "JUNIOR",
  mid: "MID",
  senior: "SENIOR",
  team_lead: "LEAD",
  lead: "LEAD",
  manager: "MANAGER",
  executive: "MANAGER",
  director: "MANAGER",
} as const;
const workArrangements = {
  onsite: "ONSITE",
  hybrid: "HYBRID",
  remote: "REMOTE",
} as const;
const salaryPeriods = {
  hour: "HOUR",
  month: "MONTH",
  year: "YEAR",
} as const;

function mapped<T extends string>(
  mapping: Record<string, T>,
  value: string,
): T {
  const result = mapping[value.trim().toLowerCase()];
  if (!result) throw new Error("UNPUBLISHABLE_JOB_MAPPING");
  return result;
}

function withinPublicTextBounds(
  value: string,
  minimum: number,
  maximum: number,
) {
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

function assertPublishableText(input: {
  title: string;
  summary: string;
  responsibilities: string;
  requirements: string;
  benefits: string | null;
  location: string;
  normalizedTitle: string;
  normalizedLocation: string;
  searchDocumentNormalized: string;
}) {
  if (
    !withinPublicTextBounds(input.title, 1, 200) ||
    !withinPublicTextBounds(input.summary, 1, 500) ||
    !withinPublicTextBounds(input.responsibilities, 1, 12_000) ||
    !withinPublicTextBounds(input.requirements, 1, 12_000) ||
    (input.benefits !== null &&
      !withinPublicTextBounds(input.benefits, 1, 8_000)) ||
    !withinPublicTextBounds(input.location, 1, 160) ||
    !withinPublicTextBounds(input.normalizedTitle, 1, 200) ||
    !withinPublicTextBounds(input.normalizedLocation, 1, 160) ||
    !withinPublicTextBounds(input.searchDocumentNormalized, 1, 60_000)
  ) {
    // Keep the database check constraint from becoming an opaque 500 during
    // approval. The caller turns this into a safe validation/integrity result.
    throw new Error("UNPUBLISHABLE_JOB_CONTENT");
  }
}

export function projectJobReviewSnapshot(value: unknown) {
  const snapshot = normalizeJobReviewSnapshot(value);
  const skills = Array.from(
    new Map(
      snapshot.skillTags.map((displayName, position) => {
        const normalizedName = normalizeSearchText(displayName.trim(), 80);
        return [
          normalizedName,
          { displayName, normalizedName, position, required: true },
        ];
      }),
    ).values(),
  );
  const location = snapshot.location.isNationwideRemote
    ? `Remote · ${snapshot.location.city}`
    : [snapshot.location.district, snapshot.location.city]
        .filter(Boolean)
        .join(", ");
  const responsibilities = snapshot.description.responsibilities.join("\n");
  const requirements = snapshot.description.requirements.join("\n");
  const benefits =
    snapshot.description.benefits.map((item) => item.label).join("\n") || null;
  const searchDocumentNormalized = normalizeSearchText(
    [
      snapshot.title,
      snapshot.shortPitch,
      location,
      snapshot.industry,
      snapshot.subIndustry,
      ...snapshot.skillTags,
      snapshot.description.overview,
      ...responsibilities.split("\n"),
      ...requirements.split("\n"),
      ...(benefits ? benefits.split("\n") : []),
      ...(snapshot.education ? [snapshot.education] : []),
      ...snapshot.description.topReasonsToJoin,
    ].join(" "),
    60_000,
  );
  const normalizedTitle = normalizeSearchText(snapshot.title, 200);
  const normalizedLocation = normalizeSearchText(location, 160);
  assertPublishableText({
    title: snapshot.title,
    summary: snapshot.shortPitch,
    responsibilities,
    requirements,
    benefits,
    location,
    normalizedTitle,
    normalizedLocation,
    searchDocumentNormalized,
  });
  return {
    companyId: snapshot.companyId,
    slug: snapshot.slug,
    title: snapshot.title,
    normalizedTitle,
    summary: snapshot.shortPitch,
    description: snapshot.description.overview,
    responsibilities,
    requirements,
    benefits,
    education: snapshot.education || null,
    numberOfHires: snapshot.numberOfHires,
    age: snapshot.age || null,
    location,
    normalizedLocation,
    employmentType: mapped(employmentTypes, snapshot.employmentType),
    experienceLevel: mapped(experienceLevels, snapshot.level),
    workArrangement: mapped(workArrangements, snapshot.workArrangement),
    salaryMin: snapshot.salary.min,
    salaryMax: snapshot.salary.max,
    salaryCurrency: snapshot.salary.currency,
    salaryPeriod: mapped(salaryPeriods, snapshot.salary.period),
    applicationDeadline: snapshot.applyDeadline
      ? new Date(snapshot.applyDeadline)
      : null,
    searchDocumentNormalized,
    skills,
  };
}
