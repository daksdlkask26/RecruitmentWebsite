import type { GenericRoleTerm } from "@/shared/contracts/search/job-search-intent";

/**
 * Generic role words are exact context signals only. The resolver never
 * applies fuzzy correction to these terms and never treats one as an
 * occupation by itself.
 */
export const genericRoleCatalog: readonly GenericRoleTerm[] = [
  { phrase: "nhân viên", language: "vi", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "chuyên viên", language: "vi", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "viên", language: "vi", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "cán bộ", language: "vi", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "kỹ sư", language: "vi", role: "INDIVIDUAL_CONTRIBUTOR" },
  {
    phrase: "lập trình viên",
    language: "vi",
    role: "INDIVIDUAL_CONTRIBUTOR",
  },
  { phrase: "quản lý", language: "vi", role: "MANAGEMENT" },
  { phrase: "trưởng phòng", language: "vi", role: "MANAGEMENT" },
  { phrase: "thực tập sinh", language: "vi", role: "INTERN" },
  { phrase: "staff", language: "en", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "specialist", language: "en", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "executive", language: "en", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "engineer", language: "en", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "developer", language: "en", role: "INDIVIDUAL_CONTRIBUTOR" },
  { phrase: "manager", language: "en", role: "MANAGEMENT" },
  { phrase: "head", language: "en", role: "MANAGEMENT" },
  { phrase: "intern", language: "en", role: "INTERN" },
] as const;
