import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobApplicationForm } from "@/frontend/features/jobs/components/job-application-form";

const form = {
  jobId: "job-1",
  jobTitle: "Engineer",
  jobLocation: "TP Hồ Chí Minh",
  companyName: "Company",
  profileReady: true,
  missingProfileFields: [],
  profileRevision: 1,
  profileBasics: {
    headline: "Engineer",
    summary: null,
    phone: null,
    location: "TP Hồ Chí Minh",
  },
  cvs: [
    {
      id: "cv-1",
      displayName: "Main CV",
      fileName: "cv.pdf",
      mimeType: "application/pdf" as const,
      byteSize: 1000,
      version: 1,
      confirmedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
  questions: [
    {
      id: "q-1",
      prompt: "Experience?",
      description: null,
      kind: "TEXT" as const,
      required: true,
      options: null,
      version: 1,
    },
  ],
  consentVersion: "2026-08-01",
  csrfToken: "csrf-proof",
};

describe("job application form", () => {
  it("explains why a temporary CV import cannot be selected for an application", () => {
    render(
      <JobApplicationForm
        form={{ ...form, cvs: [] }}
        onCancel={() => undefined}
        onSubmitted={() => undefined}
      />,
    );

    const select = screen.getByLabelText(/select a cv from profile/i);
    expect(select).toBeDisabled();
    expect(select).toHaveAccessibleDescription(/temporary source file/i);
    expect(
      screen.getByRole("button", { name: /submit application/i }),
    ).toBeDisabled();
  });

  it("labels CV, answers, cover letter, consent, and pending submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        applicationId: "app-1",
        jobId: "job-1",
        stage: "APPLIED",
        submittedAt: "2026-08-01T00:00:00.000Z",
        created: true,
        message: "Application submitted.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <JobApplicationForm
        form={form}
        onCancel={() => undefined}
        onSubmitted={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: /submit application/i }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/select a cv from profile/i), {
      target: { value: "cv-1" },
    });
    expect(
      screen.getByRole("button", { name: /submit application/i }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/experience/i), {
      target: { value: "Five years" },
    });
    fireEvent.click(screen.getByLabelText(/i consent/i));
    fireEvent.click(
      screen.getByRole("button", { name: /submit application/i }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("csrf-proof");
    expect(JSON.parse(String(init.body))).toMatchObject({ cvId: "cv-1" });
    expect(screen.getByRole("status")).toHaveTextContent(/submitted/i);
    vi.unstubAllGlobals();
  });

  it("retries an unchanged application after refreshing a rotated proof", async () => {
    const outcome = {
      applicationId: "app-1",
      jobId: "job-1",
      stage: "APPLIED",
      submittedAt: "2026-08-01T00:00:00.000Z",
      created: true,
      message: "Application submitted.",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ csrfProof: "rotated-proof" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => outcome,
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <JobApplicationForm
        form={form}
        onCancel={() => undefined}
        onSubmitted={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText(/select a cv from profile/i), {
      target: { value: "cv-1" },
    });
    fireEvent.change(screen.getByLabelText(/experience/i), {
      target: { value: "Five years" },
    });
    fireEvent.click(screen.getByLabelText(/i consent/i));
    fireEvent.click(
      screen.getByRole("button", { name: /submit application/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/submitted/i),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const retryInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(firstInit.body).toBe(retryInit.body);
    expect(new Headers(firstInit.headers).get("idempotency-key")).toBe(
      new Headers(retryInit.headers).get("idempotency-key"),
    );
    expect(new Headers(retryInit.headers).get("x-csrf-token")).toBe(
      "rotated-proof",
    );
    vi.unstubAllGlobals();
  });

  it("uses a fresh idempotency key after the candidate edits a failed submission", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: "Review the application." }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          applicationId: "app-1",
          jobId: "job-1",
          stage: "APPLIED",
          submittedAt: "2026-08-01T00:00:00.000Z",
          created: true,
          message: "Application submitted.",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <JobApplicationForm
        form={form}
        onCancel={() => undefined}
        onSubmitted={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText(/select a cv from profile/i), {
      target: { value: "cv-1" },
    });
    fireEvent.change(screen.getByLabelText(/experience/i), {
      target: { value: "Four years" },
    });
    fireEvent.click(screen.getByLabelText(/i consent/i));
    fireEvent.click(
      screen.getByRole("button", { name: /submit application/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/review/i),
    );

    fireEvent.change(screen.getByLabelText(/experience/i), {
      target: { value: "Five years" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /submit application/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/submitted/i),
    );

    const firstHeaders = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).headers,
    );
    const secondHeaders = new Headers(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).headers,
    );
    expect(firstHeaders.get("idempotency-key")).not.toBe(
      secondHeaders.get("idempotency-key"),
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      cvId: "cv-1",
      answers: [{ questionId: "q-1", value: "Five years" }],
    });
    vi.unstubAllGlobals();
  });
});
