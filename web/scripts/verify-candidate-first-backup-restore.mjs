import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = resolve(workspaceRoot, "web");
const envFile = process.env.CF004_ENV_FILE
  ? resolve(workspaceRoot, process.env.CF004_ENV_FILE)
  : ["candidate-first-live.env", "candidate-first-playwright.env"]
      .map((candidate) => resolve(workspaceRoot, candidate))
      .find((candidate) => existsSync(candidate));

function loadEnvironment(file) {
  const values = dotenv.parse(readFileSync(file));
  for (const [key, value] of Object.entries(values)) process.env[key] ??= value;
}

if (envFile) loadEnvironment(envFile);
// The host-side rehearsal connects through the published Docker port. The
// container-native `postgres` hostname is valid for the worker but not from
// this Node process on Windows.
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  const value = process.env[key];
  if (!value) continue;
  const parsed = new URL(value);
  if (parsed.hostname === "postgres") {
    parsed.hostname = "127.0.0.1";
    parsed.port = "55432";
    process.env[key] = parsed.toString();
  }
}
process.env.NODE_ENV ??= "test";
process.env.APP_ENV ??= "local";

const reportFile = resolve(
  workspaceRoot,
  process.env.CF004_RESTORE_REPORT_FILE ??
    "docs/audits/2026-09-06-cf004-restore.json",
);
const sourceStorageRoot = resolve(
  webRoot,
  process.env.CF004_RESTORE_SOURCE_STORAGE ??
    ".local/candidate-first-backup-source",
);
const restoredStorageRoot = resolve(
  webRoot,
  process.env.CF004_RESTORE_TARGET_STORAGE ??
    ".local/candidate-first-backup-restored",
);
const dumpFile = resolve(
  webRoot,
  process.env.CF004_RESTORE_DUMP_FILE ??
    ".local/candidate-first-backup-restore.dump",
);
const postgresContainer =
  process.env.CF004_POSTGRES_CONTAINER ?? "smarthire-postgres-1";
const dockerCli =
  process.env.DOCKER_CLI_PATH ??
  "docker";
const dbRole = process.env.CF004_POSTGRES_ROLE ?? "smarthire";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeDatabaseName(value) {
  return /^[a-z][a-z0-9_-]{0,62}$/u.test(value) &&
    /(?:^|[-_])(test|tests|spec|e2e)(?:[-_]|$)/iu.test(value);
}

function redactError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "postgresql://[redacted]")
    .replace(/password[^\n]*/giu, "password [redacted]")
    .slice(0, 600);
}

async function runDocker(args, options = {}) {
  try {
    return await execFileAsync(dockerCli, args, {
      cwd: workspaceRoot,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      ...options,
    });
  } catch (error) {
    const wrapped = new Error(`docker ${args[0] ?? "command"} failed: ${redactError(error)}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

async function runPsql(database, sql) {
  await runDocker([
    "exec",
    postgresContainer,
    "psql",
    "-U",
    dbRole,
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

async function copyStorage(source, target) {
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

function endpointFromUrl(value, database) {
  const parsed = new URL(value);
  parsed.hostname = parsed.hostname === "postgres" ? "127.0.0.1" : parsed.hostname;
  parsed.port ||= "55432";
  parsed.pathname = `/${database}`;
  parsed.searchParams.delete("schema");
  return parsed.toString();
}

async function queryRestored(restoredDatabase, sourceUrl, text, values = []) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: endpointFromUrl(sourceUrl, restoredDatabase) });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: "FAIL",
  scope: "CF-004 / CF-803 restore rehearsal on an isolated Candidate-first database",
  source: {},
  dump: {},
  restore: {},
  artifacts: {},
  cleanup: { sourceFixture: "PENDING", restoreDatabase: "PENDING", temporaryFiles: "PENDING" },
  limitations: [
    "The production BackupService currently emits an encrypted PostgreSQL dump; CV/application object storage is not bundled by that service.",
    "This rehearsal copies the object manifest payload to a separate restore root to prove digest/openability, so it is evidence for the runbook and not proof of an automated object-storage backup.",
    "RPO/RTO are measured for this local Docker rehearsal and must be re-baselined in the deployment topology.",
  ],
};

let prisma;
let fixture;
let restoredDatabase;
let sourceUrl;
let sourceStorageCreated = false;
let dumpCreated = false;

try {
  sourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("CF004_RESTORE_DATABASE_URL_MISSING");
  const sourceEndpoint = new URL(sourceUrl);
  const sourceDatabase = decodeURIComponent(sourceEndpoint.pathname.replace(/^\//u, ""));
  if (!safeDatabaseName(sourceDatabase) || !/candidate[-_]?first/iu.test(sourceDatabase)) {
    throw new Error("CF004_RESTORE_SOURCE_DATABASE_UNSAFE");
  }

  const { assertTestDatabaseEnvironment } = await import("../tests/helpers/test-database-guard.ts");
  const guard = assertTestDatabaseEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  });
  report.source.endpoint = guard.database;
  report.source.guard = "PASS";
  report.source.database = sourceDatabase;

  const databaseModule = await import("../src/backend/database/prisma.ts");
  prisma = databaseModule.prisma;
  const { createCandidateFirstDatabaseFixture, deleteCandidateFirstDatabaseFixture } =
    await import("../tests/helpers/candidate-first-database-fixture.ts");

  fixture = await createCandidateFirstDatabaseFixture("backup-restore", new Date());
  await mkdir(sourceStorageRoot, { recursive: true });
  sourceStorageCreated = true;

  const cvPayload = Buffer.from(
    `Candidate-first restore rehearsal CV\nfixture=${fixture.suffix}\n`,
    "utf8",
  );
  const cvChecksum = sha256(cvPayload);
  const cvStorageKey = `backup-restore/${fixture.suffix}/candidate.pdf`;
  const cvPath = join(sourceStorageRoot, cvStorageKey);
  await mkdir(dirname(cvPath), { recursive: true });
  await writeFile(cvPath, cvPayload);
  const customCvId = `cv-backup-restore-${fixture.suffix}`;
  const customCv = await prisma.candidateCv.create({
    data: {
      id: customCvId,
      candidateUserId: fixture.candidateUserId,
      displayName: "Backup restore CV",
      fileName: "candidate.pdf",
      mimeType: "application/pdf",
      byteSize: cvPayload.byteLength,
      storageKey: cvStorageKey,
      checksumSha256: cvChecksum,
      confirmedAt: fixture.now,
    },
  });

  const applicationPayload = Buffer.from(
    `Candidate-first restore rehearsal application document\nfixture=${fixture.suffix}\n`,
    "utf8",
  );
  const applicationStorageKey = `backup-restore/${fixture.suffix}/application-cv.enc`;
  const applicationPath = join(sourceStorageRoot, applicationStorageKey);
  await mkdir(dirname(applicationPath), { recursive: true });
  await writeFile(applicationPath, applicationPayload);
  const customApplicationId = `application-backup-restore-${fixture.suffix}`;
  const application = await prisma.jobApplication.create({
    data: {
      id: customApplicationId,
      candidateUserId: fixture.candidateUserId,
      jobPostingId: fixture.jobs.activeSecond.id,
      applicationAttemptNumber: 1,
      selectedCvId: customCv.id,
      cvFileRef: customCv.storageKey,
      contactSnapshot: { fullName: "Restore rehearsal candidate", email: fixture.candidateEmail },
      aiAnalysisConsent: false,
      scoringStatus: "NOT_REQUESTED",
      stage: "APPLIED",
      stageVersion: 1,
      lastStageChangedAt: fixture.now,
      profileSnapshot: { headline: "TypeScript Engineer", location: "Ho Chi Minh City" },
      cvSnapshot: {
        cvId: customCv.id,
        cvVersion: customCv.version,
        displayName: customCv.displayName,
        fileName: customCv.fileName,
        mimeType: customCv.mimeType,
        byteSize: customCv.byteSize,
        storageKey: customCv.storageKey,
        checksumSha256: customCv.checksumSha256,
      },
      jobSnapshot: {
        jobId: fixture.jobs.activeSecond.id,
        slug: fixture.jobs.activeSecond.slug,
        title: fixture.jobs.activeSecond.title,
        companyName: fixture.company.displayName,
        location: fixture.jobs.activeSecond.location,
      },
      consentVersion: "2026-09-01",
      consentedAt: fixture.now,
      idempotencyKey: `backup-restore-${fixture.suffix}`,
      submissionBindingDigest: sha256(`${fixture.candidateUserId}:${fixture.jobs.activeSecond.id}:${fixture.suffix}`),
      submittedAt: fixture.now,
    },
  });
  const applicationDocument = await prisma.applicationDocument.create({
    data: {
      id: `document-backup-restore-${fixture.suffix}`,
      jobApplicationId: application.id,
      kind: "CV",
      storagePurposeVersion: "application-document-v1",
      storageKeyEncrypted: applicationStorageKey,
      originalFilenameEncrypted: "candidate.pdf",
      mediaType: "application/pdf",
      byteLength: applicationPayload.byteLength,
      contentDigestHmac: sha256(applicationPayload),
      sourceCandidateCvId: customCv.id,
      sourceCandidateCvVersion: customCv.version,
      safetyAssessmentId: `safety-backup-restore-${fixture.suffix}`,
      committedAt: fixture.now,
    },
  });
  const promotion = await prisma.applicationArtifactPromotion.create({
    data: {
      id: `promotion-backup-restore-${fixture.suffix}`,
      candidateUserId: fixture.candidateUserId,
      jobPostingId: fixture.jobs.activeSecond.id,
      jobApplicationId: application.id,
      kind: "CV",
      storagePurposeVersion: "application-document-v1",
      storageKeyEncrypted: applicationStorageKey,
      state: "COMMITTED",
      orphanDeleteAfter: new Date(fixture.now.getTime() + 24 * 60 * 60_000),
    },
  });

  report.source.fixture = {
    suffix: fixture.suffix,
    applicationId: application.id,
    candidateCvId: customCv.id,
    applicationDocumentId: applicationDocument.id,
    promotionId: promotion.id,
    cvBytes: cvPayload.byteLength,
    applicationDocumentBytes: applicationPayload.byteLength,
    cvChecksumSha256: cvChecksum,
    applicationDocumentChecksumSha256: sha256(applicationPayload),
  };

  await mkdir(dirname(dumpFile), { recursive: true });
  await runDocker([
    "exec",
    postgresContainer,
    "pg_dump",
    "-U",
    dbRole,
    "-d",
    sourceDatabase,
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "-f",
    "/tmp/candidate-first-backup-restore.dump",
  ]);
  await runDocker(["cp", `${postgresContainer}:/tmp/candidate-first-backup-restore.dump`, dumpFile]);
  dumpCreated = true;
  const dumpStats = await stat(dumpFile);
  report.dump = {
    status: "PASS",
    format: "custom",
    noOwner: true,
    noPrivileges: true,
    bytes: dumpStats.size,
    sha256: sha256(await readFile(dumpFile)),
  };
  await runDocker(["exec", postgresContainer, "rm", "-f", "/tmp/candidate-first-backup-restore.dump"]).catch(() => undefined);

  restoredDatabase = `smarthire_candidate_first_restore_test_${Date.now().toString(36)}`;
  if (!safeDatabaseName(restoredDatabase)) throw new Error("CF004_RESTORE_TARGET_DATABASE_UNSAFE");
  await runPsql("postgres", `CREATE DATABASE "${restoredDatabase}"`);
  report.restore.database = restoredDatabase;
  await runDocker(["cp", dumpFile, `${postgresContainer}:/tmp/candidate-first-backup-restore.dump`]);
  const restoreStartedAt = Date.now();
  await runDocker([
    "exec",
    postgresContainer,
    "pg_restore",
    "-U",
    dbRole,
    "-d",
    restoredDatabase,
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    "/tmp/candidate-first-backup-restore.dump",
  ]);
  report.restore.durationMs = Date.now() - restoreStartedAt;
  report.restore.status = "PASS";

  const [cvRows, applicationRows, documentRows, promotionRows] = await Promise.all([
    queryRestored(restoredDatabase, sourceUrl, 'SELECT "id", "storageKey", "checksumSha256", "byteSize", "version" FROM "CandidateCv" WHERE "id" = $1', [customCv.id]),
    queryRestored(restoredDatabase, sourceUrl, 'SELECT "id", "candidateUserId", "jobPostingId", "selectedCvId", "idempotencyKey", "cvSnapshot" FROM "JobApplication" WHERE "id" = $1', [application.id]),
    queryRestored(restoredDatabase, sourceUrl, 'SELECT "id", "jobApplicationId", "storageKeyEncrypted", "contentDigestHmac", "byteLength", "sourceCandidateCvId" FROM "ApplicationDocument" WHERE "id" = $1', [applicationDocument.id]),
    queryRestored(restoredDatabase, sourceUrl, 'SELECT "id", "jobApplicationId", "state", "storageKeyEncrypted" FROM "ApplicationArtifactPromotion" WHERE "id" = $1', [promotion.id]),
  ]);
  const restoredCv = cvRows[0];
  const restoredApplication = applicationRows[0];
  const restoredDocument = documentRows[0];
  const restoredPromotion = promotionRows[0];
  const rowChecks = {
    candidateCv: Boolean(
      restoredCv &&
        restoredCv.storageKey === customCv.storageKey &&
        restoredCv.checksumSha256 === cvChecksum &&
        Number(restoredCv.byteSize) === cvPayload.byteLength,
    ),
    application: Boolean(
      restoredApplication &&
        restoredApplication.candidateUserId === fixture.candidateUserId &&
        restoredApplication.jobPostingId === fixture.jobs.activeSecond.id &&
        restoredApplication.selectedCvId === customCv.id &&
        restoredApplication.idempotencyKey === `backup-restore-${fixture.suffix}`,
    ),
    applicationDocument: Boolean(
      restoredDocument &&
        restoredDocument.jobApplicationId === application.id &&
        restoredDocument.storageKeyEncrypted === applicationStorageKey &&
        restoredDocument.contentDigestHmac === sha256(applicationPayload) &&
        Number(restoredDocument.byteLength) === applicationPayload.byteLength &&
        restoredDocument.sourceCandidateCvId === customCv.id,
    ),
    durablePromotion: Boolean(
      restoredPromotion &&
        restoredPromotion.jobApplicationId === application.id &&
        restoredPromotion.state === "COMMITTED" &&
        restoredPromotion.storageKeyEncrypted === applicationStorageKey,
    ),
  };
  report.restore.rowChecks = rowChecks;
  report.restore.rows = {
    candidateCv: restoredCv ? 1 : 0,
    application: restoredApplication ? 1 : 0,
    applicationDocument: restoredDocument ? 1 : 0,
    durablePromotion: restoredPromotion ? 1 : 0,
  };

  await copyStorage(sourceStorageRoot, restoredStorageRoot);
  const restoredCvBytes = await readFile(join(restoredStorageRoot, cvStorageKey));
  const restoredApplicationBytes = await readFile(join(restoredStorageRoot, applicationStorageKey));
  report.artifacts = {
    sourceRoot: sourceStorageRoot,
    restoredRoot: restoredStorageRoot,
    mode: "separate-manifest-copy-rehearsal",
    cv: {
      exists: true,
      bytes: restoredCvBytes.byteLength,
      sha256: sha256(restoredCvBytes),
      matchesDatabaseChecksum: sha256(restoredCvBytes) === cvChecksum,
    },
    applicationDocument: {
      exists: true,
      bytes: restoredApplicationBytes.byteLength,
      sha256: sha256(restoredApplicationBytes),
      matchesDatabaseDigest: sha256(restoredApplicationBytes) === sha256(applicationPayload),
    },
  };
  report.artifacts.status =
    report.artifacts.cv.matchesDatabaseChecksum &&
    report.artifacts.applicationDocument.matchesDatabaseDigest
      ? "PASS"
      : "FAIL";

  await deleteCandidateFirstDatabaseFixture(fixture);
  report.cleanup.sourceFixture = "PASS";
  await runPsql("postgres", `DROP DATABASE "${restoredDatabase}"`);
  report.cleanup.restoreDatabase = "PASS";
  await runDocker(["exec", postgresContainer, "rm", "-f", "/tmp/candidate-first-backup-restore.dump"]).catch(() => undefined);
  await rm(sourceStorageRoot, { recursive: true, force: true });
  await rm(restoredStorageRoot, { recursive: true, force: true });
  await rm(dumpFile, { force: true });
  report.cleanup.temporaryFiles = "PASS";
  report.rpo = { measured: "local rehearsal only", sourceSnapshotSeconds: 0 };
  report.rto = { measuredMs: report.restore.durationMs, scope: "database restore plus local object copy" };
  report.status = Object.values(rowChecks).every(Boolean) && report.artifacts.status === "PASS" ? "PASS_WITH_LIMITATION" : "FAIL";
} catch (error) {
  report.status = "FAIL";
  report.error = redactError(error);
  if (fixture && prisma) {
    try {
      const { deleteCandidateFirstDatabaseFixture } = await import("../tests/helpers/candidate-first-database-fixture.ts");
      await deleteCandidateFirstDatabaseFixture(fixture);
      report.cleanup.sourceFixture = "PASS_AFTER_FAILURE";
    } catch (cleanupError) {
      report.cleanup.sourceFixture = `FAILED: ${redactError(cleanupError)}`;
    }
  }
  if (restoredDatabase) {
    await runPsql("postgres", `DROP DATABASE IF EXISTS "${restoredDatabase}"`).catch(() => undefined);
    report.cleanup.restoreDatabase = "ATTEMPTED";
  }
  await runDocker([
    "exec",
    postgresContainer,
    "rm",
    "-f",
    "/tmp/candidate-first-backup-restore.dump",
  ]).catch(() => undefined);
  if (sourceStorageCreated) await rm(sourceStorageRoot, { recursive: true, force: true }).catch(() => undefined);
  await rm(restoredStorageRoot, { recursive: true, force: true }).catch(() => undefined);
  if (dumpCreated) await rm(dumpFile, { force: true }).catch(() => undefined);
  report.cleanup.temporaryFiles = "ATTEMPTED";
} finally {
  if (prisma) await prisma.$disconnect().catch(() => undefined);
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));
if (report.status === "FAIL") process.exitCode = 1;
