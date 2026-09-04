import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchInterpretationNotice } from "@/frontend/features/search/components/search-interpretation-notice";

const copy = {
  searchResultsFor: "Showing results for “{query}”.",
  includingRelatedTerm: "Also including “{term}”.",
  searchLiteral: "Search instead for “{query}”",
  didYouMean: "Did you mean “{query}”?",
  searchSuggested: "Search for “{query}”",
  literalMode: "Searching literally for “{query}”.",
  enableSmartSearch: "Enable smart search",
  interpretedAsOccupation: "Interpreted “{original}” as “{occupation}”.",
  correctionHint: "Corrected from “{query}”.",
  matchedFacets: "Matched signals",
} as const;

describe("SearchInterpretationNotice", () => {
  it("explains a high-confidence occupation interpretation and exposes literal search", () => {
    const onSearchLiteral = vi.fn();
    render(
      <SearchInterpretationNotice
        locale="en"
        copy={copy}
        onSearchLiteral={onSearchLiteral}
        interpretation={{
          mode: "SMART",
          originalQuery: "ke tona",
          normalizedQuery: "ke tona",
          effectiveQuery: "ke toan",
          reason: "TYPO_AND_ALIAS",
          confidence: "HIGH",
          correction: { from: "ke tona", to: "ke toan" },
          matchedOccupation: {
            occupationId: "occ-r04-accountant",
            labelVi: "Kế toán",
            labelEn: "Accountant",
          },
          appliedTerms: ["accountant"],
          canSearchLiteral: true,
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing results for “Accountant”.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Search instead for “ke tona”" }),
    );
    expect(onSearchLiteral).toHaveBeenCalledOnce();
  });

  it("renders a Vietnamese medium-confidence suggestion without auto-searching it", () => {
    const onAcceptSuggestion = vi.fn();
    render(
      <SearchInterpretationNotice
        locale="vi"
        copy={{
          ...copy,
          didYouMean: "Có phải bạn muốn tìm “{query}”?",
          searchSuggested: "Tìm “{query}”",
        }}
        onAcceptSuggestion={onAcceptSuggestion}
        interpretation={{
          mode: "SMART",
          originalQuery: "alph",
          normalizedQuery: "alph",
          effectiveQuery: "alpha",
          reason: "TYPO_CORRECTED",
          confidence: "MEDIUM",
          correction: { from: "alph", to: "alpha" },
          appliedTerms: [],
          canSearchLiteral: true,
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Có phải bạn muốn tìm “alpha”?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Tìm “alpha”" }));
    expect(onAcceptSuggestion).toHaveBeenCalledOnce();
  });

  it("offers smart search again after switching to literal mode", () => {
    const onEnableSmartSearch = vi.fn();
    render(
      <SearchInterpretationNotice
        locale="en"
        copy={copy}
        onEnableSmartSearch={onEnableSmartSearch}
        interpretation={{
          mode: "LITERAL",
          originalQuery: "ke tona",
          normalizedQuery: "ke tona",
          effectiveQuery: "ke tona",
          reason: "NONE",
          appliedTerms: [],
          canSearchLiteral: false,
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Searching literally for “ke tona”.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Enable smart search" }),
    );
    expect(onEnableSmartSearch).toHaveBeenCalledOnce();
  });

  it("exposes undo only when the caller has a reversible interpreted search", () => {
    const onUndo = vi.fn();
    render(
      <SearchInterpretationNotice
        locale="en"
        copy={{ ...copy, undo: "Undo" }}
        onUndo={onUndo}
        interpretation={{
          mode: "SMART",
          originalQuery: "accountant",
          normalizedQuery: "accountant",
          effectiveQuery: "accountant",
          reason: "ALIAS_EXPANDED",
          matchedOccupation: {
            occupationId: "occ-r04-accountant",
            labelVi: "Kế toán",
            labelEn: "Accountant",
          },
          appliedTerms: ["accountant"],
          canSearchLiteral: true,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("keeps the explanation compact instead of listing expanded query terms", () => {
    render(
      <SearchInterpretationNotice
        locale="en"
        copy={copy}
        interpretation={{
          mode: "SMART",
          originalQuery: "frontend senior",
          normalizedQuery: "frontend senior",
          effectiveQuery: "frontend senior",
          reason: "ALIAS_EXPANDED",
          matchedFacets: [
            {
              facetId: "specialization.frontend",
              kind: "SPECIALIZATION",
              labelVi: "Frontend",
              labelEn: "Frontend",
            },
          ],
          appliedTerms: [
            "frontend developer and frontend engineer and web developer",
          ],
          canSearchLiteral: true,
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing results for “frontend senior”.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Matched signalsFrontend",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "frontend developer and frontend engineer",
    );
  });

  it("does not render a notice for normalization without a useful explanation", () => {
    const { container } = render(
      <SearchInterpretationNotice
        locale="en"
        copy={copy}
        interpretation={{
          mode: "SMART",
          originalQuery: "KẾ TOÁN",
          normalizedQuery: "ke toan",
          effectiveQuery: "ke toan",
          reason: "NORMALIZED",
          appliedTerms: [],
          canSearchLiteral: true,
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
