import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CvFailureRecovery } from "@/frontend/features/cv-import/components/cv-failure-recovery";
import {
  cvImportResourceSchema,
  type CvImportResource,
} from "@/shared/contracts/cv-import/upload";

function failureResource(
  input: Partial<CvImportResource> &
    Pick<CvImportResource, "status" | "failure">,
): CvImportResource {
  return cvImportResourceSchema.parse({
    uploadId: "upload_failure_fixture_1234",
    displayFilename: null,
    documentKind: "PDF",
    parserClass: "DETERMINISTIC_INTERNAL",
    stage: "TERMINAL",
    availableActions: ["DELETE", "MANUAL_PROFILE"],
    scanRetriesRemaining: 0,
    extractionRetriesRemaining: 0,
    parseRetriesRemaining: 0,
    createdAt: "2026-08-01T08:00:00.000Z",
    expiresAt: "2026-08-31T08:00:00.000Z",
    draft: null,
    processingNotice: {
      noticeVersion: "cv-processing.v1",
      noticeText: "Synthetic processing notice.",
      externalConsentRequiredFor: [],
    },
    consent: null,
    receipt: null,
    contentInaccessibleAt: null,
    deleteAfter: null,
    deletedAt: null,
    ...input,
  });
}

const scanFailure = failureResource({
  status: "SCAN_FAILED",
  availableActions: ["RETRY", "DELETE", "MANUAL_PROFILE"],
  scanRetriesRemaining: 2,
  failure: {
    code: "SCANNER_UNAVAILABLE",
    message:
      "Processing could not finish. You may retry or update your profile manually.",
    retryable: true,
    suggestedActions: ["RETRY", "MANUAL_PROFILE", "DELETE"],
  },
});

const parserFailure = failureResource({
  status: "PARSE_FAILED",
  availableActions: ["RETRY", "DELETE", "MANUAL_PROFILE"],
  parseRetriesRemaining: 1,
  failure: {
    code: "PARSER_TIMEOUT",
    message:
      "Processing could not finish. You may retry or update your profile manually.",
    retryable: true,
    suggestedActions: ["RETRY", "MANUAL_PROFILE", "DELETE"],
  },
});

const extractionFailure = failureResource({
  status: "EXTRACTION_FAILED",
  availableActions: ["RETRY", "DELETE", "MANUAL_PROFILE"],
  extractionRetriesRemaining: 1,
  failure: {
    code: "OCR_TIMEOUT",
    message:
      "Processing could not finish. You may retry or update your profile manually.",
    retryable: true,
    suggestedActions: ["RETRY", "MANUAL_PROFILE", "DELETE"],
  },
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CV failure recovery", () => {
  it.each([
    {
      label: "infected document",
      resource: failureResource({
        status: "INFECTED",
        failure: {
          code: "MALWARE_DETECTED",
          message: "This document could not continue through CV processing.",
          retryable: false,
          suggestedActions: ["REPLACE_DOCUMENT", "MANUAL_PROFILE", "DELETE"],
        },
      }),
      expectedCode: "MALWARE_DETECTED",
    },
    {
      label: "unsafe document structure",
      resource: failureResource({
        status: "VALIDATION_FAILED",
        failure: {
          code: "MALFORMED_DOCUMENT",
          message: "This document could not continue through CV processing.",
          retryable: false,
          suggestedActions: ["REPLACE_DOCUMENT", "MANUAL_PROFILE", "DELETE"],
        },
      }),
      expectedCode: "MALFORMED_DOCUMENT",
    },
    {
      label: "invalid parser output",
      resource: failureResource({
        status: "PARSE_FAILED",
        failure: {
          code: "PARSER_OUTPUT_INVALID",
          message: "This document could not continue through CV processing.",
          retryable: false,
          suggestedActions: ["REPLACE_DOCUMENT", "MANUAL_PROFILE", "DELETE"],
        },
      }),
      expectedCode: "PARSER_OUTPUT_INVALID",
    },
  ])("shows stable safe guidance for $label", ({ resource, expectedCode }) => {
    render(
      <CvFailureRecovery
        resource={resource}
        retryAfterSeconds={null}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      resource.failure!.message,
    );
    fireEvent.click(screen.getByText(/technical details/i));
    expect(screen.getByText(expectedCode)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /upload a replacement cv/i }),
    ).toHaveAttribute("href", "/profile/cv-imports");
    expect(
      screen.getByRole("link", { name: /enter.*profile manually/i }),
    ).toHaveAttribute("href", "/profile");
    expect(
      screen.getByRole("button", { name: /delete import/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("cv-failure-recovery")).not.toHaveTextContent(
      /administrator|operator|support ticket|dead[- ]?letter|dlq|clamd|openai|provider payload|request id/i,
    );
  });

  it("shows the correct retry counter and counts down before retry is available", () => {
    vi.useFakeTimers();
    render(
      <CvFailureRecovery
        resource={scanFailure}
        retryAfterSeconds={2}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/2 scan retries remaining/i)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      /retry available in 2 seconds/i,
    );
    expect(screen.getByRole("button", { name: /retry scan/i })).toBeDisabled();

    act(() => vi.advanceTimersByTime(2_000));

    expect(screen.getByRole("button", { name: /retry scan/i })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/retry is available/i);
  });

  it("uses a synchronous guard so a double submit creates one retry", async () => {
    let finishRetry: (() => void) | undefined;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRetry = resolve;
        }),
    );
    render(
      <CvFailureRecovery
        resource={parserFailure}
        retryAfterSeconds={0}
        onDelete={vi.fn()}
        onRetry={onRetry}
      />,
    );
    const retry = screen.getByRole("button", { name: /retry parsing/i });

    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(onRetry).toHaveBeenCalledOnce();
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/requesting retry/i);

    finishRetry?.();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/retry queued/i),
    );
  });

  it("offers an extraction retry with its own bounded counter", async () => {
    const onRetry = vi.fn(async () => undefined);
    render(
      <CvFailureRecovery
        resource={extractionFailure}
        retryAfterSeconds={null}
        onDelete={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/1 extraction retry remaining/i)).toBeVisible();
    const retry = screen.getByRole("button", { name: /retry extraction/i });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent(/retry queued/i);
  });

  it("removes retry at exhaustion while preserving candidate-owned recovery", () => {
    const exhausted = failureResource({
      status: "PARSE_FAILED",
      availableActions: ["DELETE", "MANUAL_PROFILE"],
      parseRetriesRemaining: 0,
      failure: {
        code: "RETRY_LIMIT_REACHED",
        message: "This document could not continue through CV processing.",
        retryable: false,
        suggestedActions: ["REPLACE_DOCUMENT", "MANUAL_PROFILE", "DELETE"],
      },
    });
    const onDelete = vi.fn(async () => undefined);
    render(
      <CvFailureRecovery
        resource={exhausted}
        retryAfterSeconds={null}
        onDelete={onDelete}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/no parsing retries remaining/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /enter.*profile manually/i }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /delete import/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
