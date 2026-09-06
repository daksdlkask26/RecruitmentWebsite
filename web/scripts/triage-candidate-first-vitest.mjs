import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { execFileSync } from "node:child_process";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inputFile = resolve(
  workspaceRoot,
  process.env.CF002_VITEST_RAW ??
    "docs/audits/2026-09-06-gate0-recheck-final-source-raw.json",
);
const outputFile = resolve(
  workspaceRoot,
  process.env.CF002_VITEST_TRIAGE ??
    "docs/audits/2026-09-06-gate0-recheck-final-source-triage.json",
);

const stripAnsi = (value) => stripVTControlCharacters(String(value ?? ""));

const relativeSuite = (name) =>
  String(name ?? "")
    .replaceAll("\\", "/")
    .replace(/^.*?\/web\//u, "web/");

const evidenceFor = (assertion, result) => {
  const messages = [
    ...(assertion?.failureMessages ?? []),
    result?.message ?? "",
  ]
    .map(stripAnsi)
    .filter(Boolean)
    .join("\n");
  return (
    messages.slice(0, 1_600) ||
    "Vitest reported a failed assertion without a message."
  );
};

const candidateFirstPatterns = [
  /tests\/(?:security|performance)\/cv-import\//u,
  /tests\/backend\/unit\/(?:test-database-guard|candidate-first-fixture|job-board-fixture)/u,
  /tests\/backend\/applications\/application-draft-service/u,
  /tests\/backend\/integration\/company-team-applications\/(?:retention|storage-unknown-reconciliation)\.test/u,
  /tests\/(?:backend\/(?:unit|integration|contract)\/)?(?:candidate-first|cv-import)\//u,
  /tests\/backend\/unit\/(?:company-team-applications|profile\/save-direct-candidate-cv|profile\/promote-candidate-cv-for-application|applications\/application-retention-worker|applications\/application-draft-service)/u,
  /tests\/backend\/unit\/jobs\/(?:prepare-direct-application-cv|job-application-service-ownership|prisma-job-application-repository-ownership)/u,
  /tests\/backend\/integration\/jobs\/(?:job-application|application-stage-tracking)\.test\.ts/u,
  /tests\/backend\/integration\/cv-import\//u,
  /tests\/frontend\/(?:components|accessibility)\/cv-import\//u,
  /tests\/architecture\/cv-import-/u,
];

const changedScopePatterns = [
  /tests\/security\/home\//u,
  /tests\/backend\/(?:unit|integration|contract)\/home\//u,
  /tests\/frontend\/(?:components|accessibility)\/home\//u,
  /tests\/architecture\/home-/u,
  /tests\/performance\/home\//u,
  /tests\/frontend\/(?:components|accessibility)\/cv-import\//u,
  /tests\/architecture\/cv-import-/u,
  /tests\/backend\/repositories\/jobs/u,
];

// Include every directly changed Vitest suite in this preserved working tree.
// Focused evidence cannot override any of these suites in the full process.
const directlyChangedSuites = new Set(
  [
    execFileSync("git", ["diff", "--name-only", "HEAD", "--", "web/tests"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    }),
    execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "--", "web/tests"],
      { cwd: workspaceRoot, encoding: "utf8" },
    ),
  ]
    .join("\n")
    .split(/\r?\n/u)
    .filter((file) => /\.test\.[cm]?[jt]sx?$/u.test(file)),
);

function scopeFor(suite) {
  if (candidateFirstPatterns.some((pattern) => pattern.test(suite))) {
    return "candidate-first";
  }
  if (
    directlyChangedSuites.has(suite) ||
    changedScopePatterns.some((pattern) => pattern.test(suite))
  ) {
    return "changed-scope";
  }
  return "broader-regression-surface";
}

const areaFor = (suite) => {
  const lower = suite.toLowerCase();
  if (
    /(?:cv-import|candidate-cv|application-artifact|application-document|prepare-direct-application-cv|promote-candidate-cv|cv-retention|cv-deletion|team-applications[\\/]retention)/u.test(
      lower,
    )
  ) {
    return { owner: "Candidate Data Safety", workItem: "CF-101" };
  }
  if (/(application|candidate-submission|recruitment-pipeline)/u.test(lower)) {
    return { owner: "Recruiter and Company Platform", workItem: "CF-301–305" };
  }
  if (/(identity|auth|session|password|totp)/u.test(lower)) {
    return { owner: "Identity and Session", workItem: "CF-802" };
  }
  if (/(messaging|notification)/u.test(lower)) {
    return { owner: "Messaging and Notifications", workItem: "CF-601–604" };
  }
  if (/(home|job-board|search|jobs)/u.test(lower)) {
    return { owner: "Discovery and Search", workItem: "CF-401–406" };
  }
  if (/(profile|account|connection)/u.test(lower)) {
    return { owner: "Profile and Account", workItem: "CF-201–205" };
  }
  if (/(admin|moderation)/u.test(lower)) {
    return { owner: "Admin Platform", workItem: "CF-801–805" };
  }
  if (/(recruit|company)/u.test(lower)) {
    return { owner: "Recruiter and Company Platform", workItem: "CF-301–305" };
  }
  return { owner: "Platform Architecture", workItem: "CF-804" };
};

function classify(suite, evidence) {
  const suiteLower = suite.toLowerCase();
  const evidenceLower = evidence.toLowerCase();
  const scope = scopeFor(suite);
  const area = areaFor(suite);

  const diagnosed = (
    id,
    cause,
    owner = area.owner,
    workItem = area.workItem,
  ) => ({
    scope,
    rootCauseGroup: id,
    rootCause: cause,
    owner,
    workItem,
    type: "source-contract-or-harness-diagnosis",
    status: "REQUIRED_FIX",
  });
  if (
    /backend\/integration\/identity\/(?:registration|nonblocking-email-delivery)\.test/u.test(
      suite,
    )
  )
    return diagnosed(
      "registration-password-fixture-policy",
      "The fixture uses 'correct horse 2026', which lacks uppercase and special characters. PasswordPolicy.hasRequiredComposition rejects it before persistence or email dispatch, so positive registration assertions never reach their intended behavior.",
      "Identity Test Harness",
      "CF-802",
    );
  if (suite.includes("totp-login-challenge") && evidence.includes("423"))
    return diagnosed(
      "suspended-login-status-contract",
      "The test expects 401 for every inactive state, but LoginWithPasswordService returns 423 specifically for SUSPENDED. The no-session invariant remains separate from this response-status mismatch.",
      "Identity and Session",
      "CF-802",
    );
  if (
    suite.includes("apply-form-section") &&
    evidence.includes("select a cv from profile")
  )
    return diagnosed(
      "profile-cv-label-selector",
      "The test queries /select a cv from profile/i, but job-application-copy.ts now defines 'Select CV from Profile' (without 'a'). The selector fails before file-save, retry or submit assertions execute.",
      "Candidate Applications UI",
      "CF-301",
    );
  if (suite.includes("message-composer") && /Đã gửi|Thử lại/u.test(evidence))
    return diagnosed(
      "message-composer-locale-fixture",
      "MessageComposer defaults its locale prop to en; these tests omit locale while querying Vietnamese sent/retry labels. The render and the asserted locale do not match.",
      "Messaging UI Test Harness",
      "CF-604",
    );
  if (
    /(?:in-app-notification-boundaries|notification-convergence)/u.test(
      suite,
    ) &&
    evidence.includes("4_000")
  )
    return diagnosed(
      "notification-polling-sla-mismatch",
      "use-notifications.ts sets REFRESH_INTERVAL_MS to 30000 while tests require 4000 for the five-second convergence target. Event invalidation does not itself prove cross-client convergence inside that SLA; this remains a notification behavior/work-item decision.",
      "Messaging and Notifications",
      "CF-603",
    );
  if (
    suite.includes("compatibility/cv-import/dependency-and-infrastructure") &&
    evidence.includes("Compatibility command failed safely")
  )
    return diagnosed(
      "compatibility-cli-runner-resolution",
      "The compatibility helper spawns bare npm/docker (npm uses npm_execpath only if present), unlike the live scanner suite's verified absolute Docker path. The helper discards spawn error/stderr and reports only exit status, so this result cannot establish scanner readiness or a dependency vulnerability. Resolve the CLI and retain sanitized diagnostics before the CF-804 audit rerun; do not start shared services via compose run.",
      "Platform Dependency Test Harness",
      "CF-804",
    );
  if (evidence.includes("No QueryClient set"))
    return diagnosed(
      "missing-query-client-provider",
      "The test renders a consumer of useNotificationRefreshEvents without QueryClientProvider; useQueryClient throws before the asserted UI or privacy behavior executes.",
    );
  if (evidence.includes("expected app router to be mounted"))
    return diagnosed(
      "missing-next-router-provider",
      "RegisterForm now calls next/navigation useRouter; the isolated render has neither an App Router context nor a router test double, so rendering aborts before form assertions.",
    );
  if (suite.includes("password-change.accessibility"))
    return diagnosed(
      "password-change-two-step-contract",
      "Tests assume the old edit/cancel form with Current password initially visible. PasswordChangeForm now shows new-password inputs first and current password in the confirmation prompt; the old Cancel control and initial labels do not exist.",
      "Profile and Account",
      "CF-701",
    );
  if (suite.includes("company-team-applications/membership-creation"))
    return diagnosed(
      "expired-fixed-invitation-fixture",
      "The positive invitation fixture expires on 2026-09-03, but CompanyTeamService.decide compares expiresAt to new Date(). The fixture is already expired on this run, so INVITATION_UNAVAILABLE is the expected domain response to invalid test data.",
      "Company Membership Test Harness",
      "CF-301",
    );
  if (
    suite.includes("company-team-applications/invitation-acceptance") &&
    evidence.includes("TypeError")
  )
    return diagnosed(
      "invitation-preview-missing-root-prisma-mock",
      "The test mocks only prisma.$transaction and transaction delegates. previewById reads prisma.userAccount and prisma.companyInvitation directly, so the root delegate is undefined before account-binding assertions execute.",
      "Company Membership Test Harness",
      "CF-301",
    );
  if (/(?:private-cv-match-boundaries|private-pipeline-isolation)/u.test(suite))
    return diagnosed(
      "private-match-company-deletion-boundary",
      "recruiter-job-posting-data.ts explicitly updates/deletes privateCvMatchCheck during company/job deletion because that table has no JobPosting FK. The static no-private-match-token boundary flags this cleanup path; this is an architecture ownership conflict, not evidence of returning private scores to an employer.",
      "Platform Architecture",
      "CF-804",
    );
  if (
    suite.includes("application-review-submit") &&
    evidence.includes("multiple elements")
  )
    return diagnosed(
      "application-review-ambiguous-checkbox",
      "ApplicationReviewSubmit renders separate confirmation and consent checkboxes. The test uses unqualified getByRole('checkbox'), which is ambiguous and fails before the submission contract is exercised.",
      "Candidate Applications",
      "CF-301",
    );
  if (
    suite.includes("workspace-theme-colors") &&
    evidence.includes("to contain")
  )
    return diagnosed(
      "stylesheet-line-ending-literal",
      "The static stylesheet assertion contains LF-specific text while the stylesheet is CRLF in this Windows working tree; raw substring comparison fails independently of CSS token semantics.",
      "UI Test Harness",
      "CF-701",
    );
  if (
    suite.includes("better-auth-backup-codes") &&
    evidence.includes("length of +0")
  )
    return diagnosed(
      "backup-code-table-name-false-positive",
      "The test expects zero public tables matching ILIKE '%backup%'. BackupConfiguration and BackupRun were added for operational backups, so two legitimate tables violate this name-only assertion; the failure is not a plaintext backup-code exposure finding.",
      "Identity Test Harness",
      "CF-802",
    );
  if (suite.includes("rejection-note-privacy"))
    return diagnosed(
      "audit-source-slice-overreach",
      "The privacy test slices application-stage-service.ts from its first new PrismaAuditRepository to EOF. That slice includes later command handling and internalNote persistence outside the audit payload; the unbounded lexical scan flags those later references.",
      "Recruiter Applications Privacy",
      "CF-301",
    );
  if (suite.includes("client-secret-storage"))
    return diagnosed(
      "registration-email-session-storage-policy",
      "RegisterForm stores the submitted email in sessionStorage under pending_verification_email. The browser persistence policy forbids verification-bearing keys; this requires an explicit registration-flow privacy decision or removal of that persistence.",
      "Identity and Privacy",
      "CF-802",
    );
  if (
    suite.includes("custom-server-runtime-boundaries") &&
    evidence.includes("register-tsx-runtime.mjs")
  )
    return diagnosed(
      "renamed-runtime-loader-test-path",
      "The architecture test reads scripts/register-tsx-runtime.mjs, which does not exist. The current runtime entry is scripts/register-server-runtime.mjs; the obsolete file path makes the boundary test fail before source inspection.",
      "Platform Runtime",
      "CF-804",
    );

  if (
    suiteLower.includes("cv-route-session-boundary") &&
    evidence.includes("CV_ROUTE_SESSION_LOGIN_FAILED")
  ) {
    return {
      scope,
      rootCauseGroup: "session-order-pollution",
      rootCause:
        "Route session login failed in this raw run. An older isolated pass cannot override this failure; inspect origin, environment and module lifecycle for this run.",
      type: "test-order-session-pollution",
      owner: "Identity and Session Test Harness",
      workItem: "CF-002",
      status: "REQUIRED_FIX",
    };
  }

  // A stack containing vi.fn/mock is not proof of cross-suite pollution.
  // Retain the concrete failure below unless an isolation defect is reproduced.

  if (
    /(docker|compose|clamav|cv_scanner|scanner|econnrefused|connection refused|p1000|p1001|command not found)/u.test(
      evidenceLower,
    )
  ) {
    return {
      scope,
      rootCauseGroup: "external-runtime-readiness",
      rootCause:
        "The assertion depends on a container, scanner, socket, or external runtime that was not ready in this runner.",
      type: "test-infrastructure-or-dependency-gate",
      owner: "CV Platform Runtime",
      workItem: "CF-003",
      status: "BLOCKED_EXTERNAL",
    };
  }

  if (
    /(mojibake|encoding|utf-8|i18n|localization|translation)/u.test(
      evidenceLower,
    )
  ) {
    return {
      scope,
      rootCauseGroup: "localization-encoding",
      rootCause:
        "The rendered or stored localized contract contains an encoding or translation mismatch.",
      type: "localization-contract-regression",
      owner: "Candidate UI Localization",
      workItem: "CF-004 / CF-701",
      status: "REQUIRED_FIX",
    };
  }

  if (suiteLower.includes("architecture")) {
    return {
      scope,
      rootCauseGroup: "architecture-boundary-drift",
      rootCause:
        "A static boundary assertion no longer matches the current import, stylesheet, runtime, or ownership graph.",
      type: "architecture-static-contract-drift",
      owner: "Platform Architecture",
      workItem: "CF-804",
      status: "REQUIRED_FIX",
    };
  }

  if (suiteLower.includes("security") || suiteLower.includes("privacy")) {
    return {
      scope,
      rootCauseGroup: "security-contract-drift",
      rootCause:
        "A security or privacy contract failed and requires an isolated authorization or data-exposure reproduction.",
      type: "security-contract-regression",
      owner:
        area.owner === "Platform Architecture"
          ? "Security and Identity"
          : area.owner,
      workItem: "CF-802",
      status: "REQUIRED_FIX",
    };
  }

  if (suiteLower.includes("accessibility")) {
    return {
      scope,
      rootCauseGroup: "ui-accessibility-contract-drift",
      rootCause:
        "The rendered UI no longer exposes the accessible role, name, state, focus, or assistive copy required by the test.",
      type: "ui-accessibility-contract-drift",
      owner:
        area.owner === "Platform Architecture"
          ? "Candidate UI Accessibility"
          : area.owner,
      workItem:
        scope === "candidate-first" || scope === "changed-scope"
          ? "CF-004 / CF-701"
          : area.workItem,
      status: "REQUIRED_FIX",
    };
  }

  if (suiteLower.includes("performance")) {
    return {
      scope,
      rootCauseGroup: "performance-baseline-drift",
      rootCause:
        "A performance assertion exceeded its reviewed threshold or could not establish its measurement dependency.",
      type: "performance-baseline-drift",
      owner: "Platform Performance",
      workItem: "CF-004",
      status: "REQUIRED_FIX",
    };
  }

  if (suiteLower.includes("compatibility")) {
    return {
      scope,
      rootCauseGroup: "dependency-compatibility-drift",
      rootCause:
        "A pinned dependency, runtime, or database compatibility contract differs from the reviewed baseline.",
      type: "dependency-compatibility-drift",
      owner: "Platform Dependencies",
      workItem: "CF-804",
      status: "REQUIRED_FIX",
    };
  }

  if (suiteLower.includes("frontend") || suiteLower.includes("home")) {
    return {
      scope,
      rootCauseGroup: "ui-behavior-contract-drift",
      rootCause:
        "A frontend behavior, state transition, or presentation contract assertion failed.",
      type: "ui-behavior-contract-drift",
      owner:
        area.owner === "Platform Architecture"
          ? "Candidate UI Feature"
          : area.owner,
      workItem:
        scope === "candidate-first" || scope === "changed-scope"
          ? "CF-004 / CF-701"
          : area.workItem,
      status: "REQUIRED_FIX",
    };
  }

  if (suiteLower.includes("integration")) {
    return {
      scope,
      rootCauseGroup: "domain-integration-contract-drift",
      rootCause:
        "A route, service, persistence, authorization, or external-boundary integration contract failed.",
      type: "integration-contract-regression",
      owner: area.owner,
      workItem: area.workItem,
      status: "REQUIRED_FIX",
    };
  }

  if (suiteLower.includes("contract")) {
    return {
      scope,
      rootCauseGroup: "domain-contract-drift",
      rootCause:
        "A public or internal contract assertion no longer matches the source behavior.",
      type: "contract-regression",
      owner: area.owner,
      workItem: area.workItem,
      status: "REQUIRED_FIX",
    };
  }

  return {
    scope,
    rootCauseGroup: "domain-unit-regression",
    rootCause:
      "A unit-level domain behavior failed; isolate the smallest service or repository contract before changing expected values.",
    type: "unit-regression",
    owner: area.owner,
    workItem: area.workItem,
    status: "REQUIRED_FIX",
  };
}

function databaseMarker() {
  if (process.env.CF002_ISOLATED_DATABASE)
    return process.env.CF002_ISOLATED_DATABASE;
  try {
    return decodeURIComponent(
      new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//u, ""),
    );
  } catch {
    return "not-reported";
  }
}

const raw = JSON.parse(await readFile(inputFile, "utf8"));
const packageScripts = JSON.parse(
  await readFile(resolve(workspaceRoot, "web/package.json"), "utf8"),
).scripts;
const requiredSuites = [
  ...[...directlyChangedSuites].map((suite) => suite.replace(/^web\//u, "")),
  ...packageScripts["test:candidate-first"]
    .split(/\s+/u)
    .filter((part) => part.startsWith("tests/")),
  "tests/backend/integration/company-team-applications/storage-unknown-reconciliation.test.ts",
  "tests/backend/integration/company-team-applications/retention.test.ts",
  "tests/backend/integration/jobs/job-application.test.ts",
  "tests/backend/integration/cv-import/clamav-socket-boundary.test.ts",
  "tests/security/home/home-rendered-data.test.ts",
];
const missingRequiredSuites = requiredSuites.filter(
  (suite) =>
    !(raw.testResults ?? []).some(
      (result) =>
        relativeSuite(result.name) === `web/${suite}` &&
        result.assertionResults?.length > 0,
    ),
);
const failures = [];
const suiteFailures = [];
const pending = [];
let failureId = 1;
let pendingId = 1;

for (const result of raw.testResults ?? []) {
  const suite = relativeSuite(result.name);
  if (
    result.status === "failed" &&
    !(result.assertionResults ?? []).some((item) => item.status === "failed")
  ) {
    const evidence = evidenceFor(null, result);
    suiteFailures.push({
      id: `CF-VT-SUITE-${String(suiteFailures.length + 1).padStart(3, "0")}`,
      suite,
      test: "Nonpassing suite without a failed assertion; inspect lifecycle diagnostics and separately reported skips",
      ...classify(suite, evidence),
      rootCauseEvidence: evidence,
    });
  }
  for (const assertion of result.assertionResults ?? []) {
    if (assertion.status === "failed") {
      const evidence = evidenceFor(assertion, result);
      const diagnosis = classify(suite, evidence);
      failures.push({
        id: `CF-VT-GATE0-${String(failureId++).padStart(3, "0")}`,
        suite,
        test: assertion.fullName ?? assertion.title,
        ...diagnosis,
        failureMechanism: evidence.split("\n")[0],
        diagnosisEvidenceLevel:
          diagnosis.type === "source-contract-or-harness-diagnosis"
            ? "SOURCE_REVIEWED"
            : "ASSERTION_EVIDENCE; root-cause hypothesis requires the owning work item's verification",
        rootCauseEvidence: evidence,
      });
    } else if (
      assertion.status === "skipped" ||
      assertion.status === "pending"
    ) {
      const evidence = evidenceFor(assertion, result);
      const classification = classify(suite, evidence);
      pending.push({
        id: `CF-VT-GATE0-SKIP-${String(pendingId++).padStart(3, "0")}`,
        suite,
        test: assertion.fullName ?? assertion.title,
        scope: classification.scope,
        reason: suite.includes("openai-live.synthetic")
          ? "Explicit opt-in gate CV_OPENAI_LIVE_SYNTHETIC is off; no approved external OpenAI project was used. This is outside the local Gate 0 acceptance scope."
          : evidence,
        owner: classification.owner,
        workItem: classification.workItem,
        status: "REQUIRED_FIX",
      });
    }
  }
}

const categoryCounts = Object.fromEntries(
  Object.entries(
    failures.reduce((counts, failure) => {
      counts[failure.type] = (counts[failure.type] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort(([, a], [, b]) => b - a),
);
const statusCounts = Object.fromEntries(
  Object.entries(
    failures.reduce((counts, failure) => {
      counts[failure.status] = (counts[failure.status] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort(([, a], [, b]) => b - a),
);

const groups = new Map();
for (const failure of failures) {
  const sourceReviewed = failure.diagnosisEvidenceLevel === "SOURCE_REVIEWED";
  const key = `${failure.rootCauseGroup}|${failure.owner}|${failure.workItem}|${sourceReviewed ? "shared-cause" : failure.suite}`;
  const group = groups.get(key) ?? {
    id: `CF-VT-GROUP-${String(groups.size + 1).padStart(2, "0")}`,
    rootCauseGroup: failure.rootCauseGroup,
    rootCause: failure.rootCause,
    owner: failure.owner,
    planWorkItem: failure.workItem,
    workItem: `CF-002-R${String(groups.size + 1).padStart(2, "0")}`,
    diagnosisEvidenceLevel: failure.diagnosisEvidenceLevel,
    observedMechanisms: [],
    suites: [],
    resolutionGate:
      "Reproduce the listed contract at its source boundary; fix the cause without weakening assertions, then rerun affected suites. In-scope work also requires the full-process gate.",
    scopes: {},
    failureIds: [],
  };
  group.scopes[failure.scope] = (group.scopes[failure.scope] ?? 0) + 1;
  group.failureIds.push(failure.id);
  if (!group.suites.includes(failure.suite)) group.suites.push(failure.suite);
  if (!group.observedMechanisms.includes(failure.failureMechanism))
    group.observedMechanisms.push(failure.failureMechanism);
  failure.planWorkItem = failure.workItem;
  failure.workItem = group.workItem;
  groups.set(key, group);
}
for (const item of pending) {
  item.planWorkItem = item.workItem;
  item.workItem = item.id.replace("CF-VT-GATE0-SKIP-", "CF-002-SKIP-");
}

const candidateFirstFailures = failures.filter(
  (failure) => failure.scope === "candidate-first",
);
const changedScopeFailures = failures.filter(
  (failure) =>
    failure.scope === "candidate-first" || failure.scope === "changed-scope",
);
const candidateFirstPending = pending.filter(
  (item) => item.scope === "candidate-first",
);
const changedScopePending = pending.filter(
  (item) => item.scope === "candidate-first" || item.scope === "changed-scope",
);
const candidateFirstSuiteFailures = suiteFailures.filter(
  (item) => item.scope === "candidate-first",
);
const changedScopeSuiteFailures = suiteFailures.filter(
  (item) => item.scope !== "broader-regression-surface",
);
function scopeTotals(scopes) {
  const results = (raw.testResults ?? []).filter((result) => scopes.includes(scopeFor(relativeSuite(result.name))));
  const assertions = results.flatMap((result) => result.assertionResults ?? []);
  return { files: results.length, tests: assertions.length, passed: assertions.filter((item) => item.status === "passed").length, failed: assertions.filter((item) => item.status === "failed").length, skipped: assertions.filter((item) => ["skipped", "pending", "todo"].includes(item.status)).length };
}

const triage = {
  schemaVersion: "candidate-first-vitest-triage-v5",
  generatedAt: new Date().toISOString(),
  rawReport: inputFile.replace(`${workspaceRoot}\\`, "").replaceAll("\\", "/"),
  run: {
    exitCode: raw.success === true ? 0 : 1,
    isolatedDatabase: databaseMarker(),
    files: {
      total: (raw.testResults ?? []).length,
      passed: (raw.testResults ?? []).filter(
        (result) => result.status === "passed",
      ).length,
      failed: (raw.testResults ?? []).filter(
        (result) => result.status === "failed",
      ).length,
    },
    aggregateSuites: raw.numTotalTestSuites,
    tests: {
      total: raw.numTotalTests,
      passed: raw.numPassedTests,
      failed: raw.numFailedTests,
      skipped: raw.numPendingTests,
    },
    success: raw.success === true,
    externalProcesses:
      "Test application and test workers absent; shared Docker services left running. Scanner tests probe shared services read-only.",
  },
  historicalBaseline: {
    artifact: "candidate-first-baseline-triage-2026-09-05.md",
    suites: 18,
    tests: 35,
  },
  summary: {
    scopeTotals: {
      candidateFirst: scopeTotals(["candidate-first"]),
      changedScopeAdditional: scopeTotals(["changed-scope"]),
      acceptanceScope: scopeTotals(["candidate-first", "changed-scope"]),
      outsideScope: scopeTotals(["broader-regression-surface"]),
    },
    failedAssertions: failures.length,
    explicitSkippedAssertions: pending.length,
    categoryCounts,
    statusCounts,
    rootCauseGroups: [...groups.values()].map((group) => ({
      id: group.id,
      rootCauseGroup: group.rootCauseGroup,
      owner: group.owner,
      workItem: group.workItem,
      scopes: group.scopes,
      failureCount: group.failureIds.length,
    })),
  },
  gates: {
    scopeDefinition: {
      directlyChangedSuites: [...directlyChangedSuites].sort(),
      candidateFirstPatterns: candidateFirstPatterns.map(String),
      changedScopePatterns: changedScopePatterns.map(String),
    },
    requiredSuites: {
      missing: missingRequiredSuites,
      pass: missingRequiredSuites.length === 0,
    },
    candidateFirst: {
      suiteFailuresWithoutFailedAssertion: candidateFirstSuiteFailures.length,
      failedAssertions: candidateFirstFailures.length,
      pendingAssertions: candidateFirstPending.length,
      pass:
        candidateFirstFailures.length === 0 &&
        candidateFirstPending.length === 0 &&
        missingRequiredSuites.length === 0 &&
        candidateFirstSuiteFailures.length === 0,
    },
    changedScope: {
      suiteFailuresWithoutFailedAssertion: changedScopeSuiteFailures.length,
      failedAssertions: changedScopeFailures.length,
      pendingAssertions: changedScopePending.length,
      pass:
        changedScopeFailures.length === 0 &&
        changedScopePending.length === 0 &&
        missingRequiredSuites.length === 0 &&
        changedScopeSuiteFailures.length === 0,
    },
  },
  failures,
  suiteFailures,
  pending,
  groups: [...groups.values()],
  noHiddenSkips: pending.length === Number(raw.numPendingTests ?? -1),
  reconciliationNotes: [
    "Every failed and pending assertion is retained; no assertion was skipped, removed, or rewritten to pass.",
    "Route-session errors stay in Candidate-first scope; historical focused passes never override the current full-process result.",
    "Root-cause groups are generated from suite and failure evidence, then assigned to a concrete functional owner and plan work item; they are not a sequential list of 200 generic fixes.",
  ],
  limitations: [
    "A full-suite failure remains a failure even when a focused suite is green; this artifact does not close Gate 0 by pass-rate inference.",
    "Out-of-scope failures remain visible with their owning plan range and must be handled in that work item before the broader product is called green.",
  ],
};

await writeFile(outputFile, `${JSON.stringify(triage, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      outputFile,
      failedAssertions: failures.length,
      explicitSkippedAssertions: pending.length,
      candidateFirst: triage.gates.candidateFirst,
      changedScope: triage.gates.changedScope,
      groups: groups.size,
    },
    null,
    2,
  ),
);
