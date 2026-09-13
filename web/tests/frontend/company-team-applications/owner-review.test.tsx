import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CompanyTeamApplicationsScreen } from "@/frontend/features/recruiter-workspace/company-team-applications-screen";
import { teamApplicationFixture } from "../../helpers/company-team-applications-fixture";
import type { OwnerTeamApplication } from "@/shared/contracts/company-members/team-applications";

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("@/frontend/features/authentication/client/current-csrf-proof", () => ({
  mutateWithCurrentCsrf: mutateMock,
}));
vi.mock("@/frontend/features/authentication/client/csrf-proof-context", () => ({
  useCsrfProof: () => "csrf-test-proof",
}));

function ownerApplication(
  overrides: Partial<OwnerTeamApplication> = {},
): OwnerTeamApplication {
  return {
    ...teamApplicationFixture(),
    candidateName: "Candidate Nguyen",
    applicationEmail: "candidate@example.com",
    cvFileName: "candidate-resume.pdf",
    cvMimeType: "application/pdf",
    cvByteSize: 64,
    rejectionReason: null,
    invitationEmailStatus: null,
    ...overrides,
  };
}

describe("Owner Team Applications review", () => {
  beforeEach(() => mutateMock.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("loads a CV detail and accepts with a confirmed role", async () => {
    const application = ownerApplication();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => application,
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    mutateMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          applicationId: application.applicationId,
          invitationId: "invitation-1",
          role: "HR_MANAGER",
          status: "INVITATION_SENT",
          idempotent: false,
        }),
        { status: 200 },
      ),
    );

    render(
      <CompanyTeamApplicationsScreen
        initialApplications={[application]}
        companyId={application.companyId}
        initialPendingCount={1}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Candidate Nguyen" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "View CV" })).toHaveAttribute(
      "href",
      "/api/recruiter/company/team/applications/application-team-028/cv?companyId=company-team-028",
    );
    fireEvent.change(screen.getByLabelText("Invitation role"), {
      target: { value: "HR_MANAGER" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Accept and invite" })[0],
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Accept and invite",
      }),
    );

    await waitFor(() => expect(mutateMock).toHaveBeenCalledOnce());
    expect(mutateMock).toHaveBeenCalledWith(
      "/api/recruiter/company/team/applications/application-team-028/accept?companyId=company-team-028",
      expect.objectContaining({
        body: JSON.stringify({ role: "HR_MANAGER" }),
      }),
      "csrf-test-proof",
    );
    expect(screen.getAllByText("Invitation sent")).not.toHaveLength(0);
  });

  it("sends an optional rejection reason and does not expose an Owner identity", async () => {
    const application = ownerApplication();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => application,
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    mutateMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          applicationId: application.applicationId,
          status: "REJECTED",
          idempotent: false,
        }),
        { status: 200 },
      ),
    );

    render(
      <CompanyTeamApplicationsScreen
        initialApplications={[application]}
        companyId={application.companyId}
        initialPendingCount={1}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("Optional rejection reason"),
      ).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("Optional rejection reason"), {
      target: { value: "Please add more recruiting experience." },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Reject application" })[0],
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reject application",
      }),
    );

    await waitFor(() => expect(mutateMock).toHaveBeenCalledOnce());
    expect(mutateMock).toHaveBeenCalledWith(
      "/api/recruiter/company/team/applications/application-team-028/reject?companyId=company-team-028",
      expect.objectContaining({
        body: JSON.stringify({
          reason: "Please add more recruiting experience.",
        }),
      }),
      "csrf-test-proof",
    );
    expect(screen.getAllByText("Not selected")).not.toHaveLength(0);
    expect(screen.queryByText(/owner@/iu)).not.toBeInTheDocument();
  });

  it("keeps the selected application after a failed page and retries in the same company scope", async () => {
    const application = ownerApplication();
    const nextApplication = ownerApplication({
      applicationId: "application-team-029",
      candidateName: "Second Candidate",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => application })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: "temporary" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [nextApplication],
          nextCursor: null,
          hasMore: false,
          total: 2,
          pendingCount: 1,
          filter: { status: null, role: null },
          sort: "SUBMITTED_DESC",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CompanyTeamApplicationsScreen
        initialApplications={[application]}
        companyId={application.companyId}
        initialNextCursor="opaque-owner-cursor"
        initialHasMore
        initialTotal={2}
        initialPendingCount={1}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Candidate Nguyen" }),
      ).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
    expect(
      screen.getByRole("heading", { name: "Candidate Nguyen" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry next page" }));
    await waitFor(() =>
      expect(screen.getByText("Second Candidate")).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("companyId=company-team-028"),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(window.location.search).toContain("cursor=opaque-owner-cursor");
  });

  it("removes a decided row when the active status filter no longer matches", async () => {
    const application = ownerApplication({ status: "SUBMITTED" });
    const rejected = ownerApplication({
      status: "REJECTED",
      rejectionReason: "The role has been filled.",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => application })
      .mockResolvedValueOnce({ ok: true, json: async () => rejected })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [],
          nextCursor: null,
          hasMore: false,
          total: 0,
          pendingCount: 0,
          filter: { status: "SUBMITTED", role: null },
          sort: "SUBMITTED_DESC",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    mutateMock.mockResolvedValue(
      new Response(
        JSON.stringify({ applicationId: application.applicationId }),
        {
          status: 200,
        },
      ),
    );

    render(
      <CompanyTeamApplicationsScreen
        initialApplications={[application]}
        companyId={application.companyId}
        initialFilter={{ status: "SUBMITTED", role: null }}
        initialSort="SUBMITTED_DESC"
        initialTotal={1}
        initialPendingCount={1}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Candidate Nguyen" }),
      ).toBeVisible(),
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Reject application" })[0]!,
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reject application",
      }),
    );

    await waitFor(() => expect(mutateMock).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Candidate Nguyen" }),
      ).not.toBeInTheDocument(),
    );
    expect(window.location.search).not.toContain("selected=");
    expect(screen.getByText("No Team Applications yet")).toBeVisible();
  });

  it("uses the authoritative pending count instead of the loaded-page subset", async () => {
    const application = ownerApplication();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => application,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CompanyTeamApplicationsScreen
        initialApplications={[application]}
        companyId={application.companyId}
        initialPendingCount={17}
      />,
    );

    expect(screen.getByText("17 awaiting decision")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("clears a selected ID that is not on the URL-bound page", async () => {
    const application = ownerApplication({
      applicationId: "owner-page-one",
      candidateName: "Page One Candidate",
    });
    window.history.replaceState(
      null,
      "",
      `/recruiter/company-settings/team/applications?companyId=${application.companyId}&selected=foreign-application`,
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => application,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CompanyTeamApplicationsScreen
        initialApplications={[application]}
        companyId={application.companyId}
        eligibleCompanies={[
          { id: application.companyId, name: "Northstar Labs" },
        ]}
        initialPendingCount={1}
      />,
    );

    await waitFor(() =>
      expect(window.location.search).not.toContain(
        "selected=foreign-application",
      ),
    );
    expect(screen.getByText("Select an application")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reconstructs the selected company and bounded cursor page on Back/Forward", async () => {
    const companyId = "company-team-028";
    const pageOne = ownerApplication({
      applicationId: "owner-page-one",
      candidateName: "Page One Candidate",
      companyId,
    });
    const pageTwo = ownerApplication({
      applicationId: "owner-page-two",
      candidateName: "Page Two Candidate",
      companyId,
    });
    window.history.replaceState(
      null,
      "",
      `/recruiter/company-settings/team/applications?companyId=${companyId}&sort=SUBMITTED_ASC&cursor=opaque-owner-page-two&selected=owner-page-two`,
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/owner-page-one"))
        return { ok: true, json: async () => pageOne };
      if (url.pathname.endsWith("/owner-page-two"))
        return { ok: true, json: async () => pageTwo };
      const items = url.searchParams.has("cursor") ? [pageTwo] : [pageOne];
      return Response.json({
        items,
        nextCursor: null,
        hasMore: false,
        total: 2,
        pendingCount: 9,
        filter: { status: null, role: null },
        sort: url.searchParams.get("sort") ?? "SUBMITTED_DESC",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CompanyTeamApplicationsScreen
        initialApplications={[pageTwo]}
        companyId={companyId}
        eligibleCompanies={[{ id: companyId, name: "Northstar Labs" }]}
        initialNextCursor={null}
        initialTotal={2}
        initialPendingCount={9}
        initialSort="SUBMITTED_ASC"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Page Two Candidate" }),
      ).toBeVisible(),
    );

    window.history.pushState(
      null,
      "",
      `/recruiter/company-settings/team/applications?companyId=${companyId}&sort=SUBMITTED_ASC`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.getByText("Page One Candidate")).toBeVisible(),
    );

    window.history.pushState(
      null,
      "",
      `/recruiter/company-settings/team/applications?companyId=${companyId}&sort=SUBMITTED_ASC&cursor=opaque-owner-page-two&selected=owner-page-two`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Page Two Candidate" }),
      ).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("companyId=company-team-028"),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("cursor=opaque-owner-page-two"),
      ),
    ).toBe(true);
  });

  it("restarts at the first page when the active cursor is rejected", async () => {
    const companyId = "company-team-028";
    const pageOne = ownerApplication({
      applicationId: "owner-expired-page-one",
      candidateName: "Page One Candidate",
      companyId,
    });
    const pageTwo = ownerApplication({
      applicationId: "owner-expired-page-two",
      candidateName: "Page Two Candidate",
      companyId,
    });
    window.history.replaceState(
      null,
      "",
      `/recruiter/company-settings/team/applications?companyId=${companyId}&cursor=opaque-expired&selected=owner-expired-page-two`,
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => pageTwo })
      .mockResolvedValueOnce(
        Response.json(
          { code: "TEAM_APPLICATION_CURSOR_INVALID" },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [pageOne],
          nextCursor: null,
          hasMore: false,
          total: 2,
          pendingCount: 1,
          filter: { status: null, role: null },
          sort: "SUBMITTED_DESC",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CompanyTeamApplicationsScreen
        initialApplications={[pageTwo]}
        companyId={companyId}
        eligibleCompanies={[{ id: companyId, name: "Northstar Labs" }]}
        initialTotal={2}
        initialPendingCount={1}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Page Two Candidate" }),
      ).toBeVisible(),
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.getByText("Page One Candidate")).toBeVisible(),
    );
    expect(window.location.search).not.toContain("cursor=");
  });
});
