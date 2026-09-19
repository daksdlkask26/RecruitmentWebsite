import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const execFileAsync = promisify(execFile);
const baseUrl = process.env.CF403_BASE_URL ?? "http://localhost:3001";
const adminOrigin =
  process.env.CF403_ADMIN_ORIGIN ?? "http://console.admin.localhost:3001";
const adminTransportOrigin =
  process.env.CF403_ADMIN_TRANSPORT_ORIGIN ?? "http://127.0.0.1:3001";
const reportPath = resolve(
  process.cwd(),
  "../docs/audits/candidate-first/phase-4/evidence/cf403-authoritative-invalidation.json",
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
  const { csrfProof } =
    await import("../src/backend/security/csrf/csrf-proof.ts");
  const { closeManagedJobPost, reopenManagedJobPost } =
    await import("../src/backend/jobs/review/job-post-review-service.ts");
  const { jobReviewSnapshotFromCatalog, jobReviewSnapshotSha256 } =
    await import("../src/backend/jobs/review/job-post-review-policy.ts");
  const { chromium } = await import("playwright");
  const { AdminAuthService } =
    await import("../src/backend/admin/authorization/admin-auth-service.ts");
  const { totp } =
    await import("../tests/system/e2e/admin-management/admin-e2e-totp.ts");

  const marker = `CF403 authoritative job ${randomUUID()}`;
  const companyMarker = `CF403 authoritative company ${randomUUID()}`;
  const profileMarker = `${companyMarker} profile`;
  const republishMarker = `${marker} republished`;
  const fixture = await createJobBoardDatabaseFixture(
    "cf403-authoritative-final",
    new Date(Date.now() - 24 * 60 * 60_000),
  );
  const employerId = fixture.userIds[1];
  const activeJob = fixture.jobs.active;
  const browser = await chromium.launch({ headless: true });
  const guest = await browser.newContext();
  const account = await browser.newContext();
  let adminContext = null;
  let adminRunId = null;
  let aggregateId = null;
  let approvedVerificationId;
  const results = [];

  async function watermark() {
    const row = await prisma.publicDiscoveryInvalidation.findUnique({
      where: { id: "singleton" },
      select: { version: true },
    });
    return row?.version?.toString() ?? null;
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
        "cf403-authoritative-final",
      ],
      { cwd: process.cwd(), env: process.env, windowsHide: true },
    );
    const environment = JSON.parse(stdout.trim());
    adminRunId = environment.runId;
    const credentials = environment.administrators["cf403-authoritative-final"];
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
        "x-forwarded-for": `cf403-authoritative-${adminRunId}`,
        "user-agent": "cf403-authoritative-final",
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
    adminContext = await browser.newContext();
    return {
      credentials,
      cookie: sessionCookie.split(";", 1)[0],
      loginStatus: login.status,
    };
  }

  async function adminContextToken(cookie) {
    const response = await adminContext.request.get(
      `${adminTransportOrigin}/api/admin/auth/context`,
      {
        headers: {
          Cookie: cookie,
          Host: new URL(adminOrigin).host,
          "sec-fetch-site": "same-origin",
        },
      },
    );
    if (response.status() !== 200)
      throw new Error(
        `CF403_ADMIN_CONTEXT_FAILED:${response.status()}:${await response.text()}`,
      );
    return (await response.json()).csrfToken;
  }

  async function adminPost(path, cookie, csrf, expectedVersion, body) {
    const response = await adminContext.request.post(
      `${adminTransportOrigin}${path}`,
      {
        headers: {
          Cookie: cookie,
          Host: new URL(adminOrigin).host,
          Origin: adminOrigin,
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "If-Match": `"${expectedVersion}"`,
          "Idempotency-Key": randomUUID(),
        },
        data: body,
      },
    );
    return { status: response.status(), body: await response.text() };
  }

  async function readSurfaces() {
    const values = {};
    const urls = {
      home: `${baseUrl}/`,
      // Search for the unique fixture title so the listing assertion is about
      // this job, rather than an arbitrary first page that may not include it.
      jobs: `${baseUrl}/api/jobs?q=${encodeURIComponent(marker)}&limit=20`,
      company: `${baseUrl}/api/companies/${encodeURIComponent(fixture.company.id)}`,
      job: `${baseUrl}/api/jobs/${encodeURIComponent(activeJob.slug)}`,
    };
    for (const [key, url] of Object.entries(urls)) {
      const request =
        key === "company" || key === "job" ? account.request : guest.request;
      const response = await request.get(url);
      const body = await response.text();
      let jobResultBody = body;
      if (key === "jobs") {
        try {
          const payload = JSON.parse(body);
          jobResultBody = JSON.stringify(
            Array.isArray(payload?.items) ? payload.items : [],
          );
        } catch {
          jobResultBody = "";
        }
      }
      values[key] = {
        status: response.status(),
        body,
        containsJobMarker:
          jobResultBody.includes(marker) ||
          jobResultBody.includes(republishMarker),
        containsRepublishMarker: jobResultBody.includes(republishMarker),
        containsCompanyMarker:
          body.includes(companyMarker) || body.includes(profileMarker),
        containsProfileMarker: body.includes(profileMarker),
      };
    }
    return values;
  }

  function visible(reads) {
    return (
      reads.home.status === 200 &&
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
      reads.company.status === 404 &&
      reads.job.status === 404
    );
  }

  function jobHidden(reads) {
    return (
      !reads.home.containsJobMarker &&
      !reads.jobs.containsJobMarker &&
      reads.company.status === 200 &&
      reads.job.status === 404
    );
  }

  function restored(reads) {
    return (
      reads.home.status === 200 &&
      reads.jobs.status === 200 &&
      reads.jobs.containsJobMarker &&
      reads.company.status === 200 &&
      reads.company.containsCompanyMarker &&
      reads.job.status === 200 &&
      reads.job.containsJobMarker
    );
  }

  async function recordCommitted(name, mutation, check, metadata = {}) {
    const beforeWatermark = await watermark();
    const beforeRead = await readSurfaces();
    const mutationResult = await mutation();
    const afterRead = await readSurfaces();
    const afterWatermark = await watermark();
    const pass = check(beforeRead, afterRead, mutationResult);
    const watermarkAdvanced =
      beforeWatermark !== null &&
      afterWatermark !== null &&
      BigInt(afterWatermark) > BigInt(beforeWatermark);
    const result = {
      name,
      mutationResult,
      beforeMutation: beforeRead,
      firstReadAfterCommit: afterRead,
      beforeWatermark,
      afterWatermark,
      watermarkAdvanced,
      status: pass && watermarkAdvanced ? "PASS" : "FAIL",
      ...metadata,
    };
    results.push(result);
    if (result.status !== "PASS") {
      console.error(
        JSON.stringify(
          {
            ...result,
            firstReadAfterCommit: Object.fromEntries(
              Object.entries(afterRead).map(([key, value]) => [
                key,
                {
                  status: value.status,
                  containsJobMarker: value.containsJobMarker,
                  containsCompanyMarker: value.containsCompanyMarker,
                  bodyPreview:
                    key === "jobs" ? value.body.slice(0, 1200) : undefined,
                },
              ]),
            ),
          },
          null,
          2,
        ),
      );
      throw new Error(`CF403_AUTH_FAILED:${name}`);
    }
    return result;
  }

  async function recordFailure(
    name,
    mutation,
    expectedStatus,
    metadata = {},
    responseCheck = () => true,
  ) {
    const beforeRead = await readSurfaces();
    const beforeWatermark = await watermark();
    const mutationResult = await mutation();
    const afterRead = await readSurfaces();
    const afterWatermark = await watermark();
    const sameWatermark = beforeWatermark === afterWatermark;
    // Public responses contain volatile timestamps and ranking metadata. A
    // byte-for-byte comparison would report a false failure even when the
    // failed command left the authoritative public state untouched. Compare
    // the mutation-relevant status/markers instead.
    const samePublicState = ["home", "jobs", "company", "job"].every((key) => {
      const before = beforeRead[key];
      const after = afterRead[key];
      return (
        before.status === after.status &&
        before.containsJobMarker === after.containsJobMarker &&
        before.containsCompanyMarker === after.containsCompanyMarker &&
        before.containsProfileMarker === after.containsProfileMarker &&
        before.containsRepublishMarker === after.containsRepublishMarker
      );
    });
    const expectedResponse =
      mutationResult &&
      typeof mutationResult === "object" &&
      "status" in mutationResult &&
      mutationResult.status === expectedStatus &&
      responseCheck(mutationResult);
    const result = {
      name,
      mutationResult,
      expectedStatus,
      beforeWatermark,
      afterWatermark,
      sameWatermark,
      samePublicState,
      expectedResponse,
      status:
        expectedResponse && sameWatermark && samePublicState ? "PASS" : "FAIL",
      ...metadata,
    };
    results.push(result);
    if (result.status !== "PASS") {
      console.error(JSON.stringify(result, null, 2));
      throw new Error(`CF403_AUTH_FAILED:${name}`);
    }
    return result;
  }

  try {
    const originalCompany = await prisma.company.findUniqueOrThrow({
      where: { id: fixture.company.id },
      select: { moderationVersion: true },
    });
    await prisma.company.update({
      where: { id: fixture.company.id },
      data: {
        displayName: companyMarker,
        publicDescription: companyMarker,
        publicLocation: "Ho Chi Minh",
        normalizedTaxIdentifier: `9${fixture.suffix.replace(/\D/gu, "").padEnd(9, "0").slice(0, 9)}`,
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
    const membershipId = `cf403-authoritative-owner-${fixture.suffix}`;
    await prisma.companyMembership.create({
      data: {
        id: membershipId,
        companyId: fixture.company.id,
        userId: employerId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    const password = `CF403 authoritative ${randomUUID()}!`;
    const passwordHash = await (
      await import("better-auth/crypto")
    ).hashPassword(password);
    await prisma.authProviderAccount.create({
      data: {
        id: `cf403-authoritative-auth-${fixture.suffix}`,
        accountId: employerId,
        providerId: "credential",
        userId: employerId,
        password: passwordHash,
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
        shortPitch: "A public job used by the authoritative CF-403 probe.",
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
    // Approval projects the search profile through the authoritative search
    // mapping-review relation. Seed only the catalog-version row required by
    // that real route; the isolated database intentionally starts empty.
    await prisma.searchCatalogVersion.upsert({
      where: { version: snapshotBase.searchProfile.catalogVersion },
      create: {
        id: `cf403-authoritative-catalog-${fixture.suffix}`,
        version: snapshotBase.searchProfile.catalogVersion,
        status: "PUBLISHED",
        isActive: true,
        catalogPayload: {},
        publishedAt: new Date(),
      },
      update: { status: "PUBLISHED", isActive: true },
    });
    const aggregate = await prisma.jobPostReviewAggregate.create({
      data: {
        id: `cf403-authoritative-aggregate-${fixture.suffix}`,
        jobId: activeJob.id,
        companyId: fixture.company.id,
        latestSequence: 1,
        publicJobPostingId: activeJob.id,
        visibilityState: "PUBLISHED",
        applicationState: "OPEN",
      },
    });
    aggregateId = aggregate.id;
    const baselineReviewId = `cf403-authoritative-baseline-${fixture.suffix}`;
    await prisma.jobPostReviewVersion.create({
      data: {
        id: baselineReviewId,
        reviewAggregateId: aggregate.id,
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
      where: { id: aggregate.id },
      data: { approvedVersionId: baselineReviewId },
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
      throw new Error(
        `CF403_EMPLOYER_LOGIN_FAILED:${login.status()}:${await login.text()}`,
      );
    const session = await prisma.session.findFirstOrThrow({
      where: { userId: employerId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const accountCsrf = csrfProof(session.id);
    const admin = await setupAdmin();

    const profileSettingsResponse = await account.request.get(
      `${baseUrl}/api/recruiter/company?companyId=${encodeURIComponent(fixture.company.id)}`,
    );
    if (profileSettingsResponse.status() !== 200)
      throw new Error("CF403_PROFILE_SETTINGS_READ_FAILED");
    const profileSettings = await profileSettingsResponse.json();
    await recordCommitted(
      "authoritative recruiter company profile PATCH",
      async () => {
        const response = await account.request.patch(
          `${baseUrl}/api/recruiter/company?companyId=${encodeURIComponent(fixture.company.id)}`,
          {
            headers: {
              Origin: baseUrl,
              "Sec-Fetch-Site": "same-origin",
              "X-CSRF-Token": accountCsrf,
              "Content-Type": "application/json",
            },
            data: {
              name: profileMarker,
              logo: profileSettings.logoUrl ?? null,
              size: "51-200",
              industry: "Technology",
              address: "Ho Chi Minh",
              website: profileSettings.websiteUrl ?? null,
              description: profileMarker,
              foundedYear: profileSettings.foundedYear ?? null,
            },
          },
        );
        return { status: response.status(), body: await response.text() };
      },
      (before, reads, mutationResult) =>
        mutationResult.status === 200 &&
        ["home", "jobs", "company", "job"].every(
          (key) =>
            !before[key].containsProfileMarker &&
            reads[key].containsProfileMarker,
        ),
      {
        mutationClass: "profile-edit",
        authoritativePath: "PATCH /api/recruiter/company",
      },
    );

    await recordFailure(
      "profile PATCH validation failure does not invalidate",
      async () => {
        const response = await account.request.patch(
          `${baseUrl}/api/recruiter/company?companyId=${encodeURIComponent(fixture.company.id)}`,
          {
            headers: {
              Origin: baseUrl,
              "Sec-Fetch-Site": "same-origin",
              "X-CSRF-Token": accountCsrf,
              "Content-Type": "application/json",
            },
            data: { unsupported: true },
          },
        );
        return { status: response.status(), body: await response.text() };
      },
      422,
      { failureClass: "authoritative-route-validation" },
    );

    const csrf = await adminContextToken(admin.cookie);
    const currentCompany = await prisma.company.findUniqueOrThrow({
      where: { id: fixture.company.id },
      select: { moderationVersion: true },
    });
    await recordCommitted(
      "authoritative company moderation ban",
      () =>
        adminPost(
          `/api/admin/companies/${encodeURIComponent(fixture.company.id)}/ban`,
          admin.cookie,
          csrf,
          currentCompany.moderationVersion,
          {
            confirmation: true,
            reasonCategory: "POLICY_VIOLATION",
            explanation: "CF403 authoritative safety removal.",
          },
        ),
      (before, reads, result) =>
        result.status === 200 && visible(before) && hidden(reads),
      {
        mutationClass: "company-moderation-ban",
        authoritativePath: "POST /api/admin/companies/:companyId/ban",
      },
    );
    const afterBanCompany = await prisma.company.findUniqueOrThrow({
      where: { id: fixture.company.id },
      select: { moderationVersion: true },
    });
    await recordCommitted(
      "authoritative company moderation unban",
      () =>
        adminPost(
          `/api/admin/companies/${encodeURIComponent(fixture.company.id)}/unban`,
          admin.cookie,
          csrf,
          afterBanCompany.moderationVersion,
          {
            confirmation: true,
            reasonCategory: "INCIDENT_RESOLVED",
            explanation: "CF403 authoritative safety restoration.",
          },
        ),
      (before, reads, result) =>
        result.status === 200 && hidden(before) && restored(reads),
      {
        mutationClass: "company-moderation-unban",
        authoritativePath: "POST /api/admin/companies/:companyId/unban",
      },
    );

    const staleCompany = await prisma.company.findUniqueOrThrow({
      where: { id: fixture.company.id },
      select: { moderationVersion: true },
    });
    await recordFailure(
      "stale company moderation command rolls back without invalidation",
      () =>
        adminPost(
          `/api/admin/companies/${encodeURIComponent(fixture.company.id)}/ban`,
          admin.cookie,
          csrf,
          Math.max(1, staleCompany.moderationVersion - 1),
          {
            confirmation: true,
            reasonCategory: "POLICY_VIOLATION",
            explanation: "CF403 stale command must not commit.",
          },
        ),
      409,
      { failureClass: "authoritative-route-stale-version" },
    );

    const pendingSnapshot = {
      ...snapshotBase,
      title: republishMarker,
      searchProfile: {
        ...snapshotBase.searchProfile,
        normalizedTitle: republishMarker.toLocaleLowerCase(),
        titleIds: [],
        occupationIds: [],
        translationStatus: "INTENTIONAL_UNTRANSLATED",
        mappingSource: "CURATED",
        mappingConfidence: 0.5,
        reviewReason: null,
      },
    };
    const pendingReviewId = `cf403-authoritative-pending-${fixture.suffix}`;
    await prisma.jobPostReviewVersion.create({
      data: {
        id: pendingReviewId,
        reviewAggregateId: aggregate.id,
        sequence: 2,
        snapshot: pendingSnapshot,
        snapshotSchemaVersion: "1",
        snapshotSha256: jobReviewSnapshotSha256(pendingSnapshot),
        state: "PENDING_REVIEW",
        submittedByUserId: employerId,
        submittedMembershipId: membershipId,
        submissionIdempotencyKey: randomUUID(),
        submissionRequestHash: jobReviewSnapshotSha256(pendingSnapshot),
        assignedAdminUserId: admin.credentials.userId,
        assignedAt: new Date(),
        submittedAt: new Date(),
      },
    });
    const pendingAggregate = await prisma.jobPostReviewAggregate.update({
      where: { id: aggregate.id },
      data: {
        pendingVersionId: pendingReviewId,
        latestSequence: 2,
        version: { increment: 1 },
      },
    });
    await recordCommitted(
      "authoritative admin job approval and republish",
      () =>
        adminPost(
          `/api/admin/job-post-reviews/${encodeURIComponent(pendingReviewId)}/approve`,
          admin.cookie,
          csrf,
          pendingAggregate.version,
          { command: "APPROVE" },
        ),
      (before, reads, result) =>
        result.status === 200 &&
        !before.jobs.containsRepublishMarker &&
        !before.job.containsRepublishMarker &&
        reads.jobs.containsRepublishMarker &&
        reads.job.containsRepublishMarker,
      {
        mutationClass: "job-approval-republish",
        authoritativePath: "POST /api/admin/job-post-reviews/:reviewId/approve",
      },
    );

    await recordFailure(
      "stale job approval command rolls back without invalidation",
      () =>
        adminPost(
          `/api/admin/job-post-reviews/${encodeURIComponent(pendingReviewId)}/approve`,
          admin.cookie,
          csrf,
          pendingAggregate.version,
          { command: "APPROVE" },
        ),
      200,
      { failureClass: "authoritative-route-stale-version" },
      (response) =>
        typeof response.body === "string" &&
        /"status":"ACTION_BLOCKED"/u.test(response.body) &&
        /"code":"ACTION_BLOCKED"/u.test(response.body),
    );

    await recordCommitted(
      "authoritative recruiter close service",
      () =>
        closeManagedJobPost({
          jobId: activeJob.id,
          companyId: fixture.company.id,
          actorUserId: employerId,
        }),
      (before, reads, result) =>
        result === true && visible(before) && jobHidden(reads),
      {
        mutationClass: "recruiter-close",
        authoritativePath: "closeManagedJobPost",
      },
    );
    await recordCommitted(
      "authoritative recruiter reopen service",
      () =>
        reopenManagedJobPost({
          jobId: activeJob.id,
          companyId: fixture.company.id,
          actorUserId: employerId,
        }),
      (before, reads, result) =>
        result === true && jobHidden(before) && visible(reads),
      {
        mutationClass: "recruiter-reopen",
        authoritativePath: "reopenManagedJobPost",
      },
    );

    const raceVersion = (
      await prisma.company.findUniqueOrThrow({
        where: { id: fixture.company.id },
        select: { moderationVersion: true },
      })
    ).moderationVersion;
    const raceBefore = await watermark();
    const raceBeforeRead = await readSurfaces();
    const raceResults = await Promise.all([
      adminPost(
        `/api/admin/companies/${encodeURIComponent(fixture.company.id)}/ban`,
        admin.cookie,
        csrf,
        raceVersion,
        {
          confirmation: true,
          reasonCategory: "POLICY_VIOLATION",
          explanation: "CF403 concurrent safety removal A.",
        },
      ),
      adminPost(
        `/api/admin/companies/${encodeURIComponent(fixture.company.id)}/ban`,
        admin.cookie,
        csrf,
        raceVersion,
        {
          confirmation: true,
          reasonCategory: "POLICY_VIOLATION",
          explanation: "CF403 concurrent safety removal B.",
        },
      ),
    ]);
    const raceAfter = await watermark();
    const raceRead = await readSurfaces();
    const racePass =
      raceResults.filter((result) => result.status === 200).length === 1 &&
      raceResults.some((result) => result.status === 409) &&
      raceBefore !== null &&
      raceAfter !== null &&
      BigInt(raceAfter) - BigInt(raceBefore) === 1n &&
      visible(raceBeforeRead) &&
      hidden(raceRead);
    results.push({
      name: "concurrent moderation commands have one commit and one stale loser",
      mutationResult: raceResults,
      beforeMutation: raceBeforeRead,
      beforeWatermark: raceBefore,
      afterWatermark: raceAfter,
      firstReadAfterCommit: raceRead,
      status: racePass ? "PASS" : "FAIL",
      mutationClass: "concurrency-race",
      authoritativePath: "POST /api/admin/companies/:companyId/ban x2",
    });
    if (!racePass) throw new Error("CF403_AUTH_FAILED:moderation-race");
    const afterRaceCompany = await prisma.company.findUniqueOrThrow({
      where: { id: fixture.company.id },
      select: { moderationVersion: true },
    });
    await recordCommitted(
      "restore after concurrent moderation race",
      () =>
        adminPost(
          `/api/admin/companies/${encodeURIComponent(fixture.company.id)}/unban`,
          admin.cookie,
          csrf,
          afterRaceCompany.moderationVersion,
          {
            confirmation: true,
            reasonCategory: "INCIDENT_RESOLVED",
            explanation: "CF403 restore after race.",
          },
        ),
      (before, reads, result) =>
        result.status === 200 && hidden(before) && restored(reads),
      { mutationClass: "company-moderation-restore" },
    );

    await prisma.jobPosting.update({
      where: { id: activeJob.id },
      data: {
        // Keep the job visible at the real clock. The standalone worker is
        // invoked with a controlled future clock so its archive, rather than
        // natural deadline expiry, is the only visibility transition.
        publishedAt: new Date(Date.now() - 5 * 60_000),
        applicationDeadline: new Date(Date.now() + 60 * 60_000),
        status: "ACTIVE",
        closedAt: null,
        removedAt: null,
      },
    });
    await prisma.jobPostReviewAggregate.update({
      where: { id: aggregate.id },
      data: {
        closedAt: null,
        archivedAt: null,
        applicationClosedAt: null,
        visibilityState: "PUBLISHED",
        applicationState: "OPEN",
        version: { increment: 1 },
      },
    });
    const workerBeforeWatermark = await watermark();
    const workerBeforeRead = await readSurfaces();
    if (!visible(workerBeforeRead))
      throw new Error("CF403_WORKER_FIXTURE_NOT_VISIBLE");
    const workerClock = new Date(Date.now() + 2 * 60 * 60_000);
    const workerCode =
      "import { runJobPostLifecycleCycle } from './src/backend/admin/workers/job-post-lifecycle-loop.ts'; const result = await runJobPostLifecycleCycle(new Date(" +
      JSON.stringify(workerClock.toISOString()) +
      ")); console.log(JSON.stringify(result));";
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
    const workerResult = JSON.parse(
      worker.stdout.trim().split(/\r?\n/u).at(-1),
    );
    const workerRead = await readSurfaces();
    const workerWatermark = await watermark();
    const workerWatermarkAdvanced =
      workerBeforeWatermark !== null &&
      workerWatermark !== null &&
      BigInt(workerWatermark) > BigInt(workerBeforeWatermark);
    const workerPass =
      visible(workerBeforeRead) &&
      jobHidden(workerRead) &&
      workerResult.archived >= 1 &&
      workerWatermarkAdvanced;
    results.push({
      name: "standalone lifecycle worker commits and invalidates across process boundary",
      mutationResult: workerResult,
      beforeMutation: workerBeforeRead,
      firstReadAfterCommit: workerRead,
      beforeWatermark: workerBeforeWatermark,
      afterWatermark: workerWatermark,
      watermarkAdvanced: workerWatermarkAdvanced,
      status: workerPass ? "PASS" : "FAIL",
      mutationClass: "deadline-lifecycle-worker",
      authoritativePath: "runJobPostLifecycleCycle in standalone child process",
      processBoundary: "worker child -> production Next server",
      workerClock: workerClock.toISOString(),
    });
    if (!workerPass) throw new Error("CF403_AUTH_FAILED:lifecycle-worker");

    const verificationScript = resolve(
      process.cwd(),
      "tests/system/e2e/admin-management/admin-e2e-control.mjs",
    );
    const verificationSetup = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            verificationScript,
            "create-verification",
            adminRunId,
            "PASS",
          ],
          { cwd: process.cwd(), env: process.env, windowsHide: true },
        )
      ).stdout.trim(),
    );
    const verificationRow =
      await prisma.recruiterVerificationRequest.findUniqueOrThrow({
        where: { id: verificationSetup.requestId },
        select: { version: true },
      });
    const verificationClaim = await adminPost(
      `/api/admin/verification-requests/${encodeURIComponent(verificationSetup.requestId)}/claim`,
      admin.cookie,
      csrf,
      verificationRow.version,
      {},
    );
    if (verificationClaim.status !== 200)
      throw new Error(
        `CF403_VERIFICATION_CLAIM_FAILED:${JSON.stringify(verificationClaim)}`,
      );
    const claimedVerification =
      await prisma.recruiterVerificationRequest.findUniqueOrThrow({
        where: { id: verificationSetup.requestId },
        select: { version: true },
      });
    const verificationBefore = await watermark();
    const verificationResponse = await adminPost(
      `/api/admin/verification-requests/${encodeURIComponent(verificationSetup.requestId)}/approve`,
      admin.cookie,
      csrf,
      claimedVerification.version,
      { role: "OWNER", protectedNote: "CF403 authoritative approval." },
    );
    const verificationAfter = await watermark();
    const verificationBody = JSON.parse(verificationResponse.body);
    approvedVerificationId = verificationBody.companyId ?? null;
    const verificationRead = approvedVerificationId
      ? await account.request.get(
          `${baseUrl}/api/companies/${encodeURIComponent(approvedVerificationId)}`,
        )
      : null;
    const verificationPass =
      verificationResponse.status === 200 &&
      approvedVerificationId &&
      verificationRead?.status() === 200 &&
      verificationBefore !== null &&
      verificationAfter !== null &&
      BigInt(verificationAfter) > BigInt(verificationBefore);
    results.push({
      name: "authoritative verification approval publishes company visibility",
      mutationResult: verificationResponse,
      firstReadAfterCommit: verificationRead
        ? {
            status: verificationRead.status(),
            body: await verificationRead.text(),
          }
        : null,
      beforeWatermark: verificationBefore,
      afterWatermark: verificationAfter,
      watermarkAdvanced:
        verificationBefore !== null &&
        verificationAfter !== null &&
        BigInt(verificationAfter) > BigInt(verificationBefore),
      status: verificationPass ? "PASS" : "FAIL",
      mutationClass: "verification-approval",
      authoritativePath:
        "POST /api/admin/verification-requests/:requestId/approve",
    });
    if (!verificationPass)
      throw new Error(
        `CF403_AUTH_FAILED:verification:${JSON.stringify({
          response: verificationResponse,
          approvedVerificationId,
          readStatus: verificationRead?.status() ?? null,
          before: verificationBefore,
          after: verificationAfter,
        })}`,
      );

    const companyNow = await prisma.company.findUniqueOrThrow({
      where: { id: fixture.company.id },
      select: { moderationState: true, moderationVersion: true },
    });
    if (companyNow.moderationState !== "ACTIVE")
      throw new Error("CF403_RESTORE_FAILED");
    const assessment = Object.fromEntries(
      results.map((entry) => [entry.name, entry.status]),
    );
    const result = {
      schemaVersion: "candidate-first-cf403-authoritative-final-v2",
      generatedAt: new Date().toISOString(),
      environment: {
        runtime:
          "production Next server plus authoritative route/service calls and standalone lifecycle worker",
        baseUrl,
        adminOrigin,
        database: process.env.TEST_DATABASE_NAME,
        databaseIsolation: "task-owned isolated PostgreSQL database",
        durableSignal:
          "PostgreSQL PublicDiscoveryInvalidation singleton trigger watermark",
      },
      method: {
        directPrismaUsage:
          "fixture setup, read-only watermark/state checks, and cleanup only",
        committedMutations: results
          .filter((entry) => entry.mutationClass)
          .map((entry) => ({
            name: entry.name,
            authoritativePath: entry.authoritativePath,
            mutationClass: entry.mutationClass,
          })),
        surfaces: [
          "GET /",
          "GET /api/jobs",
          "GET /api/companies/:id",
          "GET /api/jobs/:slug",
        ],
        failureProof:
          "stale/invalid authoritative commands require the expected HTTP conflict/denial plus unchanged watermark and unchanged public visibility markers",
        concurrencyProof:
          "two same-version moderation commands; exactly one commit and one stale loser, with visible-before/hidden-after proof",
        firstReadProof:
          "every committed mutation records the pre-mutation public body and asserts a mutation-specific post-commit transition; the worker uses a future clock so natural deadline expiry cannot explain the removal",
        proofQuality: "independent-authoritative-route-and-worker",
      },
      results,
      assessment,
      safety: {
        originalCompanyModerationVersion: originalCompany.moderationVersion,
        fixtureCleanup:
          "task-owned isolated database is dropped after evidence collection",
      },
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(
      reportPath.replace(/\.json$/u, ".md"),
      [
        "# CF-403 authoritative mutation-to-read verification",
        "",
        `- Generated: ${result.generatedAt}`,
        `- Database: ${result.environment.database}`,
        "- Direct Prisma is restricted to fixture setup/read-only state checks; every listed mutation uses its production route, service, or worker boundary.",
        "",
        "| Mutation/failure/race | Result |",
        "| --- | --- |",
        ...results.map((entry) => `| ${entry.name} | **${entry.status}** |`),
        "",
      ].join("\n"),
      "utf8",
    );
    if (Object.values(assessment).some((status) => status !== "PASS"))
      throw new Error("CF-403 authoritative gate failed");
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
      ).catch(() => undefined);
    }
    if (aggregateId) {
      await prisma.jobPostReviewHistory
        .deleteMany({
          where: { reviewVersion: { reviewAggregateId: aggregateId } },
        })
        .catch(() => undefined);
      await prisma.jobPostReviewVersion
        .deleteMany({
          where: { reviewAggregateId: aggregateId },
        })
        .catch(() => undefined);
      await prisma.jobPostReviewAggregate
        .delete({ where: { id: aggregateId } })
        .catch(() => undefined);
    }
    await deleteJobBoardDatabaseFixture(fixture).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
