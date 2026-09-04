import { jobSearchBySchema } from "@/shared/contracts/jobs/discovery";
import { searchModeSchema } from "@/shared/contracts/search/search-interpretation";

export function jobsPageQuery(
  input: Record<string, string | string[] | undefined>,
) {
  const array = (name: string) => {
    const value = input[name];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  };

  return {
    q: Array.isArray(input.q) ? input.q[0] : input.q,
    searchMode:
      searchModeSchema.safeParse(
        Array.isArray(input.searchMode)
          ? input.searchMode[0]
          : input.searchMode,
      ).data ?? "SMART",
    searchBy:
      jobSearchBySchema.safeParse(
        Array.isArray(input.searchBy) ? input.searchBy[0] : input.searchBy,
      ).data ?? "BOTH",
    location: Array.isArray(input.location)
      ? input.location[0]
      : input.location,
    district: array("district").filter(Boolean),
    categoryFamily: array("categoryFamily").filter(Boolean),
    categoryId: array("categoryId").filter(Boolean),
    categoryTitle: array("categoryTitle").filter(Boolean),
    employmentType: array("employmentType").filter(Boolean),
    experienceLevel: array("experienceLevel").filter(Boolean),
    workArrangement: array("workArrangement").filter(Boolean),
    careerPath: Array.isArray(input.careerPath)
      ? input.careerPath[0]
      : input.careerPath,
    skills: array("skills").filter(Boolean),
    salaryMin: Array.isArray(input.salaryMin)
      ? input.salaryMin[0]
      : input.salaryMin,
    salaryMax: Array.isArray(input.salaryMax)
      ? input.salaryMax[0]
      : input.salaryMax,
    salaryNegotiable: Array.isArray(input.salaryNegotiable)
      ? input.salaryNegotiable[0]
      : input.salaryNegotiable,
    salaryCurrency: Array.isArray(input.salaryCurrency)
      ? input.salaryCurrency[0]
      : input.salaryCurrency,
    salaryPeriod: Array.isArray(input.salaryPeriod)
      ? input.salaryPeriod[0]
      : input.salaryPeriod,
    postedWithinDays: Array.isArray(input.postedWithinDays)
      ? input.postedWithinDays[0]
      : input.postedWithinDays,
    sort: Array.isArray(input.sort) ? input.sort[0] : input.sort,
    cursor: Array.isArray(input.cursor) ? input.cursor[0] : input.cursor,
    page: Array.isArray(input.page) ? input.page[0] : input.page,
    limit: Array.isArray(input.limit) ? input.limit[0] : input.limit,
  };
}
