"use client";

import Link from "next/link";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { getCompanyCopy } from "./i18n/company-copy";

type CompanyPaginationProps = Readonly<{
  page: number;
  total: number;
  totalPages: number;
  pageSize: number;
  itemLabel: string;
  ariaLabel: string;
  hrefForPage?: (page: number) => string;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  disabled?: boolean;
}>;

type PageToken = number | "ellipsis-start" | "ellipsis-end";

function pageNumbers(currentPage: number, totalPages: number): PageToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const visiblePages = new Set([
    1,
    totalPages,
    Math.max(1, currentPage - 1),
    currentPage,
    Math.min(totalPages, currentPage + 1),
  ]);
  const sortedPages = [...visiblePages].sort((left, right) => left - right);
  const tokens: PageToken[] = [];

  sortedPages.forEach((number, index) => {
    const previous = sortedPages[index - 1];
    if (previous !== undefined && number - previous > 1) {
      tokens.push(previous === 1 ? "ellipsis-start" : "ellipsis-end");
    }
    tokens.push(number);
  });

  return tokens;
}

function controlContent(icon: string, label: string) {
  return (
    <>
      <span aria-hidden="true">{icon}</span>
      <span className="job-pagination-control-label">{label}</span>
    </>
  );
}

const JOB_PAGE_SIZES = [10, 20, 50] as const;

export function CompanyPagination({
  page,
  total,
  totalPages,
  pageSize,
  itemLabel,
  ariaLabel,
  hrefForPage,
  onPageChange,
  onPageSizeChange,
  disabled = false,
}: CompanyPaginationProps) {
  const copy = getCompanyCopy(useWorkspaceLocale());
  if (totalPages <= 1) return null;

  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = total ? Math.min(page * pageSize, total) : 0;
  const goToPage = (nextPage: number) => {
    if (!disabled && nextPage !== page) onPageChange?.(nextPage);
  };
  const pageSizes = [...new Set([...JOB_PAGE_SIZES, pageSize])].sort(
    (left, right) => left - right,
  );
  const changePageSize = (nextPageSize: number) => {
    if (!disabled && nextPageSize !== pageSize) {
      onPageSizeChange?.(nextPageSize);
    }
  };

  function renderControl(
    targetPage: number,
    label: string,
    icon: string,
    position: "first" | "previous" | "next" | "last",
    isDisabled: boolean,
  ) {
    const unavailable = disabled || isDisabled;
    const className = `job-pagination-control job-pagination-control--${position}`;
    if (hrefForPage) {
      if (unavailable) {
        return (
          <span
            className={`${className} is-disabled`}
            aria-disabled="true"
            aria-label={label}
          >
            {controlContent(icon, label)}
          </span>
        );
      }
      return (
        <Link
          className={className}
          href={hrefForPage(targetPage)}
          aria-label={label}
          title={label}
        >
          {controlContent(icon, label)}
        </Link>
      );
    }

    return (
      <button
        className={className}
        type="button"
        disabled={unavailable}
        aria-label={label}
        title={label}
        onClick={() => goToPage(targetPage)}
      >
        {controlContent(icon, label)}
      </button>
    );
  }

  return (
    <nav
      className="job-pagination job-pagination--compact"
      aria-label={ariaLabel}
    >
      <div className="job-pagination-summary">
        <span>
          {copy.paginationShowing}{" "}
          <strong>
            {start}–{end}
          </strong>{" "}
          {copy.paginationOf} <strong>{total}</strong> {itemLabel}
        </span>
        <span className="job-pagination-divider" aria-hidden="true" />
        <label>
          {copy.perPage}
          <select
            value={String(pageSize)}
            disabled={disabled || !onPageSizeChange}
            onChange={(event) => changePageSize(Number(event.target.value))}
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      {renderControl(1, copy.firstPage, "«", "first", page === 1)}
      {renderControl(
        page === 1 ? 1 : page - 1,
        copy.previousPage,
        "‹",
        "previous",
        page === 1,
      )}
      <div className="job-pagination-pages">
        <ol>
          {pageNumbers(page, totalPages).map((token) => {
            if (typeof token !== "number") {
              return (
                <li key={token}>
                  <span className="job-pagination-ellipsis" aria-hidden="true">
                    …
                  </span>
                </li>
              );
            }
            const number = token;
            const current = number === page;
            if (hrefForPage) {
              return (
                <li key={number}>
                  {current ? (
                    <span
                      className="job-pagination-page is-current"
                      aria-current="page"
                    >
                      {number}
                    </span>
                  ) : (
                    <Link
                      className="job-pagination-page"
                      href={hrefForPage(number)}
                      aria-label={`${copy.paginationPage} ${number}`}
                    >
                      {number}
                    </Link>
                  )}
                </li>
              );
            }
            return (
              <li key={number}>
                <button
                  className={`job-pagination-page${current ? "is-current" : ""}`}
                  type="button"
                  aria-current={current ? "page" : undefined}
                  aria-label={`${copy.paginationPage} ${number}`}
                  disabled={disabled}
                  onClick={() => goToPage(number)}
                >
                  {number}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {renderControl(
        page === totalPages ? totalPages : page + 1,
        copy.nextPage,
        "›",
        "next",
        page === totalPages,
      )}
      {renderControl(
        totalPages,
        copy.lastPage,
        "»",
        "last",
        page === totalPages,
      )}
      <p className="job-pagination-progress" aria-live="polite">
        {copy.paginationPage} {page} / {totalPages}
      </p>
    </nav>
  );
}
