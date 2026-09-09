import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceLocaleProvider } from "@/frontend/features/dashboard/client/workspace-locale";
import { CompanySettingsScreen } from "@/frontend/features/recruiter-workspace/company-settings-screen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/frontend/features/authentication/client/csrf-proof-context", () => ({
  useCsrfProof: () => "csrf-accessibility-proof",
}));

describe("company deletion receipt accessibility", () => {
  it.each(["en", "vi"] as const)(
    "keeps the durable %s receipt keyboard reachable and axe-clean",
    async (locale) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            requestId: "request-accessibility",
            status: "COMPLETED",
          }),
        }),
      );
      const { container, unmount } = render(
        <WorkspaceLocaleProvider initialLocale={locale}>
          <CompanySettingsScreen
            initialCompany={null}
            initialCompanies={[]}
            initialDeletionRequestId="request-accessibility"
          />
        </WorkspaceLocaleProvider>,
      );

      const receipt = await screen.findByTestId("company-deletion-receipt");
      const reload = receipt.querySelector<HTMLButtonElement>("button");
      expect(reload).not.toBeNull();
      reload?.focus();
      expect(reload).toHaveFocus();

      const result = await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations).toEqual([]);
      unmount();
      vi.unstubAllGlobals();
    },
  );
});
