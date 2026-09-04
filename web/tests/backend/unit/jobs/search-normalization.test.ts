import { describe, expect, it } from "vitest";
import {
  decodeJobCursor,
  encodeJobCursor,
  normalizedDistrictLocation,
  normalizeSearchText,
  searchTextTokens,
} from "@/backend/services/jobs/search-normalization";

describe("Vietnamese job search normalization", () => {
  it.each([
    ["LẬP TRÌNH VIÊN", "lap trinh vien"],
    ["lập   trình-viên", "lap trinh vien"],
    ["Đà Nẵng", "da nang"],
    ["  TypeScript / React  ", "typescript react"],
    ["C++ Developer", "c++ developer"],
    [".NET Developer", ".net developer"],
    ["Node.js / React.js", "node.js react.js"],
  ])("normalizes %s deterministically", (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected);
  });

  it("bounds normalized search input", () => {
    expect(() => normalizeSearchText("x".repeat(201), 200)).toThrow(
      "JOB_SEARCH_TEXT_TOO_LONG",
    );
  });

  it("builds an exact normalized location key for a selected district", () => {
    expect(
      normalizedDistrictLocation("ba ria vung tau", "vung tau city center"),
    ).toBe("vung tau city center ba ria vung tau");
  });

  it("splits normalized free-text into stable search terms", () => {
    expect(searchTextTokens("  minh   chi ho ")).toEqual(["minh", "chi", "ho"]);
    expect(searchTextTokens("")).toEqual([]);
  });

  it("round-trips a versioned cursor", () => {
    const cursor = {
      v: 1 as const,
      sort: "NEWEST" as const,
      publishedAt: "2026-08-01T00:00:00.000Z",
      id: "job-1",
    };
    expect(decodeJobCursor(encodeJobCursor(cursor), "NEWEST")).toEqual(cursor);
  });

  it("rejects malformed and sort-mismatched cursors", () => {
    expect(() => decodeJobCursor("not-base64-json", "NEWEST")).toThrow(
      "JOB_SEARCH_CURSOR_INVALID",
    );
    const encoded = encodeJobCursor({
      v: 1,
      sort: "NEWEST",
      publishedAt: "2026-08-01T00:00:00.000Z",
      id: "job-1",
    });
    expect(() => decodeJobCursor(encoded, "RELEVANCE")).toThrow(
      "JOB_SEARCH_CURSOR_INVALID",
    );
  });
});
