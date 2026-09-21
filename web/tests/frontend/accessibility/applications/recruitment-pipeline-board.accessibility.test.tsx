import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pipeline accessibility boundary", () => {
  it("provides labelled list/kanban switching, columns, load-more, and non-color state copy", () => {
    const workspace = readFileSync("src/frontend/features/recruiter-applications/recruiter-candidate-workspace.tsx", "utf8");
    const column = readFileSync("src/frontend/features/recruiter-applications/recruitment-pipeline-column.tsx", "utf8");
    expect(workspace).toContain("aria-label={copy.candidates}");
    expect(workspace).toContain("<CandidateRankingList");
    expect(column).toContain('role="region"');
    expect(column).toContain("copy.loadMore");
    expect(column).toContain("copy.noCandidates");
  });

  it("uses shared theme tokens for board, card, controls, and dialog surfaces", () => {
    const styles = readFileSync(
      "src/frontend/styles/recruiter-workspace-full.css",
      "utf8",
    );

    expect(styles).toMatch(
      /\.pipeline-column\s*\{[^}]*background:\s*var\(--sh-color-surface-subtle\)/u,
    );
    expect(styles).toMatch(
      /\.pipeline-card\s*\{[^}]*background:\s*var\(--sh-color-surface-card\)/u,
    );
    expect(styles).toMatch(
      /\.pipeline-stage-form\s*\{[^}]*color:\s*var\(--sh-color-text-primary\)/u,
    );
    expect(styles).toMatch(
      /\.pipeline-card__actions\s+(?:button|a)[^{]*\{[^}]*color:\s*var\(--sh-color-text-primary\)/u,
    );
    expect(styles).toContain("var(--sh-color-border-focus)");
    expect(styles).not.toMatch(
      /\.pipeline-(?:column|card)\s*\{[^}]*(?:#f6f7f9|#fff|#cbd1da|#d7dbe2)/u,
    );
  });

  it("uses an ordered responsive three, two, and one column pipeline grid", () => {
    const styles = readFileSync(
      "src/frontend/styles/recruiter-workspace-full.css",
      "utf8",
    );

    expect(styles).toMatch(
      /\.recruitment-pipeline__columns\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)[^}]*align-items:\s*start/u,
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*1100px\)[\s\S]*?\.recruitment-pipeline__columns\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/u,
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.recruitment-pipeline__columns\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    );
  });
});
