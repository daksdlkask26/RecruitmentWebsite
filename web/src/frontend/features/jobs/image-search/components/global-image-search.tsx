"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Briefcase,
  Building2,
  Calculator,
  CarFront,
  Check,
  CircleDot,
  Code2,
  Cross,
  Factory,
  GraduationCap,
  Headphones,
  House,
  Landmark,
  Languages,
  Layers,
  Megaphone,
  Newspaper,
  Palette,
  Settings,
  ShieldCheck,
  Shapes,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Search as SearchIcon,
  Sparkles,
  Sprout,
  TrendingUp,
  Truck,
  Umbrella,
  UsersRound,
  UtensilsCrossed,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import type { JobSearchTaxonomy } from "@/shared/contracts/jobs/taxonomy";
import type { ManualSearchContext } from "@/shared/contracts/jobs/image-search";
import { applyImageSearchIntent } from "../client/apply-image-search-intent";
import { useImageSearch } from "../client/use-image-search";
import { ImageSearchInput } from "./image-search-input";
import { ImageSearchPrivacyNotice } from "./image-search-privacy-notice";
import { ImageSearchProgress } from "./image-search-progress";
import { ImageSearchProposals } from "./image-search-proposals";
import { ImageSearchRecovery } from "./image-search-recovery";
import { ImageSearchConsent } from "./image-search-consent";
import { ImageSearchFeedback } from "./image-search-feedback";
import { JOB_SEARCH_CRITERIA_CHANGED_EVENT } from "../../components/job-search-events";
import { useSearchSuggestions } from "@/frontend/features/search/client/use-search-suggestions";
import {
  SearchSuggestionList,
  localizedSuggestionLabel,
} from "@/frontend/features/search/components/search-suggestion-list";

const defaults: ManualSearchContext = {
  q: "",
  location: "",
  employmentType: [],
  experienceLevel: [],
  workArrangement: [],
  skills: [],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: "VND",
  salaryPeriod: "MONTH",
  postedWithinDays: null,
  sort: "RELEVANCE",
};

/** Semantic icons for the 29 first-level groups in the bundled job taxonomy. */
const industryIcons: Readonly<Record<string, LucideIcon>> = {
  r01: TrendingUp,
  r02: Megaphone,
  r03: Code2,
  r04: Calculator,
  r05: Briefcase,
  r06: UsersRound,
  r07: Zap,
  r08: Settings,
  r09: Building2,
  r10: Truck,
  r11: Factory,
  r12: Headphones,
  r13: Palette,
  r14: ShieldCheck,
  r15: Landmark,
  r16: Umbrella,
  r17: House,
  r18: Cross,
  r19: ShoppingBag,
  r20: UtensilsCrossed,
  r21: GraduationCap,
  r22: ShoppingCart,
  r23: Sparkles,
  r24: Languages,
  r25: Newspaper,
  r26: Shirt,
  r27: Sprout,
  r28: CarFront,
  r29: Shapes,
};

function IndustryIcon({ code }: Readonly<{ code: string }>) {
  const Icon = industryIcons[canonicalIndustryCode(code)] ?? Briefcase;
  return <Icon aria-hidden="true" />;
}

function criteriaFromLocation(): ManualSearchContext {
  if (typeof window === "undefined") return defaults;
  const value = new URL(window.location.href).searchParams;
  const enumValues = <T extends string>(name: string, allowed: readonly T[]) =>
    value.getAll(name).filter((item): item is T => allowed.includes(item as T));
  const number = (name: string) => {
    const raw = value.get(name);
    return raw !== null && /^\d+(?:\.\d+)?$/u.test(raw) ? Number(raw) : null;
  };
  const posted = number("postedWithinDays");
  return {
    q: value.get("q")?.slice(0, 200) ?? "",
    location: value.get("location")?.slice(0, 160) ?? "",
    employmentType: enumValues("employmentType", [
      "FULL_TIME",
      "PART_TIME",
      "CONTRACT",
      "INTERNSHIP",
      "TEMPORARY",
    ]),
    experienceLevel: enumValues("experienceLevel", [
      "ENTRY",
      "JUNIOR",
      "MID",
      "SENIOR",
      "LEAD",
      "MANAGER",
    ]),
    workArrangement: enumValues("workArrangement", [
      "ONSITE",
      "HYBRID",
      "REMOTE",
    ]),
    skills: [
      ...new Set(
        value
          .getAll("skills")
          .filter(Boolean)
          .map((item) => item.slice(0, 80)),
      ),
    ].slice(0, 20),
    salaryMin: number("salaryMin"),
    salaryMax: number("salaryMax"),
    salaryCurrency: /^[A-Z]{3}$/u.test(value.get("salaryCurrency") ?? "")
      ? value.get("salaryCurrency")!
      : "VND",
    salaryPeriod:
      enumValues("salaryPeriod", ["HOUR", "MONTH", "YEAR"])[0] ?? "MONTH",
    postedWithinDays: [1, 3, 7, 14, 30].includes(posted ?? -1)
      ? (posted as 1 | 3 | 7 | 14 | 30)
      : null,
    sort:
      enumValues("sort", ["RELEVANCE", "NEWEST", "SALARY_DESC"])[0] ??
      "RELEVANCE",
  };
}

export function jobTextSearchHref(
  href: string,
  query: string,
  location?: string,
  districts?: readonly string[],
) {
  const currentUrl = new URL(href, "http://localhost");
  const parameters = currentUrl.searchParams;
  parameters.delete("cursor");
  const value = query.trim();
  if (value) parameters.set("q", value.slice(0, 200));
  else parameters.delete("q");
  if (location !== undefined) {
    const locationValue = location.trim();
    if (locationValue) parameters.set("location", locationValue.slice(0, 160));
    else parameters.delete("location");
  }
  if (districts !== undefined) {
    parameters.delete("district");
    for (const district of [...new Set(districts.map((item) => item.trim()))]) {
      if (district) parameters.append("district", district.slice(0, 160));
    }
  }
  return parameters.size ? `/jobs?${parameters.toString()}` : "/jobs";
}

/** Build a broad search URL for the selected industry, while preserving the
 * other search-bar filters (location, districts, and non-text criteria). */
export function jobIndustrySearchHref(
  href: string,
  industryCode: string,
  location?: string,
  districts?: readonly string[],
) {
  const next = jobTextSearchHref(href, "", location, districts);
  const parameters = new URL(next, "http://localhost").searchParams;
  parameters.delete("categoryFamily");
  parameters.delete("categoryId");
  parameters.delete("categoryTitle");
  const normalizedIndustryCode = canonicalIndustryCode(industryCode);
  parameters.set("categoryFamily", normalizedIndustryCode.slice(0, 80));
  return `/jobs?${parameters.toString()}`;
}

type JobCategorySelection = Readonly<{
  industryCode?: string;
  categoryIds?: readonly string[];
  roleTitles?: readonly string[];
}>;

/** Retain normal criteria while applying either an industry or exact roles. */
export function jobCategoryFilterHref(
  href: string,
  selection: JobCategorySelection,
) {
  const currentUrl = new URL(href, "http://localhost");
  const parameters = currentUrl.searchParams;
  parameters.delete("cursor");
  parameters.delete("categoryFamily");
  parameters.delete("categoryId");
  parameters.delete("categoryTitle");

  const industryCode = canonicalIndustryCode(selection.industryCode);
  if (industryCode) {
    parameters.set("categoryFamily", industryCode.slice(0, 80));
  } else {
    for (const categoryId of [
      ...new Set(
        (selection.categoryIds ?? [])
          .map((categoryId) => categoryId.trim())
          .filter(Boolean),
      ),
    ].slice(0, 20)) {
      parameters.append("categoryId", categoryId.slice(0, 128));
    }
    for (const title of [
      ...new Set(
        (selection.roleTitles ?? [])
          .map((roleTitle) => roleTitle.trim())
          .filter(Boolean),
      ),
    ].slice(0, 20)) {
      parameters.append("categoryTitle", title.slice(0, 160));
    }
  }
  return parameters.size ? `/jobs?${parameters.toString()}` : "/jobs";
}

export function jobIndustryClearHref(href: string) {
  const currentUrl = new URL(href, "http://localhost");
  const parameters = currentUrl.searchParams;
  parameters.delete("categoryFamily");
  parameters.delete("categoryId");
  parameters.delete("categoryTitle");
  parameters.delete("cursor");
  return parameters.size ? `/jobs?${parameters.toString()}` : "/jobs";
}

type TaxonomyRole =
  JobSearchTaxonomy["industries"][number]["subIndustries"][number]["titles"][number];

/** A role is a title in an industry/sub-industry context, not its shared
 * categoryId. Multiple roles may intentionally belong to one category. */
function roleSelectionKey(
  industryCode: string,
  subIndustryName: string,
  role: Pick<TaxonomyRole, "name">,
) {
  return [industryCode, subIndustryName, role.name].join("\u0001");
}

function roleSelectionsFromTitles(
  taxonomy: JobSearchTaxonomy,
  roleTitles: readonly string[],
  categoryIds: readonly string[] = [],
) {
  const selectedTitles = new Set(roleTitles);
  const selectedCategoryIds = new Set(categoryIds);
  const selections: Record<
    string,
    { name: string; categoryIds: readonly string[] }
  > = {};
  for (const industry of taxonomy.industries) {
    for (const subIndustry of industry.subIndustries) {
      for (const title of subIndustry.titles) {
        if (!selectedTitles.has(title.name)) continue;
        if (
          selectedCategoryIds.size &&
          !title.categoryIds.some((id) => selectedCategoryIds.has(id))
        )
          continue;
        selections[roleSelectionKey(industry.code, subIndustry.name, title)] = {
          name: title.name,
          categoryIds: title.categoryIds,
        };
      }
    }
  }
  return selections;
}

function canonicalIndustryCode(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "other" ? "r29" : normalized;
}

function JobCategoryMenu({
  taxonomy,
  onApply,
  onClear,
  selectedCode,
  selectedCategoryIds,
  selectedRoleTitles,
  vi,
}: Readonly<{
  taxonomy: JobSearchTaxonomy;
  onApply(selection: JobCategorySelection): void;
  onClear(): void;
  selectedCode?: string;
  selectedCategoryIds: readonly string[];
  selectedRoleTitles: readonly string[];
  vi: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [activeCode, setActiveCode] = useState(
    canonicalIndustryCode(selectedCode) || taxonomy.industries[0]?.code || "",
  );
  const [filterQuery, setFilterQuery] = useState("");
  const [draftIndustryCode, setDraftIndustryCode] = useState<string>();
  const [draftCategoryIds, setDraftCategoryIds] = useState<string[]>([]);
  const [draftRoles, setDraftRoles] = useState<
    Record<string, { name: string; categoryIds: readonly string[] }>
  >({});
  const menu = useRef<HTMLDivElement>(null);
  const explorer = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const categoryButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const active =
    taxonomy.industries.find((industry) => industry.code === activeCode) ??
    taxonomy.industries[0];
  const resetDraft = useCallback(() => {
    setDraftIndustryCode(canonicalIndustryCode(selectedCode) || undefined);
    setDraftCategoryIds([...new Set(selectedCategoryIds)]);
    setDraftRoles(
      roleSelectionsFromTitles(
        taxonomy,
        selectedRoleTitles,
        selectedCategoryIds,
      ),
    );
    setFilterQuery("");
  }, [selectedCategoryIds, selectedCode, selectedRoleTitles, taxonomy]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setActiveCode(
        canonicalIndustryCode(selectedCode) ||
          taxonomy.industries[0]?.code ||
          "",
      ),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [selectedCode, taxonomy]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(resetDraft);
    return () => window.cancelAnimationFrame(frame);
  }, [resetDraft]);

  const close = useCallback(() => {
    resetDraft();
    setOpen(false);
    trigger.current?.focus();
  }, [resetDraft]);

  const openMenu = () => {
    if (open) {
      close();
      return;
    }
    resetDraft();
    setOpen(true);
  };

  const selectIndustry = (code: string) => {
    setActiveCode(code);
    setOpen(true);
  };

  const moveIndustryFocus = (code: string, direction: -1 | 1) => {
    const current = taxonomy.industries.findIndex(
      (industry) => industry.code === code,
    );
    const next =
      taxonomy.industries[
        (current + direction + taxonomy.industries.length) %
          taxonomy.industries.length
      ];
    if (!next) return;
    selectIndustry(next.code);
    categoryButtons.current[next.code]?.focus();
  };

  const roleCount = Object.keys(draftRoles).length;
  const categoryCount = draftCategoryIds.length;
  const selectionCount = draftIndustryCode ? 1 : categoryCount || roleCount;
  const hasSelection = selectionCount > 0;
  const hasAppliedSelection =
    Boolean(selectedCode) ||
    selectedCategoryIds.length > 0 ||
    selectedRoleTitles.length > 0;
  const canApply = hasSelection || hasAppliedSelection;
  const appliedRoleCount = Object.keys(
    roleSelectionsFromTitles(taxonomy, selectedRoleTitles, selectedCategoryIds),
  ).length;
  const appliedSelectionLabel = selectedCode
    ? active?.name
    : selectedCategoryIds.length
      ? `${selectedCategoryIds.length} sub-industries selected`
      : appliedRoleCount
        ? vi
          ? `${appliedRoleCount} vị trí đã chọn`
          : `${appliedRoleCount} roles selected`
        : undefined;
  const normalizedFilter = filterQuery.trim().toLocaleLowerCase();
  const visibleSubIndustries = active?.subIndustries
    .map((subIndustry) => ({
      ...subIndustry,
      titles: subIndustry.titles.filter((title) =>
        `${subIndustry.name} ${title.name}`
          .toLocaleLowerCase()
          .includes(normalizedFilter),
      ),
    }))
    .filter((subIndustry) => subIndustry.titles.length > 0);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) {
        resetDraft();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [close, open, resetDraft]);

  useEffect(() => {
    if (!open) return;
    const preventBackgroundScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && explorer.current?.contains(target)) return;
      event.preventDefault();
    };

    // Do not lock html/body: that can also make a fixed explorer unscrollable
    // inside the workspace shell. Instead, preserve wheel/touch input for the
    // dialog and reject it only when it originates behind the dialog.
    document.addEventListener("wheel", preventBackgroundScroll, {
      capture: true,
      passive: false,
    });
    document.addEventListener("touchmove", preventBackgroundScroll, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("wheel", preventBackgroundScroll, true);
      document.removeEventListener("touchmove", preventBackgroundScroll, true);
    };
  }, [open]);

  if (!taxonomy.industries.length) return null;

  return (
    <div className="job-category-menu" ref={menu}>
      <button
        ref={trigger}
        className="job-category-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="job-category-flyout"
        data-selected={Boolean(appliedSelectionLabel)}
        aria-label={
          appliedSelectionLabel || (vi ? "Nhóm ngành" : "Job Category")
        }
        title={
          appliedSelectionLabel ||
          (vi ? "Chọn nhóm ngành việc làm" : "Select job category")
        }
        onClick={openMenu}
      >
        <span className="job-category-trigger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 7h14M5 12h14M5 17h14" />
          </svg>
        </span>
        <span className="job-category-trigger-label">
          {appliedSelectionLabel
            ? appliedSelectionLabel
            : vi
              ? "Nhóm ngành"
              : "Job Category"}
        </span>
        <svg
          className="job-category-trigger-chevron"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>
      {appliedSelectionLabel ? (
        <button
          className="job-category-selection-clear"
          type="button"
          aria-label={
            vi
              ? `Bỏ chọn nhóm ngành ${active?.name ?? ""}`
              : `Clear job category ${active?.name ?? ""}`
          }
          title={vi ? "Bỏ chọn nhóm ngành" : "Clear job category"}
          onClick={() => {
            setOpen(false);
            onClear();
            trigger.current?.focus();
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m6 6 8 8M14 6l-8 8" />
          </svg>
        </button>
      ) : null}

      {open && active ? (
        <div
          ref={explorer}
          id="job-category-flyout"
          className="job-category-flyout"
          role="dialog"
          aria-modal="true"
          aria-label={vi ? "Nhóm ngành việc làm" : "Job categories"}
        >
          <header className="job-category-explorer-header">
            <div className="job-category-explorer-intro">
              <span className="job-category-explorer-logo" aria-hidden="true">
                <Layers />
              </span>
              <div>
                <p>
                  {vi
                    ? "Khám phá cơ hội theo ngành"
                    : "Browse opportunities by industry"}
                </p>
                <small>
                  {vi
                    ? "Chọn vị trí cụ thể hoặc toàn bộ ngành để lọc việc làm"
                    : "Select roles or an entire field to refine your job search"}
                </small>
              </div>
            </div>
            <label className="job-category-explorer-search">
              <SearchIcon aria-hidden="true" />
              <span className="sr-only">
                {vi ? "Lọc vị trí" : "Filter roles"}
              </span>
              <input
                type="search"
                value={filterQuery}
                placeholder={
                  vi
                    ? "Lọc kỹ năng hoặc vị trí..."
                    : "Filter skills or titles..."
                }
                onChange={(event) => setFilterQuery(event.currentTarget.value)}
              />
            </label>
            <button
              className="job-category-close"
              type="button"
              aria-label={vi ? "Đóng" : "Close job categories"}
              onClick={close}
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="job-category-explorer-body">
            <aside className="job-category-explorer-sidebar">
              <p className="job-category-industry-count">
                {vi
                  ? `Ngành nghề (${taxonomy.industries.length})`
                  : `Industries (${taxonomy.industries.length})`}
              </p>
              <ul
                className="job-category-industries"
                aria-label={vi ? "Nhóm ngành" : "Job categories"}
              >
                {taxonomy.industries.map((industry) => {
                  const selected = industry.code === active.code;
                  return (
                    <li
                      className="job-category-industry-item"
                      key={industry.code}
                    >
                      <button
                        ref={(element) => {
                          categoryButtons.current[industry.code] = element;
                        }}
                        className="job-category-industry"
                        data-active={selected}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectIndustry(industry.code)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            moveIndustryFocus(industry.code, 1);
                          } else if (event.key === "ArrowUp") {
                            event.preventDefault();
                            moveIndustryFocus(industry.code, -1);
                          } else if (event.key === "Home") {
                            event.preventDefault();
                            const first = taxonomy.industries[0];
                            if (!first) return;
                            selectIndustry(first.code);
                            categoryButtons.current[first.code]?.focus();
                          } else if (event.key === "End") {
                            event.preventDefault();
                            const last = taxonomy.industries.at(-1);
                            if (!last) return;
                            selectIndustry(last.code);
                            categoryButtons.current[last.code]?.focus();
                          }
                        }}
                      >
                        <span
                          className="job-category-industry-icon"
                          data-industry-code={industry.code}
                          aria-hidden="true"
                        >
                          <IndustryIcon code={industry.code} />
                        </span>
                        <span className="job-category-industry-copy">
                          <strong>{industry.name}</strong>
                          <small>
                            {industry.count}{" "}
                            {vi ? "vị trí đang tuyển" : "open roles"}
                          </small>
                        </span>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m9 6 6 6-6 6" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
            <div className="job-category-detail">
              <header className="job-category-detail-heading">
                <div>
                  <div className="job-category-detail-title-row">
                    <p className="job-category-detail-title">{active.name}</p>
                    <span className="job-category-total-count">
                      {active.count}
                    </span>
                  </div>
                  <p className="job-category-open-roles">
                    {vi
                      ? "Chọn vị trí cụ thể để thêm vào bộ lọc"
                      : "Select specific roles to add them to your filter"}
                  </p>
                </div>
                <button
                  className="job-category-industry-pill"
                  type="button"
                  data-selected={draftIndustryCode === active.code}
                  aria-pressed={draftIndustryCode === active.code}
                  aria-label={
                    draftIndustryCode === active.code
                      ? `${vi ? "Bỏ chọn toàn ngành" : "Clear entire industry"}: ${active.name}`
                      : `${vi ? "Chọn toàn ngành" : "Select entire industry"}: ${active.name}`
                  }
                  onClick={() => {
                    setDraftIndustryCode((current) =>
                      current === active.code ? undefined : active.code,
                    );
                    setDraftCategoryIds([]);
                    setDraftRoles({});
                  }}
                >
                  <CircleDot aria-hidden="true" />
                  <strong>
                    {draftIndustryCode === active.code
                      ? vi
                        ? "Đã chọn toàn ngành"
                        : "Entire industry selected"
                      : vi
                        ? "Chọn toàn ngành"
                        : "Select entire industry"}
                  </strong>
                  <small>
                    {draftIndustryCode === active.code
                      ? vi
                        ? "Đang chọn · nhấn để bỏ"
                        : "Selected · click to clear"
                      : vi
                        ? "Toàn ngành"
                        : "Entire industry"}
                  </small>
                </button>
              </header>
              {visibleSubIndustries?.map((subIndustry) => (
                <section
                  className="job-category-subindustry"
                  key={subIndustry.name}
                >
                  {(() => {
                    const categoryId =
                      subIndustry.code ??
                      subIndustry.titles[0]?.categoryIds[0] ??
                      undefined;
                    const selectedCategory = categoryId
                      ? draftCategoryIds.includes(categoryId)
                      : false;
                    return (
                      <div className="job-category-subindustry-heading">
                        <h2>
                          {subIndustry.name} <span>({subIndustry.count})</span>
                        </h2>
                        {categoryId ? (
                          <button
                            className="job-category-subindustry-select"
                            type="button"
                            data-selected={selectedCategory}
                            aria-pressed={selectedCategory}
                            aria-label={
                              vi
                                ? `${selectedCategory ? "Bỏ chọn" : "Chọn"} nhóm ngành: ${subIndustry.name}`
                                : `${selectedCategory ? "Clear" : "Select"} sub-industry: ${subIndustry.name}`
                            }
                            onClick={() => {
                              setDraftIndustryCode(undefined);
                              setDraftRoles({});
                              setDraftCategoryIds((current) =>
                                selectedCategory
                                  ? current.filter((id) => id !== categoryId)
                                  : [...current, categoryId],
                              );
                            }}
                          >
                            {selectedCategory
                              ? vi
                                ? "Đã chọn"
                                : "Selected"
                              : vi
                                ? "Chọn"
                                : "Select"}
                          </button>
                        ) : null}
                      </div>
                    );
                  })()}
                  <div>
                    {subIndustry.titles.map((title) => {
                      const key = roleSelectionKey(
                        active.code,
                        subIndustry.name,
                        title,
                      );
                      const selected = Boolean(draftRoles[key]);
                      return (
                        <button
                          className="job-category-title-pill"
                          key={title.name}
                          type="button"
                          data-selected={selected}
                          aria-pressed={selected}
                          title={title.name}
                          onClick={() => {
                            setDraftIndustryCode(undefined);
                            setDraftCategoryIds([]);
                            setDraftRoles((current) => {
                              if (current[key]) {
                                const next = { ...current };
                                delete next[key];
                                return next;
                              }
                              return {
                                ...current,
                                [key]: {
                                  name: title.name,
                                  categoryIds: title.categoryIds,
                                },
                              };
                            });
                          }}
                        >
                          {selected ? <Check aria-hidden="true" /> : null}
                          {title.name}
                          {title.count > 1 ? (
                            <small className="job-category-title-count">
                              {title.count}
                            </small>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!visibleSubIndustries?.length ? (
                <p className="job-category-empty-roles">
                  {vi
                    ? "Không tìm thấy vị trí phù hợp."
                    : "No matching roles found."}
                </p>
              ) : null}
            </div>
          </div>
          <footer className="job-category-explorer-footer">
            <div className="job-category-selection-summary" aria-live="polite">
              <strong>{selectionCount}</strong>
              <span>
                {draftIndustryCode
                  ? vi
                    ? "ngành đã chọn"
                    : "industry selected"
                  : draftCategoryIds.length
                    ? vi
                      ? "nhóm ngành đã chọn"
                      : "sub-industries selected"
                    : vi
                      ? "vị trí đã chọn"
                      : "roles selected"}
              </span>
              {hasSelection ? (
                <button
                  className="job-category-selection-clear-all"
                  type="button"
                  onClick={() => {
                    setDraftIndustryCode(undefined);
                    setDraftCategoryIds([]);
                    setDraftRoles({});
                  }}
                >
                  {vi ? "Xóa tất cả" : "Clear all"}
                </button>
              ) : null}
            </div>
            <div className="job-category-explorer-actions">
              <button
                className="job-category-cancel"
                type="button"
                onClick={close}
              >
                {vi ? "Hủy" : "Cancel"}
              </button>
              <button
                className="job-category-apply"
                type="button"
                disabled={!canApply}
                onClick={() => {
                  onApply({
                    industryCode: draftIndustryCode,
                    categoryIds: draftIndustryCode
                      ? []
                      : draftCategoryIds.length
                        ? draftCategoryIds
                        : Object.values(draftRoles).flatMap(
                            (role) => role.categoryIds,
                          ),
                    roleTitles: draftIndustryCode
                      ? []
                      : draftCategoryIds.length
                        ? []
                        : Object.values(draftRoles).map((role) => role.name),
                  });
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <Check aria-hidden="true" />
                {vi
                  ? `Áp dụng bộ lọc (${selectionCount})`
                  : `Apply filters (${selectionCount})`}
              </button>
            </div>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

function ClearFieldButton({
  label,
  onClear,
  className,
}: Readonly<{
  label: string;
  onClear(): void;
  className?: string;
}>) {
  return (
    <button
      className={["global-image-search-clear", className]
        .filter(Boolean)
        .join(" ")}
      type="button"
      aria-label={label}
      onClick={onClear}
    >
      <X aria-hidden="true" />
    </button>
  );
}

export function LocationPicker({
  taxonomy,
  location,
  districts,
  onApply,
  onClear,
  vi,
}: Readonly<{
  taxonomy: JobSearchTaxonomy;
  location: string;
  districts: readonly string[];
  onApply(city: string, districts: string[]): void;
  onClear(): void;
  vi: boolean;
}>) {
  const groups = taxonomy.locationGroups ?? [];
  const [open, setOpen] = useState(false);
  const [draftCity, setDraftCity] = useState("");
  const [draftDistricts, setDraftDistricts] = useState<string[]>([]);
  const picker = useRef<HTMLDivElement>(null);

  const selectedGroup =
    groups.find((group) => group.city === draftCity) ?? groups[0];
  const displayValue = location ? [location, ...districts].join(", ") : "";
  const countFormatter = useMemo(
    () => new Intl.NumberFormat(vi ? "vi-VN" : "en-US"),
    [vi],
  );
  const placeholder = vi ? "Tỉnh/thành, quận..." : "Province/city, district...";

  const openPicker = () => {
    setDraftCity(location || groups[0]?.city || "");
    setDraftDistricts([...districts]);
    setOpen(true);
  };

  const togglePicker = () => {
    if (open) {
      setOpen(false);
      return;
    }
    openPicker();
  };

  const beginEditing = () => {
    if (open) return;
    openPicker();
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  if (!groups.length) return null;

  return (
    <div className="job-location-picker" ref={picker}>
      <div className="global-image-search-location">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" />
          <circle cx="12" cy="10" r="2" />
        </svg>
        <div className="job-location-picker-value">
          <input
            className="job-location-picker-input"
            type="text"
            value={displayValue}
            placeholder={placeholder}
            readOnly
            data-selected={Boolean(location) && !open}
            aria-label={vi ? "Địa điểm" : "Location"}
            role="combobox"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="job-location-picker-dialog"
            onFocus={beginEditing}
            onClick={beginEditing}
          />
          {!open && location ? (
            <span className="job-location-picker-display" aria-hidden="true">
              <span className="job-location-picker-selection">
                {displayValue}
              </span>
            </span>
          ) : null}
        </div>
        <div className="job-location-picker-actions">
          {location ? (
            <ClearFieldButton
              className="job-location-picker-clear"
              label={vi ? "Xóa địa điểm" : "Clear location"}
              onClear={onClear}
            />
          ) : null}
          {location ? (
            <span
              className="job-location-picker-action-divider"
              aria-hidden="true"
            />
          ) : null}
          <button
            className="job-location-picker-chevron"
            type="button"
            aria-label={
              open
                ? vi
                  ? "Đóng chọn địa điểm"
                  : "Close location picker"
                : vi
                  ? "Mở chọn địa điểm"
                  : "Open location picker"
            }
            aria-expanded={open}
            aria-controls="job-location-picker-dialog"
            onClick={togglePicker}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 10 5 5 5-5" />
            </svg>
          </button>
        </div>
      </div>
      {open ? (
        <div
          id="job-location-picker-dialog"
          className="job-location-picker-flyout"
          role="dialog"
          aria-label={vi ? "Chọn địa điểm" : "Choose location"}
        >
          <div className="job-location-picker-panels">
            <section
              className="job-location-provinces"
              aria-label={vi ? "Tỉnh thành" : "Provinces"}
            >
              <div className="job-location-provinces-heading">
                <div>
                  <strong>{vi ? "Tỉnh/Thành" : "Province / city"}</strong>
                  <small>
                    {groups.length} {vi ? "địa điểm" : "locations"}
                  </small>
                </div>
                <button
                  className="job-location-picker-close"
                  type="button"
                  aria-label={vi ? "Đóng" : "Close"}
                  onClick={() => setOpen(false)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m6 6 8 8M14 6l-8 8" />
                  </svg>
                </button>
              </div>
              <div className="job-location-province-select">
                <select
                  id="job-location-province-select"
                  aria-label={vi ? "Tỉnh/Thành khả dụng" : "Available province"}
                  value={selectedGroup?.city ?? ""}
                  onChange={(event) => {
                    setDraftCity(event.currentTarget.value);
                    setDraftDistricts([]);
                  }}
                >
                  {groups.map((group) => (
                    <option value={group.city} key={group.city}>
                      {group.city}
                    </option>
                  ))}
                </select>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
                </svg>
              </div>
              <p className="job-location-province-meta">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 7V5.8A1.8 1.8 0 0 1 9.8 4h4.4A1.8 1.8 0 0 1 16 5.8V7M4 9.5h16v9.25A1.25 1.25 0 0 1 18.75 20H5.25A1.25 1.25 0 0 1 4 18.75V9.5Z" />
                  <path d="M4 13h16M10 13v1.5h4V13" />
                </svg>
                <strong className="job-location-province-count">
                  {countFormatter.format(selectedGroup?.count ?? 0)}
                </strong>
                <span className="job-location-province-label">
                  {vi
                    ? "việc đang tuyển tại tỉnh này"
                    : "open jobs in this province"}
                </span>
              </p>
            </section>
            <section
              className="job-location-districts"
              aria-label={vi ? "Quận huyện" : "Districts"}
            >
              <header>
                <strong>{vi ? "Quận/Huyện" : "Districts"}</strong>
                <button
                  className="job-location-apply"
                  type="button"
                  onClick={() => {
                    onApply(selectedGroup?.city ?? "", draftDistricts);
                    setOpen(false);
                  }}
                >
                  {vi ? "Áp dụng" : "Apply"}
                </button>
              </header>
              <label className="job-location-district-option job-location-district-all">
                <input
                  type="checkbox"
                  checked={draftDistricts.length === 0}
                  onChange={() => setDraftDistricts([])}
                />
                <span>{vi ? "Tất cả" : "All"}</span>
              </label>
              <div className="job-location-district-list">
                {selectedGroup?.districts.map((district) => {
                  const checked = draftDistricts.includes(district.name);
                  return (
                    <label
                      className="job-location-district-option"
                      key={district.name}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setDraftDistricts((current) =>
                            checked
                              ? current.filter((item) => item !== district.name)
                              : [...current, district.name],
                          )
                        }
                      />
                      <span>{district.name}</span>
                      <small aria-hidden="true">{district.count}</small>
                    </label>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BeforeAfterDemo({ vi }: { vi: boolean }) {
  return (
    <div className="image-search-demo" aria-hidden="true">
      <span className="image-search-demo-poster">
        {vi ? "ÁP PHÍCH" : "POSTER"}
      </span>
      <span className="image-search-demo-arrow">→</span>
      <span className="image-search-demo-chips">
        <span>{vi ? "Vai trò" : "Role"}</span>
        <span>{vi ? "Địa điểm" : "Location"}</span>
        <span>{vi ? "Kinh nghiệm" : "Experience"}</span>
      </span>
    </div>
  );
}

export function GlobalImageSearch({
  csrfProof,
  taxonomy,
  onJobSearchNavigate,
  dockToWorkspaceHeader = false,
}: {
  csrfProof?: string;
  taxonomy?: JobSearchTaxonomy;
  onJobSearchNavigate?(href: string): void;
  dockToWorkspaceHeader?: boolean;
} = {}) {
  const locale = useWorkspaceLocale();
  const vi = locale === "vi";
  const contextCsrfProof = useCsrfProof();
  const activeCsrfProof = csrfProof ?? contextCsrfProof;
  // Keep the server render and the first client render byte-for-byte stable.
  // URL-backed values are applied only after hydration; reading window in a
  // state initializer made the clear button appear on the client only.
  const [criteria, setCriteria] = useState<ManualSearchContext>(defaults);
  const [externalConsent, setExternalConsent] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedCategoryCode, setSelectedCategoryCode] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedRoleTitles, setSelectedRoleTitles] = useState<string[]>([]);
  const [clientReady, setClientReady] = useState(false);
  const queryRef = useRef("");
  const locationQueryRef = useRef("");
  const cameraButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useImageSearch({
    currentCriteria: criteria,
    csrfProof: activeCsrfProof,
  });
  const suggestions = useSearchSuggestions("JOBS", query);
  const busy = search.phase === "UPLOADING" || search.phase === "PROCESSING";
  const showPanel = panelOpen || search.phase !== "IDLE";
  const navigateJobSearch =
    onJobSearchNavigate ?? ((href: string) => window.location.assign(href));
  const workspaceHeaderSlot =
    dockToWorkspaceHeader && clientReady && typeof document !== "undefined"
      ? document.getElementById("workspace-job-search-slot")
      : null;

  useEffect(() => {
    const syncFromLocation = (forceQuerySync: boolean) => {
      const nextCriteria = criteriaFromLocation();
      const params = new URL(window.location.href).searchParams;
      setCriteria(nextCriteria);
      if (forceQuerySync || queryRef.current === locationQueryRef.current) {
        queryRef.current = nextCriteria.q;
        setQuery(nextCriteria.q);
      }
      locationQueryRef.current = nextCriteria.q;
      setSelectedCategoryCode(
        canonicalIndustryCode(params.get("categoryFamily") ?? ""),
      );
      setSelectedCategoryIds(
        [...new Set(params.getAll("categoryId").filter(Boolean))].slice(0, 20),
      );
      setSelectedRoleTitles(
        [...new Set(params.getAll("categoryTitle").filter(Boolean))].slice(
          0,
          20,
        ),
      );
    };

    // Defer both URL synchronization and portal attachment until after the
    // hydration commit. This also avoids React trying to reconcile a portal
    // whose target may be replaced by the persistent workspace shell.
    const frame = window.requestAnimationFrame(() => {
      syncFromLocation(true);
      setClientReady(true);
    });
    const handlePopState = () => syncFromLocation(true);
    const handleCriteriaChange = () => syncFromLocation(false);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener(
      JOB_SEARCH_CRITERIA_CHANGED_EVENT,
      handleCriteriaChange,
    );
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener(
        JOB_SEARCH_CRITERIA_CHANGED_EVENT,
        handleCriteriaChange,
      );
    };
  }, []);

  useEffect(() => {
    if (!taxonomy || process.env.NODE_ENV !== "development") return;
    const expectedIndustryCount = 29;
    const message = `[job-taxonomy] client receipt: ${taxonomy.industries.length}/${expectedIndustryCount} industries`;
    if (taxonomy.industries.length === expectedIndustryCount)
      console.info(message);
    else console.warn(message);
  }, [taxonomy]);

  useEffect(() => {
    if (!showPanel) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      setPanelOpen(false);
      setExternalConsent(false);
      search.clear();
      cameraButton.current?.focus();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [busy, search, showPanel]);

  const closePanel = () => {
    setPanelOpen(false);
    setExternalConsent(false);
    search.clear();
    cameraButton.current?.focus();
  };

  const submitJobTextSearch = () => {
    navigateJobSearch(jobTextSearchHref(window.location.href, query));
  };

  const updateQuery = (value: string) => {
    queryRef.current = value;
    setQuery(value);
  };

  const selectJobSuggestion = (
    suggestion: Parameters<typeof localizedSuggestionLabel>[0],
  ) => {
    updateQuery(localizedSuggestionLabel(suggestion, locale));
    suggestions.setOpen(false);
  };

  const handleSuggestionKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
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
    if (!suggestions.open || !suggestions.suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      suggestions.setActiveIndex(
        (suggestions.activeIndex + 1) % suggestions.suggestions.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      suggestions.setActiveIndex(
        suggestions.activeIndex <= 0
          ? suggestions.suggestions.length - 1
          : suggestions.activeIndex - 1,
      );
    } else if (event.key === "Enter" && suggestions.activeIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions.suggestions[suggestions.activeIndex];
      if (suggestion) selectJobSuggestion(suggestion);
    }
  };

  const clearSelectedIndustry = () => {
    setSelectedCategoryCode("");
    setSelectedCategoryIds([]);
    setSelectedRoleTitles([]);
    navigateJobSearch(jobIndustryClearHref(window.location.href));
  };

  const searchControls = (
    <div
      id="global-image-search"
      className="global-image-search"
      data-phase={search.phase.toLowerCase()}
      aria-label={vi ? "Tìm kiếm việc làm toàn cục" : "Global job search"}
    >
      <ImageSearchFeedback
        phase={search.phase}
        error={search.error}
        fallbackReason={search.fallbackReason}
        retryAt={search.retryAt}
        proposalCount={search.intent?.proposals.length ?? 0}
        warningCount={search.intent?.warnings.length ?? 0}
      />
      <div className={taxonomy ? "job-search-row" : undefined}>
        <div className="job-search-discovery">
          {taxonomy ? (
            <JobCategoryMenu
              taxonomy={taxonomy}
              vi={vi}
              selectedCode={selectedCategoryCode || undefined}
              selectedCategoryIds={selectedCategoryIds}
              selectedRoleTitles={selectedRoleTitles}
              onClear={clearSelectedIndustry}
              onApply={(selection) => {
                setSelectedCategoryCode(
                  canonicalIndustryCode(selection.industryCode),
                );
                setSelectedCategoryIds(
                  [...new Set(selection.categoryIds ?? [])].slice(0, 20),
                );
                setSelectedRoleTitles(
                  [...new Set(selection.roleTitles ?? [])].slice(0, 20),
                );
                navigateJobSearch(
                  jobCategoryFilterHref(window.location.href, selection),
                );
              }}
            />
          ) : null}
          <form
            id="global-job-search-bar"
            className="global-image-search-bar"
            role="search"
            aria-label={vi ? "Tìm kiếm việc làm toàn cục" : "Global job search"}
            onSubmit={(event) => {
              event.preventDefault();
              submitJobTextSearch();
            }}
          >
            <button
              ref={cameraButton}
              className="global-image-search-camera-button"
              type="button"
              aria-label={
                vi ? "Tìm việc bằng hình ảnh" : "Search jobs from an image"
              }
              aria-controls="global-image-search-panel"
              aria-expanded={showPanel}
              onClick={() => setPanelOpen((open) => !open)}
            >
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img">
                  <path d="M8.5 7 10 4.8h4L15.5 7H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
                  <circle cx="12" cy="13" r="3.2" />
                </svg>
              </span>
            </button>
            <label className="sr-only" htmlFor="global-job-search-query">
              {vi
                ? "Tìm công việc, kỹ năng hoặc công ty"
                : "Search jobs, skills, or companies"}
            </label>
            <div className="global-image-search-query-field">
              <span
                className="global-image-search-query-icon"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4 4" />
                </svg>
              </span>
              <input
                id="global-job-search-query"
                type="search"
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={
                  suggestions.open && suggestions.suggestions.length > 0
                }
                aria-controls="global-job-search-suggestions"
                aria-activedescendant={
                  suggestions.activeIndex >= 0
                    ? `global-job-search-suggestions-option-${suggestions.activeIndex}`
                    : undefined
                }
                value={query}
                maxLength={200}
                placeholder={
                  vi
                    ? "Tìm công việc, kỹ năng hoặc công ty"
                    : "Search jobs, skills, or companies"
                }
                onChange={(event) => updateQuery(event.currentTarget.value)}
                onFocus={() => {
                  if (suggestions.suggestions.length) suggestions.setOpen(true);
                }}
                onBlur={() =>
                  window.setTimeout(() => {
                    suggestions.setOpen(false);
                    suggestions.setActiveIndex(-1);
                  }, 100)
                }
                onKeyDown={handleSuggestionKeyDown}
              />
              {query.length > 0 || suggestions.isLoading ? (
                <span className="global-image-search-query-actions">
                  {suggestions.isLoading ? (
                    <>
                      <span
                        className="search-suggestion-loading"
                        aria-hidden="true"
                      />
                      <span className="sr-only" role="status">
                        {vi
                          ? "Đang tải gợi ý tìm kiếm"
                          : "Loading search suggestions"}
                      </span>
                    </>
                  ) : null}
                  {query.length > 0 ? (
                    <ClearFieldButton
                      label={vi ? "Xóa tìm kiếm" : "Clear search"}
                      onClear={() => updateQuery("")}
                    />
                  ) : null}
                </span>
              ) : null}
              {suggestions.open ? (
                <SearchSuggestionList
                  id="global-job-search-suggestions"
                  scope="JOBS"
                  locale={locale}
                  suggestions={suggestions.suggestions}
                  activeIndex={suggestions.activeIndex}
                  onSelect={selectJobSuggestion}
                  onActiveChange={suggestions.setActiveIndex}
                />
              ) : null}
            </div>
            {!taxonomy ? (
              <button
                className="global-image-search-submit"
                type="submit"
                aria-label={vi ? "Tìm việc" : "Search jobs"}
              >
                <span aria-hidden="true">
                  <svg viewBox="0 0 20 20" role="img">
                    <circle cx="8.5" cy="8.5" r="5.5" />
                    <path d="m12.5 12.5 4 4" />
                  </svg>
                </span>
                <span className="global-image-search-submit-label">
                  {vi ? "Tìm kiếm" : "Search"}
                </span>
              </button>
            ) : null}
          </form>
        </div>
        {taxonomy ? (
          <button
            className="global-image-search-submit"
            type="submit"
            form="global-job-search-bar"
            aria-label={vi ? "Tìm việc" : "Search jobs"}
          >
            <span aria-hidden="true">
              <svg viewBox="0 0 20 20" role="img">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="m12.5 12.5 4 4" />
              </svg>
            </span>
            <span className="global-image-search-submit-label">
              {vi ? "Tìm kiếm" : "Search"}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {workspaceHeaderSlot
        ? createPortal(searchControls, workspaceHeaderSlot)
        : dockToWorkspaceHeader
          ? null
          : searchControls}
      {showPanel
        ? createPortal(
            <div
              className="global-image-search-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) {
                  closePanel();
                }
              }}
            >
              <div
                ref={panel}
                id="global-image-search-panel"
                className="global-image-search-panel"
                role="dialog"
                aria-modal="true"
                aria-label={
                  vi ? "Tìm việc bằng hình ảnh" : "Search jobs from an image"
                }
              >
                <div className="global-image-search-panel-heading">
                  <div>
                    <strong>
                      {vi
                        ? "Tìm việc bằng hình ảnh"
                        : "Search jobs from an image"}
                    </strong>
                    <p>
                      {vi
                        ? "Chuyển áp phích tuyển dụng thành các bộ lọc có thể chỉnh sửa."
                        : "Turn a job poster into editable search filters."}
                    </p>
                  </div>
                  <button
                    className="global-image-search-close"
                    type="button"
                    aria-label={
                      vi ? "Đóng tìm kiếm hình ảnh" : "Close image search"
                    }
                    disabled={busy}
                    onClick={closePanel}
                  >
                    <span aria-hidden="true">&#215;</span>
                  </button>
                </div>
                <BeforeAfterDemo vi={vi} />
                <ImageSearchPrivacyNotice />
                <ImageSearchConsent
                  selected={externalConsent}
                  onChange={(selected) => {
                    if (!selected && busy) void search.revokeConsent();
                    setExternalConsent(selected);
                  }}
                />
                <ImageSearchInput
                  disabled={!externalConsent || busy}
                  onSelect={(file) => {
                    setPanelOpen(true);
                    void search
                      .start(file)
                      .finally(() => setExternalConsent(false));
                  }}
                />
                {!externalConsent ? (
                  <p className="image-search-consent-required" role="status">
                    {vi
                      ? "Đồng ý với thông báo xử lý văn bản trước khi chọn hình ảnh."
                      : "Agree to the text-processing notice before choosing an image."}
                  </p>
                ) : null}
                {busy ? (
                  <ImageSearchProgress
                    progress={search.progress}
                    onCancel={() => {
                      setExternalConsent(false);
                      void search.cancel();
                    }}
                  />
                ) : null}
                {search.intent ? (
                  <ImageSearchProposals
                    intent={search.intent}
                    onClear={() => {
                      setExternalConsent(false);
                      search.clear();
                    }}
                    onApply={(intent) =>
                      window.location.assign(
                        applyImageSearchIntent(criteria, intent),
                      )
                    }
                  />
                ) : null}
                <ImageSearchRecovery
                  error={search.error}
                  fallbackReason={search.fallbackReason}
                  retryAt={search.retryAt}
                  onRetry={() => {
                    setExternalConsent(false);
                    search.clear();
                  }}
                  onManual={() => window.location.assign("/jobs")}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
