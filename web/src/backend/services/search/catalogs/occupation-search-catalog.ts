import type { OccupationSearchEntry } from "./occupation-search-catalog-schema";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import { activeJobTitleSearchCatalog } from "./active-job-title-search-catalog";

export const OCCUPATION_SEARCH_CATALOG_VERSION = "2026-09-03.1";

/**
 * Search vocabulary sits below the recruiter taxonomy. The taxonomy remains
 * authoritative for industry and category ids; these entries only describe
 * deterministic occupation-language signals.
 */
const coreOccupationSearchCatalog = [
  {
    occupationId: "occ-r04-accountant",
    industryCode: "r04",
    categoryIds: ["r04-accounting"],
    labels: { vi: "Kế toán", en: "Accountant" },
    aliases: {
      vi: ["kế toán", "nhân viên kế toán", "chuyên viên kế toán"],
      en: ["accountant", "accounting", "accounting specialist"],
    },
    abbreviations: ["kt"],
    relatedTitles: {
      vi: [
        "kế toán viên",
        "kế toán tổng hợp",
        "kế toán công nợ",
        "kế toán kho",
        "kế toán trưởng",
      ],
      en: [
        "general accountant",
        "accounts payable",
        "accounts receivable",
        "accounts payable accountant",
        "accounts receivable accountant",
        "inventory accountant",
        "warehouse accountant",
        "chief accountant",
        "head of accounting",
        "accounting manager",
        "senior accountant",
        "junior accountant",
      ],
    },
    titleFacetMappings: [
      {
        phrase: "kế toán kho",
        facetIds: ["specialization.inventory-accounting"],
      },
      {
        phrase: "inventory accountant",
        facetIds: ["specialization.inventory-accounting"],
      },
      {
        phrase: "warehouse accountant",
        facetIds: ["specialization.inventory-accounting"],
      },
      {
        phrase: "kế toán trưởng",
        facetIds: ["management.department-head"],
      },
      {
        phrase: "chief accountant",
        facetIds: ["management.department-head"],
      },
      {
        phrase: "head of accounting",
        facetIds: ["management.department-head"],
      },
      {
        phrase: "accounting manager",
        facetIds: ["management.manager"],
      },
      { phrase: "senior accountant", facetIds: ["seniority.senior"] },
      { phrase: "junior accountant", facetIds: ["seniority.junior"] },
    ],
    rankingSkills: [
      "bookkeeping",
      "financial reporting",
      "tax accounting",
      "accounts payable",
      "accounts receivable",
    ],
    irregularAliases: [],
    exclusions: [],
  },
  {
    occupationId: "occ-r03-software-engineer",
    industryCode: "r03",
    categoryIds: ["r03-software-development"],
    labels: { vi: "Lập trình viên", en: "Software Engineer" },
    aliases: {
      vi: ["lập trình viên", "kỹ sư phần mềm", "phát triển phần mềm"],
      en: ["software engineer", "software developer", "programmer"],
    },
    abbreviations: [],
    relatedTitles: {
      vi: [
        "lập trình web",
        "lập trình viên backend",
        "lập trình viên frontend",
        "lập trình",
      ],
      en: [
        "frontend developer",
        "backend developer",
        "fullstack developer",
        "full stack developer",
        "web developer",
        "application developer",
      ],
    },
    titleFacetMappings: [
      {
        phrase: "lập trình viên frontend",
        facetIds: ["specialization.frontend"],
      },
      { phrase: "frontend developer", facetIds: ["specialization.frontend"] },
      {
        phrase: "lập trình viên backend",
        facetIds: ["specialization.backend"],
      },
      { phrase: "backend developer", facetIds: ["specialization.backend"] },
    ],
    rankingSkills: [
      "typescript",
      "javascript",
      "java",
      "python",
      "software development",
    ],
    irregularAliases: [],
    exclusions: [],
  },
  {
    occupationId: "occ-r03-system-administrator",
    industryCode: "r03",
    categoryIds: [
      "r03-infrastructure-networking-devops",
      "r03-it-operations-support",
    ],
    labels: { vi: "Quản trị viên hệ thống", en: "System Administrator" },
    aliases: {
      vi: ["quản trị viên hệ thống", "quản trị hệ thống"],
      en: ["system administrator"],
    },
    abbreviations: ["sysadmin"],
    relatedTitles: {
      vi: ["quản trị mạng", "kỹ sư hạ tầng"],
      en: [
        "network administrator",
        "infrastructure engineer",
        "devops engineer",
      ],
    },
    rankingSkills: ["linux", "networking", "cloud computing", "devops"],
    irregularAliases: [],
    exclusions: [],
  },
  {
    occupationId: "occ-r03-data-analyst",
    industryCode: "r03",
    categoryIds: ["r03-data-ai"],
    labels: { vi: "Phân tích dữ liệu", en: "Data Analyst" },
    aliases: {
      vi: ["dữ liệu", "phân tích dữ liệu"],
      en: ["data", "data analyst", "data engineering"],
    },
    abbreviations: [],
    relatedTitles: {
      vi: ["chuyên viên dữ liệu"],
      en: [
        "data engineer",
        "business data analyst",
        "business intelligence analyst",
      ],
    },
    rankingSkills: ["sql", "data analysis", "power bi", "tableau"],
    irregularAliases: [],
    exclusions: [],
  },
  {
    occupationId: "occ-r03-ai-engineer",
    industryCode: "r03",
    categoryIds: ["r03-data-ai"],
    labels: { vi: "Trí tuệ nhân tạo", en: "Artificial Intelligence" },
    aliases: {
      vi: ["trí tuệ nhân tạo"],
      en: ["artificial intelligence", "machine learning"],
    },
    abbreviations: ["ai"],
    relatedTitles: {
      vi: ["kỹ sư trí tuệ nhân tạo", "kỹ sư học máy"],
      en: ["ai engineer", "machine learning engineer", "ml engineer"],
    },
    rankingSkills: [
      "machine learning",
      "deep learning",
      "python",
      "natural language processing",
    ],
    irregularAliases: [],
    exclusions: [],
  },
  {
    occupationId: "occ-r06-human-resources",
    industryCode: "r06",
    categoryIds: ["r06-general-hr-management"],
    labels: { vi: "Nhân sự", en: "Human Resources" },
    aliases: {
      vi: ["nhân sự"],
      en: ["human resources", "hr"],
    },
    abbreviations: [],
    relatedTitles: {
      vi: ["chuyên viên nhân sự", "quản lý nhân sự"],
      en: ["hr specialist", "hr manager", "human resources specialist"],
    },
    rankingSkills: ["human resources", "employee relations", "hr policies"],
    irregularAliases: [],
    exclusions: [],
  },
  {
    occupationId: "occ-r06-recruiter",
    industryCode: "r06",
    categoryIds: ["r06-recruitment-talent-acquisition"],
    labels: { vi: "Tuyển dụng", en: "Recruiter" },
    aliases: {
      vi: ["tuyển dụng"],
      en: ["recruiter", "talent acquisition"],
    },
    abbreviations: [],
    relatedTitles: {
      vi: ["chuyên viên tuyển dụng", "nhà tuyển dụng"],
      en: [
        "recruitment specialist",
        "talent acquisition specialist",
        "technical recruiter",
      ],
    },
    rankingSkills: ["talent acquisition", "interviewing", "sourcing"],
    irregularAliases: [],
    exclusions: [],
  },
];

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}

function entryPhrases(entry: OccupationSearchEntry) {
  return [
    entry.labels.vi,
    entry.labels.en,
    ...entry.aliases.vi,
    ...entry.aliases.en,
    ...entry.relatedTitles.vi,
    ...entry.relatedTitles.en,
    ...entry.abbreviations,
    ...entry.irregularAliases,
  ].map((phrase) => compact(normalizeSearchText(phrase)));
}

const corePhraseKeys = new Set(
  coreOccupationSearchCatalog.flatMap((entry) => entryPhrases(entry)),
);

/**
 * Active title groups intentionally defer a phrase already owned by a more
 * specific bilingual occupation. This keeps one deterministic owner for
 * phrases such as "Chief Accountant" and "Frontend Developer" while still
 * covering the remaining active title corpus.
 */
const activeTitleGroupsWithoutCoreDuplicates = activeJobTitleSearchCatalog.map(
  (entry) => ({
    ...entry,
    labels: { ...entry.labels },
    aliases: {
      vi: entry.aliases.vi.filter(
        (phrase) => !corePhraseKeys.has(compact(normalizeSearchText(phrase))),
      ),
      en: entry.aliases.en.filter(
        (phrase) => !corePhraseKeys.has(compact(normalizeSearchText(phrase))),
      ),
    },
    relatedTitles: {
      vi: entry.relatedTitles.vi.filter(
        (phrase) => !corePhraseKeys.has(compact(normalizeSearchText(phrase))),
      ),
      en: entry.relatedTitles.en.filter(
        (phrase) => !corePhraseKeys.has(compact(normalizeSearchText(phrase))),
      ),
    },
  }),
);

export const occupationSearchCatalog = [
  ...coreOccupationSearchCatalog,
  ...activeTitleGroupsWithoutCoreDuplicates,
] satisfies readonly OccupationSearchEntry[];
