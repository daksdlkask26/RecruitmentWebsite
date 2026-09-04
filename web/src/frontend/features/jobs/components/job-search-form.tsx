"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { LocationPicker } from "@/frontend/features/jobs/image-search/components/global-image-search";
import {
  useOptionalJobInteraction,
  type FilterPresetMetadata,
} from "./job-interaction-provider";
import type {
  SearchInterpretation,
  SearchMetadata,
} from "@/shared/contracts/search/search-interpretation";
import type { StructuredSearchFilter } from "@/shared/contracts/search/natural-language-search";
import type { JobSearchTaxonomy } from "@/shared/contracts/jobs/taxonomy";
import type { SavedFilterPreset } from "@/shared/contracts/jobs/catalog";
import { SavedSearchVersionNotice } from "./saved-search-version-notice";

export type JobSearchCriteria = Partial<
  Record<string, string | string[] | number | undefined>
>;

export type JobFilterTrigger = "debounced" | "immediate";

type ActiveFilter = Readonly<{
  id: string;
  label: string;
  name: string;
  value?: string;
  href: string;
}>;

type JobSearchFormProps = Readonly<{
  criteria: JobSearchCriteria;
  onCriteriaChange?: (
    criteria: JobSearchCriteria,
    trigger: JobFilterTrigger,
  ) => void;
  onClear?: () => void;
  resultCount?: number;
  isLoading?: boolean;
  taxonomy?: JobSearchTaxonomy;
  searchInterpretation?: SearchInterpretation;
  searchMetadata?: SearchMetadata;
}>;

const valueLabels: Record<string, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
  TEMPORARY: "Temporary",
  ENTRY: "Entry",
  JUNIOR: "Junior",
  MID: "Mid-level",
  SENIOR: "Senior",
  LEAD: "Lead",
  MANAGER: "Manager",
  ONSITE: "On-site",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  RELEVANCE: "Relevance",
  NEWEST: "Newest",
  SALARY_DESC: "Highest salary",
  "1": "24 hours",
  "3": "3 days",
  "7": "7 days",
  "14": "14 days",
  "30": "30 days",
};

const valueLabelsVi: Record<string, string> = {
  FULL_TIME: "Toàn thời gian",
  PART_TIME: "Bán thời gian",
  CONTRACT: "Hợp đồng",
  INTERNSHIP: "Thực tập",
  TEMPORARY: "Tạm thời",
  ENTRY: "Mới vào nghề",
  JUNIOR: "Sơ cấp",
  MID: "Trung cấp",
  SENIOR: "Cao cấp",
  LEAD: "Trưởng nhóm",
  MANAGER: "Quản lý",
  ONSITE: "Tại văn phòng",
  HYBRID: "Linh hoạt",
  REMOTE: "Từ xa",
  RELEVANCE: "Liên quan nhất",
  NEWEST: "Mới nhất",
  SALARY_DESC: "Lương cao nhất",
  "1": "24 giờ",
  "3": "3 ngày",
  "7": "7 ngày",
  "14": "14 ngày",
  "30": "30 ngày",
};

const one = (value: JobSearchCriteria[string]) =>
  Array.isArray(value) ? (value[0] ?? "") : (value?.toString() ?? "");

const categoryFilterNames = new Set([
  "categoryFamily",
  "categoryId",
  "categoryTitle",
]);

function canonicalIndustryFilterCode(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "other" ? "r29" : normalized;
}

export function jobCriteriaParams(criteria: JobSearchCriteria) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(criteria)) {
    if (
      value === undefined ||
      name === "cursor" ||
      name === "limit" ||
      name === "page"
    )
      continue;
    for (const item of Array.isArray(value) ? value : [String(value)]) {
      if (item) params.append(name, item);
    }
  }
  return params;
}

function removeFilterHref(
  criteria: JobSearchCriteria,
  name: string,
  value?: string,
) {
  const params = jobCriteriaParams(criteria);
  if (categoryFilterNames.has(name)) {
    for (const categoryName of categoryFilterNames) params.delete(categoryName);
    const query = params.toString();
    return query ? `/jobs?${query}` : "/jobs";
  }
  const existing = params.getAll(name);
  params.delete(name);
  if (value !== undefined) {
    for (const item of existing.filter((item) => item !== value))
      params.append(name, item);
  }
  if (name === "q" && !params.get("q")) params.delete("searchMode");
  const query = params.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

function removeCriterion(
  criteria: JobSearchCriteria,
  name: string,
  value?: string,
): JobSearchCriteria {
  const next = { ...criteria };
  const current = next[name];
  if (Array.isArray(current) && value !== undefined) {
    const remaining = current.filter((item) => item !== value);
    if (remaining.length) next[name] = remaining;
    else delete next[name];
  } else {
    delete next[name];
  }
  return next;
}

function removeActiveFilter(
  criteria: JobSearchCriteria,
  filter: Pick<ActiveFilter, "name" | "value">,
) {
  if (categoryFilterNames.has(filter.name)) {
    const next = { ...criteria };
    for (const categoryName of categoryFilterNames) delete next[categoryName];
    return next;
  }
  const next = removeCriterion(criteria, filter.name, filter.value);
  if (filter.name === "location") delete next.district;
  if (filter.name === "q" && !next.q) delete next.searchMode;
  return next;
}

function activeFilters(
  criteria: JobSearchCriteria,
  locale: "vi" | "en",
  taxonomy?: JobSearchTaxonomy,
): ActiveFilter[] {
  const labels =
    locale === "vi"
      ? {
          q: "Từ khóa",
          location: "Địa điểm",
          district: "Quận/Huyện",
          employmentType: "Loại việc",
          experienceLevel: "Cấp độ",
          workArrangement: "Hình thức",
          careerPath: "Lộ trình",
          skills: "Kỹ năng",
          salaryMin: "Lương từ",
          salaryMax: "Lương đến",
          salaryNegotiable: "Mức lương",
          postedWithinDays: "Đăng trong",
          sort: "Sắp xếp",
        }
      : {
          q: "Keyword",
          location: "Location",
          district: "District",
          employmentType: "Employment type",
          experienceLevel: "Experience level",
          workArrangement: "Work arrangement",
          careerPath: "Career path",
          skills: "Skill",
          salaryMin: "Salary from",
          salaryMax: "Salary to",
          salaryNegotiable: "Salary",
          postedWithinDays: "Posted within",
          sort: "Sort",
        };
  const labelsWithCategories = {
    ...labels,
    categoryFamily: locale === "vi" ? "Ngành nghề" : "Industry",
    categoryId: locale === "vi" ? "Nhóm ngành" : "Sub-industry",
    categoryTitle: locale === "vi" ? "Vị trí" : "Role",
  } as const;
  const enums = locale === "vi" ? valueLabelsVi : valueLabels;
  const output: ActiveFilter[] = [];
  const add = (
    name: keyof typeof labelsWithCategories,
    raw: string,
    value = raw,
  ) => {
    if (!raw || (name === "sort" && raw === "RELEVANCE")) return;
    const salary = name === "salaryMin" || name === "salaryMax";
    const taxonomyValue =
      name === "categoryFamily"
        ? taxonomy?.industries.find(
            (industry) =>
              canonicalIndustryFilterCode(industry.code) ===
              canonicalIndustryFilterCode(raw),
          )?.name
        : name === "categoryId"
          ? taxonomy?.industries
              .flatMap((industry) => industry.subIndustries)
              .find(
                (subIndustry) =>
                  subIndustry.code === raw ||
                  subIndustry.titles.some((title) =>
                    title.categoryIds.includes(raw),
                  ),
              )?.name
          : undefined;
    const visible = salary
      ? `${new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US").format(Number(raw))} VND`
      : name === "salaryNegotiable"
        ? locale === "vi"
          ? "Thỏa thuận"
          : "Negotiable"
        : (taxonomyValue ?? enums[raw] ?? raw);
    output.push({
      id: `${name}:${value}`,
      label: `${labelsWithCategories[name]}: ${visible}`,
      name,
      value,
      href: removeFilterHref(criteria, name, value),
    });
  };

  for (const name of [
    "q",
    "location",
    "district",
    "employmentType",
    "experienceLevel",
    "workArrangement",
    "careerPath",
    "skills",
    "categoryFamily",
    "categoryId",
    "categoryTitle",
    "salaryMin",
    "salaryMax",
    "salaryNegotiable",
    "postedWithinDays",
    "sort",
  ] as const) {
    const value = criteria[name];
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [String(value)])
      add(name, item, item);
  }
  return output;
}

function clientNormalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[đĐ]/gu, "d")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function removeStructuredQuery(
  criteria: JobSearchCriteria,
  query: string,
): JobSearchCriteria {
  const rawQuery = one(criteria.q).trim();
  const rawTokens = rawQuery ? rawQuery.split(/\s+/u) : [];
  const queryTokens = clientNormalize(query).split(/\s+/u).filter(Boolean);
  const normalizedRawTokens = rawTokens.map(clientNormalize);
  if (!queryTokens.length || !rawTokens.length) return criteria;
  const start = normalizedRawTokens.findIndex((_, index) =>
    queryTokens.every(
      (token, offset) => normalizedRawTokens[index + offset] === token,
    ),
  );
  if (start < 0) return criteria;
  const next = { ...criteria };
  const remaining = rawTokens.filter(
    (_, index) => index < start || index >= start + queryTokens.length,
  );
  if (remaining.length) next.q = remaining.join(" ");
  else {
    delete next.q;
    delete next.searchMode;
  }
  return next;
}

function structuredFilterLabel(
  filter: StructuredSearchFilter,
  locale: "vi" | "en",
) {
  const kindLabels =
    locale === "vi"
      ? {
          TITLE: "Chức danh",
          OCCUPATION: "Nghề nghiệp",
          SKILL: "Kỹ năng",
          SENIORITY: "Kinh nghiệm",
          EMPLOYMENT_TYPE: "Loại việc",
          WORK_ARRANGEMENT: "Hình thức",
          LOCATION: "Địa điểm",
          DISTRICT: "Quận/Huyện",
          SALARY: "Lương",
          COMPANY: "Công ty",
          POSTED_TIME: "Thời gian đăng",
        }
      : {
          TITLE: "Title",
          OCCUPATION: "Occupation",
          SKILL: "Skill",
          SENIORITY: "Experience",
          EMPLOYMENT_TYPE: "Employment",
          WORK_ARRANGEMENT: "Work arrangement",
          LOCATION: "Location",
          DISTRICT: "District",
          SALARY: "Salary",
          COMPANY: "Company",
          POSTED_TIME: "Posted",
        };
  return `${kindLabels[filter.kind]}: ${locale === "vi" ? filter.labelVi : filter.labelEn}`;
}

function structuredActiveFilters(
  criteria: JobSearchCriteria,
  interpretation: SearchInterpretation | undefined,
  locale: "vi" | "en",
): ActiveFilter[] {
  return (interpretation?.structuredFilters ?? []).map((filter) => {
    const next = removeStructuredQuery(criteria, filter.query);
    const query = jobCriteriaParams(next).toString();
    return {
      id: filter.id,
      label: structuredFilterLabel(filter, locale),
      name: "structuredQuery",
      value: filter.query,
      href: query ? `/jobs?${query}` : "/jobs",
    };
  });
}

export function JobSearchForm({
  criteria,
  onCriteriaChange,
  onClear,
  resultCount,
  isLoading = false,
  taxonomy,
  searchInterpretation,
  searchMetadata,
}: JobSearchFormProps) {
  const locale = useWorkspaceLocale();
  const vi = locale === "vi";
  const copy = vi
    ? {
        mobile: "Bộ lọc",
        close: "Đóng bộ lọc",
        applied: "Bộ lọc đang áp dụng",
        clear: "Xóa bộ lọc",
        remove: "Xóa bộ lọc",
        refine: "Tinh chỉnh tìm kiếm",
        filters: "Bộ lọc",
        intro: "Danh sách tự cập nhật khi bạn thay đổi tiêu chí.",
        location: "Địa điểm",
        locationPlaceholder: "Thành phố Hồ Chí Minh",
        employment: "Loại công việc",
        experience: "Cấp độ kinh nghiệm",
        arrangement: "Hình thức làm việc",
        salaryMin: "Lương tối thiểu (VND/tháng)",
        salaryMax: "Lương tối đa (VND/tháng)",
        skill: "Kỹ năng",
        posted: "Thời gian đăng",
        sort: "Sắp xếp",
        any: "Tất cả",
        anyTime: "Mọi thời điểm",
        image: "Tìm bằng hình ảnh",
        updating: "Đang cập nhật",
        matching: "việc làm phù hợp",
        noMatching: "Chưa có việc làm phù hợp",
        keepSearch: "Lưu tìm kiếm này",
        saveDescription: "Đặt tên để dùng lại bộ lọc và từ khóa này.",
        savedSearches: "Tìm kiếm đã lưu",
        reuseSaved: "Dùng lại tìm kiếm đã lưu…",
        saveFilter: "Lưu bộ lọc",
        nameSearch: "Đặt tên tìm kiếm",
        savedDescription:
          "Tìm kiếm này lưu nguyên văn từ khóa và chế độ tìm kiếm hiện tại.",
        searchName: "Tên tìm kiếm",
        searchExample: "ví dụ: Vị trí sản phẩm cấp cao từ xa",
        cancel: "Hủy",
        saveFilterAction: "Lưu bộ lọc",
      }
    : {
        mobile: "Filters",
        close: "Close filters",
        applied: "Applied filters",
        clear: "Clear filters",
        remove: "Remove filter",
        refine: "Refine search",
        filters: "Filters",
        intro: "The list updates as you change a criterion.",
        location: "Location",
        locationPlaceholder: "Ho Chi Minh City",
        employment: "Employment type",
        experience: "Experience level",
        arrangement: "Work arrangement",
        salaryMin: "Minimum salary (VND/month)",
        salaryMax: "Maximum salary (VND/month)",
        skill: "Skill",
        posted: "Posted within",
        sort: "Sort",
        any: "Any",
        anyTime: "Any time",
        image: "Search from an image",
        updating: "Updating",
        matching: "matching jobs",
        noMatching: "No matching jobs yet",
        keepSearch: "Save this search",
        saveDescription: "Name this search and reuse its filters later.",
        savedSearches: "Saved searches",
        reuseSaved: "Reuse saved search…",
        saveFilter: "Save filter",
        nameSearch: "Name this search",
        savedDescription:
          "This search keeps the raw keyword and current search mode.",
        searchName: "Search name",
        searchExample: "e.g. Senior remote product roles",
        cancel: "Cancel",
        saveFilterAction: "Save filter",
      };
  const filters = useMemo(
    () => activeFilters(criteria, locale, taxonomy),
    [criteria, locale, taxonomy],
  );
  const parsedFilters = useMemo(
    () => structuredActiveFilters(criteria, searchInterpretation, locale),
    [criteria, locale, searchInterpretation],
  );
  const displayedFilters = [...filters, ...parsedFilters];
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customSalaryMin, setCustomSalaryMin] = useState("");
  const [customSalaryMax, setCustomSalaryMax] = useState("");
  const drawer = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const live = Boolean(onCriteriaChange);
  const shared = useOptionalJobInteraction();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [restoredPreset, setRestoredPreset] =
    useState<SavedFilterPreset | null>(null);
  const optionLabel = (value: string) =>
    (vi ? valueLabelsVi : valueLabels)[value] ?? value;

  const filterSnapshot = useMemo(() => {
    const snapshot: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(criteria)) {
      if (value === undefined) continue;
      snapshot[name] = Array.isArray(value) ? [...value] : value;
    }
    return snapshot;
  }, [criteria]);

  const presetMetadata: FilterPresetMetadata = {
    q: one(criteria.q),
    searchMode: one(criteria.searchMode) === "LITERAL" ? "LITERAL" : "SMART",
    resolverVersion:
      searchInterpretation?.resolverVersion ?? searchMetadata?.resolverVersion,
    catalogVersion:
      searchInterpretation?.catalogVersion ?? searchMetadata?.catalogVersion,
    structuredFilters: searchInterpretation?.structuredFilters,
    searchIntent: searchInterpretation?.searchIntent,
  };

  const restorePreset = (presetId: string) => {
    setSelectedPresetId("");
    if (!onCriteriaChange || !shared) return;
    const preset = shared.savedFilterPresets.find(
      (item) => item.id === presetId,
    );
    if (!preset) return;
    setRestoredPreset(preset);

    const next: JobSearchCriteria = {};
    for (const [name, value] of Object.entries(preset.filters)) {
      if (
        name === "q" ||
        name === "searchMode" ||
        name === "page" ||
        name === "cursor"
      )
        continue;
      if (typeof value === "string" || typeof value === "number") {
        next[name] = value;
      } else if (
        Array.isArray(value) &&
        value.every((item): item is string => typeof item === "string")
      ) {
        next[name] = value;
      }
    }

    const legacyQuery =
      typeof preset.filters.q === "string" ? preset.filters.q.trim() : "";
    const rawQuery = preset.q.trim() || legacyQuery;
    if (rawQuery) next.q = rawQuery;

    const legacyMode =
      preset.filters.searchMode === "LITERAL" ? "LITERAL" : "SMART";
    if (rawQuery) next.searchMode = preset.searchMode ?? legacyMode;
    onCriteriaChange(next, "immediate");
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const returnTarget = trigger.current;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => drawer.current?.focus(), 0);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer.current) return;
      const controls = Array.from(
        drawer.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      returnTarget?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    const filterColumn =
      form.current?.closest<HTMLElement>(".job-filter-column");
    if (!filterColumn) return;

    const scrollFilterColumn = (event: WheelEvent) => {
      const maximumScrollTop =
        filterColumn.scrollHeight - filterColumn.clientHeight;
      if (!event.deltaY || maximumScrollTop <= 0) return;

      const nextScrollTop = Math.max(
        0,
        Math.min(maximumScrollTop, filterColumn.scrollTop + event.deltaY),
      );
      if (nextScrollTop === filterColumn.scrollTop) return;

      event.preventDefault();
      filterColumn.scrollTop = nextScrollTop;
    };

    filterColumn.addEventListener("wheel", scrollFilterColumn, {
      passive: false,
    });
    return () => filterColumn.removeEventListener("wheel", scrollFilterColumn);
  }, []);

  const valueProps = (name: string) =>
    live
      ? { value: one(criteria[name]) }
      : { defaultValue: one(criteria[name]) };

  const updateCriterion = (
    name: string,
    value: string,
    trigger: JobFilterTrigger,
  ) => {
    if (!onCriteriaChange) return;
    const next = { ...criteria };
    if (value) next[name] = value;
    else delete next[name];
    if (name === "q" && !value) delete next.searchMode;
    onCriteriaChange(next, trigger);
  };

  const selectedValues = (name: string) => {
    const value = criteria[name];
    return Array.isArray(value) ? value : value ? [String(value)] : [];
  };

  const toggleCriterionValue = (name: string, value: string) => {
    if (!onCriteriaChange) return;
    const current = selectedValues(name);
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    onCriteriaChange(
      next.length
        ? { ...criteria, [name]: next }
        : removeCriterion(criteria, name),
      "immediate",
    );
  };

  const setSalaryRange = (minimum?: number, maximum?: number) => {
    if (!onCriteriaChange) return;
    const next = { ...criteria };
    delete next.salaryNegotiable;
    if (minimum === undefined) delete next.salaryMin;
    else next.salaryMin = String(minimum);
    if (maximum === undefined) delete next.salaryMax;
    else next.salaryMax = String(maximum);
    onCriteriaChange(next, "immediate");
  };

  const setNegotiableSalary = () => {
    if (!onCriteriaChange) return;
    const next: JobSearchCriteria = { ...criteria, salaryNegotiable: "true" };
    delete next.salaryMin;
    delete next.salaryMax;
    onCriteriaChange(next, "immediate");
  };

  const selectedEmployment = selectedValues("employmentType")[0] ?? "";
  const selectedExperience = selectedValues("experienceLevel");
  const selectedDistricts = selectedValues("district");
  const salaryMinimum = Number(one(criteria.salaryMin) || 0);
  const salaryMaximum = Number(one(criteria.salaryMax) || 0);
  const selectedSalaryPreset: string =
    one(criteria.salaryNegotiable) === "true"
      ? "negotiable"
      : !salaryMinimum && !salaryMaximum
        ? "all"
        : salaryMaximum === 10_000_000
          ? "under-10"
          : salaryMinimum === 10_000_000 && salaryMaximum === 15_000_000
            ? "10-15"
            : salaryMinimum === 15_000_000 && salaryMaximum === 20_000_000
              ? "15-20"
              : salaryMinimum === 20_000_000 && salaryMaximum === 25_000_000
                ? "20-25"
                : salaryMinimum === 25_000_000 && salaryMaximum === 30_000_000
                  ? "25-30"
                  : salaryMinimum === 30_000_000 && salaryMaximum === 50_000_000
                    ? "30-50"
                    : salaryMinimum === 50_000_000 && !salaryMaximum
                      ? "over-50"
                      : "custom";

  const countText =
    resultCount === undefined
      ? ""
      : resultCount
        ? `${new Intl.NumberFormat(vi ? "vi-VN" : "en-US").format(resultCount)} ${copy.matching}`
        : copy.noMatching;

  return (
    <div className="job-filter-shell" data-mobile-open={mobileOpen}>
      <button
        ref={trigger}
        className="job-filter-mobile-trigger"
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="job-filter-drawer"
        onClick={() => setMobileOpen(true)}
      >
        <span>{copy.mobile}</span>
        <strong>{displayedFilters.length}</strong>
      </button>

      {displayedFilters.length ? (
        <div className="job-active-filters" aria-label={copy.applied}>
          <div>
            {displayedFilters.map((filter) =>
              onCriteriaChange ? (
                <button
                  key={filter.id}
                  className="job-active-filter-chip"
                  type="button"
                  onClick={() =>
                    onCriteriaChange(
                      filter.name === "structuredQuery"
                        ? removeStructuredQuery(criteria, filter.value ?? "")
                        : removeActiveFilter(criteria, filter),
                      "immediate",
                    )
                  }
                >
                  {filter.label}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">
                    {copy.remove} {filter.label}
                  </span>
                </button>
              ) : (
                <Link key={filter.id} href={filter.href}>
                  {filter.label}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">
                    {copy.remove} {filter.label}
                  </span>
                </Link>
              ),
            )}
          </div>
          {!onClear ? (
            <Link className="job-active-filters-clear" href="/jobs">
              {copy.clear}
            </Link>
          ) : null}
        </div>
      ) : null}

      {mobileOpen ? (
        <button
          className="job-filter-mobile-backdrop"
          type="button"
          aria-label={copy.close}
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <section
        ref={drawer}
        id="job-filter-drawer"
        className="job-filter-drawer"
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? true : undefined}
        aria-label={mobileOpen ? copy.filters : undefined}
        tabIndex={mobileOpen ? -1 : undefined}
      >
        <form
          ref={form}
          className="job-panel job-filter-form"
          role="search"
          aria-label={vi ? "Tìm kiếm việc làm" : "Job search"}
          action="/jobs"
          onSubmit={(event) => event.preventDefault()}
        >
          <header className="job-filter-heading">
            <span className="job-filter-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 5.5h16l-6.25 7.1v5.1l-3.5 1.8v-6.9L4 5.5Z" />
              </svg>
            </span>
            <div>
              <p className="panel-kicker">{copy.refine}</p>
              <div className="job-filter-title-row">
                <h2>{copy.filters}</h2>
                <p
                  className="job-filter-result-count"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {countText
                    ? isLoading
                      ? `${countText} · ${copy.updating}`
                      : countText
                    : null}
                </p>
              </div>
            </div>
            <button
              className="job-filter-mobile-close"
              type="button"
              aria-label={copy.close}
              onClick={() => setMobileOpen(false)}
            >
              ×
            </button>
          </header>
          <p className="job-filter-copy">{copy.intro}</p>
          <div className="job-filter-fields job-filter-fields--redesigned">
            {taxonomy ? (
              <fieldset className="job-filter-section job-filter-location-section">
                <legend>{copy.location}</legend>
                <LocationPicker
                  taxonomy={taxonomy}
                  location={one(criteria.location)}
                  districts={selectedDistricts}
                  vi={vi}
                  onApply={(nextLocation, nextDistricts) => {
                    const next = { ...criteria };
                    if (nextLocation) next.location = nextLocation;
                    else delete next.location;
                    if (nextDistricts.length) next.district = nextDistricts;
                    else delete next.district;
                    onCriteriaChange?.(next, "immediate");
                  }}
                  onClear={() => {
                    const next = { ...criteria };
                    delete next.location;
                    delete next.district;
                    onCriteriaChange?.(next, "immediate");
                  }}
                />
              </fieldset>
            ) : null}
            <fieldset className="job-filter-section">
              <legend>{vi ? "Mức lương" : "Salary"}</legend>
              <div className="job-filter-option-grid job-filter-option-grid--salary">
                {[
                  ["all", vi ? "Tất cả" : "All", undefined, undefined],
                  [
                    "under-10",
                    vi ? "Dưới 10 triệu" : "Under 10M",
                    undefined,
                    10_000_000,
                  ],
                  [
                    "10-15",
                    vi ? "10 - 15 triệu" : "10 - 15M",
                    10_000_000,
                    15_000_000,
                  ],
                  [
                    "15-20",
                    vi ? "15 - 20 triệu" : "15 - 20M",
                    15_000_000,
                    20_000_000,
                  ],
                  [
                    "20-25",
                    vi ? "20 - 25 triệu" : "20 - 25M",
                    20_000_000,
                    25_000_000,
                  ],
                  [
                    "25-30",
                    vi ? "25 - 30 triệu" : "25 - 30M",
                    25_000_000,
                    30_000_000,
                  ],
                  [
                    "30-50",
                    vi ? "30 - 50 triệu" : "30 - 50M",
                    30_000_000,
                    50_000_000,
                  ],
                  [
                    "over-50",
                    vi ? "Trên 50 triệu" : "Over 50M",
                    50_000_000,
                    undefined,
                  ],
                ].map(([value, label, minimum, maximum]) => (
                  <label className="job-filter-option" key={String(value)}>
                    <input
                      type="radio"
                      name="salary-preset"
                      checked={selectedSalaryPreset === value}
                      onChange={() =>
                        setSalaryRange(
                          minimum as number | undefined,
                          maximum as number | undefined,
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
                <label className="job-filter-option">
                  <input
                    type="radio"
                    name="salary-preset"
                    checked={selectedSalaryPreset === "negotiable"}
                    onChange={setNegotiableSalary}
                  />
                  <span>{vi ? "Thỏa thuận" : "Negotiable"}</span>
                </label>
              </div>
              <div className="job-filter-custom-salary">
                <label>
                  <span>{vi ? "Từ" : "From"}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="0"
                    value={customSalaryMin}
                    onChange={(event) =>
                      setCustomSalaryMin(event.currentTarget.value)
                    }
                  />
                </label>
                <span aria-hidden="true">–</span>
                <label>
                  <span>{vi ? "Đến" : "To"}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="0"
                    value={customSalaryMax}
                    onChange={(event) =>
                      setCustomSalaryMax(event.currentTarget.value)
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSalaryRange(
                      customSalaryMin
                        ? Number(customSalaryMin) * 1_000_000
                        : undefined,
                      customSalaryMax
                        ? Number(customSalaryMax) * 1_000_000
                        : undefined,
                    )
                  }
                >
                  {vi ? "Áp dụng" : "Apply"}
                </button>
              </div>
            </fieldset>

            <fieldset className="job-filter-section">
              <legend>{vi ? "Loại hình làm việc" : "Employment type"}</legend>
              <div className="job-filter-option-grid">
                {[
                  ["", vi ? "Tất cả" : "All"],
                  ["FULL_TIME", vi ? "Toàn thời gian" : "Full-time"],
                  ["PART_TIME", vi ? "Bán thời gian" : "Part-time"],
                  ["INTERNSHIP", vi ? "Thực tập" : "Internship"],
                  ["OTHER", vi ? "Khác" : "Other"],
                ].map(([value, label]) => (
                  <label className="job-filter-option" key={value}>
                    <input
                      type="radio"
                      name="employment-type"
                      checked={
                        value === "OTHER"
                          ? selectedEmployment === "CONTRACT" ||
                            selectedEmployment === "TEMPORARY"
                          : selectedEmployment === value
                      }
                      onChange={() => {
                        if (value === "OTHER")
                          onCriteriaChange?.(
                            {
                              ...criteria,
                              employmentType: ["CONTRACT", "TEMPORARY"],
                            },
                            "immediate",
                          );
                        else
                          updateCriterion("employmentType", value, "immediate");
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="job-filter-section">
              <legend>{vi ? "Kinh nghiệm" : "Experience"}</legend>
              <div className="job-filter-option-grid job-filter-option-grid--experience">
                {[
                  [
                    "ENTRY",
                    vi ? "Không yêu cầu kinh nghiệm" : "No experience required",
                  ],
                  ["JUNIOR", vi ? "1 - 2 năm" : "1 - 2 years"],
                  ["MID", vi ? "3 - 4 năm" : "3 - 4 years"],
                  ["SENIOR", vi ? "Từ 5 năm" : "5+ years"],
                  ["LEAD", vi ? "Trưởng nhóm" : "Team lead"],
                  ["MANAGER", vi ? "Quản lý" : "Manager"],
                ].map(([value, label]) => (
                  <label
                    className="job-filter-option"
                    key={`${value}-${label}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedExperience.includes(value)}
                      onChange={() =>
                        toggleCriterionValue("experienceLevel", value)
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="job-filter-standard-control">
              <span>{copy.arrangement}</span>
              <select
                name="workArrangement"
                {...valueProps("workArrangement")}
                onChange={(event) =>
                  updateCriterion(
                    "workArrangement",
                    event.currentTarget.value,
                    "immediate",
                  )
                }
              >
                <option value="">{copy.any}</option>
                <option value="ONSITE">{optionLabel("ONSITE")}</option>
                <option value="HYBRID">{optionLabel("HYBRID")}</option>
                <option value="REMOTE">{optionLabel("REMOTE")}</option>
              </select>
            </label>
            <label className="job-filter-standard-control">
              <span>{copy.skill}</span>
              <input
                name="skills"
                maxLength={80}
                placeholder="TypeScript"
                {...valueProps("skills")}
                onChange={(event) =>
                  updateCriterion(
                    "skills",
                    event.currentTarget.value,
                    "debounced",
                  )
                }
              />
            </label>
          </div>
          <div className="job-filter-actions">
            {onClear ? (
              <button
                className="job-secondary-link job-filter-clear"
                type="button"
                onClick={onClear}
              >
                <svg
                  className="job-filter-action-icon"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                >
                  <path d="M20 11a8 8 0 1 0 1.6 4.8" />
                  <path d="M20 4v7h-7" />
                </svg>
                {copy.clear}
              </button>
            ) : (
              <Link
                className="job-secondary-link job-filter-clear"
                href="/jobs"
              >
                {copy.clear}
              </Link>
            )}
          </div>
        </form>
        {live && shared ? (
          <div className="job-save-filter-card">
            <span className="job-save-filter-icon" aria-hidden="true">
              ◌
            </span>
            <div>
              <strong>{copy.keepSearch}</strong>
              <p>{copy.saveDescription}</p>
            </div>
            <button type="button" onClick={() => setSaveDialogOpen(true)}>
              {copy.saveFilter}
            </button>
            {shared.savedFilterPresets.length ? (
              <select
                aria-label={copy.savedSearches}
                value={selectedPresetId}
                onChange={(event) => restorePreset(event.currentTarget.value)}
              >
                <option value="">{copy.reuseSaved}</option>
                {shared.savedFilterPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            ) : null}
            <SavedSearchVersionNotice
              preset={restoredPreset}
              interpretation={searchInterpretation}
              metadata={searchMetadata}
              locale={vi ? "vi" : "en"}
            />
          </div>
        ) : null}
      </section>
      {saveDialogOpen && shared ? (
        <div className="job-save-filter-dialog-backdrop">
          <section
            className="job-save-filter-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-save-filter-title"
          >
            <p className="panel-kicker">{copy.saveFilter}</p>
            <h2 id="live-save-filter-title">{copy.nameSearch}</h2>
            <p>{copy.savedDescription}</p>
            <label>
              {copy.searchName}
              <input
                className="sh-input"
                autoFocus
                maxLength={160}
                value={presetName}
                placeholder={copy.searchExample}
                onChange={(event) => setPresetName(event.currentTarget.value)}
              />
            </label>
            <div className="job-dialog-actions">
              <button
                className="sh-button sh-button--secondary"
                type="button"
                onClick={() => {
                  setPresetName("");
                  setSaveDialogOpen(false);
                }}
              >
                {copy.cancel}
              </button>
              <button
                className="sh-button"
                type="button"
                disabled={!presetName.trim()}
                onClick={() => {
                  shared.saveFilterPreset(
                    presetName,
                    filterSnapshot,
                    presetMetadata,
                  );
                  setPresetName("");
                  setSaveDialogOpen(false);
                }}
              >
                {copy.saveFilterAction}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
