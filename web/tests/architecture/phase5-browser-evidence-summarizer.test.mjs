import { describe, expect, it } from "vitest";
import {
  buildReport,
  CF502_STATES,
  CF502_VIEWPORTS,
} from "../../scripts/summarize-phase5-browser-evidence.mjs";

const environment = {
  productionBuild: true,
  buildOutput: ".next-phase5-summarizer-test",
  baseUrl: "http://127.0.0.1:3003",
  isolatedDatabase: "candidate_phase5_summarizer_e2e_test",
  sourceSpec:
    "tests/system/e2e/candidate-first/phase5-cf502-accessibility.spec.ts",
  config: "playwright.phase5.config.ts",
  routeMocks: false,
};

function quality(theme) {
  return {
    overflow: true,
    reducedMotion: true,
    theme,
    keyboardFocus: true,
    seriousCriticalAxeViolations: 0,
    zoom: {
      requestedPercent: 200,
      method: "cdp-device-metrics-css-viewport-reflow",
      baseViewportWidth: 320,
      baseViewportHeight: 720,
      measuredViewportWidth: 160,
      measuredViewportHeight: 360,
      reflowVerified: true,
    },
  };
}

function rowsFor(theme = "light", transform = (row) => row) {
  return CF502_STATES.flatMap((state) =>
    CF502_VIEWPORTS.map((viewport, index) =>
      transform({
        artifact: "CF-502",
        state,
        theme,
        viewport,
        project: "chromium-" + String(index),
        status: "PASS",
        quality: quality(
          theme === "dark" && state === "Guest" ? "light" : theme,
        ),
        environment,
      }),
    ),
  );
}

function playwright() {
  return {
    stats: {
      expected: 16,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
      duration: 100,
    },
  };
}

const command =
  "PHASE5_PRODUCTION_BUILD=1 PHASE5_EXACT_COMMAND=playwright-test";

describe("CF-502 browser evidence summarizer", () => {
  it("requires every declared state at every declared viewport", () => {
    const complete = rowsFor();
    const report = buildReport({
      color: "light",
      rows: complete,
      playwright: playwright(),
      commandExact: command,
    });
    expect(report.verdict).toBe(true);
    expect(report.coverage.machineRows).toBe(27 * 4);
    expect(report.coverage.expectedMachineRows).toBe(27 * 4);
    expect(report.quality.seriousCriticalAxeViolations).toBe(0);
  });

  it("rejects missing and duplicate state coverage", () => {
    const complete = rowsFor();
    const first = complete[0];
    const incomplete = complete.filter((_, index) => index !== 1);
    incomplete.push({ ...first });
    const report = buildReport({
      color: "light",
      rows: incomplete,
      playwright: playwright(),
      commandExact: command,
    });
    expect(report.verdict).toBe(false);
    expect(report.validation.errors.join("\n")).toMatch(
      /missing viewports|duplicate machine row|duplicate viewports/u,
    );
  });

  it("reports measured quality instead of hard-coded zeroes", () => {
    const rows = rowsFor("light", (row) => ({
      ...row,
      quality: {
        ...row.quality,
        overflow: false,
        seriousCriticalAxeViolations: 2,
      },
    }));
    const report = buildReport({
      color: "light",
      rows,
      playwright: playwright(),
      commandExact: command,
    });
    expect(report.verdict).toBe(false);
    expect(report.quality.seriousCriticalAxeViolations).toBe(216);
    expect(report.quality.overflowRows).toBe(0);
    expect(report.validation.errors.join("\n")).toContain(
      "overflow did not pass",
    );
  });

  it("keeps the authentication Guest route light in a dark matrix", () => {
    const report = buildReport({
      color: "dark",
      rows: rowsFor("dark"),
      playwright: playwright(),
      commandExact: command,
    });
    expect(report.verdict).toBe(true);
    expect(report.environment.routeMocks).toBe(false);
  });

  it("rejects non-production provenance and route mocks", () => {
    const rows = rowsFor("light", (row) => ({
      ...row,
      environment: {
        ...row.environment,
        productionBuild: false,
        routeMocks: true,
      },
    }));
    const report = buildReport({
      color: "light",
      rows,
      playwright: playwright(),
      commandExact: command,
    });
    expect(report.verdict).toBe(false);
    expect(report.validation.errors.join("\n")).toMatch(
      /productionBuild is not true|route mocks are enabled/u,
    );
  });

  it("fails closed when machine or Playwright input is missing", () => {
    const report = buildReport({
      color: "dark",
      rows: [],
      playwright: null,
      commandExact: null,
      inputErrors: ["fixture input missing"],
    });
    expect(report.verdict).toBe(false);
    expect(report.validation.errors).toEqual(
      expect.arrayContaining([
        "fixture input missing",
        "Playwright JSON is missing stats",
        "exact production Playwright command is missing",
      ]),
    );
  });
});
