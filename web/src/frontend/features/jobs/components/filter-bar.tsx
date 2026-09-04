"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { JobSearchResponse } from "@/shared/contracts/jobs/discovery";
import type { SavedFilterPreset } from "@/shared/contracts/jobs/catalog";
import type { SearchSuggestion } from "@/shared/contracts/search/search-suggestions";
import { useSearchSuggestions } from "@/frontend/features/search/client/use-search-suggestions";
import {
  SearchSuggestionList,
  localizedSuggestionLabel,
} from "@/frontend/features/search/components/search-suggestion-list";
import {
  useOptionalJobInteraction,
  type FilterPresetMetadata,
} from "./job-interaction-provider";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { jobCopy } from "./job-copy";
import { SavedSearchVersionNotice } from "./saved-search-version-notice";

export type JobSortMode =
  | "best-match"
  | "recently-posted"
  | "recently-updated"
  | "urgent"
  | "salary-high"
  | "salary-low";

const sortByServerValue: Record<JobSortMode, string> = {
  "best-match": "RELEVANCE",
  "recently-posted": "NEWEST",
  "recently-updated": "NEWEST",
  urgent: "RELEVANCE",
  "salary-high": "SALARY_DESC",
  "salary-low": "RELEVANCE",
};

const sortModeFromServerValue: Record<string, JobSortMode> = {
  RELEVANCE: "best-match",
  NEWEST: "recently-posted",
  SALARY_DESC: "salary-high",
};

type FilterLocale = "vi" | "en";

function filterLabelsFor(locale: FilterLocale) {
  return locale === "vi"
    ? {
        q: "Từ khóa",
        location: "Địa điểm",
        employmentType: "Loại việc",
        experienceLevel: "Cấp độ",
        workArrangement: "Hình thức",
        skills: "Kỹ năng",
        salaryMin: "Lương tối thiểu",
        salaryMax: "Lương tối đa",
        postedWithinDays: "Đăng trong",
        experienceMinYears: "Kinh nghiệm",
        categoryFamily: "Nhóm ngành",
        workOnSaturday: "Làm thứ Bảy",
        searchBy: "Tìm theo",
      }
    : {
        q: "Keyword",
        location: "Location",
        employmentType: "Work type",
        experienceLevel: "Level",
        workArrangement: "Arrangement",
        skills: "Skill",
        salaryMin: "Minimum salary",
        salaryMax: "Maximum salary",
        postedWithinDays: "Posted within",
        experienceMinYears: "Experience",
        categoryFamily: "Category",
        workOnSaturday: "Saturday work",
        searchBy: "Search by",
      };
}

function filterValueLabelsFor(locale: FilterLocale): Record<string, string> {
  const copy = jobCopy(locale);
  return {
    ...copy.employmentTypeLabels,
    ...copy.experienceLevelLabels,
    ...copy.workArrangementLabels,
    TITLE: locale === "vi" ? "Chức danh" : "Job title",
    COMPANY: locale === "vi" ? "Công ty" : "Company",
    BOTH:
      locale === "vi"
        ? "Chức danh, kỹ năng + công ty"
        : "Title, skills + company",
    "1": locale === "vi" ? "24 giờ" : "24 hours",
    "3": locale === "vi" ? "3 ngày" : "3 days",
    "7": locale === "vi" ? "7 ngày" : "7 days",
    "14": locale === "vi" ? "14 ngày" : "14 days",
    "30": locale === "vi" ? "30 ngày" : "30 days",
  };
}

function filterText(locale: FilterLocale) {
  return locale === "vi"
    ? {
        sortBy: "Sắp xếp theo",
        sortJobs: "Sắp xếp việc làm",
        salary: "Mức lương",
        salaryPresets: "Mức lương gợi ý",
        salaryRange: "Khoảng lương",
        minimumSalary: "Lương tối thiểu",
        maximumSalary: "Lương tối đa",
        from: "Từ",
        to: "Đến",
        salaryHelp: "Khoảng lương VND theo tháng, trước thuế.",
        experience: "Kinh nghiệm",
        minimumYears: "Số năm tối thiểu",
        anyExperience: "Không yêu cầu cụ thể",
        years: (count: number) => `${count}+ năm`,
        jobLevel: "Cấp độ công việc",
        workType: "Loại hình làm việc",
        moreFilters: "Bộ lọc khác",
        city: "Thành phố",
        skill: "Kỹ năng",
        categoryFamily: "Nhóm ngành",
        worksSaturdays: "Làm việc thứ Bảy",
        postedWithin: "Đăng trong",
        anyTime: "Mọi thời điểm",
        hours: "24 giờ",
        days: (count: number) => `${count} ngày`,
        activeFilters: "Bộ lọc đang áp dụng",
        filteredBy: "Được lọc theo",
        searchBy: "Tìm theo",
        jobTitle: "Chức danh công việc",
        company: "Công ty",
        titleSkillsCompany: "Chức danh, kỹ năng + công ty",
        searchJobs: "Tìm việc làm",
        searchButton: "Tìm kiếm",
        searchPlaceholder: "Tìm chức danh, kỹ năng, công ty",
        quickFilters: "Bộ lọc nhanh",
        filtersAndSort: "Bộ lọc & sắp xếp",
        matchingJobs: "việc làm phù hợp",
        advancedJobFilters: "Bộ lọc việc làm nâng cao",
        refineSignal: "Tinh chỉnh kết quả",
        advancedFilters: "Bộ lọc nâng cao",
        clear: "Xóa",
        keepSearch: "Lưu tìm kiếm này",
        saveDescription: "Đặt tên cho nhóm bộ lọc và dùng lại sau.",
        savedSearches: "Tìm kiếm đã lưu",
        reuseSaved: "Dùng lại tìm kiếm đã lưu…",
        personalizeList: "Cá nhân hóa danh sách",
        closeFiltersSort: "Đóng bộ lọc và sắp xếp",
        clearAll: "Xóa tất cả",
        showJobs: (count: number) => `Hiển thị ${count} việc làm`,
        saveFilter: "Lưu bộ lọc",
        nameSearch: "Đặt tên tìm kiếm",
        savedDescription:
          "Tìm kiếm đã lưu độc lập với bộ lọc đang áp dụng; danh sách này đã cập nhật trực tiếp.",
        searchName: "Tên tìm kiếm",
        searchExample: "ví dụ: Vị trí sản phẩm cấp cao từ xa",
        cancel: "Hủy",
        saveFilterAction: "Lưu bộ lọc",
      }
    : {
        sortBy: "Sort by",
        sortJobs: "Sort jobs",
        salary: "Salary",
        salaryPresets: "Salary presets",
        salaryRange: "Salary range",
        minimumSalary: "Minimum salary",
        maximumSalary: "Maximum salary",
        from: "From",
        to: "To",
        salaryHelp: "Monthly VND ranges, before tax.",
        experience: "Experience",
        minimumYears: "Minimum years",
        anyExperience: "Any experience",
        years: (count: number) => `${count}+ years`,
        jobLevel: "Job level",
        workType: "Work type",
        moreFilters: "More filters",
        city: "City",
        skill: "Skill",
        categoryFamily: "Category family",
        worksSaturdays: "Works Saturdays",
        postedWithin: "Posted within",
        anyTime: "Any time",
        hours: "24 hours",
        days: (count: number) => `${count} days`,
        activeFilters: "Active filters",
        filteredBy: "Filtered by",
        searchBy: "Search by",
        jobTitle: "Job title",
        company: "Company",
        titleSkillsCompany: "Title, skills + company",
        searchJobs: "Search jobs",
        searchButton: "Search",
        searchPlaceholder: "Search job titles, skills, companies",
        quickFilters: "Quick filters",
        filtersAndSort: "Filters & Sort",
        matchingJobs: "matching jobs",
        advancedJobFilters: "Advanced job filters",
        refineSignal: "Refine the signal",
        advancedFilters: "Advanced filters",
        clear: "Clear",
        keepSearch: "Keep this search",
        saveDescription: "Name this filter combo and reuse it later.",
        savedSearches: "Saved searches",
        reuseSaved: "Reuse saved search…",
        personalizeList: "Personalize the list",
        closeFiltersSort: "Close filters and sort",
        clearAll: "Clear all",
        showJobs: (count: number) => `Show ${count} jobs`,
        saveFilter: "Save filter",
        nameSearch: "Name this search",
        savedDescription:
          "Saved searches are separate from applying a filter; this list is already live.",
        searchName: "Search name",
        searchExample: "e.g. Senior remote product roles",
        cancel: "Cancel",
        saveFilterAction: "Save filter",
      };
}

function quickFiltersFor(locale: FilterLocale) {
  const labels =
    locale === "vi"
      ? ["Từ xa", "Linh hoạt", "Toàn thời gian", "Mới trong tuần", "20M+ VND"]
      : ["Remote", "Hybrid", "Full time", "New this week", "20M+ VND"];
  return [
    { label: labels[0], name: "workArrangement", value: "REMOTE" },
    { label: labels[1], name: "workArrangement", value: "HYBRID" },
    { label: labels[2], name: "employmentType", value: "FULL_TIME" },
    { label: labels[3], name: "postedWithinDays", value: "7" },
    { label: labels[4], name: "salaryMin", value: "20000000" },
  ] as const;
}

export function sortModeFromParams(params: URLSearchParams) {
  const explicit = params.get("sortBy") as JobSortMode | null;
  if (
    explicit &&
    Object.prototype.hasOwnProperty.call(sortByServerValue, explicit)
  )
    return explicit;
  return (
    sortModeFromServerValue[params.get("sort") ?? "RELEVANCE"] ?? "best-match"
  );
}

function useFilterNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("cursor");
      const query = params.toString();
      startTransition(() => {
        router.replace(query ? pathname + "?" + query : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router, searchParams],
  );

  return { navigate, searchParams, isPending };
}

function toggleQueryValue(
  params: URLSearchParams,
  name: string,
  value: string,
) {
  const values = params.getAll(name);
  params.delete(name);
  if (!values.includes(value)) {
    for (const item of [...values, value]) params.append(name, item);
  } else {
    for (const item of values.filter((item) => item !== value))
      params.append(name, item);
  }
}

export function SortDropdown({
  value,
  onChange,
}: {
  value: JobSortMode;
  onChange: (value: JobSortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const locale = useWorkspaceLocale();
  const text = filterText(locale);
  const selected =
    sortOptions.find((option) => option.value === value) ?? sortOptions[0];

  return (
    <div className="job-sort-dropdown">
      <span className="job-sort-label">{text.sortBy}</span>
      <button
        className="job-sort-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="job-sort-trigger-icon" aria-hidden="true">
          {selected.icon}
        </span>
        <span>
          <strong>{sortOptionText(locale, selected.value).label}</strong>
          <small>{sortOptionText(locale, selected.value).description}</small>
        </span>
        <span className="job-sort-chevron" aria-hidden="true">
          {open ? "⌃" : "⌄"}
        </span>
      </button>
      {open ? (
        <div
          className="job-sort-menu"
          role="listbox"
          aria-label={text.sortJobs}
        >
          {sortOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                setOpen(false);
                onChange(option.value);
              }}
            >
              <span className="job-sort-option-icon" aria-hidden="true">
                {option.icon}
              </span>
              <span>
                <strong>{sortOptionText(locale, option.value).label}</strong>
                <small>
                  {sortOptionText(locale, option.value).description}
                </small>
              </span>
              {option.value === value ? (
                <span className="job-sort-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const sortOptions: Array<{
  value: JobSortMode;
  icon: string;
}> = [
  {
    value: "best-match",
    icon: "✦",
  },
  {
    value: "recently-posted",
    icon: "◷",
  },
  {
    value: "recently-updated",
    icon: "↻",
  },
  {
    value: "urgent",
    icon: "♨",
  },
  {
    value: "salary-high",
    icon: "↗",
  },
  {
    value: "salary-low",
    icon: "↘",
  },
];

function sortOptionText(locale: FilterLocale, value: JobSortMode) {
  const options =
    locale === "vi"
      ? {
          "best-match": {
            label: "Phù hợp nhất",
            description: "Phù hợp với hồ sơ của bạn",
          },
          "recently-posted": {
            label: "Mới đăng gần đây",
            description: "Cơ hội mới nhất lên đầu",
          },
          "recently-updated": {
            label: "Cập nhật gần đây",
            description: "Vị trí có thông tin mới",
          },
          urgent: {
            label: "Đang cần tuyển gấp",
            description: "Sắp đóng và đang tuyển dụng",
          },
          "salary-high": {
            label: "Lương: cao đến thấp",
            description: "Khoảng lương công bố cao nhất lên đầu",
          },
          "salary-low": {
            label: "Lương: thấp đến cao",
            description: "Khoảng lương công bố thấp nhất lên đầu",
          },
        }
      : {
          "best-match": {
            label: "Best match",
            description: "Aligned to your profile",
          },
          "recently-posted": {
            label: "Recently posted",
            description: "Freshest opportunities first",
          },
          "recently-updated": {
            label: "Recently updated",
            description: "Roles with new details",
          },
          urgent: {
            label: "Urgent hiring",
            description: "Closing soon and hiring now",
          },
          "salary-high": {
            label: "Salary: high to low",
            description: "Highest published range first",
          },
          "salary-low": {
            label: "Salary: low to high",
            description: "Lowest published range first",
          },
        };
  return options[value];
}

export function AdvancedFilters({
  onUpdate,
}: {
  onUpdate: (
    mutate: (params: URLSearchParams) => void,
    immediate?: boolean,
  ) => void;
}) {
  const params = useSearchParams();
  const locale = useWorkspaceLocale();
  const text = filterText(locale);
  const labels = filterValueLabelsFor(locale);
  const [location, setLocation] = useState(params.get("location") ?? "");
  const [skill, setSkill] = useState(params.get("skills") ?? "");
  const locationTimer = useRef<number | null>(null);
  const skillTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocation(params.get("location") ?? "");
      setSkill(params.get("skills") ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [params]);

  function scheduleText(
    name: string,
    value: string,
    timer: MutableRefObject<number | null>,
    setValue: (value: string) => void,
  ) {
    setValue(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onUpdate((next) => {
        if (value.trim()) next.set(name, value.trim());
        else next.delete(name);
      });
    }, 400);
  }

  return (
    <div className="job-advanced-filter-groups">
      <details open>
        <summary>
          <span>{text.salary}</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="job-filter-group-content">
          <div className="job-salary-presets" aria-label={text.salaryPresets}>
            {[10000000, 20000000, 40000000].map((value) => (
              <button
                key={value}
                className={
                  Number(params.get("salaryMin")) === value ? "is-active" : ""
                }
                type="button"
                onClick={() =>
                  onUpdate((next) => {
                    if (Number(next.get("salaryMin")) === value)
                      next.delete("salaryMin");
                    else next.set("salaryMin", String(value));
                  })
                }
              >
                {value / 1_000_000}M+
              </button>
            ))}
          </div>
          <div className="job-salary-sliders" aria-label={text.salaryRange}>
            <label>
              {text.minimumSalary}
              <input
                type="range"
                min="0"
                max="100000000"
                step="1000000"
                value={params.get("salaryMin") ?? "0"}
                onChange={(event) =>
                  onUpdate((next) => {
                    const minimum = Number(event.currentTarget.value);
                    const maximum = Number(
                      next.get("salaryMax") ?? "100000000",
                    );
                    next.set("salaryMin", String(Math.min(minimum, maximum)));
                  })
                }
              />
              <output>
                {Number(params.get("salaryMin") ?? 0) / 1_000_000}M+
              </output>
            </label>
            <label>
              {text.maximumSalary}
              <input
                type="range"
                min="0"
                max="100000000"
                step="1000000"
                value={params.get("salaryMax") ?? "100000000"}
                onChange={(event) =>
                  onUpdate((next) => {
                    const maximum = Number(event.currentTarget.value);
                    const minimum = Number(next.get("salaryMin") ?? "0");
                    next.set("salaryMax", String(Math.max(minimum, maximum)));
                  })
                }
              />
              <output>
                {Number(params.get("salaryMax") ?? 100_000_000) / 1_000_000}M
              </output>
            </label>
          </div>{" "}
          <div className="job-filter-two-column">
            <label>
              {text.from}
              <input
                className="sh-input"
                type="number"
                min="0"
                inputMode="numeric"
                value={params.get("salaryMin") ?? ""}
                onChange={(event) =>
                  onUpdate((next) => {
                    if (event.currentTarget.value)
                      next.set("salaryMin", event.currentTarget.value);
                    else next.delete("salaryMin");
                  })
                }
              />
            </label>
            <label>
              {text.to}
              <input
                className="sh-input"
                type="number"
                min="0"
                inputMode="numeric"
                value={params.get("salaryMax") ?? ""}
                onChange={(event) =>
                  onUpdate((next) => {
                    if (event.currentTarget.value)
                      next.set("salaryMax", event.currentTarget.value);
                    else next.delete("salaryMax");
                  })
                }
              />
            </label>
          </div>
          <p className="job-filter-help">{text.salaryHelp}</p>
        </div>
      </details>

      <details open>
        <summary>
          <span>{text.experience}</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="job-filter-group-content">
          <label>
            {text.minimumYears}
            <select
              className="sh-input"
              value={params.get("experienceMinYears") ?? ""}
              onChange={(event) =>
                onUpdate((next) => {
                  if (event.currentTarget.value)
                    next.set("experienceMinYears", event.currentTarget.value);
                  else next.delete("experienceMinYears");
                })
              }
            >
              <option value="">{text.anyExperience}</option>
              <option value="1">{text.years(1)}</option>
              <option value="3">{text.years(3)}</option>
              <option value="5">{text.years(5)}</option>
              <option value="8">{text.years(8)}</option>
            </select>
          </label>
        </div>
      </details>

      <details open>
        <summary>
          <span>{text.jobLevel}</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="job-filter-checks">
          {(
            ["ENTRY", "JUNIOR", "MID", "SENIOR", "LEAD", "MANAGER"] as const
          ).map((value) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={params.getAll("experienceLevel").includes(value)}
                onChange={() =>
                  onUpdate((next) =>
                    toggleQueryValue(next, "experienceLevel", value),
                  )
                }
              />
              <span>{labels[value]}</span>
            </label>
          ))}
        </div>
      </details>

      <details>
        <summary>
          <span>{text.workType}</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="job-filter-checks">
          {(
            [
              "FULL_TIME",
              "PART_TIME",
              "CONTRACT",
              "INTERNSHIP",
              "TEMPORARY",
            ] as const
          ).map((value) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={params.getAll("employmentType").includes(value)}
                onChange={() =>
                  onUpdate((next) =>
                    toggleQueryValue(next, "employmentType", value),
                  )
                }
              />
              <span>{labels[value]}</span>
            </label>
          ))}
          {(["ONSITE", "HYBRID", "REMOTE"] as const).map((value) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={params.getAll("workArrangement").includes(value)}
                onChange={() =>
                  onUpdate((next) =>
                    toggleQueryValue(next, "workArrangement", value),
                  )
                }
              />
              <span>{labels[value]}</span>
            </label>
          ))}
        </div>
      </details>

      <details>
        <summary>
          <span>{text.moreFilters}</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="job-filter-group-content">
          <label>
            {text.city}
            <input
              className="sh-input"
              value={location}
              placeholder={
                locale === "vi" ? "Thành phố Hồ Chí Minh" : "Ho Chi Minh City"
              }
              onChange={(event) =>
                scheduleText(
                  "location",
                  event.currentTarget.value,
                  locationTimer,
                  setLocation,
                )
              }
            />
          </label>
          <label>
            {text.skill}
            <input
              className="sh-input"
              value={skill}
              placeholder={locale === "vi" ? "TypeScript" : "TypeScript"}
              onChange={(event) =>
                scheduleText(
                  "skills",
                  event.currentTarget.value,
                  skillTimer,
                  setSkill,
                )
              }
            />
          </label>
          <label>
            {text.categoryFamily}
            <input
              className="sh-input"
              value={params.get("categoryFamily") ?? ""}
              placeholder={locale === "vi" ? "ví dụ: r1080" : "e.g. r1080"}
              onChange={(event) =>
                onUpdate((next) => {
                  if (event.currentTarget.value)
                    next.set("categoryFamily", event.currentTarget.value);
                  else next.delete("categoryFamily");
                })
              }
            />
          </label>
          <label className="job-filter-check-label">
            <input
              type="checkbox"
              checked={params.get("workOnSaturday") === "true"}
              onChange={(event) =>
                onUpdate((next) => {
                  if (event.currentTarget.checked)
                    next.set("workOnSaturday", "true");
                  else next.delete("workOnSaturday");
                })
              }
            />
            <span>{text.worksSaturdays}</span>
          </label>
          <label>
            {text.postedWithin}
            <select
              className="sh-input"
              value={params.get("postedWithinDays") ?? ""}
              onChange={(event) =>
                onUpdate((next) => {
                  if (event.currentTarget.value)
                    next.set("postedWithinDays", event.currentTarget.value);
                  else next.delete("postedWithinDays");
                })
              }
            >
              <option value="">{text.anyTime}</option>
              <option value="1">{text.hours}</option>
              <option value="3">{text.days(3)}</option>
              <option value="7">{text.days(7)}</option>
              <option value="14">{text.days(14)}</option>
              <option value="30">{text.days(30)}</option>
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}

export function ActiveFilterChips({
  onRemove,
}: {
  onRemove: (name: string, value?: string) => void;
}) {
  const params = useSearchParams();
  const locale = useWorkspaceLocale();
  const text = filterText(locale);
  const labels = filterLabelsFor(locale);
  const values = filterValueLabelsFor(locale);
  const chips = useMemo(() => {
    const result: Array<{ name: string; value: string; label: string }> = [];
    for (const [name, value] of params.entries()) {
      if (
        [
          "sort",
          "sortBy",
          "limit",
          "cursor",
          "salaryCurrency",
          "salaryPeriod",
        ].includes(name)
      )
        continue;
      if (name === "searchBy" && value === "BOTH") continue;
      const label = labels[name as keyof typeof labels] ?? name;
      result.push({
        name,
        value,
        label: label + ": " + (values[value] ?? value),
      });
    }
    return result;
  }, [labels, params, values]);

  if (!chips.length) return null;

  return (
    <div className="job-active-filters" aria-label={text.activeFilters}>
      <span className="job-active-filters-label">{text.filteredBy}</span>
      {chips.map((chip) => (
        <button
          className="job-filter-chip"
          key={chip.name + "-" + chip.value}
          type="button"
          onClick={() => onRemove(chip.name, chip.value)}
        >
          {chip.label}
          <span aria-hidden="true">×</span>
        </button>
      ))}
    </div>
  );
}

export function FilterBar({
  result,
  children,
}: {
  result: JobSearchResponse | null;
  children: ReactNode;
}) {
  const { navigate, searchParams, isPending } = useFilterNavigation();
  const shared = useOptionalJobInteraction();
  const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [restoredPreset, setRestoredPreset] =
    useState<SavedFilterPreset | null>(null);
  const keywordTimer = useRef<number | null>(null);
  const locale = useWorkspaceLocale();
  const text = filterText(locale);
  const quickFilters = quickFiltersFor(locale);
  const suggestions = useSearchSuggestions("JOBS", keyword);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setKeyword(searchParams.get("q") ?? ""),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [searchParams]);

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => navigate(mutate),
    [navigate],
  );

  function scheduleKeyword(value: string) {
    setKeyword(value);
    setRestoredPreset(null);
    if (keywordTimer.current) window.clearTimeout(keywordTimer.current);
    keywordTimer.current = window.setTimeout(() => {
      update((params) => {
        if (value.trim()) params.set("q", value.trim());
        else {
          params.delete("q");
          params.delete("searchMode");
        }
      });
    }, 420);
  }

  function commitKeyword(value = keyword) {
    if (keywordTimer.current) window.clearTimeout(keywordTimer.current);
    const trimmed = value.trim();
    setKeyword(value);
    setRestoredPreset(null);
    suggestions.setOpen(false);
    suggestions.setActiveIndex(-1);
    update((params) => {
      if (trimmed) params.set("q", trimmed);
      else {
        params.delete("q");
        params.delete("searchMode");
      }
    });
  }

  function selectKeywordSuggestion(suggestion: SearchSuggestion) {
    commitKeyword(localizedSuggestionLabel(suggestion, locale));
  }

  function handleKeywordSuggestionKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Escape") {
      if (suggestions.open) {
        event.preventDefault();
        suggestions.setOpen(false);
        suggestions.setActiveIndex(-1);
      }
      return;
    }
    if (event.key === "Tab") {
      suggestions.setOpen(false);
      suggestions.setActiveIndex(-1);
      return;
    }
    if (suggestions.open && suggestions.suggestions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        suggestions.setActiveIndex(
          (suggestions.activeIndex + 1) % suggestions.suggestions.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        suggestions.setActiveIndex(
          suggestions.activeIndex <= 0
            ? suggestions.suggestions.length - 1
            : suggestions.activeIndex - 1,
        );
        return;
      }
      if (event.key === "Enter" && suggestions.activeIndex >= 0) {
        event.preventDefault();
        const suggestion = suggestions.suggestions[suggestions.activeIndex];
        if (suggestion) selectKeywordSuggestion(suggestion);
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitKeyword();
    }
  }

  function removeChip(name: string, value?: string) {
    update((params) => {
      if (value === undefined || params.getAll(name).length <= 1) {
        params.delete(name);
        if (name === "q") params.delete("searchMode");
        return;
      }
      const values = params.getAll(name).filter((item) => item !== value);
      params.delete(name);
      for (const item of values) params.append(name, item);
    });
  }

  function clearAll() {
    setRestoredPreset(null);
    update((params) => {
      for (const key of [...params.keys()]) params.delete(key);
    });
  }

  function changeSort(value: JobSortMode) {
    update((params) => {
      params.set("sortBy", value);
      params.set("sort", sortByServerValue[value]);
    });
  }

  const filterSnapshot = useMemo(() => {
    const snapshot: Record<string, unknown> = {};
    for (const key of new Set(searchParams.keys())) {
      const values = searchParams.getAll(key);
      snapshot[key] = values.length > 1 ? values : (values[0] ?? "");
    }
    return snapshot;
  }, [searchParams]);

  return (
    <div className="job-discovery-flow" aria-busy={isPending}>
      {isPending ? (
        <div className="job-progress-line" aria-hidden="true" />
      ) : null}
      <div className="job-filter-topbar">
        <div className="job-search-by">
          <label htmlFor="job-search-by">{text.searchBy}</label>
          <select
            id="job-search-by"
            className="job-search-by-select"
            value={searchParams.get("searchBy") ?? "BOTH"}
            onChange={(event) =>
              update((params) =>
                params.set("searchBy", event.currentTarget.value),
              )
            }
          >
            <option value="TITLE">{text.jobTitle}</option>
            <option value="COMPANY">{text.company}</option>
            <option value="BOTH">{text.titleSkillsCompany}</option>
          </select>
        </div>
        <div className="job-keyword-field">
          <label className="sr-only" htmlFor="job-search-query">
            {text.searchJobs}
          </label>
          <span className="job-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            id="job-search-query"
            type="search"
            value={keyword}
            maxLength={200}
            placeholder={text.searchPlaceholder}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={
              suggestions.open && suggestions.suggestions.length > 0
            }
            aria-controls="job-search-suggestions"
            aria-activedescendant={
              suggestions.activeIndex >= 0
                ? `job-search-suggestions-option-${suggestions.activeIndex}`
                : undefined
            }
            onChange={(event) => scheduleKeyword(event.currentTarget.value)}
            onFocus={() => {
              if (suggestions.suggestions.length) suggestions.setOpen(true);
            }}
            onBlur={() =>
              window.setTimeout(() => {
                suggestions.setOpen(false);
                suggestions.setActiveIndex(-1);
              }, 100)
            }
            onKeyDown={handleKeywordSuggestionKeyDown}
          />
          {suggestions.isLoading ? (
            <span className="search-suggestion-loading" aria-hidden="true" />
          ) : null}
          {suggestions.open ? (
            <SearchSuggestionList
              id="job-search-suggestions"
              scope="JOBS"
              locale={locale}
              suggestions={suggestions.suggestions}
              activeIndex={suggestions.activeIndex}
              onSelect={selectKeywordSuggestion}
              onActiveChange={suggestions.setActiveIndex}
              density="compact"
            />
          ) : null}
        </div>
        <button
          className="sh-button job-keyword-submit"
          type="button"
          onClick={() => commitKeyword()}
        >
          {text.searchButton}
        </button>
        <div className="job-quick-filter-row" aria-label={text.quickFilters}>
          {quickFilters.map((filter) => {
            const active = searchParams
              .getAll(filter.name)
              .includes(filter.value);
            return (
              <button
                className={
                  "job-quick-filter-pill" + (active ? " is-active" : "")
                }
                key={filter.name + filter.value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  update((params) =>
                    toggleQueryValue(params, filter.name, filter.value),
                  )
                }
              >
                {filter.label}
                {active ? <span aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
        <SortDropdown
          value={sortModeFromParams(searchParams)}
          onChange={changeSort}
        />
        <div className="job-filter-mobile-actions">
          <button
            className="job-mobile-filter-button"
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
          >
            <span aria-hidden="true">☷</span>
            {text.filtersAndSort}
          </button>
        </div>
        <p className="job-live-count" aria-live="polite">
          <strong>{result?.total ?? 0}</strong> {text.matchingJobs}
        </p>
      </div>

      <ActiveFilterChips onRemove={removeChip} />
      <div className="job-discovery-grid">
        <aside
          className="job-advanced-sidebar"
          aria-label={text.advancedJobFilters}
        >
          <div className="job-advanced-heading">
            <div>
              <p className="panel-kicker">{text.refineSignal}</p>
              <h2>{text.advancedFilters}</h2>
            </div>
            <button type="button" onClick={clearAll}>
              {text.clear}
            </button>
          </div>
          <AdvancedFilters onUpdate={update} />
          <div className="job-save-filter-card">
            <span className="job-save-filter-icon" aria-hidden="true">
              ◌
            </span>
            <div>
              <strong>{text.keepSearch}</strong>
              <p>{text.saveDescription}</p>
            </div>
            <button type="button" onClick={() => setSaveDialogOpen(true)}>
              {text.saveFilter}
            </button>
            {shared?.savedFilterPresets.length ? (
              <select
                aria-label={text.savedSearches}
                defaultValue=""
                onChange={(event) => {
                  const preset = shared.savedFilterPresets.find(
                    (item) => item.id === event.currentTarget.value,
                  );
                  if (!preset) return;
                  setRestoredPreset(preset);
                  update((params) => {
                    for (const key of [...params.keys()]) params.delete(key);
                    for (const [key, value] of Object.entries(preset.filters)) {
                      if (
                        key === "q" ||
                        key === "searchMode" ||
                        key === "page" ||
                        key === "cursor"
                      )
                        continue;
                      if (Array.isArray(value)) {
                        for (const item of value)
                          if (typeof item === "string")
                            params.append(key, item);
                      } else if (typeof value === "string") {
                        params.set(key, value);
                      }
                    }
                    const legacyQuery =
                      typeof preset.filters.q === "string"
                        ? preset.filters.q.trim()
                        : "";
                    const rawQuery = preset.q.trim() || legacyQuery;
                    if (rawQuery) params.set("q", rawQuery);
                    const legacyMode =
                      preset.filters.searchMode === "LITERAL"
                        ? "LITERAL"
                        : "SMART";
                    if ((preset.searchMode ?? legacyMode) === "LITERAL") {
                      params.set("searchMode", "LITERAL");
                    } else params.delete("searchMode");
                  });
                  event.currentTarget.value = "";
                }}
              >
                <option value="">{text.reuseSaved}</option>
                {shared.savedFilterPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            ) : null}
            <SavedSearchVersionNotice
              preset={restoredPreset}
              interpretation={result?.searchInterpretation}
              metadata={result?.searchMetadata}
              locale={locale}
            />
          </div>
        </aside>
        <section className="job-results-column">{children}</section>
      </div>

      {mobileFiltersOpen ? (
        <div
          className="job-bottom-sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setMobileFiltersOpen(false);
          }}
        >
          <section
            className="job-bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-filters-title"
          >
            <div className="job-bottom-sheet-handle" aria-hidden="true" />
            <header>
              <div>
                <p className="panel-kicker">{text.personalizeList}</p>
                <h2 id="mobile-filters-title">{text.filtersAndSort}</h2>
              </div>
              <button
                className="job-icon-button"
                type="button"
                aria-label={text.closeFiltersSort}
                onClick={() => setMobileFiltersOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="job-bottom-sheet-content">
              <SortDropdown
                value={sortModeFromParams(searchParams)}
                onChange={changeSort}
              />
              <AdvancedFilters onUpdate={update} />
            </div>
            <footer>
              <button
                className="sh-button sh-button--secondary"
                type="button"
                onClick={clearAll}
              >
                {text.clearAll}
              </button>
              <button
                className="sh-button"
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
              >
                {text.showJobs(result?.total ?? 0)}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {saveDialogOpen ? (
        <div className="job-save-filter-dialog-backdrop">
          <section
            className="job-save-filter-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-filter-title"
          >
            <p className="panel-kicker">{text.saveFilter}</p>
            <h2 id="save-filter-title">{text.nameSearch}</h2>
            <p>{text.savedDescription}</p>
            <label>
              {text.searchName}
              <input
                className="sh-input"
                autoFocus
                maxLength={160}
                value={presetName}
                placeholder={text.searchExample}
                onChange={(event) => setPresetName(event.currentTarget.value)}
              />
            </label>
            <div className="job-dialog-actions">
              <button
                className="sh-button sh-button--secondary"
                type="button"
                onClick={() => setSaveDialogOpen(false)}
              >
                {text.cancel}
              </button>
              <button
                className="sh-button"
                type="button"
                disabled={!presetName.trim()}
                onClick={() => {
                  const metadata: FilterPresetMetadata = {
                    q: searchParams.get("q") ?? "",
                    searchMode:
                      searchParams.get("searchMode") === "LITERAL"
                        ? "LITERAL"
                        : "SMART",
                    resolverVersion:
                      result?.searchInterpretation?.resolverVersion ??
                      result?.searchMetadata?.resolverVersion,
                    catalogVersion:
                      result?.searchInterpretation?.catalogVersion ??
                      result?.searchMetadata?.catalogVersion,
                    structuredFilters:
                      result?.searchInterpretation?.structuredFilters,
                    searchIntent: result?.searchInterpretation?.searchIntent,
                  };
                  shared?.saveFilterPreset(
                    presetName,
                    filterSnapshot,
                    metadata,
                  );
                  setPresetName("");
                  setSaveDialogOpen(false);
                }}
              >
                {text.saveFilterAction}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
