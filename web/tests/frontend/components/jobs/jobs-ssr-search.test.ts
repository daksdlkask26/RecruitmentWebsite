import { describe, expect, it } from "vitest";
import { jobsPageQuery } from "@/app/jobs/jobs-page-query";

describe("Jobs SSR search criteria", () => {
  it("keeps a valid searchBy mode from the shared URL contract", () => {
    expect(jobsPageQuery({ q: "designer", searchBy: "TITLE" })).toMatchObject(
      { q: "designer", searchBy: "TITLE" },
    );
    expect(jobsPageQuery({ q: "designer", searchBy: "COMPANY" })).toMatchObject(
      { q: "designer", searchBy: "COMPANY" },
    );
  });

  it("uses the shared default for omitted or invalid searchBy values", () => {
    expect(jobsPageQuery({ q: "designer" }).searchBy).toBe("BOTH");
    expect(jobsPageQuery({ q: "designer", searchBy: "UNKNOWN" }).searchBy).toBe(
      "BOTH",
    );
  });
});
