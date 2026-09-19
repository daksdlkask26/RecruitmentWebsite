import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { PrivateMatchReady } from "@/frontend/features/private-cv-match/components/private-match-ready";
import { PrivateMatchReport } from "@/frontend/features/private-cv-match/components/private-match-report";
import { WorkspaceLocaleProvider } from "@/frontend/features/dashboard/client/workspace-locale";
import type {
  FullPrivateReport,
  LimitedPrivateReport,
  PrivateAutomaticComponent,
} from "@/shared/contracts/private-cv-match";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock(
  "@/frontend/features/private-cv-match/components/private-match-delete-control",
  () => ({
    PrivateMatchDeleteControl: () => (
      <button type="button">Delete this preview</button>
    ),
  }),
);

const base = {
  checkId: "check-1",
  createdAt: "2026-08-16T00:00:00.000Z",
  expiresAt: "2027-08-16T00:00:00.000Z",
  inputSource: "CV" as const,
  completeness: "AVAILABLE" as const,
  presentationState: "AVAILABLE" as const,
  scoreEligible: true,
  provenance: {
    inputSource: "CV" as const,
    completeness: "AVAILABLE" as const,
    presentationState: "AVAILABLE" as const,
    scoreEligible: true,
    cvVersionId: "cv-1",
    cvVersion: 2,
    jdVersion: 4,
    scoringConfigVersion: "HS-40/60-v1",
    aiProvider: "openai",
    aiModel: "gpt-5.4-mini-2026-03-17",
    promptVersion: "private-match-v1",
    inputPolicyVersion: "cv-safe-v1",
  },
  job: {
    jobId: "job-1",
    slug: "senior-platform-engineer",
    title: "Senior Platform Engineer",
    company: "SmartHire",
    location: "Remote",
    employmentType: "FULL_TIME",
    workArrangement: "REMOTE",
    requiredExperienceYears: 4,
    requirements: ["Kafka", "TypeScript"] as string[],
    jdVersion: 4,
    jdUpdatedAt: "2026-08-15T00:00:00.000Z",
  },
  cv: {
    versionId: "cv-1",
    version: 2,
    displayName: "Platform CV",
    fileName: "platform-cv.pdf",
    mimeType: "application/pdf" as const,
    byteSize: 240_000,
    pageCount: 3,
    parseStatus: "READY" as const,
    confirmedAt: "2026-08-16T00:00:00.000Z",
  },
};

const automatic: PrivateAutomaticComponent = {
  score: 92,
  weight: 0.4,
  weightedContribution: 36.8,
  evidenceCoverage: 82,
  evidenceConfidence: 88,
  matchedRequirements: [
    { id: "typescript", label: "TypeScript", kind: "REQUIRED", matched: true },
    { id: "kafka", label: "Kafka", kind: "REQUIRED", matched: false },
    {
      id: "observability",
      label: "Observability",
      kind: "PREFERRED",
      matched: true,
    },
  ],
  gaps: [
    {
      code: "kafka",
      title: "Kafka — missing",
      description: "Add or verify direct Kafka evidence before applying.",
      kind: "REQUIRED",
    },
  ],
  requiredExperience: 4,
  detectedExperience: 5,
  evidence: [
    {
      type: "PROJECT",
      quote: "Built a platform service used by multiple teams.",
      criterion: "Platform delivery",
      location: "Projects · Page 1",
      confidence: 0.92,
    },
    {
      type: "IMPACT",
      quote: "Reduced deployment time by 40%.",
      criterion: "Operational impact",
      location: "Experience · Page 2",
      confidence: 0.86,
    },
  ],
  parserProvenance: {
    parserVersion: "parser-v1",
    cvStatus: "READY",
    jdStatus: "READY",
  },
  mayBeIncomplete: false,
};

const fullReport: FullPrivateReport = {
  ...base,
  view: "FULL_REPORT",
  state: "READY",
  mode: "HYBRID",
  hybridScore: 83.6,
  matchBand: "HIGH_MATCH",
  automatic,
  aiEvaluation: {
    score: 78,
    weight: 0.6,
    weightedContribution: 46.8,
    summary: "Your strongest evidence is in platform delivery.",
    strengths: [],
    mainGap: "Verify Kafka experience.",
    actions: ["Kafka: Add a concrete project example."],
    evidenceConfidence: 80,
    evidenceLevel: "HIGH",
    provider: "openai",
    model: "gpt-5.4-mini-2026-03-17",
    promptVersion: "private-match-v1",
    policyVersion: "policy-v1",
    durationMs: 1_200,
    completedAt: "2026-08-16T00:00:12.000Z",
  },
  evidenceConfidence: 84,
  summary: "You have strong evidence for most of the core requirements.",
  actions: ["Kafka: Add a concrete project example."],
  canApply: true,
  completedAt: "2026-08-16T00:00:12.000Z",
  retryInProgress: false,
};

const limitedReport: LimitedPrivateReport = {
  ...base,
  view: "LIMITED_REPORT",
  state: "LIMITED",
  mode: "LIMITED",
  automatic,
  aiEvaluation: null,
  hybridScore: null,
  matchBand: null,
  canRetryAi: true,
  canApply: true,
  retryInProgress: false,
  completedAt: "2026-08-16T00:00:12.000Z",
  failureCode: "AI_UNAVAILABLE",
};

describe("PrivateMatchReport", () => {
  it("uses the shared completion status and selected-job display mapping", () => {
    render(<PrivateMatchReady report={fullReport} onOpen={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveClass(
      "private-match-status-card",
      "private-match-status-card--completed",
    );
    expect(screen.getByText("Full-time")).toBeVisible();
    expect(screen.getByText("4+ years")).toBeVisible();
    expect(screen.queryByText("FULL_TIME")).not.toBeInTheDocument();
    expect(screen.getByText("Private and fair by design")).toBeVisible();
  });

  it("uses the locale selected in the workspace", () => {
    render(
      <WorkspaceLocaleProvider initialLocale="vi">
        <PrivateMatchReport checkId="check-1" report={fullReport} />
      </WorkspaceLocaleProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Báo cáo đối chiếu CV riêng tư" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Ứng tuyển ngay" })).toBeVisible();
    expect(screen.getByText("Đánh giá AI")).toBeVisible();
  });

  it("uses the caution treatment for a low match band", () => {
    const lowReport: FullPrivateReport = {
      ...fullReport,
      hybridScore: 42.1,
      matchBand: "LOW_MATCH",
    };

    render(<PrivateMatchReady report={lowReport} onOpen={vi.fn()} />);

    expect(
      document.querySelector(
        ".private-match-ready-banner.is-caution .private-match-hero-icon",
      ),
    ).toBeTruthy();
    expect(screen.getByText("More evidence to review")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Review missing evidence before you apply",
      }),
    ).toBeVisible();
  });

  it("keeps normal header content in structured cards and stacks evidence", () => {
    render(<PrivateMatchReport checkId="check-1" report={fullReport} />);

    expect(screen.getByText("Independent candidate preview")).toBeVisible();
    expect(
      document.querySelector(".pmr-score .private-match-badge"),
    ).toBeNull();
    expect(document.querySelector(".pmr-score")).toBeInTheDocument();
    expect(document.querySelector(".pmr-diagnostic")).toBeInTheDocument();
    expect(document.querySelectorAll(".pmr-metric")).toHaveLength(4);
    expect(document.querySelectorAll(".pmr-evidence-list > li")).toHaveLength(
      2,
    );
    expect(
      Array.from(
        document.querySelectorAll(".pmr-metric p"),
        (caption) => caption.textContent,
      ),
    ).toEqual([
      "Weighted contribution: 36.8",
      "Weighted contribution: 46.8",
      "Clear evidence for 2 of 3 checks",
      "Confidence is not part of the score",
    ]);
    expect(screen.getByText(/92 .* 40%.*78 .* 60%/u)).toBeVisible();
    expect(screen.getByText(/JD v4.*CV v2.*HS-40\/60-v1/u)).toBeVisible();
    expect(screen.getByText("Project")).toBeVisible();
    expect(screen.getByText("Impact")).toBeVisible();
    expect(screen.getByText("Kafka", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("Add a concrete project example.")).toBeVisible();
  });

  it("allows a completed hybrid report to start a fresh AI evaluation", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <PrivateMatchReport
        checkId="check-1"
        report={fullReport}
        onRetry={onRetry}
      />,
    );

    const retryButton = screen.getByRole("button", {
      name: "Re-run AI evaluation",
    });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(
      <PrivateMatchReport
        checkId="check-1"
        report={{ ...fullReport, retryInProgress: true }}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Re-running..." }),
    ).toBeDisabled();
  });

  it("renders limited mode as deterministic-only throughout the report", () => {
    render(
      <PrivateMatchReport
        checkId="check-1"
        report={limitedReport}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("DETERMINISTIC MATCH")).toBeVisible();
    expect(screen.getByText("Reduced-capability preview")).toBeVisible();
    expect(screen.getByText("AI evaluation unavailable")).toBeVisible();
    expect(
      document.querySelector(".pmr-hero.is-limited .pmr-score"),
    ).toBeTruthy();
    expect(document.querySelector(".pmr-calc-card.is-limited")).toBeTruthy();
    expect(
      document.querySelector(".pmr-metric.is-unavailable"),
    ).toHaveTextContent("—");
    expect(screen.getByText("Hybrid score unavailable")).toBeVisible();
    expect(screen.getByText("Final score: not calculated")).toBeVisible();
    expect(screen.getByRole("button", { name: /Retry AI/u })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Delete this preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Sensitive personal attributes are excluded."),
    ).toBeVisible();
    expect(
      Array.from(
        document.querySelectorAll(".pmr-metric p"),
        (caption) => caption.textContent,
      ),
    ).toEqual([
      "Available deterministic component",
      "AI contribution unavailable",
      "Clear evidence for 2 of 3 checks",
      "Confidence is not part of the score",
    ]);
    expect(screen.queryByText("Strong match")).not.toBeInTheDocument();
  });

  it("keeps the evidence section intact when no bounded quotes are available", () => {
    const emptyReport: FullPrivateReport = {
      ...fullReport,
      automatic: { ...fullReport.automatic, evidence: [] },
    };

    render(<PrivateMatchReport checkId="check-1" report={emptyReport} />);

    const evidenceHeading = screen.getByRole("heading", {
      name: "Evidence found in your CV",
    });
    expect(evidenceHeading).toBeVisible();
    expect(evidenceHeading.querySelector("svg")).not.toBeNull();
    expect(
      screen.getByText("No bounded evidence quotes are available."),
    ).toBeVisible();
  });
});
