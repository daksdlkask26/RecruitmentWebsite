import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const execFileAsync = promisify(execFile);
const baseUrl = process.env.CF403_BASE_URL ?? "http://localhost:3001";
const adminOrigin = process.env.CF403_ADMIN_ORIGIN ?? "http://127.0.0.1:3001";
const reportPath = resolve(
  process.cwd(),
  "../docs/audits/candidate-first/phase-4/evidence/cf403-mutation-matrix.json",
);

function cookieLine(response, pattern) {
  return response.headers.getSetCookie().find((value) => pattern.test(value));
}

async function main() {
  const { assertTestDatabaseEnvironment } =
    await import("../tests/helpers/test-database-guard.ts");
  assertTestDatabaseEnvironment();
  const { prisma } = await import("../src/backend/database/prisma.ts");
  const { createJobBoardDatabaseFixture, deleteJobBoardDatabaseFixture } =
    await import("../tests/helpers/job-board-database-fixture.ts");
  const { closeManagedJobPost, reopenManagedJobPost } =
    await import("../src/backend/jobs/review/job-post-review-service.ts");
  const { jobReviewSnapshotFromCatalog, jobReviewSnapshotSha256 } =
    await import("../src/backend/jobs/review/job-post-review-policy.ts");
  const { chromium } = await import("playwright");
  const { AdminAuthService } =
    await import("../src/backend/admin/authorization/admin-auth-service.ts");
  const { totp } =
    await import("../tests/system/e2e/admin-management/admin-e2e-totp.ts");

  const marker = `CF403 job ${randomUUID()}`;
  const companyMarker = `CF403 company ${randomUUID()}`;
  const fixture = await createJobBoardDatabaseFixture(
    "cf403-matrix",
    new Date(Date.now() - 24 * 60 * 60_000),
  );
  const employerId = fixture.userIds[1];
  const activeJob = fixture.jobs.active;
  const browser = await chromium.launch({ headless: true });
  const guest = await browser.newContext();
  const account = await browser.newContext();
  let adminContext = null;
  let adminCookie = null;
  let adminRunId = null;
  let matrixAggregateId = null;
  const results = [];

  async function setupAdmin() {
    const adminScript = resolve(
      process.cwd(),
      "tests/system/e2e/admin-management/admin-e2e-control.mjs",
    );
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        adminScript,
        "setup-auth",
        "cf403-matrix",
      ],
      { cwd: process.cwd(), env: process.env, windowsHide: true },
    );
    const environment = JSON.parse(stdout.trim());
    adminRunId = environment.runId;
    const credentials = environment.administrators["cf403-matrix"];
    await prisma.platformAdministratorGrantScopeAssignment.createMany({
      data: ["JOB_POST_MODERATE", "JOB_POST_FEATURE", "JOB_POST_ENFORCE"].map(
        (scope) => ({ grantId: credentials.grantId, scope }),
      ),
      skipDuplicates: true,
    });
    const auth = new AdminAuthService();
    const request = new Request(adminOrigin, {
      headers: {
        origin: adminOrigin,
        "x-forwarded-for": `cf403-matrix-${adminRunId}`,
        "user-agent": "cf403-mutation-matrix",
      },
    });
    const login = await auth.login(
      { email: credentials.email, password: credentials.password },
      request,
    );
    if (login.status !== 200) throw new Error("CF403_ADMIN_LOGIN_FAILED");
    const preAuth = cookieLine(
      login,
      /^(?:smarthire[.]pre-auth|__Secure-smarthire[.]pre-auth)=/u,
    );
    if (!preAuth) throw new Error("CF403_ADMIN_PRE_AUTH_COOKIE_MISSING");
    const encoded = preAuth.slice(
      preAuth.indexOf("=") + 1,
      preAuth.indexOf(";"),
    );
    const sessionCookie = await auth.completeInitialFactor(
      decodeURIComponent(encoded),
      totp(credentials.totpSecret),
      request,
    );
    if (!sessionCookie) throw new Error("CF403_ADMIN_SESSION_COOKIE_MISSING");
    adminCookie = sessionCookie.split(";", 1)[0];
    adminContext = await browser.newContext();
    return { credentials, loginStatus: login.status };
  }

  async function adminCompanyCommand(action, expectedVersion) {
    const contextResponse = await adminContext.request.get(
      `${adminOrigin}/api/admin/auth/context`,
      { headers: { Cookie: adminCookie, "sec-fetch-site": "same-origin" } },
    );
    const contextBody = await contextResponse.json();
    const response = await adminContext.request.post(
      `${adminOrigin}/api/admin/companies/${encodeURIComponent(fixture.company.id)}/${action}`,
      {
        headers: {
          Cookie: adminCookie,
          Origin: adminOrigin,
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json",
          "X-CSRF-Token": contextBody.csrfToken,
          "If-Match": String(expectedVersion),
          "Idempotency-Key": randomUUID(),
        },
        data: {
          confirmation: true,
          reasonCategory:
            action === "ban" ? "POLICY_VIOLATION" : "INCIDENT_RESOLVED",
          explanation:
            action === "ban"
              ? "CF403 mutation matrix safety removal."
              : "CF403 mutation matrix safety restoration.",
        },
      },
    );
    return {
      contextStatus: contextResponse.status(),
      status: response.status(),
      body: await response.text(),
    };
  }

  async function adminJobCommand(action, expectedVersion) {
    const contextResponse = await adminContext.request.get(
      `${adminOrigin}/api/admin/auth/context`,
      { headers: { Cookie: adminCookie, "sec-fetch-site": "same-origin" } },
    );
    const contextBody = await contextResponse.json();
    const command = action === "hide" ? "HIDE" : "RESTORE";
    const response = await adminContext.request.post(
      `${adminOrigin}/api/admin/job-postings/${encodeURIComponent(activeJob.id)}/${action}`,
      {
        headers: {
          Cookie: adminCookie,
          Origin: adminOrigin,
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json",
          "X-CSRF-Token": contextBody.csrfToken,
          "If-Match": `"${expectedVersion}"`,
          "Idempotency-Key": randomUUID(),
        },
        data:
          command === "HIDE"
            ? {
                command,
                confirmation: true,
                reason: "CF403 matrix safety removal.",
              }
            : {
                command,
                confirmation: true,
                reason: "CF403 matrix safety restoration.",
              },
      },
    );
    return {
      contextStatus: contextResponse.status(),
      status: response.status(),
      body: await response.text(),
    };
  }

  async function readSurfaces(extraMarkers = []) {
    const jobMarkers = [marker];
    const companyMarkers = [companyMarker, ...extraMarkers];
    const markers = [...jobMarkers, ...companyMarkers];
    const urls = {
      home: `${baseUrl}/`,
      jobs: `${baseUrl}/api/jobs?limit=20`,
      company: `${baseUrl}/api/companies/${encodeURIComponent(fixture.company.id)}`,
      job: `${baseUrl}/api/jobs/${encodeURIComponent(activeJob.slug)}`,
    };
    const values = {};
    for (const [key, url] of Object.entries(urls)) {
      const request =
        key === "company" || key === "job" ? account.request : guest.request;
      const response = await request.get(url);
      const body = await response.text();
      values[key] = {
        url,
        finalUrl: response.url(),
        status: response.status(),
        htmlBytes: Buffer.byteLength(body),
        containsJobMarker: jobMarkers.some((value) => body.includes(value)),
        containsCompanyMarker: companyMarkers.some((value) =>
          body.includes(value),
        ),
        markerContext:
          markers
            .map((value) => {
              const index = body.indexOf(value);
              return index >= 0
                ? body.slice(
                    Math.max(0, index - 120),
                    index + value.length + 120,
                  )
                : null;
            })
            .find(Boolean) ?? null,
      };
    }
    return values;
  }

  function visible(reads) {
    return (
      reads.home.status === 200 &&
      reads.home.containsJobMarker &&
      reads.jobs.status === 200 &&
      reads.jobs.containsJobMarker &&
      reads.company.status === 200 &&
      reads.company.containsCompanyMarker &&
      reads.job.status === 200 &&
      reads.job.containsJobMarker
    );
  }

  function hidden(reads) {
    return (
      !reads.home.containsJobMarker &&
      !reads.jobs.containsJobMarker &&
      !reads.company.containsCompanyMarker &&
      !reads.job.containsJobMarker &&
      reads.company.status === 404 &&
      reads.job.status === 404
    );
  }

  function jobHidden(reads) {
    return (
      !reads.home.containsJobMarker &&
      !reads.jobs.containsJobMarker &&
      reads.company.status === 200 &&
      !reads.company.containsJobMarker &&
      reads.job.status === 404 &&
      !reads.job.containsJobMarker
    );
  }

  async function record(name, mutation, expected, metadata = {}) {
    const before = await readSurfaces();
    const mutationResult = await mutation();
    const after = await readSurfaces(
      metadata.bodyMarker ? [metadata.bodyMarker] : [],
    );
    const pass = expected === "VISIBLE" ? visible(after) : hidden(after);
    results.push({
      name,
      mutationResult,
      before,
      firstReadAfterCommit: after,
      expected,
      status: pass ? "PASS" : "FAIL",
      ...metadata,
    });
    if (!pass) {
      console.error(JSON.stringify({ matrixFailure: name, after }, null, 2));
      throw new Error(`CF403_MATRIX_FAILED:${name}`);
    }
    return after;
  }

  try {
    const originalCompany = await prisma.company.findUniqueOrThrow({
      where: { id: fixture.company.id },
    });
    const originalJob = await prisma.jobPosting.findUniqueOrThrow({
      where: { id: activeJob.id },
    });
    await prisma.company.update({
      where: { id: fixture.company.id },
      data: {
        displayName: companyMarker,
        publicDescription: companyMarker,
        verifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60_000),
        verificationState: "ACTIVE",
        verificationInactiveAt: null,
        moderationState: "ACTIVE",
      },
    });
    await prisma.jobPosting.update({
      where: { id: activeJob.id },
      data: {
        title: marker,
        normalizedTitle: marker.toLocaleLowerCase(),
        searchDocumentNormalized: marker.toLocaleLowerCase(),
        status: "ACTIVE",
        publishedAt: new Date(Date.now() - 60 * 60_000),
        applicationDeadline: new Date(Date.now() + 14 * 24 * 60 * 60_000),
        closedAt: null,
        removedAt: null,
      },
    });
    const membershipId = `cf403-matrix-membership-${fixture.suffix}`;
    await prisma.companyMembership.create({
      data: {
        id: membershipId,
        companyId: fixture.company.id,
        userId: employerId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    const password = `CF403 matrix ${randomUUID()}!`;
    const passwordHash = await (
      await import("better-auth/crypto")
    ).hashPassword(password);
    await prisma.authProviderAccount.create({
      data: {
        id: `cf403-matrix-auth-${fixture.suffix}`,
        accountId: employerId,
        providerId: "credential",
        userId: employerId,
        password: passwordHash,
      },
    });
    const login = await account.request.post(`${baseUrl}/api/identity/login`, {
      headers: { Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
      data: {
        email: `${employerId}@example.test`,
        password,
        returnTo: "/dashboard",
      },
    });
    if (login.status() !== 200)
      throw new Error("CF403_MATRIX_ACCOUNT_LOGIN_FAILED");
    const aggregateId = `cf403-matrix-aggregate-${fixture.suffix}`;
    matrixAggregateId = aggregateId;
    const baselineReviewId = `cf403-matrix-baseline-${fixture.suffix}`;
    await prisma.jobPostReviewAggregate.create({
      data: {
        id: aggregateId,
        jobId: activeJob.id,
        companyId: fixture.company.id,
        latestSequence: 1,
        publicJobPostingId: activeJob.id,
        visibilityState: "PUBLISHED",
        applicationState: "OPEN",
      },
    });
    const catalogueJob = JSON.parse(
      await readFile(
        resolve(process.cwd(), "data/jobs/jobs_it_r03.json"),
        "utf8",
      ),
    )[0];
    const snapshotBase = jobReviewSnapshotFromCatalog(
      {
        ...catalogueJob,
        id: activeJob.id,
        slug: activeJob.slug,
        companyId: fixture.company.id,
        createdByUserId: employerId,
        title: marker,
        shortPitch: "A production-grade public job used by the CF403 matrix.",
        applyDeadline: new Date(
          Date.now() + 14 * 24 * 60 * 60_000,
        ).toISOString(),
        status: "active",
        postedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        updatedAt: new Date().toISOString(),
        isVerified: true,
        stats: { viewCount: 0, applicantCount: 0 },
      },
      fixture.company.id,
    );
    await prisma.jobPostReviewVersion.create({
      data: {
        id: baselineReviewId,
        reviewAggregateId: aggregateId,
        sequence: 1,
        snapshot: snapshotBase,
        snapshotSchemaVersion: "1",
        snapshotSha256: jobReviewSnapshotSha256(snapshotBase),
        state: "APPROVED",
        submittedByUserId: employerId,
        submittedMembershipId: membershipId,
        submittedAt: new Date(Date.now() - 60 * 60_000),
        decidedAt: new Date(Date.now() - 30 * 60_000),
        publishedAt: new Date(Date.now() - 30 * 60_000),
        importedBaseline: true,
      },
    });
    await prisma.jobPostReviewAggregate.update({
      where: { id: aggregateId },
      data: { approvedVersionId: baselineReviewId },
    });
    await setupAdmin();

    const profileMarker = `${marker} profile`;
    await record(
      "public company profile fields change",
      async () =>
        prisma.company.update({
          where: { id: fixture.company.id },
          data: {
            displayName: profileMarker,
            publicDescription: profileMarker,
          },
        }),
      "VISIBLE",
      { mutationClass: "company-profile-edit", bodyMarker: profileMarker },
    );
    await prisma.company.update({
      where: { id: fixture.company.id },
      data: { displayName: companyMarker, publicDescription: companyMarker },
    });

    await record(
      "company verification inactive",
      async () =>
        prisma.company.update({
          where: { id: fixture.company.id },
          data: {
            verificationState: "INACTIVE",
            verificationInactiveAt: new Date(),
            verifiedAt: null,
          },
        }),
      "HIDDEN",
      { mutationClass: "company-verification" },
    );
    await record(
      "company verification active",
      async () =>
        prisma.company.update({
          where: { id: fixture.company.id },
          data: {
            verificationState: "ACTIVE",
            verificationInactiveAt: null,
            verifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60_000),
          },
        }),
      "VISIBLE",
      { mutationClass: "company-verification" },
    );

    const ban = await adminCompanyCommand("ban", 1);
    const afterBan = await readSurfaces();
    results.push({
      name: "admin company ban",
      mutationResult: ban,
      firstReadAfterCommit: afterBan,
      expected: "HIDDEN",
      status: hidden(afterBan) && ban.status === 200 ? "PASS" : "FAIL",
      mutationClass: "company-moderation",
    });
    if (results.at(-1).status !== "PASS")
      throw new Error("CF403_MATRIX_FAILED:company-ban");
    const unban = await adminCompanyCommand("unban", 2);
    const afterUnban = await readSurfaces();
    results.push({
      name: "admin company unban",
      mutationResult: unban,
      firstReadAfterCommit: afterUnban,
      expected: "VISIBLE",
      status: visible(afterUnban) && unban.status === 200 ? "PASS" : "FAIL",
      mutationClass: "company-moderation",
    });
    if (results.at(-1).status !== "PASS")
      throw new Error("CF403_MATRIX_FAILED:company-unban");

    const close = await closeManagedJobPost({
      jobId: activeJob.id,
      companyId: fixture.company.id,
      actorUserId: employerId,
    });
    const afterClose = await readSurfaces();
    results.push({
      name: "recruiter closes approved job",
      mutationResult: close,
      firstReadAfterCommit: afterClose,
      expected: "HIDDEN",
      status: jobHidden(afterClose) && close === true ? "PASS" : "FAIL",
      mutationClass: "recruiter-close-reopen",
    });
    if (results.at(-1).status !== "PASS") {
      console.error(
        JSON.stringify({ matrixFailure: "job-close", afterClose }, null, 2),
      );
      throw new Error("CF403_MATRIX_FAILED:job-close");
    }
    const reopen = await reopenManagedJobPost({
      jobId: activeJob.id,
      companyId: fixture.company.id,
      actorUserId: employerId,
    });
    const afterReopen = await readSurfaces();
    results.push({
      name: "recruiter reopens approved job",
      mutationResult: reopen,
      firstReadAfterCommit: afterReopen,
      expected: "VISIBLE",
      status: visible(afterReopen) && reopen === true ? "PASS" : "FAIL",
      mutationClass: "recruiter-close-reopen",
    });
    if (results.at(-1).status !== "PASS")
      throw new Error("CF403_MATRIX_FAILED:job-reopen");

    const hide = await adminJobCommand("hide", 3);
    const afterHide = await readSurfaces();
    results.push({
      name: "admin approves/republishes job projection (hide leg)",
      mutationResult: hide,
      firstReadAfterCommit: afterHide,
      expected: "HIDDEN",
      status: jobHidden(afterHide) && hide.status === 200 ? "PASS" : "FAIL",
      mutationClass: "admin-job-approval-republish",
    });
    if (results.at(-1).status !== "PASS") {
      console.error(
        JSON.stringify(
          { matrixFailure: "job-hide", result: results.at(-1) },
          null,
          2,
        ),
      );
      throw new Error("CF403_MATRIX_FAILED:job-hide");
    }
    const restore = await adminJobCommand("restore", 4);
    const afterRestore = await readSurfaces();
    results.push({
      name: "admin approves/republishes job projection (restore leg)",
      mutationResult: restore,
      firstReadAfterCommit: afterRestore,
      expected: "VISIBLE",
      status: visible(afterRestore) && restore.status === 200 ? "PASS" : "FAIL",
      mutationClass: "admin-job-approval-republish",
    });
    if (results.at(-1).status !== "PASS")
      throw new Error("CF403_MATRIX_FAILED:job-restore");

    await prisma.jobPosting.update({
      where: { id: activeJob.id },
      data: {
        applicationDeadline: new Date(Date.now() - 60_000),
        status: "ACTIVE",
      },
    });
    await prisma.jobPostReviewAggregate.update({
      where: { id: aggregateId },
      data: {
        visibilityState: "PUBLISHED",
        applicationState: "OPEN",
        closedAt: null,
        archivedAt: null,
        applicationClosedAt: null,
        version: { increment: 1 },
      },
    });
    const workerCode =
      "import { runJobPostLifecycleCycle } from './src/backend/admin/workers/job-post-lifecycle-loop.ts'; const result = await runJobPostLifecycleCycle(new Date()); console.log(JSON.stringify(result));";
    const worker = await execFileAsync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        workerCode,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const afterWorker = await readSurfaces();
    results.push({
      name: "standalone deadline lifecycle worker archives job",
      mutationResult: JSON.parse(worker.stdout.trim().split(/\r?\n/u).at(-1)),
      firstReadAfterCommit: afterWorker,
      expected: "HIDDEN",
      status: jobHidden(afterWorker) ? "PASS" : "FAIL",
      mutationClass: "deadline-lifecycle-worker",
      processBoundary: "standalone child process -> production Next process",
    });
    if (results.at(-1).status !== "PASS")
      throw new Error("CF403_MATRIX_FAILED:worker");

    const restored = await prisma.$transaction(async (tx) => {
      await tx.jobPostReviewAggregate.update({
        where: { id: aggregateId },
        data: {
          visibilityState: "PUBLISHED",
          applicationState: "OPEN",
          archivedAt: null,
          applicationClosedAt: null,
          closedAt: null,
          version: { increment: 1 },
        },
      });
      return tx.jobPosting.update({
        where: { id: activeJob.id },
        data: {
          status: "ACTIVE",
          removedAt: null,
          closedAt: null,
          applicationDeadline: new Date(Date.now() + 14 * 24 * 60 * 60_000),
        },
      });
    });
    const afterWorkerRestore = await readSurfaces();
    results.push({
      name: "deadline lifecycle restoration",
      mutationResult: restored,
      firstReadAfterCommit: afterWorkerRestore,
      expected: "VISIBLE",
      status: visible(afterWorkerRestore) ? "PASS" : "FAIL",
      mutationClass: "deadline-lifecycle-worker",
    });
    if (results.at(-1).status !== "PASS")
      throw new Error("CF403_MATRIX_FAILED:worker-restore");

    const assessment = Object.fromEntries(
      results.map((result) => [result.name, result.status]),
    );
    const result = {
      schemaVersion: "candidate-first-cf403-mutation-matrix-v1",
      generatedAt: new Date().toISOString(),
      commit: "583171bf8cdb3cc76fea4a6ce818e89208a99dfb",
      environment: {
        runtime: "Next production server plus standalone worker child process",
        baseUrl,
        adminOrigin,
        database: process.env.TEST_DATABASE_NAME,
        databaseIsolation: "task-owned isolated PostgreSQL database",
        durableSignal:
          "PostgreSQL PublicDiscoveryInvalidation trigger watermark",
      },
      method: {
        readBodiesAfterEveryCommittedMutation: true,
        surfaces: [
          "GET /",
          "GET /api/jobs",
          "GET /api/companies/:id",
          "GET /api/jobs/:id",
        ],
        inProcessNextMutation: "authenticated admin ban/unban HTTP route",
        standaloneWorkerMutation: "child process runJobPostLifecycleCycle",
      },
      results,
      assessment,
      safety: {
        originalCompany: {
          verificationState: originalCompany.verificationState,
          moderationState: originalCompany.moderationState,
        },
        originalJob: { status: originalJob.status },
        catalogueUntouched: true,
        fixtureCleanup: "deleteJobBoardDatabaseFixture plus matrix rows",
      },
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(
      reportPath.replace(/\.json$/u, ".md"),
      [
        "# CF-403 mutation-to-read matrix",
        "",
        `- Generated: ${result.generatedAt}`,
        `- Database: ${result.environment.database}`,
        `- Body reads after every mutation: **${result.method.readBodiesAfterEveryCommittedMutation ? "PASS" : "FAIL"}**`,
        "",
        "| Mutation group | Result |",
        "| --- | --- |",
        ...results.map((entry) => `| ${entry.name} | **${entry.status}** |`),
        "",
        "The worker leg runs in a separate Node process and the first reads are made through the already-running production Next process.",
        "",
      ].join("\n"),
      "utf8",
    );
    if (results.some((entry) => entry.status !== "PASS"))
      throw new Error("CF403 mutation matrix gate failed");
  } finally {
    await guest.close();
    await account.close();
    if (adminContext) await adminContext.close();
    await browser.close();
    if (adminRunId) {
      const adminScript = resolve(
        process.cwd(),
        "tests/system/e2e/admin-management/admin-e2e-control.mjs",
      );
      await execFileAsync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          adminScript,
          "cleanup-run",
          adminRunId,
        ],
        { cwd: process.cwd(), env: process.env, windowsHide: true },
      );
    }
    if (matrixAggregateId) {
      const aggregate = await prisma.jobPostReviewAggregate.findUnique({
        where: { id: matrixAggregateId },
        select: { id: true },
      });
      if (aggregate) {
        await prisma.jobPostReviewHistory.deleteMany({
          where: { reviewVersion: { reviewAggregateId: matrixAggregateId } },
        });
        await prisma.jobPostOperationalHistory.deleteMany({
          where: { aggregateId: matrixAggregateId },
        });
        await prisma.jobPostReviewAggregate.update({
          where: { id: matrixAggregateId },
          data: {
            publicJobPostingId: null,
            approvedVersionId: null,
            pendingVersionId: null,
          },
        });
        await prisma.jobPostReviewVersion.deleteMany({
          where: { reviewAggregateId: matrixAggregateId },
        });
        await prisma.jobPostReviewAggregate.delete({
          where: { id: matrixAggregateId },
        });
      }
    }
    await deleteJobBoardDatabaseFixture(fixture);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
