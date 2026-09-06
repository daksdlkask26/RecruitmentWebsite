import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Candidate-first fixture contract", () => {
  it("keeps every required entity inside a unique disposable namespace", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "tests/helpers/candidate-first-database-fixture.ts",
      ),
      "utf8",
    );

    for (const model of [
      "createJobBoardDatabaseFixture",
      "authProviderAccount.create",
      "companyMembership.create",
      "jobApplication.create",
      "recruitmentThread.create",
      "recruitmentMessage.create",
      "inAppNotification.create",
    ]) {
      expect(source, model).toContain(model);
    }
    expect(source).toContain("databaseFixture.suffix");
    expect(source).toContain("deleteCandidateFirstDatabaseFixture");
    expect(source).toContain("deleteJobBoardDatabaseFixture(fixture)");
    expect(source).toContain("AggregateError");
    expect(source).toContain("Candidate-first fixture creation and rollback");

    const base = readFileSync(
      resolve(process.cwd(), "tests/helpers/job-board-database-fixture.ts"),
      "utf8",
    );
    expect(base).toContain("createJobBoardDatabaseFixtureUnsafe");
    expect(base).toContain("Job-board fixture creation and rollback");
    expect(base).toContain("skill-${fixture.suffix}");
    expect(base).toContain("createdSkillIds");
    expect(base).toContain("candidateProfileSkill.findMany");
    expect(base).toContain("AuditEvent is database-enforced append-only");

    const control = readFileSync(
      resolve(process.cwd(), "tests/helpers/candidate-first-e2e-control.mjs"),
      "utf8",
    );
    expect(control).toContain("assertTestDatabaseEnvironment");
    expect(control.indexOf("assertTestDatabaseEnvironment()")).toBeLessThan(
      control.indexOf('const { prisma } = await import("../../src/backend/database/prisma.ts")'),
    );
    expect(control).toContain("immutable audit events stay retained");

    const performanceWrite = readFileSync(
      resolve(
        process.cwd(),
        "tests/performance/admin-management/messaging-report-review.performance.test.ts",
      ),
      "utf8",
    );
    expect(performanceWrite).toContain("assertRequestedTestDatabase");
    expect(
      performanceWrite.indexOf("assertRequestedTestDatabase()"),
    ).toBeLessThan(performanceWrite.indexOf('"@/backend/database/prisma"'));
    const securityWrite = readFileSync(
      resolve(
        process.cwd(),
        "tests/security/admin-management/account-session-rationale-privacy.test.ts",
      ),
      "utf8",
    );
    expect(securityWrite).toContain("assertRequestedTestDatabase");
    expect(
      securityWrite.indexOf("assertRequestedTestDatabase()"),
    ).toBeLessThan(securityWrite.indexOf('"@/backend/database/prisma"'));
    for (const relativePath of [
      "tests/system/e2e/admin-management/admin-e2e-control.mjs",
      "tests/system/e2e/admin-management/e2e-prisma-query.mjs",
      "scripts/measure-in-app-notification-performance.mjs",
    ]) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).toMatch(
        /assert(?:Requested)?TestDatabase(?:Environment)?/u,
      );
    }

    const inventory = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "../docs/audits/candidate-first-db-write-inventory-2026-09-06.json",
        ),
        "utf8",
      ),
    ) as { entries: Array<{ path: string }> };
    expect(inventory.entries.map((entry) => entry.path)).toContain(
      "web/tests/backend/scoring/prisma-scoring-repository.test.ts",
    );
    expect(inventory.entries.map((entry) => entry.path)).toContain(
      "web/tests/backend/unit/applications/application-retention-worker.test.ts",
    );

    const vitestConfig = readFileSync(
      resolve(process.cwd(), "vitest.config.ts"),
      "utf8",
    );
    expect(vitestConfig).toContain("!hasExplicitTestPath");
    expect(vitestConfig).toContain("hasDatabaseBackedTestPath");
    expect(vitestConfig).toContain("SMART_HIRE_TEST_DATABASE_REQUIRED");
    expect(vitestConfig).toContain('"tests/performance/**/*.spec.ts"');

    for (const [relativePath, prismaImport] of [
      [
        "tests/helpers/home/home-e2e-control.mjs",
        '"../../../src/backend/database/prisma.ts"',
      ],
      [
        "tests/helpers/recruitment-pipeline-kanban/recruitment-pipeline-kanban-e2e-control.mjs",
        '"../../../src/backend/database/prisma.ts"',
      ],
      ["scripts/run-messaging-e2e.mjs", '"../src/backend/database/prisma.ts"'],
    ] as const) {
      const e2eControl = readFileSync(
        resolve(process.cwd(), relativePath),
        "utf8",
      );
      expect(e2eControl, relativePath).toContain(
        "assertTestDatabaseEnvironment",
      );
      expect(
        e2eControl.indexOf("assertTestDatabaseEnvironment()"),
        relativePath,
      ).toBeLessThan(e2eControl.indexOf(prismaImport));
    }
  });
});
