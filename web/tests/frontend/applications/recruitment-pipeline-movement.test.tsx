import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pipeline movement presentation", () => {
  it("shares one command path between pointer movement and explicit stage control", () => {
    const board = readFileSync(
      "src/frontend/features/recruiter-applications/recruitment-pipeline-board.tsx",
      "utf8",
    );
    const dialog = readFileSync(
      "src/frontend/features/recruiter-applications/application-stage-change-dialog.tsx",
      "utf8",
    );
    expect(board).toContain("DndContext");
    expect(board).toContain("onDragCancel");
    expect(board).toContain("requestStageChange");
    expect(board).toContain('intent: "drag"');
    expect(board).toContain('intent: "button"');
    expect(dialog).toContain("allowedDestinations");
  });
});
