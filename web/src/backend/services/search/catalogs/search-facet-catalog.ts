import type { SearchFacetDefinition } from "@/shared/contracts/search/job-search-intent";

/**
 * Facets describe reusable title signals. They deliberately do not contain
 * occupation-specific branches; occupation compatibility is supplied by the
 * compiled catalog and the recruiter taxonomy.
 */
export const searchFacetCatalog: readonly SearchFacetDefinition[] = [
  {
    facetId: "specialization.frontend",
    kind: "SPECIALIZATION",
    labels: { vi: "Frontend", en: "Frontend" },
    positiveTerms: ["frontend", "front end", "front-end", "giao dien"],
    conflictFacetIds: ["specialization.backend"],
    compatibleCategoryIds: ["r03-software-development"],
  },
  {
    facetId: "specialization.backend",
    kind: "SPECIALIZATION",
    labels: { vi: "Backend", en: "Backend" },
    positiveTerms: ["backend", "back end", "back-end", "phia sau"],
    conflictFacetIds: ["specialization.frontend"],
    compatibleCategoryIds: ["r03-software-development"],
  },
  {
    facetId: "specialization.seo",
    kind: "SPECIALIZATION",
    labels: { vi: "SEO", en: "SEO" },
    positiveTerms: ["seo", "search engine optimization"],
    conflictFacetIds: ["domain.electronics"],
    compatibleIndustryCodes: ["r02"],
  },
  {
    facetId: "specialization.inventory-accounting",
    kind: "SPECIALIZATION",
    labels: { vi: "Kế toán kho", en: "Inventory accounting" },
    positiveTerms: [
      "kế toán kho",
      "inventory accountant",
      "warehouse accountant",
      "inventory accounting",
    ],
    conflictFacetIds: [],
    compatibleIndustryCodes: ["r04"],
  },
  {
    facetId: "specialization.human-resources",
    kind: "SPECIALIZATION",
    labels: { vi: "Nhân sự", en: "Human resources" },
    positiveTerms: ["nhân sự", "human resources", "hr"],
    conflictFacetIds: [],
    compatibleIndustryCodes: ["r06"],
  },
  {
    facetId: "specialization.tax",
    kind: "SPECIALIZATION",
    labels: { vi: "Thuế", en: "Tax" },
    positiveTerms: ["thuế", "tax", "taxation"],
    conflictFacetIds: [],
    compatibleIndustryCodes: ["r04"],
  },
  {
    facetId: "seniority.senior",
    kind: "SENIORITY",
    labels: { vi: "Cấp cao", en: "Senior" },
    positiveTerms: ["senior", "lead", "cấp cao"],
    conflictFacetIds: ["seniority.junior", "employment.intern"],
  },
  {
    facetId: "seniority.junior",
    kind: "SENIORITY",
    labels: { vi: "Junior", en: "Junior" },
    positiveTerms: ["junior", "mới vào nghề"],
    conflictFacetIds: ["seniority.senior", "employment.intern"],
  },
  {
    facetId: "management.department-head",
    kind: "MANAGEMENT_LEVEL",
    labels: { vi: "Trưởng phòng", en: "Department head" },
    positiveTerms: [
      "trưởng phòng",
      "department head",
      "head of",
      "chief",
      "trưởng",
    ],
    conflictFacetIds: ["employment.intern"],
  },
  {
    facetId: "management.manager",
    kind: "MANAGEMENT_LEVEL",
    labels: { vi: "Quản lý", en: "Manager" },
    positiveTerms: ["quản lý", "manager", "management"],
    conflictFacetIds: ["employment.intern"],
  },
  {
    facetId: "employment.staff",
    kind: "EMPLOYMENT_LEVEL",
    labels: { vi: "Nhân viên", en: "Staff" },
    positiveTerms: ["nhân viên", "staff", "associate", "executive"],
    conflictFacetIds: ["employment.intern"],
  },
  {
    facetId: "employment.intern",
    kind: "EMPLOYMENT_LEVEL",
    labels: { vi: "Thực tập sinh", en: "Intern" },
    positiveTerms: ["thực tập sinh", "intern", "internship"],
    conflictFacetIds: [
      "management.manager",
      "management.department-head",
      "seniority.senior",
      "seniority.junior",
      "employment.staff",
    ],
  },
  {
    facetId: "domain.electronics",
    kind: "DOMAIN",
    labels: { vi: "Điện tử", en: "Electronics" },
    positiveTerms: ["điện tử", "electronics", "semiconductor"],
    conflictFacetIds: ["specialization.seo"],
    compatibleIndustryCodes: ["r03", "r07"],
  },
] as const;

export type SearchFacetCatalogEntry = (typeof searchFacetCatalog)[number];
