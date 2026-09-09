import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { CvConfirmationReceipt } from "@/frontend/features/cv-import/components/cv-confirmation-receipt";
import { CvDraftReview } from "@/frontend/features/cv-import/components/cv-draft-review";
import { CvFailureRecovery } from "@/frontend/features/cv-import/components/cv-failure-recovery";
import { CvImportList } from "@/frontend/features/cv-import/components/cv-import-list";
import { CvImportStatus } from "@/frontend/features/cv-import/components/cv-import-status";
import { CvReviewConflictPanel } from "@/frontend/features/cv-import/components/cv-review-conflict";
import { WorkspaceLocaleProvider } from "@/frontend/features/dashboard/client/workspace-locale";
import { CV_EXTERNAL_CONSENT_NOTICE_TEXT } from "@/shared/contracts/cv-import/consent-retention";
import { cvCopy } from "@/frontend/features/cv-import/i18n/cv-import-copy";
import {
  cvConfirmationReceiptFixture,
  cvDraftReviewFixture,
} from "../../../fixtures/cv-draft-review";

const navigation = vi.hoisted(() => ({
  prefetch: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const componentRoot = resolve(
  process.cwd(),
  "src/frontend/features/cv-import/components",
);
const consentChallenge =
  "eyJ1IjoidXBsb2FkX3dvcmtmbG93X2F4ZSIsImUiOjE3ODU2MzAwMDB9.signature_workflow_accessibility_123456789";

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const result = await axe.run(container, {
    rules: {
      // jsdom has no layout/paint engine; reviewed numeric contrast is asserted
      // separately below instead of accepting axe's incomplete result.
      "color-contrast": { enabled: false },
    },
  });
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

function expectKeyboardReachable(container: HTMLElement): void {
  const controls = Array.from(
    container.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
    ),
  );
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    control.focus();
    expect(control).toHaveFocus();
    expect(control.tabIndex).toBeGreaterThanOrEqual(0);
  }
}

function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

function luminance(hex: string): number {
  const weights = [0.2126, 0.7152, 0.0722];
  return rgb(hex)
    .map((component) => component / 255)
    .map((component) =>
      component <= 0.03928
        ? component / 12.92
        : ((component + 0.055) / 1.055) ** 2.4,
    )
    .reduce((total, component, index) => total + component * weights[index], 0);
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("CV import cross-state accessibility workflow", () => {
  it("passes axe and keyboard checks for import list, active status, consent, and delete states", async () => {
    const list = render(
      <main>
        <h1>CV imports</h1>
        <CvImportList
          items={[
            {
              uploadId: "workflow-list-upload-1234",
              displayFilename: "synthetic-accessibility.pdf",
              documentKind: "PDF",
              parserClass: "DETERMINISTIC_INTERNAL",
              status: "SCAN_QUEUED",
              createdAt: "2026-08-01T00:00:00.000Z",
              expiresAt: "2026-08-31T00:00:00.000Z",
              confirmedAt: null,
            },
          ]}
        />
      </main>,
    );
    await expectNoAxeViolations(list.container);
    expectKeyboardReachable(list.container);
    list.unmount();

    const status = render(
      <main>
        <h1>CV import status</h1>
        <CvImportStatus
          csrfProof="csrf_workflow_accessibility"
          resource={{
            uploadId: "workflow-consent-upload-1234",
            status: "AWAITING_CONSENT",
            stage: "PARSE",
            availableActions: ["GRANT_CONSENT", "DELETE", "MANUAL_PROFILE"],
            pollingAfterMs: null,
            consent: {
              required: true,
              granted: false,
              providerDisplayName: "OpenAI",
              processingPurpose: "Create a private CV review draft",
              noticeText: CV_EXTERNAL_CONSENT_NOTICE_TEXT,
              consentChallenge,
            },
            expiresAt: "2026-09-01T00:00:00.000Z",
            contentInaccessibleAt: null,
            deleteAfter: null,
            deletedAt: null,
          }}
        />
      </main>,
    );
    await expectNoAxeViolations(status.container);
    expectKeyboardReachable(status.container);

    fireEvent.click(
      screen.getByRole("button", { name: /cancel and delete this cv import/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /confirm cancel and delete/i }),
      ).toHaveFocus(),
    );
    await expectNoAxeViolations(status.container);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    status.unmount();

    for (const tombstone of [
      {
        uploadId: "workflow-cancelled-upload-1234",
        status: "CANCELLED" as const,
        contentInaccessibleAt: "2026-08-02T00:00:00.000Z",
        deleteAfter: "2026-08-03T00:00:00.000Z",
        deletedAt: null,
      },
      {
        uploadId: "workflow-expired-upload-1234",
        status: "EXPIRED" as const,
        contentInaccessibleAt: "2026-08-02T00:00:00.000Z",
        deleteAfter: "2026-08-02T00:00:00.000Z",
        deletedAt: "2026-08-02T00:00:01.000Z",
      },
    ]) {
      const terminal = render(
        <main>
          <h1>CV import status</h1>
          <CvImportStatus resource={tombstone} />
        </main>,
      );
      await expectNoAxeViolations(terminal.container);
      expectKeyboardReachable(terminal.container);
      expect(
        screen.queryByLabelText("Processing timeline"),
      ).not.toBeInTheDocument();
      terminal.unmount();
    }
  });

  it("passes axe and keyboard checks for review and conflict states", async () => {
    const review = render(
      <main>
        <h1>Review CV suggestions</h1>
        <CvDraftReview
          initial={cvDraftReviewFixture}
          csrfProof="csrf_workflow_accessibility"
        />
      </main>,
    );
    await expectNoAxeViolations(review.container);
    expectKeyboardReachable(review.container);
    review.unmount();

    const conflict = render(
      <main>
        <h1>Review CV suggestions</h1>
        <CvReviewConflictPanel
          conflict={{
            code: "DRAFT_REVISION_CONFLICT",
            message: "A newer saved review is available.",
            latest: {
              draftRevision: 2,
              profileRevision: 4,
              draftUpdatedAt: "2026-08-02T00:00:00.000Z",
              profileUpdatedAt: "2026-08-02T00:00:00.000Z",
            },
          }}
          unsavedSummary="One proposed value remains unsaved."
          unsavedPreview={[
            {
              id: "headline",
              label: "Headline",
              value: "Synthetic platform engineer",
            },
          ]}
          latestCompared
          pending={false}
          onCompareLatest={vi.fn()}
          onReapplyLatest={vi.fn()}
          onDiscardAndReload={vi.fn()}
        />
      </main>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: /review conflict needs your choice/i,
        }),
      ).toHaveFocus(),
    );
    await expectNoAxeViolations(conflict.container);
    expectKeyboardReachable(conflict.container);
  });

  it("passes axe and keyboard checks for failure and confirmation receipt states", async () => {
    const failure = render(
      <main>
        <h1>CV import status</h1>
        <CvFailureRecovery
          resource={{
            uploadId: "workflow-failure-upload-1234",
            status: "SCAN_FAILED",
            availableActions: ["RETRY", "DELETE", "MANUAL_PROFILE"],
            scanRetriesRemaining: 2,
            parseRetriesRemaining: 2,
            failure: {
              code: "SCANNER_UNAVAILABLE",
              message:
                "Processing could not finish. Retry or update your Profile manually.",
              retryable: true,
              suggestedActions: ["RETRY", "MANUAL_PROFILE", "DELETE"],
            },
          }}
          retryAfterSeconds={0}
          onRetry={vi.fn(async () => undefined)}
          onDelete={vi.fn()}
        />
      </main>,
    );
    await expectNoAxeViolations(failure.container);
    expectKeyboardReachable(failure.container);
    failure.unmount();

    const receipt = render(
      <main>
        <h1>Import complete</h1>
        <CvConfirmationReceipt receipt={cvConfirmationReceiptFixture} />
      </main>,
    );
    await expectNoAxeViolations(receipt.container);
    expectKeyboardReachable(receipt.container);
  });

  it("verifies reviewed contrast plus 320px and reduced-motion ownership", async () => {
    for (const [foreground, background] of [
      ["#0f172a", "#ffffff"],
      ["#475569", "#ffffff"],
      ["#7f1d1d", "#fef2f2"],
      ["#713f12", "#ffffff"],
      ["#064e3b", "#ecfdf5"],
      ["#ffffff", "#b91c1c"],
    ]) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of ["#ffffff", "#fef2f2", "#ecfdf5"]) {
      expect(contrast("#1d4ed8", background)).toBeGreaterThanOrEqual(3);
    }

    const narrowOwners = [
      "cv-import-status",
      "cv-draft-review",
      "cv-collection-review",
      "cv-scalar-review",
      "cv-review-conflict",
      "cv-processing-consent",
      "cv-failure-recovery",
      "cv-confirmation-receipt",
      "cv-retention-actions",
    ];
    const narrowCss = await Promise.all(
      narrowOwners.map((name) =>
        readFile(resolve(componentRoot, `${name}.module.css`), "utf8"),
      ),
    );
    for (const css of narrowCss) {
      expect(css).toMatch(/@media\s*\(max-width:\s*32rem\)/u);
      expect(css).not.toContain(":global");
    }
    for (const name of [
      "cv-import-status",
      "cv-draft-review",
      "cv-collection-review",
      "cv-scalar-review",
      "cv-processing-consent",
      "cv-failure-recovery",
      "cv-retention-actions",
    ]) {
      const css = await readFile(
        resolve(componentRoot, `${name}.module.css`),
        "utf8",
      );
      expect(css).toMatch(/prefers-reduced-motion:\s*reduce/u);
    }
    const listCss = await readFile(
      resolve(componentRoot, "cv-import-list.module.css"),
      "utf8",
    );
    expect(listCss).toContain("min-width: 0");
    expect(listCss).toContain("overflow-wrap: anywhere");
  });

  it("covers the representative UI matrix without rerunning the CV pipeline", async () => {
    const originalWidth = window.innerWidth;
    const originalMatchMedia = window.matchMedia;
    const widths = [320, 375, 768, 1280] as const;
    const locales = ["en", "vi"] as const;
    const themes = ["light", "dark"] as const;
    const longUploadId = `matrix-${"x".repeat(68)}`;
    try {
      for (const width of widths) {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: width,
        });
        for (const theme of themes) {
          document.documentElement.dataset.theme = theme;
          document.documentElement.style.colorScheme = theme;
          for (const locale of locales) {
            Object.defineProperty(window, "matchMedia", {
              configurable: true,
              value: vi.fn((query: string) => ({
                matches: query.includes("prefers-reduced-motion"),
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(() => false),
              })),
            });
            const matrix = render(
              <WorkspaceLocaleProvider initialLocale={locale}>
                <main data-matrix-width={width} data-matrix-theme={theme}>
                  <h1>{cvCopy(locale).common.importHistory}</h1>
                  <CvImportStatus
                    csrfProof="csrf_matrix"
                    resource={{
                      uploadId: longUploadId,
                      status: "SCAN_FAILED",
                      stage: "SCAN",
                      availableActions: [
                        "RETRY",
                        "DELETE",
                        "MANUAL_PROFILE",
                      ],
                      pollingAfterMs: null,
                      scanRetriesRemaining: 2,
                      extractionRetriesRemaining: 2,
                      parseRetriesRemaining: 2,
                      failure: {
                        code: "SCANNER_UNAVAILABLE",
                        message: "Scanner unavailable.",
                        retryable: true,
                        suggestedActions: [
                          "RETRY",
                          "MANUAL_PROFILE",
                          "DELETE",
                        ],
                      },
                    }}
                  />
                  <CvDraftReview
                    initial={cvDraftReviewFixture}
                    csrfProof="csrf_matrix"
                  />
                  <CvReviewConflictPanel
                    conflict={{
                      code: "DRAFT_REVISION_CONFLICT",
                      message: "A newer saved review is available.",
                      latest: {
                        draftRevision: 2,
                        profileRevision: 4,
                        draftUpdatedAt: "2026-08-02T00:00:00.000Z",
                        profileUpdatedAt: "2026-08-02T00:00:00.000Z",
                      },
                    }}
                    unsavedSummary="One proposed value remains unsaved."
                    unsavedPreview={[
                      {
                        id: "headline",
                        label: "Headline",
                        value: "Synthetic platform engineer",
                      },
                    ]}
                    latestCompared
                    pending={false}
                    onCompareLatest={vi.fn()}
                    onReapplyLatest={vi.fn()}
                    onDiscardAndReload={vi.fn()}
                  />
                  <CvConfirmationReceipt
                    receipt={cvConfirmationReceiptFixture}
                  />
                </main>
              </WorkspaceLocaleProvider>,
            );
            expect(matrix.container.querySelector("main")).toHaveAttribute(
              "data-matrix-width",
              String(width),
            );
            expect(matrix.container.querySelector("main")).toHaveAttribute(
              "data-matrix-theme",
              theme,
            );
            await waitFor(() =>
              expect(document.documentElement.lang).toBe(locale),
            );
            await expectNoAxeViolations(matrix.container);
            expectKeyboardReachable(matrix.container);
            matrix.unmount();
          }
        }
      }
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = "";
    }
  });
});
