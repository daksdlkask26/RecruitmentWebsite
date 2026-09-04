import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { savedFilterPresetSchema } from "@/shared/contracts/jobs/catalog";
import { SavedSearchVersionNotice } from "@/frontend/features/jobs/components/saved-search-version-notice";

const preset = savedFilterPresetSchema.parse({
  id: "saved-search-1",
  name: "Remote accountant",
  filters: { q: "accountant remote" },
  q: "accountant remote",
  searchMode: "SMART",
  resolverVersion: "resolver-v1",
  catalogVersion: "catalog-v1",
});

describe("saved search version notice", () => {
  it("explains when a saved search was re-resolved against an older context", () => {
    render(
      <SavedSearchVersionNotice
        preset={preset}
        metadata={{
          resolverVersion: "resolver-v1",
          catalogVersion: "catalog-v2",
        }}
        locale="en"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /older resolver or catalog/i,
    );
  });

  it("stays quiet for a current versioned search", () => {
    const { container } = render(
      <SavedSearchVersionNotice
        preset={preset}
        metadata={{
          resolverVersion: "resolver-v1",
          catalogVersion: "catalog-v1",
        }}
        locale="en"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
