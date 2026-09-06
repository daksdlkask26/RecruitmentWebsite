import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CvImportList } from "@/frontend/features/cv-import/components/cv-import-list";
import { CvImportStatus } from "@/frontend/features/cv-import/components/cv-import-status";
import { CvProcessingNotice } from "@/frontend/features/cv-import/components/cv-processing-notice";
import { CvUploadForm } from "@/frontend/features/cv-import/components/cv-upload-form";
import { CV_PROCESSING_NOTICES } from "@/shared/contracts/cv-import/upload";

const navigation = vi.hoisted(() => ({
  prefetch: vi.fn(),
  replace: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

beforeEach(() => {
  navigation.prefetch.mockClear();
  navigation.replace.mockClear();
  toastError.mockReset();
});

afterEach(() => vi.useRealTimers());

describe("CV upload and authoritative status UI", () => {
  it("shows a versioned notice for each explicit parser choice", () => {
    const { rerender } = render(
      <CvProcessingNotice parserClass="DETERMINISTIC_INTERNAL" />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      CV_PROCESSING_NOTICES.DETERMINISTIC_INTERNAL.noticeText,
    );
    rerender(<CvProcessingNotice parserClass="EXTERNAL_OPENAI" />);
    expect(screen.getByRole("note")).toHaveTextContent(
      CV_PROCESSING_NOTICES.EXTERNAL_OPENAI.noticeText,
    );
    expect(screen.getByRole("note")).toHaveAttribute(
      "data-notice-version",
      CV_PROCESSING_NOTICES.EXTERNAL_OPENAI.noticeVersion,
    );
  });

  it("defers exact external consent to the server-bound status lifecycle", () => {
    render(<CvUploadForm csrfProof="csrf_fixture" onUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /external openai/i }));
    expect(screen.getByRole("note")).toHaveTextContent(
      /blocked until you separately consent/i,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload cv/i })).toBeEnabled();
  });

  it("defaults to the private parser and lets the candidate opt into external processing", () => {
    render(
      <CvUploadForm
        csrfProof="csrf_fixture"
        onUpload={vi.fn()}
        parserAvailability={{ deterministic: true, external: true }}
      />,
    );
    const external = screen.getByRole("radio", { name: /external openai/i });
    expect(external).toBeEnabled();
    const deterministic = screen.getByRole("radio", {
      name: /smarthire deterministic/i,
    });
    expect(deterministic).toBeChecked();
    fireEvent.click(external);
    expect(external).toBeChecked();
    expect(deterministic).not.toBeChecked();
  });

  it("validates exact type/5 MB, uploads by keyboard, and preserves text progress", async () => {
    const onUpload = vi.fn(async () => undefined);
    render(<CvUploadForm csrfProof="csrf_fixture" onUpload={onUpload} />);
    const input = screen.getByLabelText("CV file");
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(5_000_001)], "too-large.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("5MB");
    expect(toastError).toHaveBeenCalledWith("File size must not exceed 5MB.", {
      id: "candidate-cv-upload-error",
    });
    expect(input).toHaveFocus();

    fireEvent.change(input, {
      target: {
        files: [
          new File(["%PDF-synthetic"], "synthetic.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /synthetic\.pdf is ready/i,
      ),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /upload cv/i }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: /upload cv/i }));
    await waitFor(() => expect(onUpload).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent(/upload/i);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("renders list/empty/quota and persistent non-color status actions", () => {
    const { rerender } = render(<CvImportList items={[]} />);
    expect(screen.getByText(/no cv imports yet/i)).toBeVisible();
    rerender(
      <CvImportList
        items={[
          {
            uploadId: "upload_fixture_1234",
            displayFilename: "synthetic.pdf",
            documentKind: "PDF",
            parserClass: "DETERMINISTIC_INTERNAL",
            status: "SCAN_QUEUED",
            createdAt: "2026-08-01T00:00:00.000Z",
            expiresAt: "2026-08-31T00:00:00.000Z",
            confirmedAt: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("synthetic.pdf")).toBeVisible();
    expect(screen.getByRole("link", { name: /view status/i })).toHaveAttribute(
      "href",
      "/profile/cv-imports/upload_fixture_1234",
    );
    rerender(
      <CvImportStatus
        resource={{
          uploadId: "upload_fixture_1234",
          status: "SCAN_FAILED",
          stage: "SCAN",
          availableActions: ["RETRY", "DELETE", "MANUAL_PROFILE"],
          pollingAfterMs: 5_000,
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/scan failed/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /manual profile/i })).toBeVisible();
  });

  it("cleans status polling on unmount", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const loadStatus = vi.fn(async () => ({
      uploadId: "upload_fixture_1234",
      status: "SCANNING" as const,
      stage: "SCAN" as const,
      availableActions: [],
      pollingAfterMs: 50,
    }));
    const { unmount } = render(
      <CvImportStatus resource={await loadStatus()} loadStatus={loadStatus} />,
    );
    unmount();
    expect(clear).toHaveBeenCalled();
  });

  it("keeps polling successful responses and lets the candidate open a ready draft", async () => {
    vi.useFakeTimers();
    const loadStatus = vi
      .fn()
      .mockResolvedValueOnce({
        uploadId: "upload_polling_1234",
        parserClass: "EXTERNAL_OPENAI" as const,
        status: "PARSING" as const,
        stage: "PARSE" as const,
        availableActions: [],
        pollingAfterMs: 50,
      })
      .mockResolvedValueOnce({
        uploadId: "upload_polling_1234",
        parserClass: "EXTERNAL_OPENAI" as const,
        status: "REVIEW_READY" as const,
        stage: "REVIEW" as const,
        availableActions: ["REVIEW"],
        pollingAfterMs: null,
        draft: {
          draftId: "draft_polling_1234",
          revision: 1,
          reviewUrl: "/profile/cv-imports/upload_polling_1234/review",
        },
      });
    render(
      <CvImportStatus
        resource={{
          uploadId: "upload_polling_1234",
          parserClass: "EXTERNAL_OPENAI",
          status: "PARSE_QUEUED",
          stage: "PARSE",
          availableActions: [],
          pollingAfterMs: 50,
        }}
        loadStatus={loadStatus}
      />,
    );

    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("openai-status")).toHaveTextContent(
      /api request is running/i,
    );

    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(loadStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("openai-status")).toHaveAttribute(
      "data-tone",
      "success",
    );

    expect(screen.getByRole("link", { name: /review draft/i })).toHaveAttribute(
      "href",
      "/profile/cv-imports/upload_polling_1234/review",
    );
    await act(async () => vi.advanceTimersByTimeAsync(320));
    expect(navigation.prefetch).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("keeps a confirmed import on the status route and renders its completed state", () => {
    render(
      <CvImportStatus
        resource={{
          uploadId: "upload_confirmed_1234",
          parserClass: "EXTERNAL_OPENAI",
          status: "CONFIRMED",
          stage: "COMPLETE",
          availableActions: [],
          pollingAfterMs: null,
        }}
      />,
    );
    expect(screen.getByTestId("openai-status")).toHaveAttribute(
      "data-tone",
      "success",
    );
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("transitions OpenAI status through consent, pending, API work, success, and safe error", () => {
    const base = {
      uploadId: "upload_fixture_1234",
      parserClass: "EXTERNAL_OPENAI" as const,
      availableActions: [] as const,
      pollingAfterMs: null,
    };
    const { rerender } = render(
      <CvImportStatus
        resource={{
          ...base,
          status: "AWAITING_CONSENT",
          stage: "CONSENT",
        }}
      />,
    );
    expect(screen.getByTestId("openai-status")).toHaveAttribute(
      "data-tone",
      "pending",
    );
    expect(screen.getByTestId("openai-status")).toHaveTextContent(
      /no cv text has been sent/i,
    );

    rerender(
      <CvImportStatus
        key="queued"
        resource={{ ...base, status: "PARSE_QUEUED", stage: "PARSE" }}
      />,
    );
    expect(screen.getByTestId("openai-status")).toHaveTextContent(/queued/i);

    rerender(
      <CvImportStatus
        key="parsing"
        resource={{ ...base, status: "PARSING", stage: "PARSE" }}
      />,
    );
    expect(screen.getByTestId("openai-status")).toHaveAttribute(
      "data-tone",
      "processing",
    );
    expect(screen.getByTestId("openai-status")).toHaveTextContent(
      /api request is running/i,
    );

    rerender(
      <CvImportStatus
        key="success"
        resource={{
          ...base,
          status: "REVIEW_READY",
          stage: "REVIEW",
          availableActions: ["REVIEW"],
        }}
      />,
    );
    expect(screen.getByTestId("openai-status")).toHaveAttribute(
      "data-tone",
      "success",
    );
    expect(screen.getByRole("link", { name: /review draft/i })).toBeVisible();

    rerender(
      <CvImportStatus
        key="failed"
        resource={{
          ...base,
          status: "PARSE_FAILED",
          stage: "TERMINAL",
          scanRetriesRemaining: 2,
          parseRetriesRemaining: 1,
          failure: {
            code: "PARSER_TIMEOUT",
            message: "Processing could not finish safely.",
            retryable: true,
            suggestedActions: ["RETRY", "MANUAL_PROFILE", "DELETE"],
          },
        }}
      />,
    );
    expect(screen.getByTestId("openai-status")).toHaveAttribute(
      "data-tone",
      "error",
    );
    expect(screen.getByTestId("openai-status")).toHaveTextContent(
      /parser_timeout/i,
    );
    expect(screen.getByText(/failed: parse/i).closest("li")).toHaveAttribute(
      "data-state",
      "error",
    );
  });
});
