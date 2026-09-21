import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportJobDialog } from "@/frontend/features/jobs/components/report-job-dialog";

afterEach(() => vi.unstubAllGlobals());

describe("report job dialog", () => {
  it("keeps invalid content, explains conditional details, and supports cancel", async () => {
    render(<ReportJobDialog jobId="job-1" />);
    const trigger = screen.getByRole("button", { name: /report this job/i });
    fireEvent.click(trigger);
    expect(
      screen.getByRole("dialog", { name: /report this job/i }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "OTHER" },
    });
    fireEvent.change(screen.getByLabelText(/details/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /review the report fields/i,
    );
    expect(screen.getByLabelText(/details/i)).toHaveValue("short");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("submits with CSRF, shows neutral success, and restores trigger focus", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfProof: "csrf-proof" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          received: true,
          duplicate: true,
          message: "Thanks. Your concern was received for review.",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportJobDialog jobId="job-1" />);
    const trigger = screen.getByRole("button", { name: /report this job/i });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "FRAUD" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      /report submitted/i,
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/jobs/job-1/reports",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-proof",
        },
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
