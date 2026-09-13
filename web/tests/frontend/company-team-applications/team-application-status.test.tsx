import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { TeamApplicationStatus } from "@/frontend/features/candidate-company/team-application-status";
import { teamApplicationFixture } from "../../helpers/company-team-applications-fixture";

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("@/frontend/features/authentication/client/current-csrf-proof", () => ({
  mutateWithCurrentCsrf: mutateMock,
}));
vi.mock("@/frontend/features/authentication/client/csrf-proof-context", () => ({
  useCsrfProof: () => "csrf-test-proof",
}));
vi.mock("@/frontend/features/dashboard/client/workspace-locale", () => ({
  useWorkspaceLocale: () => "en",
}));

describe("Candidate Team Application status", () => {
  beforeEach(() => mutateMock.mockReset());
  afterEach(() => {
    window.history.replaceState(null, "", "/jobs/applied/team");
    vi.unstubAllGlobals();
  });

  it("shows an in-app withdrawal confirmation before sending the request", async () => {
    const application = teamApplicationFixture();
    mutateMock.mockResolvedValue(
      new Response(
        JSON.stringify(teamApplicationFixture({ status: "WITHDRAWN" })),
        { status: 200 },
      ),
    );

    render(<TeamApplicationStatus initialApplications={[application]} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Withdraw application",
      }),
    );

    await waitFor(() => expect(mutateMock).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your application to Northstar Labs was withdrawn.",
    );
    expect(screen.getAllByText("Withdrawn").length).toBeGreaterThanOrEqual(1);
  });

  it("provides a direct invitation review link for a pending team invitation", () => {
    const application = teamApplicationFixture({
      status: "INVITATION_SENT",
      invitationStatus: "PENDING",
      invitationId: "invitation-1",
    });

    render(<TeamApplicationStatus initialApplications={[application]} />);

    expect(
      screen.getByRole("link", { name: "Review invitation" }),
    ).toHaveAttribute(
      "href",
      "/recruiter/company-invitation?invitationId=invitation-1",
    );
  });

  it("keeps rows after a failed page and retries without losing the list", async () => {
    const application = teamApplicationFixture();
    const nextApplication = teamApplicationFixture({
      applicationId: "team-application-029",
      companyName: "Second Labs",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "temporary" }), { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [nextApplication],
          nextCursor: null,
          hasMore: false,
          total: 2,
          filter: { status: null, role: null },
          sort: "SUBMITTED_DESC",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TeamApplicationStatus
        initialApplications={[application]}
        initialNextCursor="opaque-team-cursor"
        initialHasMore
        initialTotal={2}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The next page could not be loaded.",
      ),
    );
    expect(screen.getByText("Northstar Labs")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry next page" }));
    await waitFor(() => expect(screen.getByText("Second Labs")).toBeVisible());
    expect(window.location.search).toContain("cursor=opaque-team-cursor");
  });

  it("reconstructs filters and sort from URL history", async () => {
    window.history.replaceState(
      null,
      "",
      "/jobs/applied/team?status=VIEWED&role=RECRUITER&sort=SUBMITTED_ASC",
    );
    const viewed = teamApplicationFixture({ status: "VIEWED" });
    const submitted = teamApplicationFixture({ status: "SUBMITTED" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const status = url.searchParams.get("status");
      const items = status === "SUBMITTED" ? [submitted] : [viewed];
      return Response.json({
        items,
        nextCursor: null,
        hasMore: false,
        total: items.length,
        filter: {
          status: status ?? null,
          role: url.searchParams.get("role") ?? null,
        },
        sort: url.searchParams.get("sort") ?? "SUBMITTED_DESC",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TeamApplicationStatus initialApplications={[viewed]} />);
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveValue("VIEWED");
    expect(selects[1]).toHaveValue("RECRUITER");
    expect(selects[2]).toHaveValue("SUBMITTED_ASC");

    window.history.pushState(
      null,
      "",
      "/jobs/applied/team?status=SUBMITTED&role=RECRUITER&sort=SUBMITTED_DESC",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.getByText("Submitted")).toBeVisible());
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("SUBMITTED");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/candidate/team-applications?limit=24&sort=SUBMITTED_DESC&status=SUBMITTED&role=RECRUITER",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reconstructs the bounded cursor page on refresh and Back/Forward", async () => {
    const pageOne = teamApplicationFixture({
      applicationId: "team-page-one",
      companyName: "Northstar Labs",
    });
    const pageTwo = teamApplicationFixture({
      applicationId: "team-page-two",
      companyName: "Second Labs",
    });
    window.history.replaceState(
      null,
      "",
      "/jobs/applied/team?sort=SUBMITTED_ASC&cursor=opaque-team-page-two",
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const items = url.searchParams.has("cursor") ? [pageTwo] : [pageOne];
      return Response.json({
        items,
        nextCursor: null,
        hasMore: false,
        total: 2,
        filter: { status: null, role: null },
        sort: url.searchParams.get("sort") ?? "SUBMITTED_DESC",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TeamApplicationStatus
        initialApplications={[pageTwo]}
        initialNextCursor={null}
        initialTotal={2}
        initialSort="SUBMITTED_ASC"
      />,
    );
    expect(screen.getByText("Second Labs")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate/team-applications?limit=24&sort=SUBMITTED_ASC&cursor=opaque-team-page-two",
        expect.objectContaining({ cache: "no-store" }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.history.pushState(null, "", "/jobs/applied/team?sort=SUBMITTED_ASC");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.getByText("Northstar Labs")).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    window.history.pushState(
      null,
      "",
      "/jobs/applied/team?sort=SUBMITTED_ASC&cursor=opaque-team-page-two",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.getByText("Second Labs")).toBeVisible());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(window.location.search).toContain("cursor=opaque-team-page-two");
  });

  it("restarts at the first page when the active cursor is rejected", async () => {
    const pageOne = teamApplicationFixture({
      applicationId: "team-expired-page-one",
      companyName: "Northstar Labs",
    });
    const pageTwo = teamApplicationFixture({
      applicationId: "team-expired-page-two",
      companyName: "Second Labs",
    });
    window.history.replaceState(
      null,
      "",
      "/jobs/applied/team?sort=SUBMITTED_DESC&cursor=opaque-expired",
    );
    const fetchMock = vi
      .fn()
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
          filter: { status: null, role: null },
          sort: "SUBMITTED_DESC",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TeamApplicationStatus
        initialApplications={[pageTwo]}
        initialNextCursor={null}
        initialTotal={2}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByText("Northstar Labs")).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.location.search).not.toContain("cursor=");
  });
});
