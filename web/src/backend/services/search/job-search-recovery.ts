import "server-only";

import type { NormalizedJobSearch } from "@/backend/services/jobs/job-types";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import {
  jobSearchCatalogIndex,
  type SearchCatalogIndex,
} from "./catalogs/job-search-catalog-index";
import {
  searchRecoverySchema,
  type SearchRecoveryAction,
} from "@/shared/contracts/search/search-recovery";

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}

function removePhrase(query: string, phrase: string) {
  const queryTokens = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
  const phraseTokens = normalizeSearchText(phrase)
    .split(/\s+/u)
    .filter(Boolean);
  if (!queryTokens.length || !phraseTokens.length) return query;
  for (
    let start = 0;
    start <= queryTokens.length - phraseTokens.length;
    start += 1
  ) {
    const candidate = queryTokens.slice(start, start + phraseTokens.length);
    if (
      candidate.join(" ") === phraseTokens.join(" ") ||
      compact(candidate.join("")) === compact(phraseTokens.join(""))
    ) {
      return [
        ...queryTokens.slice(0, start),
        ...queryTokens.slice(start + phraseTokens.length),
      ].join(" ");
    }
  }
  return query;
}

function addAction(
  actions: SearchRecoveryAction[],
  action: SearchRecoveryAction,
  currentQuery: string,
) {
  if (actions.length >= 5) return;
  if (
    action.query &&
    normalizeSearchText(action.query) === normalizeSearchText(currentQuery)
  )
    return;
  if (actions.some((candidate) => candidate.id === action.id)) return;
  actions.push(action);
}

function hasFilter(
  criteria: NormalizedJobSearch,
  filter: SearchRecoveryAction["removeFilter"],
) {
  switch (filter) {
    case "LOCATION":
      return Boolean(criteria.normalizedLocation);
    case "DISTRICT":
      return Boolean(criteria.normalizedDistricts?.length);
    case "SALARY":
      return (
        criteria.salaryMin !== undefined || criteria.salaryMax !== undefined
      );
    case "SENIORITY":
      return Boolean(criteria.experienceLevel.length);
    case "EMPLOYMENT_TYPE":
      return Boolean(criteria.employmentType.length);
    case "WORK_ARRANGEMENT":
      return Boolean(criteria.workArrangement.length);
    case "SKILL":
      return Boolean(criteria.normalizedSkills.length);
    case "CATEGORY":
      return Boolean(
        criteria.categoryFamily?.length ||
        criteria.categoryIds?.length ||
        criteria.normalizedRoleTitles?.length,
      );
    default:
      return false;
  }
}

function structuredFilterQuery(
  criteria: NormalizedJobSearch,
  removeFilter: SearchRecoveryAction["removeFilter"],
) {
  const kindByFilter: Record<
    NonNullable<SearchRecoveryAction["removeFilter"]>,
    string
  > = {
    LOCATION: "LOCATION",
    DISTRICT: "DISTRICT",
    SALARY: "SALARY",
    SENIORITY: "SENIORITY",
    EMPLOYMENT_TYPE: "EMPLOYMENT_TYPE",
    WORK_ARRANGEMENT: "WORK_ARRANGEMENT",
    SKILL: "SKILL",
    CATEGORY: "TITLE",
  };
  return criteria.searchInterpretation?.structuredFilters?.find(
    (filter) => filter.kind === kindByFilter[removeFilter!],
  );
}

/**
 * Builds only actions that can be represented by the public URL/search
 * contract. It never suggests an action without a concrete query or filter
 * mutation, which keeps empty states actionable rather than decorative.
 */
export function buildJobSearchRecovery(
  criteria: NormalizedJobSearch,
  catalogIndex: SearchCatalogIndex = criteria.catalogIndex ??
    jobSearchCatalogIndex,
) {
  const currentQuery = criteria.rawQuery?.trim() ?? criteria.normalizedQuery;
  const actions: SearchRecoveryAction[] = [];
  const interpretation = criteria.searchInterpretation;

  if (criteria.searchMode !== "LITERAL" && interpretation) {
    const correctedQuery = interpretation.effectiveQuery.trim();
    if (
      correctedQuery &&
      normalizeSearchText(correctedQuery) !== normalizeSearchText(currentQuery)
    ) {
      addAction(
        actions,
        {
          id: "recovery:corrected-query",
          kind: "CORRECTED_QUERY",
          labelVi: "Thử truy vấn đã sửa",
          labelEn: "Try the corrected search",
          query: correctedQuery,
        },
        currentQuery,
      );
    }

    const relatedTitles = (criteria.searchVariants ?? [])
      .filter(
        (variant) => variant.source === "RELATED_TITLE" && variant.titleId,
      )
      .map((variant) => ({
        variant,
        title: catalogIndex.titleById(variant.titleId!),
      }))
      .filter(
        (
          candidate,
        ): candidate is typeof candidate & {
          title: NonNullable<typeof candidate.title>;
        } => Boolean(candidate.title),
      );
    for (const { variant, title } of relatedTitles) {
      addAction(
        actions,
        {
          id: `recovery:title:${title.titleId}`,
          kind: "RELATED_TITLE",
          labelVi: `Tìm ${title.canonical.vi}`,
          labelEn: `Search ${title.canonical.en}`,
          query: variant.value,
        },
        currentQuery,
      );
    }

    if (interpretation.matchedOccupation) {
      const occupation = catalogIndex.occupationById(
        interpretation.matchedOccupation.occupationId,
      );
      addAction(
        actions,
        {
          id: `recovery:occupation:${interpretation.matchedOccupation.occupationId}`,
          kind: "RELATED_OCCUPATION",
          labelVi: `Tìm nhóm ${interpretation.matchedOccupation.labelVi}`,
          labelEn: `Search ${interpretation.matchedOccupation.labelEn} roles`,
          query:
            occupation?.labels.en ?? interpretation.matchedOccupation.labelEn,
        },
        currentQuery,
      );
    }
  }

  const filters: Array<{
    removeFilter: NonNullable<SearchRecoveryAction["removeFilter"]>;
    labelVi: string;
    labelEn: string;
  }> = [
    {
      removeFilter: "LOCATION",
      labelVi: "Bỏ lọc địa điểm",
      labelEn: "Remove location filter",
    },
    {
      removeFilter: "SALARY",
      labelVi: "Bỏ lọc lương",
      labelEn: "Remove salary filter",
    },
    {
      removeFilter: "SENIORITY",
      labelVi: "Bỏ lọc kinh nghiệm",
      labelEn: "Remove experience filter",
    },
    {
      removeFilter: "WORK_ARRANGEMENT",
      labelVi: "Bỏ lọc hình thức làm việc",
      labelEn: "Remove work arrangement filter",
    },
    {
      removeFilter: "SKILL",
      labelVi: "Bỏ lọc kỹ năng",
      labelEn: "Remove skill filter",
    },
  ];
  for (const filter of filters) {
    if (!hasFilter(criteria, filter.removeFilter)) continue;
    const structured = structuredFilterQuery(criteria, filter.removeFilter);
    const relaxedQuery = structured
      ? removePhrase(currentQuery, structured.query)
      : undefined;
    addAction(
      actions,
      {
        id: `recovery:relax:${filter.removeFilter.toLowerCase()}`,
        kind: "RELAX_FILTER",
        labelVi: filter.labelVi,
        labelEn: filter.labelEn,
        ...(relaxedQuery &&
        normalizeSearchText(relaxedQuery) !== normalizeSearchText(currentQuery)
          ? { query: relaxedQuery }
          : {}),
        removeFilter: filter.removeFilter,
      },
      currentQuery,
    );
  }

  if (
    criteria.searchMode !== "LITERAL" &&
    interpretation?.canSearchLiteral &&
    currentQuery
  ) {
    addAction(
      actions,
      {
        id: "recovery:literal",
        kind: "LITERAL",
        labelVi: "Tìm nguyên văn",
        labelEn: "Search literally",
        query: currentQuery,
      },
      "__literal-action__",
    );
  }

  return searchRecoverySchema.parse({ actions });
}
