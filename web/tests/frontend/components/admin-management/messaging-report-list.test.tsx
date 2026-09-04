import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("messaging report queue", () => {
  it("renders safe metadata columns without protected content fields", () => {
    const source = readFileSync(
      "src/frontend/features/admin/messaging-reports/messaging-report-list.tsx",
      "utf8",
    );
    expect(source).toContain("record.reporterDisplayName");
    expect(source).toContain("record.targetDisplayName");
    expect(source).toContain("record.evidenceAvailable");
    expect(source).not.toMatch(/source="(?:detail|content|conversationId)"/u);
  });
});
