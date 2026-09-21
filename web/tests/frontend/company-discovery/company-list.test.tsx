import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  CompanyListScreen,
  CompanyLocationSelect,
} from "@/frontend/features/candidate-company/company-list-screen";
import type { SearchSuggestion } from "@/shared/contracts/search/search-suggestions";

vi.mock("@/frontend/features/dashboard/client/workspace-locale", () => ({
  useWorkspaceLocale: () => "en",
}));

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

const suggestionState = vi.hoisted(() => ({
  suggestions: [] as SearchSuggestion[],
  isLoading: false,
  open: false,
  activeIndex: -1,
  setOpen: vi.fn(),
  setActiveIndex: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/frontend/features/search/client/use-search-suggestions", () => ({
  useSearchSuggestions: () => suggestionState,
}));

const companies = [
  {
    companyId: "company-1",
    slug: "northstar-labs",
    name: "Northstar Labs",
    logoUrl: null,
    description: "A verified product company.",
  },
] as const;

describe("Candidate Company list", () => {
  it("renders a keyboard-focusable card with fallback branding and detail navigation", () => {
    render(<CompanyListScreen companies={companies} total={1} />);

    const link = screen.getByRole("link", { name: /Northstar Labs/u });
    expect(link).toHaveAttribute("href", "/company/company-1");
    expect(link).toHaveTextContent("View company");
    expect(document.querySelector(".company-avatar")).toHaveTextContent("NL");

    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it("renders an explicit empty state without private company fields", () => {
    render(<CompanyListScreen companies={[]} total={0} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "No companies are available yet",
    );
    expect(
      screen.queryByText("owner@northstar.example"),
    ).not.toBeInTheDocument();
  });

  it("keeps company search text and filters pagination links", () => {
    render(
      <CompanyListScreen
        companies={companies}
        total={49}
        page={2}
        totalPages={3}
        initialQuery="Northstar"
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Search companies" }),
    ).toHaveValue("Northstar");
    expect(
      screen.getByRole("navigation", { name: "Companies" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Page 1" })).toHaveAttribute(
      "href",
      "/company?q=Northstar",
    );
    expect(screen.getByText("Northstar Labs")).toBeInTheDocument();
  });

  it("preserves literal search mode when paginating company results", () => {
    render(
      <CompanyListScreen
        companies={companies}
        total={49}
        page={2}
        totalPages={3}
        initialQuery="FPT"
        initialSearchMode="LITERAL"
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Search companies" }),
    ).toHaveValue("FPT");
    expect(screen.getByRole("link", { name: "Page 1" })).toHaveAttribute(
      "href",
      "/company?q=FPT&searchMode=LITERAL",
    );
    expect(screen.getByDisplayValue("LITERAL")).toBeInTheDocument();
  });

  it("renders the directory metadata and complete numbered page map", () => {
    render(
      <CompanyListScreen
        companies={[
          {
            ...companies[0],
            industry: "Information Technology",
            location: "Can Tho",
            openPositionCount: 14,
          },
        ]}
        total={180}
        page={1}
        totalPages={30}
        initialLocation="Can Tho"
        locations={["Can Tho", "Da Nang"]}
      />,
    );

    expect(screen.getByText("14 open roles")).toBeInTheDocument();
    expect(screen.getAllByText("Can Tho").length).toBeGreaterThan(0);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Page 30" })).toHaveAttribute(
      "href",
      "/company?location=Can+Tho&page=30",
    );
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("keeps the location filter at province/city level", () => {
    render(
      <CompanyListScreen
        companies={companies}
        total={2}
        locations={[
          "Thanh Khe District, Da Nang",
          "District 3, Ho Chi Minh City",
        ]}
      />,
    );

    const locationSelect = screen.getByRole("combobox", {
      name: "Location",
    });
    fireEvent.click(locationSelect);

    const locationOptions = within(
      screen.getByRole("listbox", { name: "Location" }),
    ).getAllByRole("option");
    expect(locationOptions.map((option) => option.textContent)).toEqual([
      "All locations",
      "Da Nang",
      "Ho Chi Minh City",
    ]);
  });

  it("highlights the popular filter that matches the current query", () => {
    render(
      <CompanyListScreen
        companies={companies}
        total={1}
        initialQuery="Manufacturing"
        initialLocation="Da Nang"
      />,
    );

    expect(screen.getByRole("link", { name: "Manufacturing" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Manufacturing" })).toHaveAttribute(
      "href",
      "/company?location=Da+Nang",
    );
    expect(screen.getByRole("link", { name: "Education" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Education" })).toHaveAttribute(
      "href",
      "/company?q=Education&location=Da+Nang",
    );
  });

  it("updates results through the route after the user pauses typing", () => {
    replaceMock.mockReset();
    vi.useFakeTimers();

    try {
      render(<CompanyListScreen companies={companies} total={1} />);
      fireEvent.change(
        screen.getByRole("combobox", { name: "Search companies" }),
        { target: { value: "Manufacturing" } },
      );

      expect(replaceMock).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(799));
      expect(replaceMock).not.toHaveBeenCalled();
      act(() => vi.runOnlyPendingTimers());

      expect(replaceMock).toHaveBeenCalledWith("/company?q=Manufacturing", {
        scroll: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports keyboard selection in the company search combobox", () => {
    suggestionState.suggestions = [
      {
        id: "company:company-1",
        type: "COMPANY",
        labelVi: "Northstar Labs",
        labelEn: "Northstar Labs",
      },
    ];
    suggestionState.open = true;
    suggestionState.activeIndex = -1;
    suggestionState.setOpen.mockClear();
    suggestionState.setActiveIndex.mockClear();

    try {
      render(<CompanyListScreen companies={companies} total={1} />);
      const input = screen.getByRole("combobox", { name: "Search companies" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(suggestionState.setActiveIndex).toHaveBeenCalledWith(0);

      suggestionState.activeIndex = 0;
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input).toHaveValue("Northstar Labs");
      expect(suggestionState.setOpen).toHaveBeenCalledWith(false);
    } finally {
      suggestionState.suggestions = [];
      suggestionState.open = false;
      suggestionState.activeIndex = -1;
    }
  });

  it("moves location focus into the options and returns it after selection or Escape", () => {
    const onChange = vi.fn();
    render(
      <CompanyLocationSelect
        value=""
        options={["Hanoi", "Da Nang"]}
        label="Location"
        allLocationsLabel="All locations"
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Location" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(document.activeElement).toBe(options[0]);

    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1], { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Hanoi");
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getAllByRole("option")[0]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps literal mode while the debounced company query changes", () => {
    replaceMock.mockReset();
    vi.useFakeTimers();

    try {
      render(
        <CompanyListScreen
          companies={companies}
          total={1}
          initialQuery="FPT"
          initialSearchMode="LITERAL"
        />,
      );
      fireEvent.change(
        screen.getByRole("combobox", { name: "Search companies" }),
        { target: { value: "FPT Holdings" } },
      );
      act(() => vi.runOnlyPendingTimers());

      expect(replaceMock).toHaveBeenCalledWith(
        "/company?q=FPT+Holdings&searchMode=LITERAL",
        { scroll: false },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
