import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".tsx")
        ? [path]
        : [];
  });
}

describe("Candidate production illustrative score guard", () => {
  it("rejects hard-coded illustrative numeric scores and hiring-like band labels", () => {
    const roots = [
      resolve(process.cwd(), "src/frontend/features/home/components"),
      resolve(
        process.cwd(),
        "src/frontend/features/private-cv-match/components",
      ),
    ];
    const files = roots.flatMap(sourceFiles);
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const findings: string[] = [];
      if (/<strong>\s*\d+(?:\.\d+)?\s*%/u.test(source)) {
        findings.push("hard-coded numeric score");
      }
      if (
        /(illustrative|sampleScore)[\s\S]{0,240}\b\d+(?:\.\d+)?\s*(?:%|\/\s*100)\b/iu.test(
          source,
        ) ||
        /\b\d+(?:\.\d+)?\s*(?:%|\/\s*100)\b[\s\S]{0,240}(illustrative|sampleScore)/iu.test(
          source,
        )
      ) {
        findings.push("illustrative numeric score");
      }
      if (/\b(?:Strong|Good|Low)\s+match\b/iu.test(source)) {
        findings.push("hiring-like match label");
      }
      if (/private-match-badge--(?:green|red)\b/iu.test(source)) {
        findings.push("legacy green/red match badge class");
      }
      const matchBandWindow = source.match(
        /report\.matchBand[\s\S]{0,420}/u,
      )?.[0];
      if (
        matchBandWindow &&
        /\b(?:emerald|red)\b|(?:bg|text)-(?:emerald|red)|private-match-badge--(?:green|red)\b/iu.test(
          matchBandWindow,
        )
      ) {
        findings.push("green/red match-band styling");
      }
      return findings.length ? [{ file, findings }] : [];
    });
    expect(violations).toEqual([]);
  });
});
