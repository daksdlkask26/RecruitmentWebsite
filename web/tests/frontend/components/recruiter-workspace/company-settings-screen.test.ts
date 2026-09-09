import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import styles from "@/frontend/features/recruiter-workspace/company-settings-screen.module.css";
import {
  CompanySettingsScreen,
  getCompanyProfileValidation,
} from "@/frontend/features/recruiter-workspace/company-settings-screen";
import { RECRUITER_COMPANY_SCOPE_STORAGE_KEY } from "@/frontend/features/recruiter-workspace/recruiter-company-scope";

const navigationMocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
}));

vi.mock("@/frontend/features/authentication/client/csrf-proof-context", () => ({
  useCsrfProof: () => "csrf-test-proof",
}));

describe("company posting gate validation", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    navigationMocks.push.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("recomputes completeness from filled form values instead of a stale server snapshot", () => {
    const validation = getCompanyProfileValidation({
      name: "Dava",
      industry: "Game Development",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: "https://example.com/dava-logo.png",
      website: "https://example.com/Dava",
      description: "A verified SmartHire employer.",
    });

    expect(validation).toEqual({
      missingFields: [],
      fieldErrors: {},
    });
  });

  it("keeps the no-company state inside the shared recruiter page root", () => {
    render(
      createElement(CompanySettingsScreen, {
        initialCompany: null,
        initialCompanies: [],
      }),
    );

    const emptyState = screen.getByRole("heading", {
      name: "No company is linked yet",
    }).parentElement;
    expect(emptyState?.parentElement).toHaveClass(styles.wrap);
  });

  it("does not show a stale posting gate for a filled company form", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: {
          id: "company-1",
          slug: "dava",
          name: "Dava",
          entityType: "Limited liability company",
          industry: "Game Development",
          size: "1-50 employees",
          address: "Ho Chi Minh, District 8",
          logo: "https://example.com/dava-logo.png",
          website: "https://example.com/Dava",
          description: "A verified SmartHire employer.",
          ownerUserId: "recruiter-1",
          memberUserIds: [],
          taxCode: "1234567890",
          verificationStatus: "approved",
          profileComplete: false,
          missingProfileFields: ["industry", "size", "address", "logo"],
        },
      }),
    );

    expect(
      screen.queryByRole("heading", {
        name: "Complete your company profile before posting a job",
      }),
    ).not.toBeInTheDocument();
  });

  it("renders verified identity as locked display-only data", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: {
          id: "company-1",
          slug: "dava",
          name: "Dava",
          entityType: "Limited liability company",
          industry: "Game Development",
          size: "1-50 employees",
          address: "Ho Chi Minh, District 8",
          logo: "https://example.com/dava-logo.png",
          website: "https://example.com/Dava",
          description: "A verified SmartHire employer.",
          ownerUserId: "recruiter-1",
          memberUserIds: [],
          taxCode: "1234567890",
          verificationStatus: "approved",
          profileComplete: true,
          missingProfileFields: [],
        },
      }),
    );

    expect(screen.getByText("Verified identity")).toBeInTheDocument();
    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(screen.getByText("Limited liability company")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Company name" }),
    ).not.toBeInTheDocument();
  });

  it("switches the settings profile and team context between companies", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const firstCompany = {
      id: "company-1",
      slug: "dava",
      name: "Dava",
      entityType: "Limited liability company",
      industry: "Game Development",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: "https://example.com/dava-logo.png",
      website: "https://example.com/Dava",
      description: "A verified SmartHire employer.",
      ownerUserId: "recruiter-1",
      memberUserIds: [],
      taxCode: "1234567890",
      verificationStatus: "approved" as const,
      role: "OWNER" as const,
      profileComplete: true,
      missingProfileFields: [],
    };
    const secondCompany = {
      ...firstCompany,
      id: "company-2",
      slug: "northstar",
      name: "Northstar Labs",
      industry: "Information Technology",
      address: "Hanoi",
      role: "RECRUITER" as const,
      memberUserIds: ["recruiter-1"],
    };

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: firstCompany,
        initialCompanies: [firstCompany, secondCompany],
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Dava", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("1/3 slots")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Your companies" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add or join a company" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Member access" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dava/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const manageTeamLink = screen.getByRole("link", { name: "Manage team" });
    const teamApplicationsLink = screen.getByRole("link", {
      name: "Team Applications",
    });
    expect(manageTeamLink).toHaveAttribute(
      "href",
      "/recruiter/company-settings/team?companyId=company-1",
    );
    expect(manageTeamLink.parentElement).toHaveClass(styles.sideActions);
    expect(teamApplicationsLink.parentElement).toBe(manageTeamLink.parentElement);

    fireEvent.click(screen.getByRole("button", { name: /Northstar Labs/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Northstar Labs", level: 1 }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Northstar Labs/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Verification: Approved")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Manage team" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete company" }),
    ).not.toBeInTheDocument();
  });

  it("shows the ownership quota separately from invited company access", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const owner = {
      id: "company-owner-1",
      slug: "owner-one",
      name: "Owner One",
      entityType: "Limited liability company",
      industry: "Technology",
      size: "1-50 employees",
      address: "Ho Chi Minh City",
      logo: null,
      website: null,
      description: null,
      ownerUserId: "recruiter-1",
      memberUserIds: [],
      taxCode: "1234567890",
      verificationStatus: "approved" as const,
      role: "OWNER" as const,
      profileComplete: true,
      missingProfileFields: [],
    };
    const companies = [
      owner,
      { ...owner, id: "company-owner-2", name: "Owner Two" },
      { ...owner, id: "company-owner-3", name: "Owner Three" },
      {
        ...owner,
        id: "company-member-1",
        name: "Invited Company",
        role: "RECRUITER" as const,
      },
    ];

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: owner,
        initialCompanies: companies,
      }),
    );

    expect(
      screen.getByText(/Ownership limit reached \(3\/3\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("3/3 slots")).toBeInTheDocument();
    expect(
      screen.getByText(
        /You can still join companies as a Recruiter or HR Manager/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Invited Company/ }),
    ).toBeInTheDocument();
  });

  it("restores the shared company selection when settings is revisited", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const firstCompany = {
      id: "company-1",
      slug: "dava",
      name: "Dava",
      entityType: "Limited liability company",
      industry: "Game Development",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: "https://example.com/dava-logo.png",
      website: "https://example.com/Dava",
      description: "A verified SmartHire employer.",
      ownerUserId: "recruiter-1",
      memberUserIds: [],
      taxCode: "1234567890",
      verificationStatus: "approved" as const,
      role: "OWNER" as const,
      profileComplete: true,
      missingProfileFields: [],
    };
    const secondCompany = {
      ...firstCompany,
      id: "company-2",
      slug: "northstar",
      name: "Northstar Labs",
      role: "RECRUITER" as const,
    };
    window.sessionStorage.setItem(
      RECRUITER_COMPANY_SCOPE_STORAGE_KEY,
      secondCompany.id,
    );

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: firstCompany,
        initialCompanies: [firstCompany, secondCompany],
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Northstar Labs", level: 1 }),
      ).toBeInTheDocument();
    });
  });

  it("lets an owner delete the selected company and switches to the next one", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const firstCompany = {
      id: "company-1",
      slug: "dava",
      name: "Dava",
      entityType: "Limited liability company",
      industry: "Game Development",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: "https://example.com/dava-logo.png",
      website: "https://example.com/Dava",
      description: "A verified SmartHire employer.",
      ownerUserId: "recruiter-1",
      memberUserIds: [],
      taxCode: "1234567890",
      verificationStatus: "approved" as const,
      role: "OWNER" as const,
      profileComplete: true,
      missingProfileFields: [],
    };
    const secondCompany = {
      ...firstCompany,
      id: "company-2",
      slug: "northstar",
      name: "Northstar Labs",
      role: "RECRUITER" as const,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ companyId: "company-1", deleted: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: firstCompany,
        initialCompanies: [firstCompany, secondCompany],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete company" }));

    const dialog = screen.getByRole("dialog", { name: "Delete Dava?" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(
      within(dialog).getByRole("textbox", {
        name: "Type company name to confirm",
      }),
      { target: { value: "Dava" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete company" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Northstar Labs", level: 1 }),
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recruiter/company?companyId=company-1",
      {
        method: "DELETE",
        headers: { "X-CSRF-Token": "csrf-test-proof" },
      },
    );
    expect(
      screen.queryByRole("button", { name: "Delete company" }),
    ).not.toBeInTheDocument();
  });

  it("reloads a blocked deletion receipt without exposing retention details", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const company = {
      id: "company-1",
      slug: "dava",
      name: "Dava",
      entityType: "Limited liability company",
      industry: "Game Development",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: "https://example.com/dava-logo.png",
      website: "https://example.com/Dava",
      description: "A verified SmartHire employer.",
      ownerUserId: "recruiter-1",
      memberUserIds: [],
      taxCode: "1234567890",
      verificationStatus: "approved" as const,
      role: "OWNER" as const,
      profileComplete: true,
      missingProfileFields: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deleted: false,
          status: "BLOCKED_BY_LEGAL_HOLD",
          requestId: "request-1",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          requestId: "request-1",
          status: "BLOCKED",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: company,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete company" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Dava?" });
    fireEvent.change(
      within(dialog).getByRole("textbox", {
        name: "Type company name to confirm",
      }),
      { target: { value: "Dava" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete company" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("company-deletion-receipt")).toHaveTextContent(
        "Blocked by an active retention requirement.",
      );
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/recruiter/company/deletion/request-1",
      { cache: "no-store" },
    );
    expect(navigationMocks.push).toHaveBeenCalledWith(
      "/recruiter/company-settings?deletionRequestId=request-1",
    );
  });

  it("reloads an owner receipt from its durable URL state after refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ requestId: "request-refresh", status: "COMPLETED" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: null,
        initialCompanies: [],
        initialDeletionRequestId: "request-refresh",
      }),
    );

    const heading = await screen.findByRole("heading", {
      name: "Completed.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recruiter/company/deletion/request-refresh",
      { cache: "no-store" },
    );
    expect(heading).toHaveFocus();
    expect(window.localStorage.getItem("request-refresh")).toBeNull();
    expect(window.sessionStorage.getItem("request-refresh")).toBeNull();
  });

  it("closes the delete confirmation when the backdrop is clicked", () => {
    const firstCompany = {
      id: "company-1",
      slug: "dava",
      name: "Dava",
      entityType: "Limited liability company",
      industry: "Game Development",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: "https://example.com/dava-logo.png",
      website: "https://example.com/Dava",
      description: "A verified SmartHire employer.",
      ownerUserId: "recruiter-1",
      memberUserIds: [],
      taxCode: "1234567890",
      verificationStatus: "approved" as const,
      role: "OWNER" as const,
      profileComplete: true,
      missingProfileFields: [],
    };

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: firstCompany,
        initialCompanies: [firstCompany],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete company" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Dava?" });
    expect(dialog).toBeInTheDocument();

    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);

    expect(
      screen.queryByRole("dialog", { name: "Delete Dava?" }),
    ).not.toBeInTheDocument();
  });

  it("returns to read-only mode after saving and opens editing on demand", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const savedCompany = {
      id: "company-1",
      slug: "dava",
      name: "Dava",
      entityType: "Limited liability company",
      industry: "FinTech",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: "https://example.com/dava-logo.png",
      website: "https://example.com/Dava",
      description: "A verified SmartHire employer.",
      ownerUserId: "recruiter-1",
      memberUserIds: [],
      taxCode: "1234567890",
      verificationStatus: "approved" as const,
      profileComplete: true,
      missingProfileFields: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => savedCompany,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: savedCompany,
      }),
    );

    expect(
      screen.queryByRole("textbox", { name: "Industry *" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit company profile" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Industry *" }), {
      target: { value: "FinTech" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save company profile" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "Industry *" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Your public company information"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("auto-expands the description field as its content grows", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);

    render(
      createElement(CompanySettingsScreen, {
        initialCompany: {
          id: "company-1",
          slug: "dava",
          name: "Dava",
          entityType: "Limited liability company",
          industry: "Game Development",
          size: "1-50 employees",
          address: "Ho Chi Minh, District 8",
          logo: "https://example.com/dava-logo.png",
          website: "https://example.com/Dava",
          description: "A verified SmartHire employer.",
          ownerUserId: "recruiter-1",
          memberUserIds: [],
          taxCode: "1234567890",
          verificationStatus: "approved",
          profileComplete: true,
          missingProfileFields: [],
        },
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit company profile" }),
    );
    const description = screen.getByRole("textbox", { name: "Description" });
    Object.defineProperty(description, "scrollHeight", {
      configurable: true,
      value: 240,
    });

    fireEvent.change(description, {
      target: {
        value:
          "A longer company description that should expand vertically as the recruiter types more content.",
      },
    });

    expect(description).toHaveStyle({ height: "240px" });
  });

  it("returns field-specific reasons for incomplete profile values", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);

    const validation = getCompanyProfileValidation({
      name: "Dava",
      industry: "",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: null,
      website: null,
      description: null,
    });

    expect(validation.missingFields).toEqual(["industry", "logo"]);
    expect(validation.fieldErrors).toEqual({
      industry: "Industry is required.",
      logo: "Company logo is required.",
    });
  });
});
