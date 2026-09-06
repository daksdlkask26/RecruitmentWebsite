import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeTestHarness } from "../../helpers/home/home-test-harness";
import {
  companySpotlight,
  employerViewer,
  homeModel,
} from "../../helpers/home/home-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("rendered Home privacy", () => {
  it("keeps Guest and expired HTML free of identity, session, profile, membership, and personal recommendation data", () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeTestHarness, { model: homeModel() }),
    );
    expect(html).not.toMatch(
      /csrf-proof|private-proof|@example|My Applications|Saved Jobs|profileSignals|Personal match estimate|membership|token/iu,
    );
    expect(html).not.toContain("match estimate</strong>");
  });

  it("keeps Employer output free of candidate-specific recommendation and company-private fields", () => {
    const companies = [
      companySpotlight(),
      { ...companySpotlight(), slug: "company-two", name: "Company Two" },
      { ...companySpotlight(), slug: "company-three", name: "Company Three" },
    ];
    const model = homeModel({ viewer: employerViewer, companies });
    const html = renderToStaticMarkup(
      React.createElement(HomeTestHarness, {
        model,
      }),
    );
    expect(html).not.toMatch(
      /Personal job-fit recommendation|private address/iu,
    );
    expect(html).toContain(
      "This example does not use your profile or a live job.",
    );
    const { container } = render(
      React.createElement(HomeTestHarness, {
        model: homeModel({ viewer: employerViewer, companies }),
      }),
    );
    const companyGrid = container.querySelector(
      ".home-companies-hiring-grid",
    ) as HTMLElement;
    expect(
      within(companyGrid).queryByText(
        /tax|membership|private address|mentoring|internship-friendly/iu,
      ),
    ).not.toBeInTheDocument();
    expect(
      within(companyGrid).getAllByRole("heading", { name: /Company|Công ty/u }),
    ).toHaveLength(3);
  });
});
