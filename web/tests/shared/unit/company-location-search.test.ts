import { describe, expect, it } from "vitest";
import { companyLocationSearchTerms } from "@/shared/utils/locations/company-location";

describe("companyLocationSearchTerms", () => {
  it("matches Da Nang across compact, unaccented and accented forms", () => {
    expect(companyLocationSearchTerms("danang")).toEqual([
      "Da Nang",
      "Đà Nẵng",
      "danang",
    ]);
    expect(companyLocationSearchTerms("Đà Nẵng")).toEqual([
      "Da Nang",
      "Đà Nẵng",
      "danang",
    ]);
  });
});
