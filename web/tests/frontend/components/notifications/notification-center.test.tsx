import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "@/frontend/features/notifications/components/notification-center";
import { AppProviders } from "@/frontend/providers/app-providers";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const item = {
  id: "notification-1",
  kind: "PASSWORD_CHANGED",
  category: "SECURITY",
  severity: "HIGH",
  title: "Password changed",
  summary: "Your SmartHire password was changed.",
  href: "/profile/security",
  contextType: "ACCOUNT",
  contextId: "user-1",
  occurrenceCount: 1,
  readAt: null,
  createdAt: "2026-08-14T00:00:00.000Z",
  lastOccurredAt: "2026-08-14T00:00:00.000Z",
  expiresAt: "2026-11-12T00:00:00.000Z",
};

describe("notification center", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        if (url.includes("unread-count"))
          return Response.json({
            unreadCount: 1,
            observedAt: "2026-08-14T00:00:01.000Z",
          });
        if (url.includes("/read"))
          return Response.json({
            changedCount: 1,
            unreadCount: 0,
            observedAt: "2026-08-14T00:00:02.000Z",
          });
        if (url.includes("/api/notifications?"))
          return Response.json({
            items: [item],
            nextCursor: null,
            unreadCount: 1,
            observedAt: "2026-08-14T00:00:01.000Z",
          });
        throw new Error(`Unexpected request ${url} ${init?.method ?? "GET"}`);
      }),
    );
  });

  it("shows unread count, loads the panel, marks read, and navigates", async () => {
    render(
      <AppProviders>
        <NotificationCenter csrfProof="proof" locale="en" />
      </AppProviders>,
    );
    const bell = await screen.findByRole("button", {
      name: /notifications: 1 unread/i,
    });
    fireEvent.click(bell);
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Password changed"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/profile/security"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/notifications/notification-1/read",
      expect.objectContaining({
        method: "PATCH",
        headers: { "x-csrf-token": "proof" },
      }),
    );
  });

  it("provides explicit severity and read labels instead of color only", async () => {
    render(
      <AppProviders>
        <NotificationCenter csrfProof="proof" locale="en" />
      </AppProviders>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /notifications/i }),
    );
    expect(await screen.findByText("Important")).toBeInTheDocument();
    expect(screen.getByText("Unread")).toBeInTheDocument();
  });
});
