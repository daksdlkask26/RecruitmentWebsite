import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompanyDetailScreen } from "@/frontend/features/candidate-company/company-detail-screen";
import { CompanyListScreen } from "@/frontend/features/candidate-company/company-list-screen";
import {
  approvedCompanyFixture,
  teamRoleFixtures,
} from "../../helpers/company-team-applications-fixture";

vi.mock("@/frontend/features/dashboard/client/workspace-locale", () => ({
  useWorkspaceLocale: () => "en",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const company = {
  companyId: approvedCompanyFixture.id,
  slug: approvedCompanyFixture.slug,
  name: approvedCompanyFixture.displayName,
  logoUrl: null,
  description: approvedCompanyFixture.publicDescription,
  foundedYear: null,
  sizeRange: "Unavailable",
  industry: null,
  location: null,
  activeEmployeeCount: 0,
  teamRoles: [...teamRoleFixtures],
  jobs: [],
  jobTotal: 0,
  jobPage: 1,
  jobTotalPages: 0,
};

describe("Company and Team Applications accessibility", () => {
  it("keeps primary discovery controls keyboard-addressable with descriptive roles", () => {
    const { unmount } = render(
      <CompanyListScreen
        companies={[
          {
            companyId: company.companyId,
            slug: company.slug,
            name: company.name,
            logoUrl: company.logoUrl,
            description: company.description,
          },
        ]}
        total={1}
      />,
    );
    expect(screen.getByRole("link", { name: /Northstar Labs/u })).toBeVisible();
    unmount();

    render(<CompanyDetailScreen initialCompany={company} />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Keyword" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Location" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
  });
});
