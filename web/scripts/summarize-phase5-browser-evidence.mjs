import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CF502_VIEWPORTS = ["320x720", "375x812", "768x900", "1280x900"];

export const CF502_STATES = [
  "Guest",
  "Employer",
  "Profile AVAILABLE",
  "Candidate without Profile",
  "CV AVAILABLE",
  "FULL_REPORT MEDIUM",
  "FULL_REPORT LOW",
  "LIMITED_REPORT",
  "incomplete CV",
  "incomplete JD",
  "missing criteria",
  "evidence-empty",
  "unavailable failed parse",
  "queued",
  "analyzing",
  "retrying",
  "retry failure",
  "expired",
  "revoked",
  "deleted",
  "direct link and refresh",
  "Back Forward",
  "second authenticated tab",
  "cross-account denial",
  "long EN VI",
  "closed Apply",
  "expired Apply",
];

const requiredSourceSpec =
  "tests/system/e2e/candidate-first/phase5-cf502-accessibility.spec.ts";
const requiredConfig = "playwright.phase5.config.ts";
const requiredZoomMethod = "cdp-device-metrics-css-viewport-reflow";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function groupCounts(values) {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((item) => item === value).length]),
  );
}

function safeJsonParse(text, label, errors) {
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(
      label +
        ": invalid JSON (" +
        String(error instanceof Error ? error.message : error).slice(0, 240) +
        ")",
    );
    return null;
  }
}

function loadInputs({ color, resultsRoot }) {
  const errors = [];
  let names = [];
  try {
    names = fs
      .readdirSync(resultsRoot)
      .filter((name) =>
        new RegExp("^phase5-cf502-" + color + "-\\d+\\.jsonl$", "u").test(name),
      )
      .sort();
  } catch (error) {
    errors.push(
      "results directory unavailable: " +
        String(error instanceof Error ? error.message : error),
    );
  }
  if (!names.length)
    errors.push("no machine-readable CF-502 JSONL files found");

  const rows = [];
  for (const name of names) {
    const file = path.join(resultsRoot, name);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      errors.push(
        name +
          ": unreadable (" +
          String(error instanceof Error ? error.message : error) +
          ")",
      );
      continue;
    }
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      const value = safeJsonParse(line, name + ":" + String(index + 1), errors);
      if (isRecord(value)) rows.push(value);
      else if (value !== null)
        errors.push(name + ":" + String(index + 1) + ": row is not an object");
    }
  }

  const playwrightPath = path.join(
    resultsRoot,
    "phase5-cf502-playwright-" + color + ".json",
  );
  let playwright = null;
  try {
    playwright = safeJsonParse(
      fs.readFileSync(playwrightPath, "utf8"),
      path.basename(playwrightPath),
      errors,
    );
  } catch (error) {
    errors.push(
      path.basename(playwrightPath) +
        ": unreadable (" +
        String(error instanceof Error ? error.message : error) +
        ")",
    );
  }
  return { errors, rows, playwright, machineFiles: names };
}

function validateEnvironment(row, index, errors) {
  const environment = row.environment;
  if (!isRecord(environment)) {
    errors.push("row " + String(index) + ": missing environment provenance");
    return;
  }
  if (environment.productionBuild !== true)
    errors.push("row " + String(index) + ": productionBuild is not true");
  if (
    typeof environment.buildOutput !== "string" ||
    !environment.buildOutput.trim() ||
    (/\.next[\\/]/u.test(environment.buildOutput) &&
      /[\\/]dev(?:[\\/]|$)/u.test(environment.buildOutput))
  )
    errors.push(
      "row " +
        String(index) +
        ": isolated production build output is missing or invalid",
    );
  if (
    typeof environment.baseUrl !== "string" ||
    !/^https?:\/\/[^\s]+$/u.test(environment.baseUrl)
  )
    errors.push("row " + String(index) + ": production base URL is missing");
  if (
    typeof environment.isolatedDatabase !== "string" ||
    !/(?:^|[-_])(test|tests|spec|e2e)(?:[-_]|$)/iu.test(
      environment.isolatedDatabase,
    )
  )
    errors.push(
      "row " + String(index) + ": isolated test database is missing or unsafe",
    );
  if (environment.routeMocks !== false)
    errors.push(
      "row " + String(index) + ": route mocks are enabled or unproven",
    );
  if (environment.sourceSpec !== requiredSourceSpec)
    errors.push("row " + String(index) + ": source spec provenance is missing");
  if (environment.config !== requiredConfig)
    errors.push(
      "row " + String(index) + ": Playwright config provenance is missing",
    );
}

function validateQuality(row, index, color, errors) {
  const quality = row.quality;
  if (!isRecord(quality)) {
    errors.push("row " + String(index) + ": missing quality evidence");
    return;
  }
  if (
    !Number.isInteger(quality.seriousCriticalAxeViolations) ||
    quality.seriousCriticalAxeViolations < 0
  )
    errors.push("row " + String(index) + ": invalid axe count");
  if (quality.overflow !== true)
    errors.push("row " + String(index) + ": overflow did not pass");
  if (quality.reducedMotion !== true)
    errors.push(
      "row " + String(index) + ": reduced-motion evidence did not pass",
    );
  if (quality.keyboardFocus !== true)
    errors.push(
      "row " + String(index) + ": keyboard/focus evidence did not pass",
    );
  // The Guest state lands on the authentication route, whose product
  // contract intentionally remains light even during the dark Home matrix.
  const expectedTheme = row.state === "Guest" ? "light" : color;
  if (quality.theme !== expectedTheme)
    errors.push(
      "row " +
        String(index) +
        ": theme evidence does not match matrix (expected " +
        expectedTheme +
        ")",
    );
  if (!isRecord(quality.zoom)) {
    errors.push("row " + String(index) + ": missing zoom/reflow evidence");
    return;
  }
  if (quality.zoom.requestedPercent !== 200)
    errors.push("row " + String(index) + ": zoom evidence is not 200%");
  if (quality.zoom.method !== requiredZoomMethod)
    errors.push(
      "row " + String(index) + ": browser zoom was not measured as CSS reflow",
    );
  if (quality.zoom.reflowVerified !== true)
    errors.push("row " + String(index) + ": 200% reflow was not verified");
  if (
    !Number.isFinite(quality.zoom.baseViewportWidth) ||
    !Number.isFinite(quality.zoom.baseViewportHeight) ||
    !Number.isFinite(quality.zoom.measuredViewportWidth) ||
    !Number.isFinite(quality.zoom.measuredViewportHeight)
  )
    errors.push(
      "row " + String(index) + ": zoom viewport dimensions are invalid",
    );
}

function validateStats(playwright, errors) {
  const stats = isRecord(playwright) ? playwright.stats : null;
  if (!isRecord(stats)) {
    errors.push("Playwright JSON is missing stats");
    return {
      expected: null,
      unexpected: null,
      flaky: null,
      skipped: null,
      durationMs: null,
    };
  }
  const values = {
    expected: integerOrNull(stats.expected),
    unexpected: integerOrNull(stats.unexpected),
    flaky: integerOrNull(stats.flaky),
    skipped: integerOrNull(stats.skipped),
    durationMs: numberOrNull(stats.duration),
  };
  for (const key of ["expected", "unexpected", "flaky", "skipped"]) {
    if (values[key] === null)
      errors.push("Playwright stats." + key + " is missing or invalid");
  }
  return values;
}

function summarizeCoverage(rows, color, errors) {
  const seenComposite = new Set();
  const observedStates = new Set();
  const stateRows = {};
  for (const state of CF502_STATES) stateRows[state] = [];

  rows.forEach((row, index) => {
    if (typeof row.state !== "string" || !row.state.trim()) {
      errors.push("row " + String(index) + ": state is missing");
      return;
    }
    observedStates.add(row.state);
    if (!stateRows[row.state]) stateRows[row.state] = [];
    if (row.artifact !== "CF-502")
      errors.push("row " + String(index) + ": artifact is not CF-502");
    if (row.theme !== color)
      errors.push(
        "row " + String(index) + ": theme does not match requested color",
      );
    if (!CF502_VIEWPORTS.includes(row.viewport))
      errors.push(
        "row " +
          String(index) +
          ": unsupported viewport " +
          String(row.viewport),
      );
    if (typeof row.project !== "string" || !row.project.trim())
      errors.push("row " + String(index) + ": Playwright project is missing");
    const composite = [row.state, row.viewport, row.project, row.theme].join(
      "|",
    );
    if (seenComposite.has(composite))
      errors.push("duplicate machine row: " + composite);
    seenComposite.add(composite);
    if (row.status !== "PASS")
      errors.push("row " + String(index) + ": status is " + String(row.status));
    validateEnvironment(row, index, errors);
    validateQuality(row, index, color, errors);
    stateRows[row.state].push(row);
  });

  for (const state of observedStates) {
    if (!CF502_STATES.includes(state))
      errors.push("unexpected matrix state: " + state);
  }

  const coverage = {};
  for (const state of CF502_STATES) {
    const values = stateRows[state];
    const viewports = values.map((row) => row.viewport);
    const duplicateViewports = [
      ...new Set(
        viewports.filter((value, index) => viewports.indexOf(value) !== index),
      ),
    ];
    const missingViewports = CF502_VIEWPORTS.filter(
      (viewport) => !viewports.includes(viewport),
    );
    if (values.length !== CF502_VIEWPORTS.length)
      errors.push(
        "state " +
          state +
          ": expected " +
          String(CF502_VIEWPORTS.length) +
          " rows, got " +
          String(values.length),
      );
    if (missingViewports.length)
      errors.push(
        "state " + state + ": missing viewports " + missingViewports.join(", "),
      );
    if (duplicateViewports.length)
      errors.push(
        "state " +
          state +
          ": duplicate viewports " +
          duplicateViewports.join(", "),
      );
    coverage[state] = {
      expectedRows: CF502_VIEWPORTS.length,
      rows: values.length,
      pass:
        values.length === CF502_VIEWPORTS.length &&
        missingViewports.length === 0 &&
        duplicateViewports.length === 0 &&
        values.every((row) => row.status === "PASS"),
      themes: groupCounts(values.map((row) => row.theme)),
      viewports: groupCounts(viewports),
      projects: groupCounts(values.map((row) => row.project)),
      missingViewports,
      duplicateViewports,
    };
  }
  return { coverage, stateRows };
}

export function buildReport({
  color,
  rows,
  playwright,
  inputErrors = [],
  machineFiles = [],
  commandExact = null,
}) {
  const errors = [...inputErrors];
  if (!["light", "dark"].includes(color)) errors.push("invalid color scheme");
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const stats = validateStats(playwright, errors);
  const { coverage, stateRows } = summarizeCoverage(
    normalizedRows,
    color,
    errors,
  );

  const environments = normalizedRows
    .map((row) => row.environment)
    .filter(isRecord);
  const firstEnvironment = environments[0] ?? {};
  const sameEnvironment = environments.every(
    (environment) =>
      environment.productionBuild === true &&
      environment.buildOutput === firstEnvironment.buildOutput &&
      environment.baseUrl === firstEnvironment.baseUrl &&
      environment.isolatedDatabase === firstEnvironment.isolatedDatabase &&
      environment.sourceSpec === requiredSourceSpec &&
      environment.config === requiredConfig &&
      environment.routeMocks === false,
  );
  if (!environments.length || !sameEnvironment)
    errors.push(
      "machine rows do not share one verified production environment",
    );
  if (typeof commandExact !== "string" || !commandExact.trim())
    errors.push("exact production Playwright command is missing");

  const axeCount = normalizedRows.reduce(
    (total, row) =>
      total +
      (isRecord(row.quality) &&
      Number.isInteger(row.quality.seriousCriticalAxeViolations)
        ? row.quality.seriousCriticalAxeViolations
        : 0),
    0,
  );
  const qualityRows = normalizedRows.filter((row) => isRecord(row.quality));
  const failures = normalizedRows.filter((row) => row.status !== "PASS");
  const environment = {
    productionBuild:
      environments.length > 0 &&
      environments.every((value) => value.productionBuild === true),
    buildOutput: firstEnvironment.buildOutput ?? null,
    baseUrl: firstEnvironment.baseUrl ?? null,
    isolatedDatabase: firstEnvironment.isolatedDatabase ?? null,
    sourceSpec: firstEnvironment.sourceSpec ?? null,
    config: firstEnvironment.config ?? null,
    routeMocks:
      environments.length > 0 &&
      environments.some((value) => value.routeMocks !== false),
  };
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    artifact: "CF-502",
    colorScheme: color,
    environment,
    command: {
      exact: commandExact,
      testFiles: [
        ...new Set(
          environments
            .map((value) => value.sourceSpec)
            .filter((value) => typeof value === "string"),
        ),
      ],
      config: [
        ...new Set(
          environments
            .map((value) => value.config)
            .filter((value) => typeof value === "string"),
        ),
      ],
      machineFiles,
    },
    playwright: stats,
    coverage: {
      machineRows: normalizedRows.length,
      expectedMachineRows: CF502_STATES.length * CF502_VIEWPORTS.length,
      stateCount: Object.keys(stateRows).filter(
        (state) => stateRows[state].length > 0,
      ).length,
      expectedStateCount: CF502_STATES.length,
      stateRows: coverage,
      viewports: groupCounts(normalizedRows.map((row) => row.viewport)),
      projects: groupCounts(normalizedRows.map((row) => row.project)),
    },
    quality: {
      seriousCriticalAxeViolations: axeCount,
      qualityRows: qualityRows.length,
      reducedMotionRows: qualityRows.filter(
        (row) => row.quality.reducedMotion === true,
      ).length,
      keyboardFocusRows: qualityRows.filter(
        (row) => row.quality.keyboardFocus === true,
      ).length,
      overflowRows: qualityRows.filter((row) => row.quality.overflow === true)
        .length,
      zoom200ReflowRows: qualityRows.filter(
        (row) =>
          isRecord(row.quality.zoom) &&
          row.quality.zoom.requestedPercent === 200 &&
          row.quality.zoom.reflowVerified === true,
      ).length,
      stateFailures: failures.length,
    },
    validation: {
      errors,
      inputErrors,
    },
    verdict:
      errors.length === 0 &&
      stats.unexpected === 0 &&
      stats.flaky === 0 &&
      stats.skipped === 0 &&
      normalizedRows.length === CF502_STATES.length * CF502_VIEWPORTS.length &&
      normalizedRows.every((row) => row.status === "PASS") &&
      axeCount === 0 &&
      qualityRows.length === normalizedRows.length,
    rows: normalizedRows,
  };
  return report;
}

function writeOutputs({ color, evidenceRoot, report }) {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceRoot, "cf502-browser-" + color + ".json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );
  const errors = report.validation.errors;
  const markdown = [
    "# CF-502 browser evidence - " + color + " theme",
    "",
    "Verdict: **" + (report.verdict ? "PASS" : "FAIL") + "**",
    "",
    "- Production Playwright: " +
      String(report.playwright.expected) +
      " expected, " +
      String(report.playwright.unexpected) +
      " unexpected, " +
      String(report.playwright.flaky) +
      " flaky, " +
      String(report.playwright.skipped) +
      " skipped.",
    "- Machine rows: " +
      String(report.coverage.machineRows) +
      "/" +
      String(report.coverage.expectedMachineRows) +
      "; states: " +
      String(report.coverage.stateCount) +
      "/" +
      String(report.coverage.expectedStateCount) +
      "; each state requires one row for each viewport.",
    "- Viewports: " + CF502_VIEWPORTS.join(", ") + ".",
    "- Quality rows: axe serious/critical " +
      String(report.quality.seriousCriticalAxeViolations) +
      "; overflow " +
      String(report.quality.overflowRows) +
      "/" +
      String(report.coverage.machineRows) +
      "; keyboard/focus " +
      String(report.quality.keyboardFocusRows) +
      "/" +
      String(report.coverage.machineRows) +
      "; reduced motion " +
      String(report.quality.reducedMotionRows) +
      "/" +
      String(report.coverage.machineRows) +
      "; 200% CSS reflow " +
      String(report.quality.zoom200ReflowRows) +
      "/" +
      String(report.coverage.machineRows) +
      ".",
    "- Production build: " +
      String(report.environment.productionBuild) +
      "; build output: " +
      String(report.environment.buildOutput) +
      "; DB: " +
      String(report.environment.isolatedDatabase) +
      "; route mocks: " +
      String(report.environment.routeMocks) +
      ".",
    "- Exact command: " + String(report.command.exact) + ".",
    "- The JSON retains every machine row and every validation error; a failed or incomplete run is not promoted to PASS.",
    "",
  ];
  if (errors.length)
    markdown.push(
      "## Validation errors",
      "",
      ...errors.map((error) => "- " + error),
      "",
    );
  fs.writeFileSync(
    path.join(evidenceRoot, "cf502-browser-" + color + ".md"),
    markdown.join("\n"),
    "utf8",
  );
}

function main() {
  const color = process.env.CF502_COLOR_SCHEME === "dark" ? "dark" : "light";
  const webRoot = process.cwd();
  const resultsRoot = path.join(webRoot, "test-results");
  const evidenceRoot = path.resolve(
    webRoot,
    "../docs/audits/candidate-first/phase-5/evidence",
  );
  const inputs = loadInputs({ color, resultsRoot });
  const report = buildReport({
    color,
    rows: inputs.rows,
    playwright: inputs.playwright,
    inputErrors: inputs.errors,
    machineFiles: inputs.machineFiles,
    commandExact: process.env.PHASE5_EXACT_COMMAND ?? null,
  });
  writeOutputs({ color, evidenceRoot, report });
  process.exitCode = report.verdict ? 0 : 1;
  console.log(
    JSON.stringify({
      color,
      verdict: report.verdict,
      expected: report.playwright.expected,
      unexpected: report.playwright.unexpected,
      skipped: report.playwright.skipped,
      machineRows: report.coverage.machineRows,
      expectedMachineRows: report.coverage.expectedMachineRows,
      stateCount: report.coverage.stateCount,
      expectedStateCount: report.coverage.expectedStateCount,
      validationErrors: report.validation.errors.length,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
