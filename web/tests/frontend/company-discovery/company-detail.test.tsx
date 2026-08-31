import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CompanyDetailScreen } from "@/frontend/features/candidate-company/company-detail-screen";
import {
  approvedCompanyFixture,
  publicJobCardFixture,
  teamRoleFixtures,
} from "../../helpers/company-team-applications-fixture";

vi.mock("@/frontend/features/dashboard/client/workspace-locale", () => ({
  useWorkspaceLocale: () => "en",
}));

const company = {
  companyId: approvedCompanyFixture.id,
  slug: approvedCompanyFixture.slug,
  name: approvedCompanyFixture.displayName,
  logoUrl: null,
  description: approvedCompanyFixture.publicDescription,
  foundedYear: approvedCompanyFixture.foundedYear,
  sizeRange: "1–10 employees",
  industry: approvedCompanyFixture.industry,
  location: approvedCompanyFixture.publicLocation,
  activeEmployeeCount: 2,
  teamRoles: [...teamRoleFixtures],
  jobs: [publicJobCardFixture],
  jobTotal: 1,
  jobPage: 1,
  jobTotalPages: 1,
};

describe("Candidate Company detail", () => {
  it("shows public metadata, separate team actions, and ordinary job navigation", () => {
    render(<CompanyDetailScreen initialCompany={company} />);

    expect(
      screen.getByRole("heading", { name: "Northstar Labs" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2018")).toBeInTheDocument();
    expect(screen.getByText("1–10 employees")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Apply as HR Manager" }),
    ).toHaveAttribute(
      "href",
      "/company/company-team-028/apply?role=HR_MANAGER",
    );
    expect(
      screen.getByRole("link", { name: publicJobCardFixture.title }),
    ).toHaveAttribute("href", "/jobs/senior-recruiter");
    expect(document.querySelector(".job-redesign-card")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apply" })).toBeInTheDocument();
  });

  it("sends combined keyword and location filters and can clear them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        total: 0,
        nextCursor: null,
        page: 1,
        totalPages: 0,
        companyId: approvedCompanyFixture.id,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyDetailScreen initialCompany={company} />);
    fireEvent.change(screen.getByLabelText("Keyword"), {
      target: { value: "recruiter" },
    });
    fireEvent.change(screen.getByLabelText("Location"), {
      target: { value: "Ho Chi Minh City" },
    });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/companies/company-team-028/jobs?q=recruiter&location=Ho+Chi+Minh+City",
      { headers: { Accept: "application/json" } },
    );
    expect(
      screen.getByText("No open positions match these filters"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/companies/company-team-028/jobs",
      { headers: { Accept: "application/json" } },
    );
  });

  it("keeps server-applied filters visible after a deep link", () => {
    render(
      <CompanyDetailScreen
        initialCompany={company}
        initialKeyword="recruiter"
        initialLocation="Ho Chi Minh City"
      />,
    );

    expect(screen.getByLabelText("Keyword")).toHaveValue("recruiter");
    expect(screen.getByLabelText("Location")).toHaveValue("Ho Chi Minh City");
  });

  it("loads another company job page while preserving the active filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        total: 41,
        nextCursor: null,
        page: 2,
        totalPages: 3,
        companyId: approvedCompanyFixture.id,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CompanyDetailScreen
        initialCompany={{
          ...company,
          jobTotal: 41,
          jobPage: 1,
          jobTotalPages: 3,
        }}
        initialKeyword="recruiter"
        initialLocation="Ho Chi Minh City"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/companies/company-team-028/jobs?q=recruiter&location=Ho+Chi+Minh+City&page=2",
      { headers: { Accept: "application/json" } },
    );
    expect(
      screen.getByText("No open positions match these filters"),
    ).toBeInTheDocument();
  });

  it("uses the shared jobs pagination to change the page size", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        total: 41,
        nextCursor: null,
        page: 1,
        totalPages: 1,
        companyId: approvedCompanyFixture.id,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CompanyDetailScreen
        initialCompany={{
          ...company,
          jobTotal: 41,
          jobPage: 1,
          jobTotalPages: 3,
        }}
        initialKeyword="recruiter"
        initialLocation="Ho Chi Minh City"
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Per page" }), {
      target: { value: "50" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/companies/company-team-028/jobs?q=recruiter&location=Ho+Chi+Minh+City&limit=50",
      { headers: { Accept: "application/json" } },
    );
  });
});
