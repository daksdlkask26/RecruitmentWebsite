import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import {
  jobSearchCatalogIndex,
  type SearchCatalogIndex,
} from "./catalogs/job-search-catalog-index";
import type { StructuredSearchFilter } from "@/shared/contracts/search/natural-language-search";

type Experience = "ENTRY" | "JUNIOR" | "MID" | "SENIOR" | "LEAD" | "MANAGER";
type Employment =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "INTERNSHIP"
  | "TEMPORARY";
type Arrangement = "ONSITE" | "HYBRID" | "REMOTE";

export type NaturalLanguageSearchFilters = Readonly<{
  location?: string;
  district: readonly string[];
  skills: readonly string[];
  employmentType: readonly Employment[];
  experienceLevel: readonly Experience[];
  workArrangement: readonly Arrangement[];
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: "HOUR" | "MONTH" | "YEAR";
  postedWithinDays?: number;
}>;

export type NaturalLanguageSearchParseResult = Readonly<{
  rawQuery: string;
  normalizedQuery: string;
  residualQuery: string;
  hasFilters: boolean;
  filters: NaturalLanguageSearchFilters;
  structuredFilters: readonly StructuredSearchFilter[];
}>;

type Range = { start: number; end: number };

const locationRules = [
  {
    aliases: [
      "ho chi minh city",
      "ho chi minh",
      "hcmc",
      "tphcm",
      "tp hcm",
      "hcm",
    ],
    value: "ho chi minh city",
    labelVi: "Hồ Chí Minh",
    labelEn: "Ho Chi Minh City",
  },
  {
    aliases: ["da nang", "danang"],
    value: "da nang",
    labelVi: "Đà Nẵng",
    labelEn: "Da Nang",
  },
  {
    aliases: ["ha noi", "hanoi"],
    value: "ha noi",
    labelVi: "Hà Nội",
    labelEn: "Hanoi",
  },
  {
    aliases: ["can tho", "cantho"],
    value: "can tho",
    labelVi: "Cần Thơ",
    labelEn: "Can Tho",
  },
] as const;

const experienceRules: readonly {
  aliases: readonly string[];
  value: Experience;
  labelVi: string;
  labelEn: string;
}[] = [
  {
    aliases: ["fresher", "entry level", "entry-level", "moi vao nghe"],
    value: "ENTRY",
    labelVi: "Mới vào nghề",
    labelEn: "Entry level",
  },
  {
    aliases: ["junior", "so cap"],
    value: "JUNIOR",
    labelVi: "Sơ cấp",
    labelEn: "Junior",
  },
  {
    aliases: ["mid level", "mid-level", "trung cap"],
    value: "MID",
    labelVi: "Trung cấp",
    labelEn: "Mid-level",
  },
  {
    aliases: ["senior", "cao cap"],
    value: "SENIOR",
    labelVi: "Cao cấp",
    labelEn: "Senior",
  },
  {
    aliases: ["team lead", "lead", "truong nhom"],
    value: "LEAD",
    labelVi: "Trưởng nhóm",
    labelEn: "Team lead",
  },
  {
    aliases: ["manager", "quan ly"],
    value: "MANAGER",
    labelVi: "Quản lý",
    labelEn: "Manager",
  },
];

const employmentRules: readonly {
  aliases: readonly string[];
  value: Employment;
  labelVi: string;
  labelEn: string;
}[] = [
  {
    aliases: ["full time", "full-time", "toan thoi gian"],
    value: "FULL_TIME",
    labelVi: "Toàn thời gian",
    labelEn: "Full-time",
  },
  {
    aliases: ["part time", "part-time", "ban thoi gian"],
    value: "PART_TIME",
    labelVi: "Bán thời gian",
    labelEn: "Part-time",
  },
  {
    aliases: ["contract", "hop dong"],
    value: "CONTRACT",
    labelVi: "Hợp đồng",
    labelEn: "Contract",
  },
  {
    aliases: ["internship", "intern", "thuc tap"],
    value: "INTERNSHIP",
    labelVi: "Thực tập",
    labelEn: "Internship",
  },
  {
    aliases: ["temporary", "tam thoi"],
    value: "TEMPORARY",
    labelVi: "Tạm thời",
    labelEn: "Temporary",
  },
];

const arrangementRules: readonly {
  aliases: readonly string[];
  value: Arrangement;
  labelVi: string;
  labelEn: string;
}[] = [
  {
    aliases: ["remote", "work from home", "tu xa", "lam viec tu xa"],
    value: "REMOTE",
    labelVi: "Từ xa",
    labelEn: "Remote",
  },
  {
    aliases: ["hybrid", "linh hoat"],
    value: "HYBRID",
    labelVi: "Linh hoạt",
    labelEn: "Hybrid",
  },
  {
    aliases: ["onsite", "on-site", "tai van phong", "tai cho"],
    value: "ONSITE",
    labelVi: "Tại văn phòng",
    labelEn: "On-site",
  },
];

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function tokenBoundary(text: string, start: number, end: number) {
  const isWord = (value: string | undefined) =>
    Boolean(value && /[\p{L}\p{N}+#.]/u.test(value));
  return !isWord(text[start - 1]) && !isWord(text[end]);
}

function occurrences(text: string, phrase: string) {
  const normalizedPhrase = normalizeSearchText(phrase, 200);
  if (!normalizedPhrase) return [];
  const matcher = new RegExp(
    `(?<![\\p{L}\\p{N}+#.])${escaped(normalizedPhrase)}(?![\\p{L}\\p{N}+#.])`,
    "gu",
  );
  return Array.from(text.matchAll(matcher)).flatMap((match) => {
    const start = match.index ?? -1;
    if (
      start < 0 ||
      !tokenBoundary(text, start, start + normalizedPhrase.length)
    )
      return [];
    return [{ start, end: start + normalizedPhrase.length }];
  });
}

function free(range: Range, ranges: readonly Range[]) {
  return !ranges.some(
    (other) => range.start < other.end && other.start < range.end,
  );
}

function cleanupResidual(value: string) {
  return value
    .replace(/\b(?:o|ở|tai|tại|in|at|trong|within|with|and|va|và)\b/gu, " ")
    .replace(/\b(?:luong|lương|salary|minimum|min|from|tu|từ)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function skillMarker(text: string, start: number) {
  const prefix = text.slice(0, start);
  const match = prefix.match(
    /(?:^|\s)(skills?|ky nang|biet|know|with|using|proficient in)\s*$/u,
  );
  if (!match || match.index === undefined) return undefined;
  return { start: match.index, end: start };
}

function amount(value: string, unit: string | undefined) {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  const normalizedUnit = unit?.toLowerCase();
  if (["trieu", "million", "m"].includes(normalizedUnit ?? ""))
    return Math.round(parsed * 1_000_000);
  if (["k", "nghin", "ngan"].includes(normalizedUnit ?? ""))
    return Math.round(parsed * 1_000);
  if (normalizedUnit === "vnd") return Math.round(parsed);
  return undefined;
}

function chip(
  kind: StructuredSearchFilter["kind"],
  value: string,
  query: string,
  labelVi: string,
  labelEn: string,
): StructuredSearchFilter {
  return {
    id: `query:${kind}:${value}:${query}`.slice(0, 240),
    kind,
    value,
    query,
    labelVi,
    labelEn,
    source: "QUERY",
  };
}

export function parseNaturalLanguageJobSearch(
  rawQuery: string,
  catalogIndex: SearchCatalogIndex = jobSearchCatalogIndex,
): NaturalLanguageSearchParseResult {
  const raw = rawQuery ?? "";
  const normalized = normalizeSearchText(raw, 200);
  if (!normalized) {
    return {
      rawQuery: raw,
      normalizedQuery: normalized,
      residualQuery: normalized,
      hasFilters: false,
      filters: {
        district: [],
        skills: [],
        employmentType: [],
        experienceLevel: [],
        workArrangement: [],
      },
      structuredFilters: [],
    };
  }

  const ranges: Range[] = [];
  const structured: StructuredSearchFilter[] = [];
  const addPhraseRule = <
    T extends {
      aliases: readonly string[];
      value: string;
      labelVi: string;
      labelEn: string;
    },
  >(
    kind: StructuredSearchFilter["kind"],
    rule: T,
  ) => {
    const phrase = [...rule.aliases]
      .sort((left, right) => right.length - left.length)
      .find((candidate) =>
        occurrences(normalized, candidate).some((range) => free(range, ranges)),
      );
    if (!phrase) return false;
    const range = occurrences(normalized, phrase).find((candidate) =>
      free(candidate, ranges),
    );
    if (!range) return false;
    ranges.push(range);
    structured.push(
      chip(
        kind,
        rule.value,
        normalized.slice(range.start, range.end),
        rule.labelVi,
        rule.labelEn,
      ),
    );
    return true;
  };

  let location: string | undefined;
  for (const rule of locationRules) {
    if (addPhraseRule("LOCATION", rule)) {
      location = rule.value;
      break;
    }
  }
  const district: string[] = [];
  const districtPattern =
    /\b(?:(?:district|quan|q)\s*\d+|thu duc|binh thanh|cau giay)\b/gu;
  for (const match of normalized.matchAll(districtPattern)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const range = { start, end: start + match[0].length };
    if (!free(range, ranges)) continue;
    ranges.push(range);
    const value = match[0].trim();
    district.push(value);
    structured.push(chip("DISTRICT", value, value, value, value));
  }
  const experienceLevel: Experience[] = [];
  for (const rule of experienceRules)
    if (addPhraseRule("SENIORITY", rule)) experienceLevel.push(rule.value);
  const employmentType: Employment[] = [];
  for (const rule of employmentRules)
    if (addPhraseRule("EMPLOYMENT_TYPE", rule)) employmentType.push(rule.value);
  const workArrangement: Arrangement[] = [];
  for (const rule of arrangementRules)
    if (addPhraseRule("WORK_ARRANGEMENT", rule))
      workArrangement.push(rule.value);

  const skills: string[] = [];
  for (const skill of catalogIndex.skills) {
    const phrase = [...skill.phrases]
      .sort((left, right) => right.length - left.length)
      .find((candidate) =>
        occurrences(normalized, candidate).some((range) => {
          const marker = skillMarker(normalized, range.start);
          return Boolean(marker && free(range, ranges));
        }),
      );
    if (!phrase) continue;
    const range = occurrences(normalized, phrase).find((candidate) => {
      const marker = skillMarker(normalized, candidate.start);
      return Boolean(marker && free(candidate, ranges));
    });
    if (!range) continue;
    const marker = skillMarker(normalized, range.start);
    if (!marker) continue;
    ranges.push({ start: marker.start, end: range.end });
    const value = normalizeSearchText(phrase, 100);
    skills.push(value);
    structured.push(
      chip(
        "SKILL",
        value,
        normalized.slice(marker.start, range.end),
        phrase,
        phrase,
      ),
    );
  }

  let salaryMin: number | undefined;
  let salaryMax: number | undefined;
  const salaryPattern =
    /\b(?:(?:luong|salary)\s*)?(?:(?:tu|from|min(?:imum)?|at least|>=)\s*)?(\d+(?:[.,]\d+)?)\s*(trieu|million|m|k|nghin|ngan|vnd)?(?:(?:\s*(?:den|to)\s*)|(?:\s+(?=\d+(?:[.,]\d+)?\s*(?:trieu|million|m|k|nghin|ngan|vnd))))?(\d+(?:[.,]\d+)?)?\s*(trieu|million|m|k|nghin|ngan|vnd)?\b/gu;
  const salaryMatch = salaryPattern.exec(normalized);
  if (salaryMatch) {
    const range = {
      start: salaryMatch.index,
      end: salaryMatch.index + salaryMatch[0].length,
    };
    if (free(range, ranges)) {
      const firstUnit = salaryMatch[2] ?? salaryMatch[4];
      const first = amount(salaryMatch[1], firstUnit);
      const second = salaryMatch[3]
        ? amount(salaryMatch[3], salaryMatch[4] ?? firstUnit)
        : undefined;
      if (first) {
        ranges.push(range);
        salaryMin = first;
        salaryMax = second;
        const labelVi = second
          ? `Từ ${first / 1_000_000} đến ${second / 1_000_000} triệu`
          : `Từ ${first / 1_000_000} triệu`;
        const labelEn = second
          ? `${first / 1_000_000}–${second / 1_000_000}M salary`
          : `From ${first / 1_000_000}M salary`;
        structured.push(
          chip("SALARY", String(first), salaryMatch[0], labelVi, labelEn),
        );
      }
    }
  }

  let postedWithinDays: number | undefined;
  const postedPattern =
    /\b(?:within|trong)\s+(24h|24 hours|1 day|1 ngay|\d+\s+(?:days|ngay))\b/gu;
  const postedMatch = postedPattern.exec(normalized);
  if (postedMatch) {
    const range = {
      start: postedMatch.index,
      end: postedMatch.index + postedMatch[0].length,
    };
    const days = /24h|24 hours|1 day|1 ngay/u.test(postedMatch[1])
      ? 1
      : Number.parseInt(postedMatch[1], 10);
    if (free(range, ranges) && [1, 3, 7, 14, 30].includes(days)) {
      ranges.push(range);
      postedWithinDays = days;
      structured.push(
        chip(
          "POSTED_TIME",
          String(days),
          postedMatch[0],
          days === 1 ? "Trong 24 giờ" : `Trong ${days} ngày`,
          days === 1 ? "Within 24 hours" : `Within ${days} days`,
        ),
      );
    }
  }

  const residual = cleanupResidual(
    Array.from(normalized)
      .map((character, index) =>
        ranges.some((range) => index >= range.start && index < range.end)
          ? " "
          : character,
      )
      .join(""),
  );
  const filters: NaturalLanguageSearchFilters = {
    ...(location ? { location } : {}),
    district: [...new Set(district)],
    skills: [...new Set(skills)],
    employmentType: [...new Set(employmentType)],
    experienceLevel: [...new Set(experienceLevel)],
    workArrangement: [...new Set(workArrangement)],
    ...(salaryMin !== undefined ? { salaryMin } : {}),
    ...(salaryMax !== undefined ? { salaryMax } : {}),
    ...(salaryMin !== undefined
      ? { salaryCurrency: "VND" as const, salaryPeriod: "MONTH" as const }
      : {}),
    ...(postedWithinDays !== undefined ? { postedWithinDays } : {}),
  };
  return {
    rawQuery: raw,
    normalizedQuery: normalized,
    residualQuery: residual,
    hasFilters: structured.length > 0,
    filters,
    structuredFilters: structured.slice(0, 16),
  };
}
