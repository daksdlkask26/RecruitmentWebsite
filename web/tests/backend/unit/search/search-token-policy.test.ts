import { describe, expect, it } from "vitest";
import {
  classifySearchToken,
  escapePostgresRegex,
  hasRetrievalSafeToken,
} from "@/backend/services/search/search-token-policy";

describe("search token policy", () => {
  it.each([
    ["accountant", "SAFE_WORD"],
    ["AI", "KNOWN_ABBREVIATION"],
    ["HR", "KNOWN_ABBREVIATION"],
    ["IT", "KNOWN_ABBREVIATION"],
    ["C++", "KNOWN_ABBREVIATION"],
    ["C#", "KNOWN_ABBREVIATION"],
    [".NET", "KNOWN_ABBREVIATION"],
    ["y", "SHORT_AMBIGUOUS"],
    ["ta", "SHORT_AMBIGUOUS"],
    ["engineer", "GENERIC_ROLE"],
    ["nhân", "GENERIC_ROLE"],
    ["and", "STOPWORD"],
  ] as const)("classifies %s as %s", (token, expected) => {
    expect(classifySearchToken(token)).toBe(expected);
  });

  it("keeps punctuation-bearing technology tokens retrievable", () => {
    expect(classifySearchToken("Node.js")).toBe("SAFE_WORD");
    expect(classifySearchToken("React.js")).toBe("SAFE_WORD");
    expect(classifySearchToken("QA/QC")).toBe("SAFE_WORD");
    expect(hasRetrievalSafeToken(["y", "ta"])).toBe(true);
  });

  it("escapes regex metacharacters before word-boundary matching", () => {
    expect(escapePostgresRegex("C++/.NET")).toBe("C\\+\\+/\\.NET");
  });
});
