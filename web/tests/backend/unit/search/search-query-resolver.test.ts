import { describe, expect, it } from "vitest";
import {
  resolveSearchQuery,
  SEARCH_RESOLVER_VERSION,
} from "@/backend/services/search/search-query-resolver";

describe("resolveSearchQuery", () => {
  it("normalizes Vietnamese and expands controlled job aliases", () => {
    const result = resolveSearchQuery("LẬP TRÌNH VIÊN", "JOBS", "vi");

    expect(result.normalizedQuery).toBe("lap trinh vien");
    expect(result.variants.map((variant) => variant.value)).toEqual([
      "lap trinh vien",
      "software engineer",
      "software developer",
      "programmer",
    ]);
    expect(result.usedFallback).toBe(true);
  });

  it("does not fuzzy-correct short queries", () => {
    const result = resolveSearchQuery("IT", "COMPANIES");

    expect(result.correction).toBeUndefined();
    expect(result.variants.map((variant) => variant.value)).toEqual([
      "it",
      "information technology",
    ]);
    expect(result.usedFallback).toBe(true);
  });

  it("marks a close canonical term as a typo correction", () => {
    const result = resolveSearchQuery("sofware engineer", "JOBS");

    expect(result.correction?.to).toBe("software engineer");
    expect(result.correction?.confidence).toBe("HIGH");
    expect(result.resolverVersion).toBe(SEARCH_RESOLVER_VERSION);
  });

  it.each(["kế toán", "ke toan", "KẾ TOÁN"])(
    "maps %s to the accounting canonical terms",
    (query) => {
      const result = resolveSearchQuery(query, "JOBS", "vi");
      expect(result.variants.map((variant) => variant.value)).toContain(
        "accountant",
      );
    },
  );

  it("recognizes an accounting phrase inside a longer query", () => {
    const result = resolveSearchQuery("nhân viên kế toán", "JOBS", "vi");
    expect(result.variants.map((variant) => variant.value)).toContain(
      "accountant",
    );
  });

  it("recognizes compact Vietnamese phrases without spaces", () => {
    const accounting = resolveSearchQuery("ketoan", "JOBS", "vi");
    const engineering = resolveSearchQuery(
      "laptrinhvien",
      "JOBS",
      "vi",
    );

    expect(accounting.variants.map((variant) => variant.value)).toContain(
      "accountant",
    );
    expect(engineering.variants.map((variant) => variant.value)).toContain(
      "software engineer",
    );
  });
});
