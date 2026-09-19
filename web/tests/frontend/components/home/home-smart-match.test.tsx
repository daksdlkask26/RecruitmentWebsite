import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeSmartMatch } from "@/frontend/features/home/components/home-smart-match";
import {
  candidateViewer,
  homeModel,
  personalMatch,
} from "../../../helpers/home/home-fixtures";

describe("Home Smart Match", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders a non-numeric explainer when no actual result exists", () => {
    const { container } = render(
      <HomeSmartMatch model={homeModel()} locale="en" />,
    );

    expect(screen.getByText("AI Smart Match")).toBeInTheDocument();
    expect(
      screen.getByText("This example does not use your profile or a live job."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse opportunities" }),
    ).toHaveAttribute("href", "/jobs");
    expect(container.querySelector(".home-match-score-progress")).toBeNull();
    expect(container.querySelector(".home-match-connectors")).toBeNull();
    expect(container.textContent).not.toContain("82%");
  });

  it("renders an actual score with source semantics when personal data exists", () => {
    const match = personalMatch({ score: 75 });
    render(
      <HomeSmartMatch
        model={homeModel({ viewer: candidateViewer, match })}
        locale="en"
      />,
    );

    expect(screen.getByText(match.jobTitle)).toBeInTheDocument();
    expect(screen.getByText("Profile estimate")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /75%.*available/u }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Minh Anh")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /82%/u })).toBeNull();
  });

  it("does not render a ring or band for an incomplete CV result", () => {
    const match = personalMatch({
      score: null,
      presentationState: "INCOMPLETE",
      scoreEligible: false,
      scoreSource: "cv",
      completeness: "INCOMPLETE",
      cvMatch: {
        checkId: "pmc_incomplete",
        cvVersion: 2,
        jdVersion: 3,
        completeness: "INCOMPLETE",
        presentationState: "INCOMPLETE",
        scoreEligible: false,
      },
    });
    const { container } = render(
      <HomeSmartMatch
        model={homeModel({ viewer: candidateViewer, match })}
        locale="en"
      />,
    );

    expect(container.querySelector(".home-match-score-progress")).toBeNull();
    expect(container.querySelector(".home-match-stackbar")).toBeNull();
    expect(screen.queryByRole("img", { name: /%/u })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Review match report" }),
    ).toHaveAttribute("href", "/cv-match-check/pmc_incomplete");
  });
});
