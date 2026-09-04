import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterBar } from "@/frontend/features/jobs/components/filter-bar";
import type { SearchSuggestion } from "@/shared/contracts/search/search-suggestions";

const { replaceMock, setOpenMock, setActiveIndexMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  setOpenMock: vi.fn(),
  setActiveIndexMock: vi.fn(),
}));

const suggestion: SearchSuggestion = {
  id: "title-software-engineer",
  type: "TITLE",
  labelVi: "Kỹ sư phần mềm",
  labelEn: "Software Engineer",
  secondaryLabelVi: "Công nghệ thông tin",
  secondaryLabelEn: "Information Technology",
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/jobs",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/frontend/features/dashboard/client/workspace-locale", () => ({
  useWorkspaceLocale: () => "en",
}));

vi.mock("@/frontend/features/search/client/use-search-suggestions", () => ({
  useSearchSuggestions: () => ({
    suggestions: [suggestion],
    isLoading: false,
    open: true,
    setOpen: setOpenMock,
    activeIndex: 0,
    setActiveIndex: setActiveIndexMock,
  }),
}));

describe("FilterBar job search combobox", () => {
  it("selects a keyboard suggestion and commits its localized label to the URL", () => {
    replaceMock.mockReset();
    render(
      <FilterBar result={null}>
        <p>results</p>
      </FilterBar>,
    );

    const input = screen.getByRole("combobox", { name: "Search jobs" });
    expect(input).toHaveAttribute("aria-controls", "job-search-suggestions");
    expect(input).toHaveAttribute("aria-activedescendant");
    expect(
      screen.getByRole("option", { name: /Software Engineer/u }),
    ).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(replaceMock).toHaveBeenCalledWith("/jobs?q=Software+Engineer", {
      scroll: false,
    });
    expect(setOpenMock).toHaveBeenCalledWith(false);
  });

  it("keeps an explicit Search button available as a JavaScript/debounce fallback", () => {
    replaceMock.mockReset();
    render(
      <FilterBar result={null}>
        <p>results</p>
      </FilterBar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(replaceMock).toHaveBeenCalledWith("/jobs", { scroll: false });
  });
});
