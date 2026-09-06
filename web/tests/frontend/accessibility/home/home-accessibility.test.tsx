import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  candidateViewer,
  employerViewer,
  homeModel,
  personalMatch,
} from "../../../helpers/home/home-fixtures";
import { HomeTestHarness } from "../../../helpers/home/home-test-harness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("Home accessibility", () => {
  it.each([
    ["guest", homeModel()],
    [
      "candidate personal match",
      homeModel({
        viewer: candidateViewer,
        match: personalMatch(),
        jobs: [{ ...homeModel().jobs.items[0], matchScore: 75 }],
      }),
    ],
    ["employer", homeModel({ viewer: employerViewer })],
    [
      "independent states",
      {
        ...homeModel(),
        jobs: { status: "error", items: [], recovery: { kind: "reloadHome" } },
        spotlights: { status: "loading", items: [] },
      },
    ],
  ] as const)(
    "has landmarks, labelled controls, headings, and no serious axe violations for %s",
    async (_name, model) => {
      const { container } = render(
        <HomeTestHarness model={model as never} />,
      );
      const axe = (await import("axe-core")).default;
      const result = await axe.run(container);
      expect(
        result.violations.filter((item) =>
          ["serious", "critical"].includes(item.impact ?? ""),
        ),
      ).toEqual([]);
      expect(container.querySelector("main")).toBeInTheDocument();
      expect(container.querySelector("header")).toBeInTheDocument();
      expect(container.querySelector("footer")).toBeInTheDocument();
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      expect(
        container.querySelectorAll("label input, label select"),
      ).toHaveLength(3);
    },
  );
});
