import { describe, expect, it } from "vitest";
import {
  companyLocationRegion,
  companyLocationRegions,
} from "@/shared/utils/locations/company-location";

describe("company location projection", () => {
  it.each([
    ["Thanh Khe District, Da Nang", "Da Nang"],
    ["District 2 (Thu Duc), Ho Chi Minh City", "Ho Chi Minh City"],
    ["Ho Chi Minh City, District 8", "Ho Chi Minh City"],
    ["Nha Trang City Center, Nha Trang (Khanh Hoa)", "Nha Trang (Khanh Hoa)"],
    ["Ho Chi Minh City, Vietnam", "Ho Chi Minh City"],
    ["Can Tho", "Can Tho"],
    ["", null],
    [null, null],
  ])("projects %s to %s", (value, expected) => {
    expect(companyLocationRegion(value)).toBe(expected);
  });

  it("deduplicates and sorts province/city labels", () => {
    expect(
      companyLocationRegions([
        "District 1, Ho Chi Minh City",
        "Hai Chau District, Da Nang",
        "District 3, Ho Chi Minh City",
        null,
      ]),
    ).toEqual(["Da Nang", "Ho Chi Minh City"]);
  });
});
