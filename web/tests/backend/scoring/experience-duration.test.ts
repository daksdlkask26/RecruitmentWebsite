import { describe, expect, it } from "vitest";
import { calculateExperienceDuration } from "@/backend/scoring/domain/experience-duration";

const interval = (startMonth: number, endMonthExclusive: number) => ({
  startMonth,
  endMonthExclusive,
});

describe("calendar-month experience duration", () => {
  it("calculates 2020-2022 plus 2021-2023 as a three-year union", () => {
    const result = calculateExperienceDuration([
      interval(2020 * 12, 2022 * 12),
      interval(2021 * 12, 2023 * 12),
    ]);
    expect(result.totalMonths).toBe(36);
    expect(result.years).toBe(3);
    expect(result.unionIntervals).toEqual([interval(2020 * 12, 2023 * 12)]);
  });

  it("merges nested and adjacent intervals but preserves gaps", () => {
    const result = calculateExperienceDuration([
      interval(10, 20),
      interval(12, 15),
      interval(20, 24),
      interval(30, 36),
    ]);
    expect(result.unionIntervals).toEqual([interval(10, 24), interval(30, 36)]);
    expect(result.totalMonths).toBe(20);
  });

  it("sorts evidence and discards invalid intervals without throwing", () => {
    const result = calculateExperienceDuration([
      { ...interval(20, 22), source: "later" },
      { ...interval(8, 12), source: "earlier" },
      interval(-1, 4),
      interval(10, 10),
    ]);
    expect(result.evidenceIntervals.map((item) => item.source)).toEqual([
      "earlier",
      "later",
    ]);
    expect(result.discardedIntervalCount).toBe(2);
    expect(result.totalMonths).toBe(6);
  });
});
