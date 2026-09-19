import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companySpotlight } from "../../helpers/home/home-fixtures";

describe("Home company projection privacy", () => {
  it("contains only the explicit public display allowlist", () => {
    expect(Object.keys(companySpotlight()).sort()).toEqual([
      "destination",
      "industry",
      "logoUrl",
      "name",
      "openPositionCount",
      "publicLocation",
      "publicSummary",
      "size",
      "slug",
    ]);
  });

  it("never selects company tax, address, membership, culture, or badge data", async () => {
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/backend/repositories/home/prisma-home-public-company-repository.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/tax|membership|culture|badge|address/iu);
    expect(source).toContain("getPublicCompanyWhere");
    expect(source).toContain("candidateVisibleJobWhere");
  });
});
