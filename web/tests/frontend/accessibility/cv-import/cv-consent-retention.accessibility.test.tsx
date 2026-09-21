import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CvProcessingConsent } from "@/frontend/features/cv-import/components/cv-processing-consent";
import { CvRetentionActions } from "@/frontend/features/cv-import/components/cv-retention-actions";
import { CV_EXTERNAL_CONSENT_NOTICE_TEXT } from "@/shared/contracts/cv-import/consent-retention";

const challenge =
  "eyJ1IjoidXBsb2FkX2FjY2Vzc2liaWxpdHkiLCJlIjoxNzg1NjMwMDAwfQ.signature_accessibility_123456789012345";

describe("CV consent and retention accessibility", () => {
  it("uses labelled native consent controls and announces persistent effects", async () => {
    const onGrant = vi.fn(async () => undefined);
    render(
      <CvProcessingConsent
        notice={{
          required: true,
          granted: false,
          providerDisplayName: "OpenAI",
          processingPurpose: "Create a private CV review draft",
          noticeText: CV_EXTERNAL_CONSENT_NOTICE_TEXT,
          consentChallenge: challenge,
        }}
        canGrant
        canRevoke={false}
        onGrant={onGrant}
        onRevoke={vi.fn()}
      />,
    );
    const root = screen.getByTestId("cv-processing-consent");
    expect(root).toHaveAttribute("data-narrow-layout", "320");
    expect(root).toHaveAttribute("data-reduced-motion-safe", "true");
    const checkbox = screen.getByRole("checkbox", {
      name: CV_EXTERNAL_CONSENT_NOTICE_TEXT,
    });
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: " " });
    fireEvent.click(checkbox);
    const grant = screen.getByRole("button", {
      name: /grant external processing consent/i,
    });
    grant.focus();
    fireEvent.keyDown(grant, { key: "Enter" });
    fireEvent.click(grant);
    await waitFor(() => expect(onGrant).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
  });

  it("focuses and traps destructive confirmation, supports Escape, and restores the trigger", async () => {
    render(
      <CvRetentionActions
        resource={{
          uploadId: "upload_retention_accessibility_1234",
          status: "PARSING",
          expiresAt: "2026-09-01T00:00:00.000Z",
          contentInaccessibleAt: null,
          deleteAfter: null,
          deletedAt: null,
        }}
        canDelete
        onDelete={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /cancel and delete this cv import/i,
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /keep/i })).toHaveFocus(),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("owns 320px, focus, error, dialog, and reduced-motion presentation", async () => {
    for (const basename of ["cv-processing-consent", "cv-retention-actions"]) {
      const css = await readFile(
        resolve(
          process.cwd(),
          `src/frontend/features/cv-import/components/${basename}.module.css`,
        ),
        "utf8",
      );
      expect(css).toMatch(/@media\s*\(max-width:\s*32rem\)/u);
      expect(css).toMatch(/focus-visible/u);
      expect(css).toMatch(/prefers-reduced-motion/u);
      expect(css).not.toMatch(/:global/u);
    }
  });
});
