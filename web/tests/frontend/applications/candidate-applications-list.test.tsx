import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateApplicationsListPage } from "@/frontend/features/candidate-applications/components/candidate-applications-list-page";
import { NOTIFICATION_CHANGED_EVENT } from "@/frontend/features/notifications/client/use-notification-context-read";
import {
  publicStageForCanonicalStage,
  type CandidateApplicationSummary,
} from "@/shared/contracts/candidate-applications";
import type { ApplicationStage } from "@/shared/contracts/jobs/applications";

function application(
  stage: ApplicationStage,
  index: number,
  publicOutcome: CandidateApplicationSummary["publicOutcome"] = null,
): CandidateApplicationSummary {
  return {
    applicationId: `application-${index}`,
    jobId: `job-${index}`,
    jobSlug: `job-${index}`,
    jobTitle: `Role ${index}`,
    companyName: "SmartHire",
    companyLogoUrl: null,
    location: "Ho Chi Minh City",
    publicStage: publicStageForCanonicalStage(stage),
    publicOutcome,
    canonicalStage: stage,
    stageVersion: 1,
    submittedAt: "2026-08-01T00:00:00.000Z",
    lastUpdatedAt: "2026-08-02T00:00:00.000Z",
    jobAvailable: true,
  };
}

const applications: CandidateApplicationSummary[] = [
  application("APPLIED", 1),
  application("VIEWED", 2),
  application("SHORTLISTED", 3),
  application("INTERVIEWING", 4),
  application("OFFERED", 5),
  application("HIRED", 6),
  application("OFFER_DECLINED", 7),
  application("REJECTED", 8),
  application("WAITLISTED", 9),
  application("INTERVIEWING", 10, "WITHDRAWN"),
];

afterEach(() => {
  window.history.replaceState(null, "", "/jobs/applied");
  vi.unstubAllGlobals();
});

function openFilter() {
  fireEvent.click(screen.getByRole("button", { name: /^Filter:/u }));
}

function chooseFilter(name: RegExp) {
  openFilter();
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("candidate applications list filters", () => {
  it("falls back to a company monogram for an unavailable logo", () => {
    render(
      <CandidateApplicationsListPage
        initialApplications={[
          {
            ...application("APPLIED", 11),
            companyName: "Smart Hire",
            companyLogoUrl: "https://example.com/logo.png",
          },
        ]}
        initialNextCursor={null}
      />,
    );

    expect(screen.getByText("SH")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows counts, separates terminal filters, and includes Offer sent in Outcome", () => {
    render(
      <CandidateApplicationsListPage
        initialApplications={applications}
        initialNextCursor={null}
      />,
    );

    openFilter();

    expect(
      screen.getByRole("option", {
        name: "Under review, 2 applications",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Withdrawn, 1 application" }),
    ).toBeVisible();
    expect(screen.getByText("Terminal")).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Outcome, 5 applications" }),
    ).toHaveClass("candidate-application-filter__option--terminal-start");
  });

  it("uses the same effective mapping for Under review, Outcome, and Withdrawn", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const filter = url.searchParams.get("filter");
      const filtered =
        filter === "UNDER_REVIEW"
          ? applications.filter((item) =>
              ["VIEWED", "SHORTLISTED"].includes(item.canonicalStage),
            )
          : filter === "OUTCOME"
            ? applications.filter((item) =>
                [
                  "OFFERED",
                  "HIRED",
                  "OFFER_DECLINED",
                  "REJECTED",
                  "WAITLISTED",
                ].includes(item.canonicalStage),
              )
            : filter === "WITHDRAWN"
              ? applications.filter(
                  (item) => item.publicOutcome === "WITHDRAWN",
                )
              : applications;
      return Response.json({
        applications: filtered,
        nextCursor: null,
        hasMore: false,
        total: filtered.length,
        counts: {
          ALL: applications.length,
          APPLICATION_SUBMITTED: 1,
          UNDER_REVIEW: 2,
          INTERVIEW: 1,
          OUTCOME: 5,
          WITHDRAWN: 1,
        },
        filter: filter ?? "ALL",
        sort: "SUBMITTED_DESC",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateApplicationsListPage
        initialApplications={applications}
        initialNextCursor={null}
      />,
    );

    chooseFilter(/Under review, 2 applications/u);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("Viewed")).toBeVisible();
    expect(screen.getByText("Shortlisted")).toBeVisible();

    chooseFilter(/Outcome, 5 applications/u);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(5));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.getByText("Offer sent")).toBeVisible();
    expect(screen.getByText("Hired")).toBeVisible();
    expect(screen.getByText("Offer declined")).toBeVisible();
    expect(screen.getByText("Rejected")).toBeVisible();
    expect(screen.getByText("Waitlisted")).toBeVisible();
    expect(screen.queryByText("Withdrawn")).not.toBeInTheDocument();

    chooseFilter(/Withdrawn, 1 application/u);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    const withdrawnCard = screen.getByRole("article");
    const withdrawnBadge = within(withdrawnCard).getByText("Withdrawn");
    expect(withdrawnBadge).toBeVisible();
    expect(
      withdrawnBadge.closest(".candidate-application-status-badge"),
    ).toHaveAttribute("data-stage", "withdrawn");
  });

  it("renders a badge for every canonical stage value", () => {
    render(
      <CandidateApplicationsListPage
        initialApplications={applications}
        initialNextCursor={null}
      />,
    );

    expect(
      Array.from(document.querySelectorAll("[data-stage]")).map((badge) =>
        badge.getAttribute("data-stage"),
      ),
    ).toEqual([
      "applied",
      "viewed",
      "shortlisted",
      "interviewing",
      "offered",
      "hired",
      "offer-declined",
      "rejected",
      "waitlisted",
      "withdrawn",
    ]);
  });

  it("refreshes application stages when a notification arrives", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        applications: [application("VIEWED", 1)],
        nextCursor: null,
        hasMore: false,
        total: 1,
        counts: {
          ALL: 1,
          APPLICATION_SUBMITTED: 0,
          UNDER_REVIEW: 1,
          INTERVIEW: 0,
          OUTCOME: 0,
          WITHDRAWN: 0,
        },
        filter: "ALL",
        sort: "SUBMITTED_DESC",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateApplicationsListPage
        initialApplications={[application("APPLIED", 1)]}
        initialNextCursor={null}
      />,
    );

    window.dispatchEvent(new Event(NOTIFICATION_CHANGED_EVENT));

    await waitFor(() => expect(screen.getByText("Viewed")).toBeVisible());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/candidate/applications?limit=24&filter=ALL&sort=SUBMITTED_DESC",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
  });

  it("preserves loaded rows after a failed page and exposes a retry", async () => {
    const initialApplications = Array.from({ length: 24 }, (_, index) =>
      application("APPLIED", index + 1),
    );
    const nextApplication = application("VIEWED", 25);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "temporary" }), { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          applications: [nextApplication],
          nextCursor: null,
          hasMore: false,
          total: 25,
          counts: {
            ALL: 25,
            APPLICATION_SUBMITTED: 24,
            UNDER_REVIEW: 1,
            INTERVIEW: 0,
            OUTCOME: 0,
            WITHDRAWN: 0,
          },
          filter: "ALL",
          sort: "SUBMITTED_DESC",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateApplicationsListPage
        initialApplications={initialApplications}
        initialNextCursor="opaque-next-page"
        initialHasMore
        initialTotal={25}
        initialFilter="ALL"
        initialSort="SUBMITTED_DESC"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The next page could not be loaded.",
      ),
    );
    expect(screen.getAllByRole("article")).toHaveLength(24);
    fireEvent.click(screen.getByRole("button", { name: "Retry next page" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.getByText("Viewed")).toBeVisible();
    expect(window.location.search).toContain("cursor=opaque-next-page");
  });

  it("rebuilds URL state on keyboard filter changes and Back/Forward popstate", async () => {
    window.history.replaceState(
      null,
      "",
      "/jobs/applied?filter=UNDER_REVIEW&sort=SUBMITTED_ASC",
    );
    const applied = application("APPLIED", 11);
    const outcome = application("OFFERED", 12);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const filter = url.searchParams.get("filter") ?? "ALL";
      const items =
        filter === "OUTCOME"
          ? [outcome]
          : filter === "APPLICATION_SUBMITTED"
            ? [applied]
            : [applications[1]!];
      return Response.json({
        applications: items,
        nextCursor: null,
        hasMore: false,
        total: items.length,
        counts: {
          ALL: 3,
          APPLICATION_SUBMITTED: 1,
          UNDER_REVIEW: 1,
          INTERVIEW: 0,
          OUTCOME: 1,
          WITHDRAWN: 0,
        },
        filter,
        sort: url.searchParams.get("sort") ?? "SUBMITTED_DESC",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateApplicationsListPage
        initialApplications={[applications[1]! as CandidateApplicationSummary]}
        initialNextCursor={null}
        initialFilter="UNDER_REVIEW"
        initialSort="SUBMITTED_ASC"
      />,
    );

    const filterButton = screen.getByRole("button", { name: /^Filter:/u });
    expect(filterButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(filterButton, { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox");
    expect(document.activeElement).toBe(listbox);
    fireEvent.keyDown(listbox, { key: "Home" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    await waitFor(() =>
      expect(window.location.search).toContain("filter=APPLICATION_SUBMITTED"),
    );
    expect(window.location.search).toContain("sort=SUBMITTED_ASC");

    window.history.pushState(
      null,
      "",
      "/jobs/applied?filter=OUTCOME&sort=SUBMITTED_DESC",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.getByText("Offer sent")).toBeVisible());
    expect(screen.getAllByRole("article")).toHaveLength(1);

    window.history.pushState(
      null,
      "",
      "/jobs/applied?filter=UNDER_REVIEW&sort=SUBMITTED_ASC",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.getByText("Viewed")).toBeVisible());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/candidate/applications?limit=24&filter=UNDER_REVIEW&sort=SUBMITTED_ASC",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reconstructs the bounded cursor page on refresh and Back/Forward", async () => {
    const pageOne = application("APPLIED", 1);
    const pageTwo = application("VIEWED", 25);
    window.history.replaceState(
      null,
      "",
      "/jobs/applied?filter=ALL&sort=SUBMITTED_DESC&cursor=opaque-page-two",
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const items = url.searchParams.has("cursor") ? [pageTwo] : [pageOne];
      return Response.json({
        applications: items,
        nextCursor: null,
        hasMore: false,
        total: 2,
        counts: {
          ALL: 2,
          APPLICATION_SUBMITTED: 1,
          UNDER_REVIEW: 1,
          INTERVIEW: 0,
          OUTCOME: 0,
          WITHDRAWN: 0,
        },
        filter: "ALL",
        sort: url.searchParams.get("sort") ?? "SUBMITTED_DESC",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateApplicationsListPage
        initialApplications={[pageTwo]}
        initialNextCursor={null}
        initialTotal={2}
        initialFilter="ALL"
        initialSort="SUBMITTED_DESC"
      />,
    );
    expect(screen.getByRole("heading", { name: "Role 25" })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event(NOTIFICATION_CHANGED_EVENT));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate/applications?limit=24&filter=ALL&sort=SUBMITTED_DESC&cursor=opaque-page-two",
        expect.objectContaining({ cache: "no-store" }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.history.pushState(
      null,
      "",
      "/jobs/applied?filter=ALL&sort=SUBMITTED_DESC",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Role 1" })).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    window.history.pushState(
      null,
      "",
      "/jobs/applied?filter=ALL&sort=SUBMITTED_DESC&cursor=opaque-page-two",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Role 25" })).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(window.location.search).toContain("cursor=opaque-page-two");
  });

  it("restarts at the first page when the active cursor is rejected", async () => {
    const pageOne = application("APPLIED", 1);
    const pageTwo = application("VIEWED", 25);
    window.history.replaceState(
      null,
      "",
      "/jobs/applied?filter=ALL&sort=SUBMITTED_DESC&cursor=opaque-expired",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { code: "APPLICATION_LIST_CURSOR_INVALID" },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          applications: [pageOne],
          nextCursor: null,
          hasMore: false,
          total: 2,
          counts: {
            ALL: 2,
            APPLICATION_SUBMITTED: 1,
            UNDER_REVIEW: 1,
            INTERVIEW: 0,
            OUTCOME: 0,
            WITHDRAWN: 0,
          },
          filter: "ALL",
          sort: "SUBMITTED_DESC",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateApplicationsListPage
        initialApplications={[pageTwo]}
        initialNextCursor={null}
        initialTotal={2}
      />,
    );
    window.dispatchEvent(new Event(NOTIFICATION_CHANGED_EVENT));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Role 1" })).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.location.search).not.toContain("cursor=");
  });
});
