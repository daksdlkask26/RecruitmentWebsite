import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("consequential decision UI", () => {
  it("requires reason/confirmation and intercepts Hired drag before submitting", () => {
    const dialog = readFileSync(
      "src/frontend/features/recruiter-applications/application-stage-change-dialog.tsx",
      "utf8",
    );
    const board = readFileSync(
      "src/frontend/features/recruiter-applications/recruitment-pipeline-board.tsx",
      "utf8",
    );
    expect(dialog).toContain("REJECTED");
    expect(dialog).toContain("OFFER_DECLINED");
    expect(dialog).toContain("HIRED");
    expect(dialog).toContain("confirmHiring");
    expect(board).toContain('setDialog({ card, target, intent: "drag" })');
  });
});
