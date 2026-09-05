import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ImageSearchConsent } from "@/frontend/features/jobs/image-search/components/image-search-consent";
import { ImageSearchInput } from "@/frontend/features/jobs/image-search/components/image-search-input";
import { ImageSearchProgress } from "@/frontend/features/jobs/image-search/components/image-search-progress";
import { ImageSearchProposals } from "@/frontend/features/jobs/image-search/components/image-search-proposals";
import { ImageSearchRecovery } from "@/frontend/features/jobs/image-search/components/image-search-recovery";
import { ImageSearchFeedback } from "@/frontend/features/jobs/image-search/components/image-search-feedback";
import {
  GlobalImageSearch,
  jobCategoryFilterHref,
  jobIndustryClearHref,
  jobIndustrySearchHref,
  jobTextSearchHref,
} from "@/frontend/features/jobs/image-search/components/global-image-search";
import type { SearchIntent } from "@/shared/contracts/jobs/search-intent";
import { WorkspaceLocaleProvider } from "@/frontend/features/dashboard/client/workspace-locale";
import type { JobSearchTaxonomy } from "@/shared/contracts/jobs/taxonomy";
import {
  JobSearchForm,
  type JobSearchCriteria,
} from "@/frontend/features/jobs/components/job-search-form";
import { JOB_SEARCH_CRITERIA_CHANGED_EVENT } from "@/frontend/features/jobs/components/job-search-events";

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

const intent: SearchIntent = {
  schemaVersion: "job-search-intent-v1",
  language: "EN",
  warnings: [],
  proposals: [
    {
      id: "occupation-1",
      field: "q",
      stringValue: "Digital Marketing Specialist",
      numberValue: null,
      stringValues: [],
      confidence: 0.82,
      basis: "INFERRED",
      evidence: [
        {
          startCodePoint: 15,
          endCodePoint: 34,
          text: "optimize paid media",
        },
      ],
      selected: false,
      selectionReason: "USER_SELECTION_REQUIRED",
    },
    {
      id: "remote-1",
      field: "workArrangement",
      stringValue: null,
      numberValue: null,
      stringValues: ["REMOTE"],
      confidence: 0.98,
      basis: "NORMALIZED",
      evidence: [{ startCodePoint: 0, endCodePoint: 6, text: "Remote" }],
      selected: true,
      selectionReason: "AUTO_NORMALIZED",
    },
    {
      id: "location-1",
      field: "location",
      stringValue: "Da Nang",
      numberValue: null,
      stringValues: [],
      confidence: 0.72,
      basis: "INFERRED",
      evidence: [{ startCodePoint: 7, endCodePoint: 14, text: "Da Nang" }],
      selected: false,
      selectionReason: "USER_SELECTION_REQUIRED",
    },
  ],
};

const taxonomy: JobSearchTaxonomy = {
  industries: [
    {
      code: "r01",
      name: "Sales & Business Development",
      count: 4,
      subIndustries: [
        {
          name: "B2B Sales",
          count: 4,
          titles: [
            {
              name: "Key Account Manager",
              categoryIds: ["r01-b2b-sales"],
              count: 2,
            },
            {
              name: "Account Executive",
              categoryIds: ["r01-b2b-sales"],
              count: 1,
            },
          ],
        },
      ],
    },
  ],
  locations: [
    { label: "Ho Chi Minh City", value: "Ho Chi Minh City", count: 4 },
    {
      label: "Ho Chi Minh City · District 1",
      value: "District 1, Ho Chi Minh City",
      count: 2,
    },
  ],
  locationGroups: [
    {
      city: "Ho Chi Minh City",
      count: 4,
      districts: [{ name: "District 1", count: 2 }],
    },
  ],
};

function LocationFilterHarness({
  taxonomy: filterTaxonomy,
  initialCriteria = {},
  onChange,
}: {
  taxonomy: JobSearchTaxonomy;
  initialCriteria?: JobSearchCriteria;
  onChange?: (criteria: JobSearchCriteria) => void;
}) {
  const [criteria, setCriteria] = useState(initialCriteria);
  return (
    <JobSearchForm
      criteria={criteria}
      taxonomy={filterTaxonomy}
      onCriteriaChange={(next) => {
        setCriteria(next);
        onChange?.(next);
      }}
    />
  );
}

describe("image-assisted job-search controls", () => {
  it("keeps an English text-and-camera search bar available in the global header", async () => {
    window.history.replaceState(null, "", "/jobs?q=Sidebar%20keyword");
    render(<GlobalImageSearch />);

    expect(
      screen.getByRole("search", { name: "Global job search" }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Search jobs, skills, or companies"),
      ).toHaveValue("Sidebar keyword");
    });
    expect(
      screen.getByPlaceholderText("Search jobs, skills, or companies"),
    ).toHaveAttribute("autocomplete", "off");
    expect(
      screen.getByRole("button", { name: "Search jobs from an image" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Search jobs" })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Search jobs from an image" }),
    );
    const file = screen.getByLabelText("Job poster image");
    expect(file).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(file).toBeEnabled();
    window.history.replaceState(null, "", "/");
  });

  it("shows the search clear control solely while the query has a value", () => {
    render(<GlobalImageSearch taxonomy={taxonomy} />);

    const searchField = screen.getByRole("combobox", {
      name: "Search jobs, skills, or companies",
    });
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();

    fireEvent.focus(searchField);
    fireEvent.change(searchField, { target: { value: "com" } });
    const clearButton = screen.getByRole("button", { name: "Clear search" });
    expect(clearButton).toBeVisible();
    expect(clearButton.querySelector("svg")).toBeInTheDocument();
    expect(
      clearButton.closest(".global-image-search-query-actions"),
    ).not.toBeNull();

    fireEvent.blur(searchField);
    expect(screen.getByRole("button", { name: "Clear search" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(searchField).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();

    fireEvent.change(searchField, { target: { value: "c" } });
    fireEvent.change(searchField, { target: { value: "" } });
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();
  });

  it("preserves an unsent keyword when live filters update the URL", async () => {
    window.history.replaceState(null, "", "/jobs");
    render(<GlobalImageSearch taxonomy={taxonomy} />);

    const searchField = screen.getByRole("combobox", {
      name: "Search jobs, skills, or companies",
    });
    await waitFor(() => expect(searchField).toHaveValue(""));
    fireEvent.change(searchField, { target: { value: "Platform Engineer" } });
    window.history.replaceState(null, "", "/jobs?workArrangement=HYBRID");
    window.dispatchEvent(new Event(JOB_SEARCH_CRITERIA_CHANGED_EVENT));

    await waitFor(() => expect(searchField).toHaveValue("Platform Engineer"));
    window.history.replaceState(null, "", "/jobs");
  });

  it("keeps the complete image-search panel in Vietnamese when selected", () => {
    window.history.replaceState(null, "", "/jobs");
    render(
      <WorkspaceLocaleProvider initialLocale="vi">
        <GlobalImageSearch />
      </WorkspaceLocaleProvider>,
    );

    expect(
      screen.getByPlaceholderText("Tìm công việc, kỹ năng hoặc công ty"),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Tìm việc bằng hình ảnh" }),
    );
    expect(screen.getByText("Đồng ý xử lý hình ảnh (bắt buộc)")).toBeVisible();
    expect(
      screen.getByText("Hình ảnh được xử lý riêng tư và tạm thời"),
    ).toBeVisible();
  });

  it("keeps one search instance in the persistent workspace header slot", async () => {
    const headerSlot = document.createElement("div");
    headerSlot.id = "workspace-job-search-slot";
    document.body.append(headerSlot);
    let unmount: (() => void) | undefined;

    try {
      ({ unmount } = render(
        <GlobalImageSearch taxonomy={taxonomy} dockToWorkspaceHeader />,
      ));

      await waitFor(() => {
        expect(headerSlot.querySelector("#global-image-search")).not.toBeNull();
      });
      expect(document.querySelectorAll("#global-image-search")).toHaveLength(1);
    } finally {
      unmount?.();
      headerSlot.remove();
    }
  });

  it("replaces only the keyword and keeps active filters from the header", () => {
    expect(
      jobTextSearchHref(
        "https://smarthire.test/jobs?q=old&location=Da%20Nang&workArrangement=REMOTE&cursor=next",
        "product designer",
      ),
    ).toBe("/jobs?q=product+designer&location=Da+Nang&workArrangement=REMOTE");
    expect(
      jobTextSearchHref(
        "https://smarthire.test/jobs?q=old&location=Da%20Nang&workArrangement=REMOTE",
        "product designer",
        "Ha Noi",
      ),
    ).toBe("/jobs?q=product+designer&location=Ha+Noi&workArrangement=REMOTE");
    expect(
      jobTextSearchHref(
        "https://smarthire.test/jobs?location=Da%20Nang",
        "",
        "Da Nang",
        ["Hai Chau", "Son Tra"],
      ),
    ).toBe("/jobs?location=Da+Nang&district=Hai+Chau&district=Son+Tra");
    expect(
      jobTextSearchHref(
        "https://smarthire.test/jobs/saved?q=old",
        "product designer",
      ),
    ).toBe("/jobs?q=product+designer");
  });

  it("clears only the selected industry while preserving the other filters", () => {
    expect(
      jobIndustryClearHref(
        "https://smarthire.test/jobs?q=engineer&categoryFamily=r03&workArrangement=REMOTE&cursor=next",
      ),
    ).toBe("/jobs?q=engineer&workArrangement=REMOTE");
  });

  it("builds an exact-role URL without retaining a broad industry filter", () => {
    expect(
      jobCategoryFilterHref(
        "https://smarthire.test/jobs?q=engineer&categoryFamily=r03&cursor=next",
        { roleTitles: ["Key Account Manager", "Key Account Manager"] },
      ),
    ).toBe("/jobs?q=engineer&categoryTitle=Key+Account+Manager");
  });

  it("keeps category filters visible and clears the category group together", () => {
    const onChange = vi.fn();
    render(
      <LocationFilterHarness
        taxonomy={taxonomy}
        initialCriteria={{
          categoryFamily: "r01",
          categoryId: ["r01-b2b-sales"],
          categoryTitle: ["Key Account Manager"],
        }}
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Industry: Sales & Business Development/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Sub-industry: B2B Sales/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Role: Key Account Manager/i }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Industry: Sales & Business Development/i,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("clears a selected industry from the compact clear control", async () => {
    const navigate = vi.fn();
    window.history.replaceState(
      null,
      "",
      "/jobs?categoryFamily=r01&workArrangement=REMOTE",
    );
    render(
      <GlobalImageSearch taxonomy={taxonomy} onJobSearchNavigate={navigate} />,
    );

    const clear = await screen.findByRole("button", {
      name: /clear job category sales & business development/i,
    });
    fireEvent.click(clear);

    expect(navigate).toHaveBeenCalledWith("/jobs?workArrangement=REMOTE");
    expect(
      screen.queryByRole("button", { name: /clear job category/i }),
    ).not.toBeInTheDocument();
  });

  it("clears an applied industry only after the user confirms the draft", async () => {
    const navigate = vi.fn();
    window.history.replaceState(null, "", "/jobs?categoryFamily=r01");
    render(
      <GlobalImageSearch taxonomy={taxonomy} onJobSearchNavigate={navigate} />,
    );

    await screen.findByRole("button", {
      name: /clear job category sales & business development/i,
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^sales & business development$/i }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /clear entire industry: sales & business development/i,
      }),
    );
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /apply filters \(0\)/i }),
    );

    expect(navigate).toHaveBeenCalledWith("/jobs");
  });

  it("shows a server-derived category flyout without crowding the header with location", () => {
    render(<GlobalImageSearch taxonomy={taxonomy} />);

    fireEvent.click(screen.getByRole("button", { name: "Job Category" }));
    expect(
      screen.getAllByText("Sales & Business Development").at(0),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: /b2b sales/i })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /key account manager/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole("searchbox", { name: "Location" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Job categories" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Job Category" })).toHaveFocus();
  });

  it("keeps wheel and touch input inside the role explorer", () => {
    render(<GlobalImageSearch taxonomy={taxonomy} />);

    fireEvent.click(screen.getByRole("button", { name: "Job Category" }));
    const explorer = screen.getByRole("dialog", { name: "Job categories" });
    const dialogWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
    });
    explorer.dispatchEvent(dialogWheel);
    expect(dialogWheel.defaultPrevented).toBe(false);

    const backgroundWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(backgroundWheel);
    expect(backgroundWheel.defaultPrevented).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Close job categories" }),
    );

    const wheelAfterClose = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(wheelAfterClose);
    expect(wheelAfterClose.defaultPrevented).toBe(false);
  });

  it("applies an industry filter only after confirmation", () => {
    const navigate = vi.fn();
    render(
      <GlobalImageSearch taxonomy={taxonomy} onJobSearchNavigate={navigate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Job Category" }));
    const industryPill = screen.getByRole("button", {
      name: /select entire industry: sales & business development/i,
    });
    expect(industryPill).toBeVisible();
    fireEvent.click(industryPill);
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /apply filters \(1\)/i }),
    );
    expect(navigate).toHaveBeenCalledWith("/jobs?categoryFamily=r01");
    expect(
      screen.queryByRole("dialog", { name: "Job categories" }),
    ).not.toBeInTheDocument();
  });

  it("adds exact role categories to the URL through the explorer footer", () => {
    const navigate = vi.fn();
    render(
      <GlobalImageSearch taxonomy={taxonomy} onJobSearchNavigate={navigate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Job Category" }));
    fireEvent.click(
      screen.getByRole("button", { name: /key account manager/i }),
    );
    expect(
      screen.getByRole("button", { name: /account executive/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /apply filters \(1\)/i }),
    );

    expect(navigate).toHaveBeenCalledWith(
      "/jobs?categoryId=r01-b2b-sales&categoryTitle=Key+Account+Manager",
    );
  });

  it("adds the selected shared sub-industry id to the URL", () => {
    const navigate = vi.fn();
    render(
      <GlobalImageSearch taxonomy={taxonomy} onJobSearchNavigate={navigate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Job Category" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /select sub-industry: b2b sales/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /apply filters \(1\)/i }),
    );

    expect(navigate).toHaveBeenCalledWith("/jobs?categoryId=r01-b2b-sales");
  });

  it("builds an industry URL without retaining a title query", () => {
    expect(
      jobIndustrySearchHref(
        "https://smarthire.test/jobs?q=old&location=Da%20Nang&cursor=next",
        "r03",
      ),
    ).toBe("/jobs?location=Da+Nang&categoryFamily=r03");
    expect(jobIndustrySearchHref("https://smarthire.test/jobs", "other")).toBe(
      "/jobs?categoryFamily=r29",
    );
  });

  it("picks a province from the dropdown and one or more districts", () => {
    const onChange = vi.fn();
    render(
      <LocationFilterHarness
        taxonomy={taxonomy}
        initialCriteria={{ q: "project manager" }}
        onChange={onChange}
      />,
    );

    const locationField = screen.getByRole("combobox", { name: "Location" });
    expect(locationField).toHaveAttribute(
      "placeholder",
      "Province/city, district...",
    );
    fireEvent.focus(locationField);
    expect(
      screen.getByRole("dialog", { name: "Choose location" }),
    ).toBeVisible();
    expect(screen.getByText("Province / city")).toBeVisible();
    expect(screen.getByText(/locations$/i)).toBeVisible();
    const provinceSelect = screen.getByRole("combobox", {
      name: "Available province",
    });
    fireEvent.change(provinceSelect, { target: { value: "Ho Chi Minh City" } });
    expect(provinceSelect).toHaveValue("Ho Chi Minh City");
    expect(screen.getByText(/open jobs in this province/i)).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: /district 1/iu }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Choose location" })).getByRole(
        "button",
        { name: "Apply" },
      ),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: "project manager",
        location: "Ho Chi Minh City",
        district: ["District 1"],
      }),
    );
    expect(locationField).toHaveValue("Ho Chi Minh City, District 1");
    expect(
      locationField.parentElement?.querySelector(
        ".job-location-picker-selection",
      ),
    ).toHaveTextContent("Ho Chi Minh City, District 1");
    expect(locationField).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear location" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Clear location" })).toHaveClass(
      "global-image-search-clear",
    );
    expect(screen.getByRole("button", { name: "Clear location" })).toHaveClass(
      "job-location-picker-clear",
    );
    fireEvent.blur(locationField);
    expect(
      screen.getByRole("button", { name: "Clear location" }),
    ).toBeVisible();
    expect(
      locationField.closest(".global-image-search-location")?.children,
    ).toHaveLength(3);
    expect(
      locationField
        .closest(".global-image-search-location")
        ?.querySelector(".job-location-picker-actions"),
    ).toContainElement(screen.getByRole("button", { name: "Clear location" }));
    expect(
      locationField
        .closest(".global-image-search-location")
        ?.querySelector("button.job-location-picker-chevron"),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "Open location picker" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Choose location" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Close location picker" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Choose location" }),
    ).not.toBeInTheDocument();
    fireEvent.focus(locationField);
    expect(locationField).toHaveValue("Ho Chi Minh City, District 1");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(locationField).toHaveValue("Ho Chi Minh City, District 1");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear location" }));
    expect(locationField).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith({ q: "project manager" });
  });

  it("keeps a long province's comma-separated district list without a hover tooltip", () => {
    const longLocationTaxonomy: JobSearchTaxonomy = {
      ...taxonomy,
      locations: [
        {
          label: "Bà Rịa - Vũng Tàu",
          value: "Bà Rịa - Vũng Tàu",
          count: 2,
        },
      ],
      locationGroups: [
        {
          city: "Bà Rịa - Vũng Tàu",
          count: 2,
          districts: [
            { name: "Long Hải", count: 1 },
            { name: "Phước Hải", count: 1 },
          ],
        },
      ],
    };
    render(<LocationFilterHarness taxonomy={longLocationTaxonomy} />);

    const locationField = screen.getByRole("combobox", { name: "Location" });
    fireEvent.focus(locationField);
    fireEvent.click(screen.getByRole("checkbox", { name: "Long Hải" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Phước Hải" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Choose location" })).getByRole(
        "button",
        { name: "Apply" },
      ),
    );

    expect(
      locationField.parentElement?.querySelector(
        ".job-location-picker-selection",
      ),
    ).toHaveTextContent("Bà Rịa - Vũng Tàu, Long Hải, Phước Hải");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows only the province when all districts are selected", () => {
    render(<LocationFilterHarness taxonomy={taxonomy} />);

    const locationField = screen.getByRole("combobox", { name: "Location" });
    expect(locationField).toHaveAttribute(
      "placeholder",
      "Province/city, district...",
    );
    fireEvent.focus(locationField);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Available province" }),
      { target: { value: "Ho Chi Minh City" } },
    );
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Choose location" })).getByRole(
        "button",
        { name: "Apply" },
      ),
    );

    expect(locationField).toHaveValue("Ho Chi Minh City");
    expect(
      locationField.parentElement?.querySelector(
        ".job-location-picker-selection",
      ),
    ).toHaveTextContent("Ho Chi Minh City");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens and changes job categories only when clicked", () => {
    const clickTaxonomy: JobSearchTaxonomy = {
      ...taxonomy,
      industries: [
        {
          ...taxonomy.industries[0]!,
          name: "Marketing / PR / Advertising / Communications",
          count: 428,
        },
        {
          code: "r03",
          name: "Information Technology (IT)",
          count: 2,
          subIndustries: [
            {
              name: "Software Engineering",
              count: 2,
              titles: [
                {
                  name: "Software Engineer",
                  categoryIds: ["r03-software-engineering"],
                  count: 2,
                },
              ],
            },
          ],
        },
      ],
    };
    render(<GlobalImageSearch taxonomy={clickTaxonomy} />);

    const trigger = screen.getByRole("button", { name: "Job Category" });
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole("dialog", { name: "Job categories" })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const technology = screen.getByRole("button", {
      name: /information technology.*2 open roles/i,
    });
    fireEvent.mouseEnter(technology);
    expect(
      document.querySelector(".job-category-detail-title"),
    ).toHaveTextContent("Marketing / PR / Advertising / Communications");
    expect(technology).toHaveAttribute("data-active", "false");
    expect(technology.closest("li")).toHaveClass("job-category-industry-item");

    fireEvent.click(technology);
    expect(technology).toHaveAttribute("aria-pressed", "true");
    expect(technology).toHaveAttribute("data-active", "true");
    expect(
      document.querySelector(".job-category-detail-title"),
    ).toHaveTextContent("Information Technology (IT)");
  });

  it("closes the category flyout from its close control or an outside click", () => {
    render(<GlobalImageSearch taxonomy={taxonomy} />);
    const trigger = screen.getByRole("button", { name: "Job Category" });

    fireEvent.click(trigger);
    const closeButton = screen.getByRole("button", {
      name: "Close job categories",
    });
    expect(closeButton.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(screen.queryByRole("dialog", { name: "Job categories" })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Job categories" })).toBeNull();
  });

  it("syncs the category menu when a sidebar filter chip changes the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/jobs?categoryId=r01-b2b-sales&categoryTitle=Key%20Account%20Manager",
    );
    render(<GlobalImageSearch taxonomy={taxonomy} />);
    fireEvent.click(screen.getByRole("button", { name: "Job Category" }));

    const subIndustrySelect = await screen.findByRole("button", {
      name: "Clear sub-industry: B2B Sales",
    });
    await waitFor(() =>
      expect(subIndustrySelect).toHaveAttribute("data-selected", "true"),
    );
    expect(
      screen.getByRole("button", { name: /Key Account Manager/u }),
    ).toHaveAttribute("data-selected", "true");

    window.history.replaceState(null, "", "/jobs");
    window.dispatchEvent(new Event(JOB_SEARCH_CRITERIA_CHANGED_EVENT));

    await waitFor(() =>
      expect(subIndustrySelect).toHaveAttribute("data-selected", "false"),
    );
    expect(
      screen.getByRole("button", { name: /Key Account Manager/u }),
    ).toHaveAttribute("data-selected", "false");
  });

  it("renders every industry supplied by the precomputed taxonomy", () => {
    const allIndustries: JobSearchTaxonomy = {
      ...taxonomy,
      industries: Array.from({ length: 29 }, (_, index) => ({
        ...taxonomy.industries[0]!,
        code: `r${String(index + 1).padStart(2, "0")}`,
        name: `Industry ${String(index + 1).padStart(2, "0")}`,
      })),
    };
    render(<GlobalImageSearch taxonomy={allIndustries} />);

    fireEvent.click(screen.getByRole("button", { name: "Job Category" }));
    expect(screen.getAllByRole("button", { name: /^Industry /u })).toHaveLength(
      29,
    );
    const icons = document.querySelectorAll(".job-category-industry-icon");
    expect(icons).toHaveLength(29);
    expect(
      [...icons].map((icon) => icon.getAttribute("data-industry-code")),
    ).toEqual(allIndustries.industries.map((industry) => industry.code));
    expect([...icons].every((icon) => !icon.hasAttribute("data-tone"))).toBe(
      true,
    );
    expect(
      new Set(
        [...icons].map((icon) =>
          icon.querySelector("svg")?.getAttribute("class"),
        ),
      ).size,
    ).toBe(29);
  });

  it("keeps exactly one in-flow active row while selecting all 29 categories", () => {
    const allIndustries: JobSearchTaxonomy = {
      ...taxonomy,
      industries: Array.from({ length: 29 }, (_, index) => ({
        ...taxonomy.industries[0]!,
        code: `r${String(index + 1).padStart(2, "0")}`,
        name: `Industry ${String(index + 1).padStart(2, "0")}`,
      })),
    };
    render(<GlobalImageSearch taxonomy={allIndustries} />);
    fireEvent.click(screen.getByRole("button", { name: "Job Category" }));

    for (let index = 1; index <= 29; index += 1) {
      const category = screen.getByRole("button", {
        name: new RegExp(`^Industry ${String(index).padStart(2, "0")}`, "u"),
      });
      fireEvent.click(category);
      expect(category).toHaveAttribute("data-active", "true");
      expect(
        document.querySelectorAll('.job-category-industry[data-active="true"]'),
      ).toHaveLength(1);
    }
  });

  it("accepts a PNG/JPEG file through the accessible labeled input", () => {
    const onSelect = vi.fn();
    render(<ImageSearchInput disabled={false} onSelect={onSelect} />);
    const file = new File([Buffer.from("image")], "poster.png", {
      type: "image/png",
    });
    fireEvent.change(screen.getByLabelText("Job poster image"), {
      target: { files: [file] },
    });
    expect(onSelect).toHaveBeenCalledWith(file);
    expect(screen.getByText(/up to 5 MB/u)).toBeVisible();
    expect(screen.getByText(/maximum 20 MP/u)).toBeVisible();
  });

  it("shows provenance and confidence while supporting edit, reverse, remove, and clear", () => {
    const onApply = vi.fn();
    const onClear = vi.fn();
    render(
      <ImageSearchProposals
        intent={intent}
        onApply={onApply}
        onClear={onClear}
      />,
    );
    expect(screen.getByText("High confidence")).toBeVisible();
    expect(screen.getAllByText("Review suggested")).toHaveLength(2);
    expect(
      screen.getByText(/This may be a “Digital Marketing Specialist” role/u),
    ).toBeVisible();
    expect(screen.getByText("Job title or keyword")).toBeVisible();
    expect(screen.getByText(/Source: Remote/u)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Edit location proposal"), {
      target: { value: "Hanoi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reverse selections" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Apply selected filters" }),
    );
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        proposals: expect.arrayContaining([
          expect.objectContaining({
            id: "location-1",
            stringValue: "Hanoi",
            selected: true,
          }),
        ]),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove location" }));
    expect(
      screen.queryByLabelText("Edit location proposal"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear proposals" }));
    expect(
      screen.queryByLabelText("Edit workArrangement proposal"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reverse selections" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply selected filters" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("keeps a single suggested filter compact by omitting reverse selection", () => {
    const onApply = vi.fn();
    const onClear = vi.fn();
    render(
      <ImageSearchProposals
        intent={{ ...intent, proposals: [intent.proposals[1]] }}
        onApply={onApply}
        onClear={onClear}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Reverse selections" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear proposals" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Apply selected filters" }),
    ).toBeVisible();
  });

  it("keeps cancel, manual fallback, and initially-off external consent explicit", () => {
    const cancel = vi.fn();
    const manual = vi.fn();
    const consent = vi.fn();
    const { rerender } = render(
      <>
        <ImageSearchConsent selected={false} onChange={consent} />
        <ImageSearchProgress progress={42} onCancel={cancel} />
        <ImageSearchRecovery
          error="OCR unavailable"
          fallbackReason={null}
          onRetry={vi.fn()}
          onManual={manual}
        />
      </>,
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(consent).toHaveBeenCalledWith(true);
    expect(screen.getByRole("status")).toHaveTextContent("42%");
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel image search" }),
    );
    expect(
      screen.getByRole("button", { name: "Cancel image search" }),
    ).toHaveClass("image-search-progress-cancel");
    expect(cancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Search manually" }));
    expect(manual).toHaveBeenCalledWith();

    rerender(
      <ImageSearchRecovery
        error={null}
        fallbackReason="INTERPRETER_UNAVAILABLE"
        onRetry={vi.fn()}
        onManual={manual}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "AI filter suggestions are unavailable",
      }),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("Recognized job poster text"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use as keyword search" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Find jobs" }),
    );
    expect(manual).toHaveBeenLastCalledWith();
  });

  it("uses error, warning, and success toasts for image-search outcomes", () => {
    vi.clearAllMocks();
    const { rerender } = render(
      <ImageSearchFeedback
        phase="ERROR"
        error="Image search is temporarily unavailable."
        fallbackReason={null}
        retryAt={null}
        proposalCount={0}
        warningCount={0}
      />,
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Image search could not continue",
      expect.objectContaining({
        description: "Image search is temporarily unavailable.",
      }),
    );

    rerender(
      <ImageSearchFeedback
        phase="FALLBACK"
        error={null}
        fallbackReason="INTERPRETER_UNAVAILABLE"
        retryAt={null}
        proposalCount={0}
        warningCount={0}
      />,
    );
    expect(toast.warning).toHaveBeenCalledWith(
      "AI filter suggestions are unavailable",
      expect.any(Object),
    );

    rerender(
      <ImageSearchFeedback
        phase="READY"
        error={null}
        fallbackReason={null}
        retryAt={null}
        proposalCount={2}
        warningCount={0}
      />,
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Job filters are ready",
      expect.objectContaining({ description: expect.stringContaining("2") }),
    );
  });
});
