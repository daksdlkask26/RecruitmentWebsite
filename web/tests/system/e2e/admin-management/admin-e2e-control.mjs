import { createHmac, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });
const serverOnlyMarker = pathToFileURL(
  resolve(process.cwd(), "scripts/server-only-marker.mjs"),
).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnlyMarker, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { assertRequestedTestDatabase } =
  await import("../../../helpers/test-database-guard.ts");
assertRequestedTestDatabase();

async function recordReliabilityEvidence(record) {
  const path = process.env.ADMIN_E2E_RELIABILITY_EVIDENCE;
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/u, "").toUpperCase().replace(/\s+/gu, "");
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(buffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function cookieLine(response, pattern) {
  return response.headers.getSetCookie().find((value) => pattern.test(value));
}

const command = process.argv[2];
const arguments_ = process.argv.slice(3);
const { prisma } = await import("../../../../src/backend/database/prisma.ts");

async function setupAdministrator(runId, projectName) {
  const { createCredentialFixture } =
    await import("../../../helpers/credential-fixture.ts");
  const { BetterAuthSessionGateway } =
    await import("../../../../src/backend/auth/better-auth/better-auth-session-gateway.ts");
  const { BetterAuthTwoFactorGateway } =
    await import("../../../../src/backend/auth/better-auth/better-auth-two-factor-gateway.ts");
  const suffix = `${runId}-${projectName.replace(/[^a-z0-9-]/giu, "-")}`;
  const email = `admin-e2e-${suffix}@example.test`;
  const password = "Admin fixture password 2026!";
  const user = await createCredentialFixture({
    email,
    password,
    name: `E2E Administrator ${projectName}`,
  });
  const login = await new BetterAuthSessionGateway().signIn(
    email,
    password,
    new Headers({ "x-forwarded-for": `admin-e2e-${suffix}` }),
  );
  if (!login.ok) throw new Error("ADMIN_E2E_ENROLLMENT_LOGIN_FAILED");
  const session = cookieLine(
    login,
    /^(smarthire[.]session|__Host-smarthire[.]session)=/u,
  );
  if (!session) throw new Error("ADMIN_E2E_ENROLLMENT_SESSION_MISSING");
  const headers = new Headers({ cookie: session.split(";", 1)[0] });
  const gateway = new BetterAuthTwoFactorGateway();
  const enrollment = await gateway.startEnrollment(headers, password);
  const secret = new URL(enrollment.otpauthUri).searchParams.get("secret");
  if (!secret) throw new Error("ADMIN_E2E_ENROLLMENT_SECRET_MISSING");
  const verified = await gateway.verifyInitialTotp(headers, totp(secret));
  if (!verified.verified) throw new Error("ADMIN_E2E_ENROLLMENT_VERIFY_FAILED");
  const grant = await prisma.platformAdministratorGrant.create({
    data: { id: `grant-${suffix}`, userId: user.id, state: "ACTIVE" },
  });
  return {
    runId,
    userId: user.id,
    grantId: grant.id,
    email,
    password,
    totpSecret: secret,
  };
}

async function setupAuth(projectNames) {
  const runId = randomUUID();
  const administrators = {};
  try {
    for (const projectName of projectNames) {
      administrators[projectName] = await setupAdministrator(
        runId,
        projectName,
      );
    }
    return { runId, administrators };
  } catch (error) {
    await cleanupRun(runId);
    throw error;
  }
}

async function createManyInChunks(delegate, data, chunkSize = 1_000) {
  for (let index = 0; index < data.length; index += chunkSize)
    await delegate.createMany({ data: data.slice(index, index + chunkSize) });
}

async function authenticatePerformanceAdministrator(administrator, index) {
  const { AdminAuthService } =
    await import("../../../../src/backend/admin/authorization/admin-auth-service.ts");
  const service = new AdminAuthService();
  const headers = new Headers({
    origin: "http://console.admin.localhost:3001",
    "x-forwarded-for": `admin-performance-${index}`,
    "user-agent": `admin-performance-${index}`,
  });
  const request = new Request("http://console.admin.localhost:3001", {
    headers,
  });
  const login = await service.login(
    { email: administrator.email, password: administrator.password },
    request,
  );
  const preAuth = cookieLine(
    login,
    /^(smarthire[.]pre-auth|__Secure-smarthire[.]pre-auth)=/u,
  );
  if (!preAuth) throw new Error("ADMIN_PERF_PRE_AUTH_COOKIE_MISSING");
  const encoded = preAuth.slice(preAuth.indexOf("=") + 1, preAuth.indexOf(";"));
  const sessionCookie = await service.completeInitialFactor(
    decodeURIComponent(encoded),
    totp(administrator.totpSecret),
    request,
  );
  if (!sessionCookie) throw new Error("ADMIN_PERF_SESSION_COOKIE_MISSING");
  return sessionCookie.split(";", 1)[0];
}

async function setupPerformanceFixture() {
  const projectNames = Array.from(
    { length: 10 },
    (_, index) => `performance-${index + 1}`,
  );
  const environment = await setupAuth(projectNames);
  const runId = environment.runId;
  try {
    const candidateCount = 9_990;
    const candidateIds = Array.from(
      { length: candidateCount },
      (_, index) => `admin-perf-account-${runId}-${index}`,
    );
    await createManyInChunks(
      prisma.userAccount,
      candidateIds.map((id, index) => ({
        id,
        name: `Performance Candidate ${index}`,
        email: `${id}@example.test`,
        normalizedEmail: `${id}@example.test`,
        emailVerified: true,
        state:
          index % 20 === 0
            ? "SUSPENDED"
            : index % 20 === 1
              ? "PENDING_VERIFICATION"
              : "ACTIVE",
      })),
    );
    await createManyInChunks(
      prisma.candidateIdentity,
      candidateIds.map((userId) => ({ userId })),
    );

    const companyIds = Array.from(
      { length: 1_000 },
      (_, index) => `admin-perf-company-${runId}-${index}`,
    );
    await createManyInChunks(
      prisma.company,
      companyIds.map((id, index) => ({
        id,
        slug: `admin-perf-${runId}-${index}`,
        legalName: `Performance Company ${index}`,
        displayName: `Performance Company ${index}`,
        verificationState: "ACTIVE",
      })),
    );
    const roles = ["OWNER", "HR_MANAGER", "RECRUITER", "HIRING_MANAGER"];
    await createManyInChunks(
      prisma.companyMembership,
      Array.from({ length: 5_000 }, (_, index) => ({
        id: `admin-perf-membership-${runId}-${index}`,
        companyId: companyIds[index % companyIds.length],
        userId: candidateIds[index],
        role: roles[index % roles.length],
        priorApprovedRole: roles[index % roles.length],
        status: index % 10 === 0 ? "SUSPENDED" : "ACTIVE",
      })),
    );
    await createManyInChunks(
      prisma.recruiterVerificationRequest,
      Array.from({ length: 1_000 }, (_, index) => ({
        id: `admin-perf-verification-${runId}-${index}`,
        applicantUserId: candidateIds[index],
        submittedCompanyName: `Performance Review ${index}`,
        normalizedTaxIdentifier: String(8_000_000_000 + index),
        requestedRole: roles[index % roles.length],
        state: index % 2 === 0 ? "PENDING_CHECKS" : "PENDING_REVIEW",
      })),
    );
    const administrators = Object.values(environment.administrators);
    const cookies = [];
    for (const [index, administrator] of administrators.entries())
      cookies.push(
        await authenticatePerformanceAdministrator(administrator, index),
      );
    return {
      runId,
      cookies,
      dataset: {
        accounts: candidateCount + administrators.length,
        companies: companyIds.length,
        memberships: 5_000,
        openReviewItems: 1_000,
      },
    };
  } catch (error) {
    await cleanupRun(runId);
    throw error;
  }
}

async function cleanupRun(runId) {
  const { configuredJsonJobCatalogueRepository } =
    await import("../../../../src/backend/repositories/jobs/job-catalogue-repository-factory.ts");
  const ownedCatalogPrefix = `search-catalog-draft-search-review-${runId}-`;
  const [mappingReviews, directlyOwnedCatalogs] = await Promise.all([
    prisma.searchMappingReview.findMany({
      where: {
        OR: [
          { openKey: { contains: runId } },
          { id: { startsWith: `search-review-${runId}-` } },
        ],
      },
      select: { id: true, resultCatalogVersionId: true },
    }),
    // A publish can commit before the browser process is interrupted. In that
    // case the service clears openKey and the review may already be removed,
    // so discover this run's deterministic draft ID directly as a recovery
    // path. The prefix is scoped to this run UUID and never touches a real
    // catalog version.
    prisma.searchCatalogVersion.findMany({
      where: { id: { startsWith: ownedCatalogPrefix } },
      select: { id: true },
    }),
  ]);
  const mappingReviewIds = mappingReviews.map((row) => row.id);
  const mappingCatalogIds = [
    ...mappingReviews.map((row) => row.resultCatalogVersionId),
    ...directlyOwnedCatalogs.map((row) => row.id),
  ].filter(
    (value) =>
      typeof value === "string" && value.startsWith(ownedCatalogPrefix),
  );
  if (mappingCatalogIds.length) {
    const uniqueCatalogIds = [...new Set(mappingCatalogIds)];
    // Never delete the review row before checking this invariant. Keeping the
    // row allows a subsequent recovery run to identify the draft if a test
    // was interrupted after publish but before rollback.
    const activeOwnedCatalogs = await prisma.searchCatalogVersion.count({
      where: { id: { in: uniqueCatalogIds }, isActive: true },
    });
    if (activeOwnedCatalogs) {
      throw new Error("ADMIN_E2E_ACTIVE_SEARCH_CATALOG_LEFT_BEHIND");
    }
  }
  if (mappingReviewIds.length) {
    await prisma.searchMappingReview.deleteMany({
      where: { id: { in: mappingReviewIds } },
    });
  }
  if (mappingCatalogIds.length) {
    const uniqueCatalogIds = [...new Set(mappingCatalogIds)];
    const remainingReviewCounts = await Promise.all(
      uniqueCatalogIds.map(async (catalogVersionId) => ({
        catalogVersionId,
        count: await prisma.searchMappingReview.count({
          where: { resultCatalogVersionId: catalogVersionId },
        }),
      })),
    );
    const deletableCatalogIds = remainingReviewCounts
      .filter((row) => row.count === 0)
      .map((row) => row.catalogVersionId);
    if (deletableCatalogIds.length) {
      await prisma.searchTitleFacet.deleteMany({
        where: { catalogVersionId: { in: deletableCatalogIds } },
      });
      await prisma.searchJobTitleTranslation.deleteMany({
        where: { catalogVersionId: { in: deletableCatalogIds } },
      });
      await prisma.searchAlias.deleteMany({
        where: { catalogVersionId: { in: deletableCatalogIds } },
      });
      await prisma.searchJobTitle.deleteMany({
        where: { catalogVersionId: { in: deletableCatalogIds } },
      });
      await prisma.searchOccupation.deleteMany({
        where: { catalogVersionId: { in: deletableCatalogIds } },
      });
      await prisma.searchFacet.deleteMany({
        where: { catalogVersionId: { in: deletableCatalogIds } },
      });
      await prisma.searchCatalogVersion.deleteMany({
        where: { id: { in: deletableCatalogIds }, isActive: false },
      });
    }
  }

  const users = await prisma.userAccount.findMany({
    where: { email: { contains: runId } },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);
  const companies = await prisma.company.findMany({
    where: { slug: { contains: runId } },
    select: { id: true },
  });
  const companyIds = new Set(companies.map((row) => row.id));
  const requests = await prisma.recruiterVerificationRequest.findMany({
    where: { applicantUserId: { in: userIds } },
    select: { id: true },
  });
  const requestIds = requests.map((row) => row.id);
  const evidence = await prisma.businessLicenseEvidence.findMany({
    where: { requestId: { in: requestIds }, storageAdapter: "filesystem" },
    select: { storageLocator: true },
  });
  const works = await prisma.securityNotificationWork.findMany({
    where: { targetUserId: { in: userIds } },
    select: { emailOutboxId: true, originatingCorrelationId: true },
  });
  const receipts = await prisma.adminCommandReceipt.findMany({
    where: { targetReference: { contains: runId } },
    select: { correlationId: true },
  });
  const correlations = [
    ...works.map((row) => row.originatingCorrelationId),
    ...receipts.map((row) => row.correlationId),
  ];
  await prisma.securityNotificationWork.deleteMany({
    where: { targetUserId: { in: userIds } },
  });
  await prisma.emailOutbox.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { verificationRequestId: { in: requestIds } },
        { id: { in: works.flatMap((row) => row.emailOutboxId ?? []) } },
      ],
    },
  });
  await prisma.privilegedActionRationale.deleteMany({
    where: { correlationId: { in: correlations } },
  });
  await prisma.adminCommandReceipt.deleteMany({
    where: { targetReference: { contains: runId } },
  });
  if (evidence.length) {
    const { FilesystemPrivateBusinessEvidenceStorage } =
      await import("../../../../src/backend/storage/business-evidence/filesystem.ts");
    const storage = new FilesystemPrivateBusinessEvidenceStorage();
    for (const row of evidence) await storage.delete(row.storageLocator);
  }
  await prisma.recruiterVerificationRequest.deleteMany({
    where: { id: { in: requestIds } },
  });
  await prisma.companyMembership.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.company.deleteMany({ where: { slug: { contains: runId } } });
  if (companyIds.size) {
    const companiesCatalogue =
      configuredJsonJobCatalogueRepository("companies.json");
    const ownedCompanies = await companiesCatalogue.readMatching((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      return companyIds.has(String(value.id));
    });
    if (ownedCompanies.length) {
      await companiesCatalogue.mutate((values) =>
        values.filter((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return true;
          return !companyIds.has(String(value.id));
        }),
      );
    }
  }
  await prisma.candidateIdentity.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.platformAdministratorGrant.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.userAccount.deleteMany({ where: { id: { in: userIds } } });
  return { cleaned: userIds.length };
}

async function createCandidate(runId, label) {
  const id = `${label}-${runId}-${randomUUID()}`;
  return prisma.userAccount.create({
    data: {
      id,
      name: `E2E ${label}`,
      email: `${id}@example.test`,
      normalizedEmail: `${id}@example.test`,
      emailVerified: true,
      state: "ACTIVE",
      candidateIdentity: { create: {} },
    },
  });
}

async function createAccountScenario(runId) {
  const user = await createCandidate(runId, "account-target");
  const expiry = new Date(Date.now() + 24 * 60 * 60_000);
  await prisma.session.createMany({
    data: [1, 2].map((index) => ({
      id: `account-session-${index}-${runId}-${randomUUID()}`,
      token: `account-token-${index}-${runId}-${randomUUID()}`,
      userId: user.id,
      expiresAt: expiry,
      absoluteExpiresAt: expiry,
      userAgent: `E2E browser ${index}`,
    })),
  });
  return { runId, accountId: user.id, displayName: user.name };
}

async function createMembershipScenario(runId) {
  const user = await createCandidate(runId, "membership-target");
  const companyA = await prisma.company.create({
    data: {
      id: `company-a-${runId}-${randomUUID()}`,
      slug: `company-a-${runId}-${randomUUID()}`,
      legalName: "E2E Company Alpha",
      displayName: "E2E Company Alpha",
      verificationState: "ACTIVE",
    },
  });
  const companyB = await prisma.company.create({
    data: {
      id: `company-b-${runId}-${randomUUID()}`,
      slug: `company-b-${runId}-${randomUUID()}`,
      legalName: "E2E Company Beta",
      displayName: "E2E Company Beta",
      verificationState: "ACTIVE",
    },
  });
  const membership = await prisma.companyMembership.create({
    data: {
      id: `membership-${runId}-${randomUUID()}`,
      companyId: companyA.id,
      userId: user.id,
      role: "RECRUITER",
      priorApprovedRole: "RECRUITER",
    },
  });
  const unrelated = await prisma.companyMembership.create({
    data: {
      id: `membership-other-${runId}-${randomUUID()}`,
      companyId: companyB.id,
      userId: user.id,
      role: "HIRING_MANAGER",
      priorApprovedRole: "HIRING_MANAGER",
    },
  });
  return {
    runId,
    userId: user.id,
    membershipId: membership.id,
    unrelatedMembershipId: unrelated.id,
    companyDisplayName: companyA.displayName,
  };
}

async function createSearchMappingScenario(runId) {
  const catalog = await prisma.searchCatalogVersion.findFirst({
    where: { isActive: true, status: "PUBLISHED" },
    select: { id: true, version: true },
  });
  if (!catalog) throw new Error("ADMIN_E2E_SEARCH_CATALOG_MISSING");
  const titles = await prisma.searchJobTitle.findMany({
    where: { catalogVersionId: catalog.id },
    orderBy: { titleId: "asc" },
    select: {
      titleId: true,
      canonicalVi: true,
      canonicalEn: true,
      occupationId: true,
      facetIds: true,
    },
  });
  const title = titles.find(
    (candidate) =>
      candidate.canonicalVi.trim().toLocaleLowerCase() !==
      candidate.canonicalEn.trim().toLocaleLowerCase(),
  );
  if (!title) throw new Error("ADMIN_E2E_SEARCH_TITLE_MISSING");
  const reviewId = `search-review-${runId}-${randomUUID()}`;
  const originalTitle = `E2E Search Alias ${runId}-${reviewId.slice(-8)}`;
  const review = await prisma.searchMappingReview.create({
    data: {
      id: reviewId,
      catalogVersionId: catalog.id,
      openKey: `e2e-search-mapping:${runId}:${reviewId}`,
      originalTitle,
      normalizedTitle: originalTitle.toLowerCase(),
      context: {
        schemaVersion: "search-mapping-review-context-v1",
        catalogVersion: catalog.version,
        sampleJobIds: [],
      },
      suggestedTitleId: title.titleId,
      suggestedTranslationVi: title.canonicalVi,
      suggestedTranslationEn: title.canonicalEn,
      suggestedOccupationId: title.occupationId,
      suggestedFacetIds: title.facetIds,
      suggestedSkillSignals: [],
      confidence: 0.55,
    },
  });
  return {
    runId,
    reviewId: review.id,
    titleId: title.titleId,
    catalogVersionId: catalog.id,
    originalTitle,
  };
}

async function inspectSearchMappingScenario(reviewId) {
  const review = await prisma.searchMappingReview.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      status: true,
      version: true,
      openKey: true,
      resultCatalogVersionId: true,
      reviewedByAdminUserId: true,
      reviewedAt: true,
      suggestedTitleId: true,
    },
  });
  if (!review) throw new Error("ADMIN_E2E_SEARCH_REVIEW_MISSING");
  const draft = review.resultCatalogVersionId
    ? await prisma.searchCatalogVersion.findUnique({
        where: { id: review.resultCatalogVersionId },
        select: { id: true, version: true, status: true, parentVersion: true },
      })
    : null;
  const targetTitle =
    draft && review.suggestedTitleId
      ? await prisma.searchJobTitle.findFirst({
          where: {
            catalogVersionId: draft.id,
            titleId: review.suggestedTitleId,
          },
          select: {
            titleId: true,
            aliasesVi: true,
            aliasesEn: true,
            translationStatus: true,
            mappingSource: true,
            mappingConfidence: true,
          },
        })
      : null;
  const aliases =
    draft && review.suggestedTitleId
      ? await prisma.searchAlias.findMany({
          where: {
            catalogVersionId: draft.id,
            targetType: "TITLE",
            targetId: review.suggestedTitleId,
          },
          select: {
            phrase: true,
            normalizedPhrase: true,
            locale: true,
            source: true,
            confidence: true,
          },
          orderBy: { phrase: "asc" },
        })
      : [];
  const audits = await prisma.auditEvent.findMany({
    where: { targetType: "search_mapping_review", targetId: reviewId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: {
      action: true,
      result: true,
      actorUserId: true,
      actorSessionId: true,
      correlationId: true,
      context: true,
    },
  });
  const rationaleCount = await prisma.privilegedActionRationale.count({
    where: { correlationId: { in: audits.map((row) => row.correlationId) } },
  });
  return {
    review,
    draft,
    targetTitle,
    aliases,
    audits,
    rationaleCount,
  };
}

async function inspectSearchCatalogVersion(versionId) {
  const row = await prisma.searchCatalogVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      version: true,
      status: true,
      isActive: true,
      revision: true,
      parentVersion: true,
      publishedAt: true,
      retiredAt: true,
    },
  });
  if (!row) throw new Error("ADMIN_E2E_SEARCH_CATALOG_MISSING");
  const [active, parent, audits] = await Promise.all([
    prisma.searchCatalogVersion.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        version: true,
        status: true,
        isActive: true,
        revision: true,
      },
    }),
    row.parentVersion
      ? prisma.searchCatalogVersion.findUnique({
          where: { version: row.parentVersion },
          select: {
            id: true,
            version: true,
            status: true,
            isActive: true,
            revision: true,
          },
        })
      : null,
    prisma.auditEvent.findMany({
      where: { targetType: "search_catalog_version", targetId: versionId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        action: true,
        result: true,
        actorUserId: true,
        actorSessionId: true,
        correlationId: true,
        context: true,
      },
    }),
  ]);
  return {
    row: {
      ...row,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      retiredAt: row.retiredAt?.toISOString() ?? null,
    },
    active,
    parent,
    audits,
  };
}

async function createVerificationScenario(runId, qualification = "PENDING") {
  const { default: sharp } = await import("sharp");
  const { FilesystemPrivateBusinessEvidenceStorage } =
    await import("../../../../src/backend/storage/business-evidence/filesystem.ts");
  const user = await createCandidate(runId, "verification-applicant");
  const requestId = `verification-${runId}-${randomUUID()}`;
  const evidenceId = `evidence-${runId}-${randomUUID()}`;
  const companyDisplayName = `E2E ${runId}-${randomUUID().slice(0, 6)}`;
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const storage = new FilesystemPrivateBusinessEvidenceStorage();
  const stored = await storage.write(`${requestId}:1`, bytes);
  await prisma.recruiterVerificationRequest.create({
    data: {
      id: requestId,
      applicantUserId: user.id,
      submittedCompanyName: companyDisplayName,
      normalizedTaxIdentifier: randomUUID()
        .replace(/\D/gu, "")
        .padEnd(10, "0")
        .slice(0, 10),
      requestedRole: "RECRUITER",
      state: qualification === "PASS" ? "PENDING_REVIEW" : "PENDING_CHECKS",
      currentEvidenceId: evidenceId,
      evidence: {
        create: {
          id: evidenceId,
          submissionVersion: 1,
          declaredMediaType: "image/png",
          ...stored,
          ...(qualification === "PASS"
            ? {
                detectedMediaType: "image/png",
                malwareStatus: "PASS",
                typeStatus: "PASS",
                structureStatus: "PASS",
                previewStatus: "PASS",
                reviewableAt: new Date(),
              }
            : {}),
        },
      },
    },
  });
  return {
    runId,
    requestId,
    evidenceId,
    applicantUserId: user.id,
    companyDisplayName,
  };
}

async function authorityFor(userId) {
  const grant = await prisma.platformAdministratorGrant.findUniqueOrThrow({
    where: { userId },
    include: { sessionPolicy: true },
  });
  if (!grant.sessionPolicy?.designatedSessionId)
    throw new Error("ADMIN_E2E_SESSION_NOT_DESIGNATED");
  return {
    userId,
    sessionId: grant.sessionPolicy.designatedSessionId,
    grantId: grant.id,
    proofAt: grant.sessionPolicy.latestTwoFactorProofAt,
  };
}

async function expireProof(grantId) {
  const stale = new Date(Date.now() - 16 * 60_000);
  await prisma.administratorSessionPolicy.update({
    where: { grantId },
    data: { latestTwoFactorProofAt: stale },
  });
  return { staleAt: stale.toISOString() };
}

async function accountCardinality(adminUserId, accountId) {
  const { AdminAccountService } =
    await import("../../../../src/backend/admin/accounts/admin-account-service.ts");
  const service = new AdminAccountService();
  const authority = await authorityFor(adminUserId);
  const detail = await service.security(accountId);
  const reference = detail.sessions[0]?.reference;
  if (!reference) throw new Error("ADMIN_E2E_SESSION_REFERENCE_MISSING");
  await service.revokeOne(authority, accountId, reference, {
    expectedVersion: 1,
    idempotencyKey: randomUUID(),
    reasonCategory: "SECURITY_COMPROMISE",
    explanation: "E2E single session revocation verification.",
  });
  const afterOne = await prisma.securityNotificationWork.count({
    where: { targetUserId: accountId },
  });
  await service.revokeAll(authority, accountId, {
    expectedVersion: 2,
    idempotencyKey: randomUUID(),
    reasonCategory: "SECURITY_COMPROMISE",
    explanation: "E2E all session revocation verification.",
  });
  const works = await prisma.securityNotificationWork.findMany({
    where: { targetUserId: accountId },
  });
  return { afterOne, kinds: works.map((row) => row.kind) };
}

async function suspendAccount(
  adminUserId,
  accountId,
  operationId = randomUUID(),
) {
  const { AdminAccountService } =
    await import("../../../../src/backend/admin/accounts/admin-account-service.ts");
  const started = performance.now();
  const result = await new AdminAccountService().suspend(
    await authorityFor(adminUserId),
    accountId,
    {
      expectedVersion: 1,
      idempotencyKey: operationId,
      reasonCategory: "SECURITY_COMPROMISE",
      explanation: "E2E confirmed account security enforcement.",
    },
  );
  const activeSessions = await prisma.session.count({
    where: { userId: accountId, revokedAt: null },
  });
  await recordReliabilityEvidence({
    type: "sessionEnforcement",
    eventKind: "ACCOUNT_SUSPENDED",
    durationMs: performance.now() - started,
    enforced: activeSessions === 0,
  });
  return result;
}

async function membershipSequence(adminUserId, membershipId) {
  const { AdminMembershipService } =
    await import("../../../../src/backend/admin/memberships/admin-membership-service.ts");
  const service = new AdminMembershipService();
  const authority = await authorityFor(adminUserId);
  const command = (version) => ({
    expectedVersion: version,
    idempotencyKey: randomUUID(),
    reasonCategory: "ACCESS_CLEANUP",
    explanation: "E2E company membership lifecycle verification.",
  });
  await service.suspend(authority, membershipId, command(1));
  await service.restore(authority, membershipId, command(2));
  await service.remove(authority, membershipId, command(3));
  const stale = await service
    .remove(authority, membershipId, command(3))
    .then(() => "unexpected-success")
    .catch((error) => String(error.message));
  return { stale };
}

async function membershipGuards(adminUserId, runId) {
  const { AdminMembershipService } =
    await import("../../../../src/backend/admin/memberships/admin-membership-service.ts");
  const { RecruiterEntitlementService } =
    await import("../../../../src/backend/admin/memberships/recruiter-entitlement-service.ts");
  const candidate = await createCandidateRequest(runId, "membership-guard");
  const company = await prisma.company.create({
    data: {
      id: `membership-guard-company-${runId}-${randomUUID()}`,
      slug: `membership-guard-${runId}-${randomUUID().slice(0, 6)}`,
      legalName: "E2E Membership Guard Company",
      displayName: "E2E Membership Guard Company",
      verificationState: "ACTIVE",
    },
  });
  const membership = await prisma.companyMembership.create({
    data: {
      id: `membership-guard-${runId}-${randomUUID()}`,
      companyId: company.id,
      userId: candidate.user.id,
      role: "RECRUITER",
      priorApprovedRole: "RECRUITER",
    },
  });
  const entitlement = new RecruiterEntitlementService();
  const before = await entitlement.resolve(candidate.request, company.id);
  const service = new AdminMembershipService();
  await service.suspend(await authorityFor(adminUserId), membership.id, {
    expectedVersion: membership.version,
    idempotencyKey: randomUUID(),
    reasonCategory: "ACCESS_CLEANUP",
    explanation: "E2E revoke stale recruiter authorization snapshot.",
  });
  const after = await entitlement.resolve(candidate.request, company.id);

  const ownerCompany = await prisma.company.create({
    data: {
      id: `membership-owner-company-${runId}-${randomUUID()}`,
      slug: `membership-owner-${runId}-${randomUUID().slice(0, 6)}`,
      legalName: "E2E Last Owner Company",
      displayName: "E2E Last Owner Company",
      verificationState: "ACTIVE",
    },
  });
  const owner = await prisma.companyMembership.create({
    data: {
      id: `membership-owner-${runId}-${randomUUID()}`,
      companyId: ownerCompany.id,
      userId: candidate.user.id,
      role: "OWNER",
      priorApprovedRole: "OWNER",
    },
  });
  const lastOwner = await service
    .suspend(await authorityFor(adminUserId), owner.id, {
      expectedVersion: owner.version,
      idempotencyKey: randomUUID(),
      reasonCategory: "ACCESS_CLEANUP",
      explanation: "E2E last active owner denial verification.",
    })
    .then(() => "unexpected-success")
    .catch((error) => (error instanceof Error ? error.message : String(error)));
  return {
    beforeAvailable: before.available,
    beforeMembershipVersion: before.companies[0]?.membershipVersion,
    afterAvailable: after.available,
    afterCompanies: after.companies.length,
    staleRecruiterSnapshotRejected:
      before.companies[0]?.membershipVersion === membership.version &&
      !after.available,
    lastOwner,
    lastOwnerStatus: (
      await prisma.companyMembership.findUniqueOrThrow({
        where: { id: owner.id },
      })
    ).status,
    lastOwnerWorkCount: await prisma.securityNotificationWork.count({
      where: {
        idempotencyKey: {
          startsWith: `security-notification:membership:${owner.id}:`,
        },
      },
    }),
    candidateIdentityPreserved: Boolean(
      await prisma.candidateIdentity.findUnique({
        where: { userId: candidate.user.id },
      }),
    ),
  };
}

async function verificationConcurrent(adminUserId, requestId) {
  const { VerificationApprovalTransaction } =
    await import("../../../../src/backend/admin/verification/verification-approval-transaction.ts");
  const { VerificationReviewService } =
    await import("../../../../src/backend/admin/verification/verification-review-service.ts");
  const authority = await authorityFor(adminUserId);
  await new VerificationReviewService().claim(authority, requestId, {
    expectedVersion: 1,
    idempotencyKey: randomUUID(),
  });
  const transaction = new VerificationApprovalTransaction();
  const commands = [randomUUID(), randomUUID()].map((idempotencyKey) => ({
    expectedVersion: 2,
    idempotencyKey,
    role: "RECRUITER",
  }));
  const results = await Promise.allSettled(
    commands.map((item) => transaction.execute(authority, requestId, item)),
  );
  const winningIndex = results.findIndex((item) => item.status === "fulfilled");
  if (winningIndex < 0)
    throw new Error(
      `ADMIN_E2E_APPROVAL_WINNER_MISSING:${results
        .map((item) =>
          item.status === "rejected" && item.reason instanceof Error
            ? item.reason.message
            : item.status,
        )
        .join(",")}`,
    );
  await transaction.execute(authority, requestId, commands[winningIndex]);
  return {
    fulfilled: results.filter((item) => item.status === "fulfilled").length,
    rejected: results.filter((item) => item.status === "rejected").length,
    replayed: true,
    receipts: await prisma.adminCommandReceipt.count({
      where: {
        targetReference: requestId,
        commandKind: "verification.approve",
      },
    }),
  };
}

async function createCandidateRequest(runId, label) {
  const { createCredentialFixture } =
    await import("../../../helpers/credential-fixture.ts");
  const { BetterAuthSessionGateway } =
    await import("../../../../src/backend/auth/better-auth/better-auth-session-gateway.ts");
  const suffix = `${label}-${runId}-${randomUUID()}`;
  const email = `${suffix}@example.test`;
  const password = "Candidate fixture password 2026!";
  const user = await createCredentialFixture({
    email,
    password,
    name: `E2E ${label}`,
  });
  await prisma.candidateIdentity.create({ data: { userId: user.id } });
  const response = await new BetterAuthSessionGateway().signIn(
    email,
    password,
    new Headers({ "x-forwarded-for": `admin-e2e-${suffix}` }),
  );
  if (!response.ok) throw new Error("ADMIN_E2E_CANDIDATE_LOGIN_FAILED");
  const session = cookieLine(
    response,
    /^(smarthire[.]session|__Host-smarthire[.]session)=/u,
  );
  if (!session) throw new Error("ADMIN_E2E_CANDIDATE_SESSION_MISSING");
  return {
    user,
    request: new Request("http://localhost:3001/api/employer-verifications", {
      headers: { cookie: session.split(";", 1)[0] },
    }),
  };
}

async function applicantVerificationLifecycle(adminUserId, runId) {
  const { default: sharp } = await import("sharp");
  const { ApplicantVerificationService } =
    await import("../../../../src/backend/admin/verification/applicant-verification-service.ts");
  const { VerificationReviewService } =
    await import("../../../../src/backend/admin/verification/verification-review-service.ts");
  const candidate = await createCandidateRequest(runId, "verification-flow");
  const service = new ApplicantVerificationService();
  const bytes = await sharp({
    create: { width: 18, height: 18, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const uniqueTax = () =>
    randomUUID().replace(/\D/gu, "").padEnd(10, "0").slice(0, 10);
  const submitted = await service.submit(
    candidate.request,
    {
      companyName: `E2E Applicant Company ${runId}`,
      taxIdentifier: uniqueTax(),
      requestedRole: "RECRUITER",
    },
    new File([bytes], "business-license.png", { type: "image/png" }),
  );
  await scanEvidence(submitted.requestId, "SAFE");
  const reviewable =
    await prisma.recruiterVerificationRequest.findUniqueOrThrow({
      where: { id: submitted.requestId },
    });
  const changes = await new VerificationReviewService().requestChanges(
    await authorityFor(adminUserId),
    submitted.requestId,
    {
      expectedVersion: reviewable.version,
      idempotencyKey: randomUUID(),
      guidance: "Please submit a clearer complete business license.",
      privateNote: "E2E private review note.",
    },
  );
  const resubmitted = await service.resubmit(
    candidate.request,
    submitted.requestId,
    new File([bytes], "business-license-resubmission.png", {
      type: "image/png",
    }),
  );
  const cancelled = await service.cancel(
    candidate.request,
    submitted.requestId,
  );

  const existingCompany = await prisma.company.create({
    data: {
      id: `verification-existing-${runId}-${randomUUID()}`,
      slug: `verification-existing-${runId}-${randomUUID()}`,
      legalName: "E2E Existing Company",
      displayName: "E2E Existing Company",
      normalizedTaxIdentifier: uniqueTax(),
      verificationState: "ACTIVE",
    },
  });
  const previousReadiness = process.env.ADMIN_COMPANY_PREREQUISITE_READY;
  process.env.ADMIN_COMPANY_PREREQUISITE_READY = "true";
  let prerequisiteError = "";
  try {
    await service.submit(
      candidate.request,
      {
        companyName: existingCompany.displayName,
        taxIdentifier: existingCompany.normalizedTaxIdentifier,
        requestedRole: "RECRUITER",
        targetCompanyId: existingCompany.id,
      },
      new File([bytes], "existing-company-license.png", { type: "image/png" }),
    );
  } catch (error) {
    prerequisiteError = error instanceof Error ? error.message : String(error);
  } finally {
    if (previousReadiness === undefined)
      delete process.env.ADMIN_COMPANY_PREREQUISITE_READY;
    else process.env.ADMIN_COMPANY_PREREQUISITE_READY = previousReadiness;
  }

  const row = await prisma.recruiterVerificationRequest.findUniqueOrThrow({
    where: { id: submitted.requestId },
    include: { evidence: true, notifications: true },
  });
  return {
    requestId: row.id,
    applicantUserId: row.applicantUserId,
    submittedState: submitted.state,
    changesState: changes.state,
    resubmittedState: resubmitted.state,
    cancelledState: cancelled.state,
    resubmissionCount: row.resubmissionCount,
    evidenceCount: row.evidence.length,
    inaccessibleEvidence: row.evidence.filter(
      (item) => item.contentInaccessibleAt,
    ).length,
    eventKinds: row.notifications.map((item) => item.payloadRef?.eventKind),
    prerequisiteError,
    candidateIdentityPreserved: Boolean(
      await prisma.candidateIdentity.findUnique({
        where: { userId: row.applicantUserId },
      }),
    ),
  };
}

async function verificationOutageLifecycle(runId) {
  const { EvidenceAccessService } =
    await import("../../../../src/backend/admin/verification/evidence-access-service.ts");
  const { runVerificationDeadlineCycle } =
    await import("../../../../src/backend/admin/workers/verification-lifecycle-loop.ts");
  const scenario = await createVerificationScenario(runId, "PASS");
  const preview = await new EvidenceAccessService().preview(
    scenario.requestId,
    scenario.evidenceId,
  );
  const outageStartedAt = new Date();
  await prisma.recruiterVerificationRequest.update({
    where: { id: scenario.requestId },
    data: { viewerUnavailableSince: outageStartedAt },
  });
  const at15m = new Date(outageStartedAt.getTime() + 15 * 60_000);
  await runVerificationDeadlineCycle(at15m);
  const after15m = await prisma.recruiterVerificationRequest.findUniqueOrThrow({
    where: { id: scenario.requestId },
  });
  const at24h = new Date(outageStartedAt.getTime() + 24 * 60 * 60_000);
  await runVerificationDeadlineCycle(at24h);
  const after24h = await prisma.recruiterVerificationRequest.findUniqueOrThrow({
    where: { id: scenario.requestId },
  });
  const at72h = new Date(outageStartedAt.getTime() + 72 * 60 * 60_000);
  await runVerificationDeadlineCycle(at72h);
  const after72h = await prisma.recruiterVerificationRequest.findUniqueOrThrow({
    where: { id: scenario.requestId },
    include: { evidence: true, notifications: true },
  });
  return {
    requestId: scenario.requestId,
    previewBytes: preview.bytes.length,
    previewMediaType: preview.mediaType,
    escalatedAt15m: Boolean(after15m.viewerEscalatedAt),
    notifiedAt24h: Boolean(after24h.viewerDelayNotifiedAt),
    stateAt72h: after72h.state,
    inaccessibleAt72h: after72h.evidence.every(
      (item) => item.contentInaccessibleAt,
    ),
    eventKinds: after72h.notifications.map(
      (item) => item.payloadRef?.eventKind,
    ),
  };
}

async function createVerificationEvents(runId) {
  const scenario = await createVerificationScenario(runId, "PASS");
  const { buildVerificationOutbox } =
    await import("../../../../src/backend/admin/notifications/verification-outbox.ts");
  const kinds = [
    "VERIFICATION_RECEIPT",
    "VERIFICATION_CHANGES_REQUESTED",
    "VERIFICATION_APPROVED",
    "VERIFICATION_REJECTED",
    "VERIFICATION_CANCELLED",
    "VERIFICATION_DELAYED",
    "VERIFICATION_EXPIRED",
  ];
  for (const [index, eventKind] of kinds.entries()) {
    await prisma.emailOutbox.create({
      data: buildVerificationOutbox({
        requestId: scenario.requestId,
        userId: scenario.applicantUserId,
        eventKind,
        resultingState: eventKind.replace("VERIFICATION_", ""),
        resultingVersion: index + 2,
        occurredAt: new Date(Date.now() + index),
        nextAction:
          eventKind === "VERIFICATION_APPROVED"
            ? "OPEN_RECRUITER_WORKSPACE"
            : "REVIEW_STATUS",
        ...(eventKind === "VERIFICATION_APPROVED"
          ? {
              companyDisplayName: `E2E Verified Company ${runId}`,
              approvedMembershipRole: "RECRUITER",
            }
          : {}),
      }),
    });
  }
  return { ...scenario, kinds };
}

async function scanEvidence(requestId, mode) {
  const { EvidenceSafetyPipeline } =
    await import("../../../../src/backend/admin/verification/evidence-safety-pipeline.ts");
  const { runEvidenceSafetyCycle } =
    await import("../../../../src/backend/admin/workers/verification-lifecycle-loop.ts");
  const { FilesystemPrivateBusinessEvidenceStorage } =
    await import("../../../../src/backend/storage/business-evidence/filesystem.ts");
  const scanner = {
    async scan() {
      await new Promise((resolve_) => setTimeout(resolve_, 25));
      return mode === "SAFE"
        ? { outcome: "CLEAN", engineVersion: "admin-e2e-async-scanner" }
        : { outcome: "INFECTED", threatCode: "ADMIN_E2E_UNSAFE" };
    },
  };
  await runEvidenceSafetyCycle(new Date(), 10, {
    pipeline: new EvidenceSafetyPipeline(scanner),
    storageFor: () => new FilesystemPrivateBusinessEvidenceStorage(),
  });
  const request = await prisma.recruiterVerificationRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { evidence: true, safetyAttempts: true },
  });
  return {
    state: request.state,
    evidence: request.evidence[0],
    attemptCount: request.safetyAttempts.length,
  };
}

async function dispatchSecurity() {
  const { runSecurityNotificationCycle } =
    await import("../../../../src/backend/admin/workers/security-notification-loop.ts");
  return runSecurityNotificationCycle(new Date());
}

async function driveEmail(outboxId, mode, transientFailures = 2) {
  const { PrismaOutboxRepository } =
    await import("../../../../src/backend/repositories/email/outbox-repository.ts");
  const { deliverClaimedOutbox } =
    await import("../../../../src/backend/email/workers/email-outbox.ts");
  const { EmailDeliveryError } =
    await import("../../../../src/backend/email/email-service.ts");
  const { alertSecurityNotificationDead } =
    await import("../../../../src/backend/admin/notifications/security-notification-ops-alert.ts");
  const repository = new PrismaOutboxRepository();
  const messages = [];
  const alerts = [];
  const providerLatencyMs = [];
  let providerAttempts = 0;
  const adapter = {
    async send(message) {
      const providerStarted = performance.now();
      providerAttempts += 1;
      messages.push(message);
      if (
        mode === "TRANSIENT_FAILURE" &&
        providerAttempts <= transientFailures
      ) {
        providerLatencyMs.push(performance.now() - providerStarted);
        throw new EmailDeliveryError("TEMPORARY_UNAVAILABLE", true);
      }
      if (mode === "PERMANENT_FAILURE") {
        providerLatencyMs.push(performance.now() - providerStarted);
        throw new EmailDeliveryError("TEMPORARY_UNAVAILABLE", true);
      }
      providerLatencyMs.push(performance.now() - providerStarted);
      return { providerMessageId: `admin-e2e:${randomUUID()}` };
    },
  };
  const ops = {
    async send(alert) {
      alerts.push(alert);
    },
  };
  const transitions = [];
  const initialOutbox = await prisma.emailOutbox.findUniqueOrThrow({
    where: { id: outboxId },
  });
  let now = initialOutbox.createdAt;
  for (let index = 0; index < 6; index += 1) {
    const owner = `admin-e2e-email-${randomUUID()}`;
    const claimed = await repository.claimOne(outboxId, owner, now);
    if (!claimed) throw new Error("ADMIN_E2E_EMAIL_CLAIM_FAILED");
    await deliverClaimedOutbox(
      claimed,
      owner,
      adapter,
      repository,
      now,
      () => 0,
      ops,
    );
    const row = await prisma.emailOutbox.findUniqueOrThrow({
      where: { id: outboxId },
    });
    const work = await prisma.securityNotificationWork.findFirst({
      where: { emailOutboxId: outboxId },
    });
    transitions.push({
      status: row.status,
      attempts: row.attempts,
      safeErrorCode: row.safeErrorCode,
      at: now.toISOString(),
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      workStatus: work?.status ?? null,
    });
    if (row.status === "SENT" || row.status === "DEAD") break;
    now = row.nextAttemptAt;
  }
  const restartAlerts = [];
  const restartAlerted = await alertSecurityNotificationDead(
    outboxId,
    {
      async send(alert) {
        restartAlerts.push(alert);
      },
    },
    { increment() {} },
    new Date(now.getTime() + 1),
  );
  const finalOutbox = await prisma.emailOutbox.findUniqueOrThrow({
    where: { id: outboxId },
  });
  const finalWork = await prisma.securityNotificationWork.findFirst({
    where: { emailOutboxId: outboxId },
  });
  const eventKind = initialOutbox.payloadRef?.eventKind;
  if (typeof eventKind !== "string")
    throw new Error("ADMIN_E2E_EMAIL_EVENT_KIND_MISSING");
  const commitToSentMs =
    finalOutbox.status === "SENT"
      ? Math.max(
          0,
          finalOutbox.updatedAt.getTime() - initialOutbox.createdAt.getTime(),
        )
      : null;
  await recordReliabilityEvidence({
    type: "emailDelivery",
    eventKind,
    providerLatencyMs,
    retryCount: Math.max(0, providerAttempts - 1),
    finalOutboxStatus: finalOutbox.status,
    finalWorkStatus: finalWork?.status ?? null,
    commitToSentMs,
  });
  return {
    providerAttempts,
    providerLatencyMs,
    eventKind,
    commitToSentMs,
    transitions,
    messages,
    alertCount: alerts.length,
    restartAlerted,
    restartAlertCount: restartAlerts.length,
  };
}

try {
  let result;
  if (command === "setup-auth") result = await setupAuth(arguments_);
  else if (command === "setup-performance")
    result = await setupPerformanceFixture();
  else if (command === "cleanup-run") result = await cleanupRun(arguments_[0]);
  else if (command === "create-account")
    result = await createAccountScenario(arguments_[0]);
  else if (command === "create-membership")
    result = await createMembershipScenario(arguments_[0]);
  else if (command === "create-search-mapping")
    result = await createSearchMappingScenario(arguments_[0]);
  else if (command === "inspect-search-mapping")
    result = await inspectSearchMappingScenario(arguments_[0]);
  else if (command === "inspect-search-catalog")
    result = await inspectSearchCatalogVersion(arguments_[0]);
  else if (command === "create-verification")
    result = await createVerificationScenario(arguments_[0], arguments_[1]);
  else if (command === "expire-proof")
    result = await expireProof(arguments_[0]);
  else if (command === "account-cardinality")
    result = await accountCardinality(arguments_[0], arguments_[1]);
  else if (command === "suspend-account")
    result = await suspendAccount(arguments_[0], arguments_[1], arguments_[2]);
  else if (command === "membership-sequence")
    result = await membershipSequence(arguments_[0], arguments_[1]);
  else if (command === "membership-guards")
    result = await membershipGuards(arguments_[0], arguments_[1]);
  else if (command === "verification-concurrent")
    result = await verificationConcurrent(arguments_[0], arguments_[1]);
  else if (command === "verification-applicant-lifecycle")
    result = await applicantVerificationLifecycle(arguments_[0], arguments_[1]);
  else if (command === "verification-outage-lifecycle")
    result = await verificationOutageLifecycle(arguments_[0]);
  else if (command === "create-verification-events")
    result = await createVerificationEvents(arguments_[0]);
  else if (command === "scan-evidence")
    result = await scanEvidence(arguments_[0], arguments_[1]);
  else if (command === "dispatch-security") result = await dispatchSecurity();
  else if (command === "drive-email")
    result = await driveEmail(
      arguments_[0],
      arguments_[1],
      Number(arguments_[2] ?? 2),
    );
  else throw new Error(`ADMIN_E2E_CONTROL_UNSUPPORTED:${command}`);
  process.stdout.write(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
