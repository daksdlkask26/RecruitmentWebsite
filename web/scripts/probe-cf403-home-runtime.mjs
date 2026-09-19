import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import pg from "pg";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const execFileAsync = promisify(execFile);
const baseUrl = process.env.CF403_BASE_URL ?? "http://localhost:3001";
const adminOrigin =
  process.env.CF403_ADMIN_ORIGIN ?? "http://console.admin.localhost:3001";
const candidateOrigin =
  process.env.CF403_CANDIDATE_ORIGIN ?? "http://localhost:3001";
const password = `Home candidate ${randomUUID()}!`;
const marker = `CF403 runtime ${randomUUID()}`;
const reportPath = resolve(
  process.cwd(),
  "../docs/audits/candidate-first/phase-4/evidence/cf403-runtime-smoke.json",
);

function cookieLine(response, pattern) {
  return response.headers.getSetCookie().find((value) => pattern.test(value));
}

async function fileSha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function delta(before, after) {
  return Object.fromEntries(
    Object.keys(before).map((key) => [key, after[key] - before[key]]),
  );
}

async function main() {
  const { assertTestDatabaseEnvironment } =
    await import("../tests/helpers/test-database-guard.ts");
  assertTestDatabaseEnvironment();
  const { prisma } = await import("../src/backend/database/prisma.ts");
  const { createJobBoardDatabaseFixture, deleteJobBoardDatabaseFixture } =
    await import("../tests/helpers/job-board-database-fixture.ts");
  const { chromium } = await import("playwright");
  const { AdminAuthService } =
    await import("../src/backend/admin/authorization/admin-auth-service.ts");
  const { totp } =
    await import("../tests/system/e2e/admin-management/admin-e2e-totp.ts");

  const catalogueCompaniesPath = resolve(
    process.cwd(),
    "data/companies/companies.json",
  );
  const catalogueJobPaths = (await readdir(resolve(process.cwd(), "data/jobs")))
    .filter((name) => name.endsWith(".json"))
    .map((name) => resolve(process.cwd(), "data/jobs", name));
  const catalogueHashes = {
    companies: await fileSha256(catalogueCompaniesPath),
    jobs: await Promise.all(catalogueJobPaths.map(fileSha256)),
  };

  const fixture = await createJobBoardDatabaseFixture(
    "cf403-runtime",
    new Date(Date.now() - 24 * 60 * 60_000),
  );
  const employerId = fixture.userIds[1];
  const passwordHash = await (
    await import("better-auth/crypto")
  ).hashPassword(password);
  const authAccountId = randomUUID();
  const membershipId = `cf403-membership-${fixture.suffix}`;
  let adminRunId = null;
  let adminCookie = null;
  let adminContext = null;
  const browser = await chromium.launch({ headless: true });
  const guest = await browser.newContext();
  const account = await browser.newContext();

  const targetUrl = process.env.DATABASE_URL ?? "";
  const maintenanceUrl = targetUrl.replace(
    /\/[^/?]+(?=\?schema=public|$)/u,
    "/postgres",
  );
  const statsPool = new pg.Pool({ connectionString: maintenanceUrl });
  async function stats() {
    const rows = await statsPool.query(
      `SELECT xact_commit, tup_returned, blks_read, blks_hit
       FROM pg_stat_database WHERE datname = $1`,
      [process.env.TEST_DATABASE_NAME],
    );
    const row = rows.rows[0] ?? {};
    return {
      xact_commit: Number(row.xact_commit ?? 0),
      tup_returned: Number(row.tup_returned ?? 0),
      blks_read: Number(row.blks_read ?? 0),
      blks_hit: Number(row.blks_hit ?? 0),
    };
  }
  async function readUrl(request, url) {
    const startedAt = performance.now();
    const before = await stats();
    const response = await request.get(url);
    const body = await response.text();
    const after = await stats();
    return {
      url,
      status: response.status(),
      latencyMs: Number((performance.now() - startedAt).toFixed(2)),
      htmlBytes: Buffer.byteLength(body),
      bodyContainsMarker: body.includes(marker),
      bodyContainsActiveJob: body.includes(fixture.jobs.active.slug),
      cacheControl: response.headers()["cache-control"] ?? null,
      cacheHeader: response.headers()["x-nextjs-cache"] ?? null,
      dbDelta: delta(before, after),
    };
  }

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
        "cf403-runtime",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const environment = JSON.parse(stdout.trim());
    adminRunId = environment.runId;
    const credentials = environment.administrators["cf403-runtime"];
    const auth = new AdminAuthService();
    const request = new Request(adminOrigin, {
      headers: {
        origin: adminOrigin,
        "x-forwarded-for": `cf403-admin-${adminRunId}`,
        "user-agent": "cf403-runtime-probe",
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
    return { loginStatus: login.status, adminCookie: Boolean(adminCookie) };
  }

  async function adminCommand(action, expectedVersion) {
    const contextResponse = await adminContext.request.get(
      `${adminOrigin}/api/admin/auth/context`,
      {
        headers: {
          Cookie: adminCookie,
          "sec-fetch-site": "same-origin",
        },
      },
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
              ? "CF403 safety invalidation runtime probe removal."
              : "CF403 safety invalidation runtime probe restoration.",
        },
      },
    );
    return {
      contextStatus: contextResponse.status(),
      status: response.status(),
      body: await response.text(),
    };
  }

  try {
    await prisma.company.update({
      where: { id: fixture.company.id },
      data: {
        displayName: marker,
        publicDescription: marker,
        size: "51-200",
        industry: "Technology",
        address: "Hồ Chí Minh",
        normalizedTaxIdentifier: `cf403-${fixture.suffix}`,
        verifiedAt: new Date("2099-01-01T00:00:00.000Z"),
        verificationState: "ACTIVE",
      },
    });
    await prisma.jobPosting.update({
      where: { id: fixture.jobs.active.id },
      data: {
        title: marker,
        normalizedTitle: marker.toLocaleLowerCase(),
        searchDocumentNormalized: marker.toLocaleLowerCase(),
      },
    });
    await prisma.authProviderAccount.create({
      data: {
        id: authAccountId,
        accountId: employerId,
        providerId: "credential",
        userId: employerId,
        password: passwordHash,
      },
    });
    await prisma.companyMembership.create({
      data: {
        id: membershipId,
        companyId: fixture.company.id,
        userId: employerId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    const login = await account.request.post(`${baseUrl}/api/identity/login`, {
      headers: { Origin: candidateOrigin, "Sec-Fetch-Site": "same-origin" },
      data: {
        email: `${employerId}@example.test`,
        password,
        returnTo: "/dashboard",
      },
    });
    const adminSetup = await setupAdmin();
    const first = await readUrl(guest.request, `${baseUrl}/`);
    const warmReads = [];
    for (let index = 0; index < 10; index += 1)
      warmReads.push(await readUrl(guest.request, `${baseUrl}/`));
    const jobsBefore = await readUrl(
      account.request,
      `${baseUrl}/api/jobs?limit=20`,
    );
    const detailBeforeResponse = await account.request.get(
      `${baseUrl}/api/companies/${encodeURIComponent(fixture.company.id)}`,
    );
    const detailBeforeBody = await detailBeforeResponse.text();
    const detailBefore = {
      status: detailBeforeResponse.status(),
      bodyContainsMarker: detailBeforeBody.includes(marker),
    };

    const ban = await adminCommand("ban", 1);
    const postHome = await readUrl(guest.request, `${baseUrl}/`);
    const postJobs = await readUrl(
      account.request,
      `${baseUrl}/api/jobs?limit=20`,
    );
    const postDetailResponse = await account.request.get(
      `${baseUrl}/api/companies/${encodeURIComponent(fixture.company.id)}`,
    );
    const postDetailBody = await postDetailResponse.text();
    const postDetail = {
      status: postDetailResponse.status(),
      bodyContainsMarker: postDetailBody.includes(marker),
    };
    const unban = await adminCommand("unban", 2);

    const warmHitCount = warmReads.filter(
      (read) =>
        read.status === 200 &&
        Object.values(read.dbDelta).every((value) => value === 0),
    ).length;
    const assessment = {
      coldRead:
        first.status === 200 && first.bodyContainsMarker ? "PASS" : "FAIL",
      warmPublicCacheHit:
        warmHitCount / warmReads.length >= 0.9 ? "PASS" : "FAIL",
      preMutationProjection:
        jobsBefore.status === 200 &&
        detailBefore.status === 200 &&
        detailBefore.bodyContainsMarker
          ? "PASS"
          : "FAIL",
      realSafetyMutationRoute:
        login.status() === 200 &&
        adminSetup.loginStatus === 200 &&
        ban.contextStatus === 200 &&
        ban.status === 200 &&
        unban.status === 200
          ? "PASS"
          : "FAIL",
      firstReadAfterSafetyMutation:
        postHome.status === 200 &&
        !postHome.bodyContainsMarker &&
        postJobs.status === 200 &&
        !postJobs.bodyContainsActiveJob &&
        postDetail.status === 404 &&
        !postDetail.bodyContainsMarker
          ? "PASS"
          : "FAIL",
      safetyInvalidationImmediate:
        postHome.status === 200 &&
        !postHome.bodyContainsMarker &&
        postDetail.status === 404
          ? "PASS"
          : "FAIL",
      catalogueUnchanged:
        (await fileSha256(catalogueCompaniesPath)) ===
          catalogueHashes.companies &&
        JSON.stringify(await Promise.all(catalogueJobPaths.map(fileSha256))) ===
          JSON.stringify(catalogueHashes.jobs)
          ? "PASS"
          : "FAIL",
    };
    const result = {
      schemaVersion: "candidate-first-cf403-home-runtime-v3",
      generatedAt: new Date().toISOString(),
      commit: "583171bf8cdb3cc76fea4a6ce818e89208a99dfb",
      environment: {
        runtime: "Next production server via npm run start",
        baseUrl,
        candidateOrigin,
        adminOrigin,
        database: process.env.TEST_DATABASE_NAME,
        databaseIsolation: "task-owned isolated PostgreSQL database",
        cacheImplementation:
          "unstable_cache public home snapshot with immediate safety expiry",
      },
      method: {
        firstRead: "fresh guest GET / after marker committed in isolated DB",
        warmRead: "ten guest GET / reads without mutation",
        safetyMutation:
          "authenticated administrator POST /api/admin/companies/:id/ban",
        postMutationReads: ["GET /", "GET /api/jobs", "GET /api/companies/:id"],
        noTrackedCatalogueMutation: true,
      },
      results: {
        first,
        warm: warmReads.at(-1),
        warmReads,
        jobsBefore,
        detailBefore,
        loginStatus: login.status(),
        mutation: { ban, unban },
        postMutation: { home: postHome, jobs: postJobs, detail: postDetail },
      },
      assessment,
      limitations: [
        "PostgreSQL counters are the runtime hit/miss signal because this force-dynamic page does not emit x-nextjs-cache.",
        "The safety mutation is the production admin route and its first Home, job-list, and company-detail bodies are checked after the committed ban.",
      ],
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(
      reportPath.replace(/\.json$/u, ".md"),
      [
        "# CF-403 Home runtime cache and safety invalidation",
        "",
        `- Generated: ${result.generatedAt}`,
        `- Database: ${result.environment.database}`,
        ...Object.entries(assessment).map(
          ([key, status]) => `- ${key}: **${status}**`,
        ),
        "",
        ...result.limitations.map(
          (limitation) => `- Limitation: ${limitation}`,
        ),
        "",
      ].join("\n"),
      "utf8",
    );
    if (Object.values(assessment).some((status) => status !== "PASS"))
      throw new Error("CF-403 runtime gate failed");
  } finally {
    await guest.close();
    await account.close();
    if (adminContext) await adminContext.close();
    await browser.close();
    await statsPool.end();
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
        {
          cwd: process.cwd(),
          env: process.env,
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
    }
    await deleteJobBoardDatabaseFixture(fixture);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
