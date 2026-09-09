import { describe, expect, it } from "vitest";

import { nextCvPollingDelay } from "@/frontend/features/cv-import/client/cv-import-polling-policy";
import { cvStatusPollingAfterMs } from "@/shared/contracts/cv-import/upload";

describe("CV import polling policy", () => {
  it("refreshes active work initially and resets the delay after progress", () => {
    expect(
      nextCvPollingDelay({ outcome: "initial", baseDelayMs: 2_000 }),
    ).toBe(2_000);
    expect(
      nextCvPollingDelay({
        outcome: "advanced",
        baseDelayMs: 2_000,
        previousDelayMs: 16_000,
      }),
    ).toBe(2_000);
  });

  it("backs off unchanged or failed polls with bounded jitter", () => {
    expect(
      nextCvPollingDelay({
        outcome: "unchanged",
        baseDelayMs: 2_000,
        previousDelayMs: 2_000,
        random: () => 0.5,
      }),
    ).toBe(4_000);
    expect(
      nextCvPollingDelay({
        outcome: "error",
        baseDelayMs: 2_000,
        previousDelayMs: 29_000,
        random: () => 1,
      }),
    ).toBe(30_000);
  });

  it("keeps profile imports active after SECURITY_CLEAN but preserves SCAN_ONLY terminality", () => {
    expect(
      cvStatusPollingAfterMs("SECURITY_CLEAN", "IMPORT_AND_PARSE"),
    ).toBe(2_000);
    expect(cvStatusPollingAfterMs("SECURITY_CLEAN", "SCAN_ONLY")).toBe(null);
    expect(cvStatusPollingAfterMs("REVIEW_READY")).toBe(null);
    expect(
      cvStatusPollingAfterMs("CANCELLED", "IMPORT_AND_PARSE", {
        deleteAfter: "2026-09-08T12:00:10.000Z",
        deletedAt: null,
        nowMs: Date.parse("2026-09-08T12:00:00.000Z"),
      }),
    ).toBe(2_000);
  });
});
