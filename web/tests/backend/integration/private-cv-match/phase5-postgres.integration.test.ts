import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/backend/database/prisma";
import { deleteCompanyScopedCandidatePrivateData } from "@/backend/private-data/company-deletion";
import {
  PRIVATE_SCORING_CONFIG_VERSION,
  PrivateCvMatchService,
} from "@/backend/private-cv-match/private-cv-match-service";
import { PrivateMatchWorker } from "@/backend/private-cv-match/private-match-worker";
import { PrivateCvMatchRepository } from "@/backend/repositories/private-cv-match/prisma-private-cv-match-repository";
import { deleteRecruiterCompany } from "@/backend/services/jobs/recruiter-job-posting-data";
import {
  createCandidateFirstDatabaseFixture,
  deleteCandidateFirstDatabaseFixture,
} from "../../../helpers/candidate-first-database-fixture";

const now = new Date("2026-09-17T00:00:00.000Z");
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

type Fixture = Awaited<ReturnType<typeof createCandidateFirstDatabaseFixture>>;

function privateSnapshots(input: {
  fixture: Fixture;
  jobId: string;
  cvVersionId: string;
  cvVersion?: number;
  cvParseStatus?: "READY" | "PARTIAL" | "FAILED";
  jdParseStatus?: "READY" | "PARTIAL" | "FAILED";
}) {
  const job = [input.fixture.jobs.active, input.fixture.jobs.activeSecond].find(
    (candidate) => candidate.id === input.jobId,
  );
  if (!job) throw new Error(`PHASE5_FIXTURE_JOB_NOT_FOUND:${input.jobId}`);
  const cvVersion = input.cvVersion ?? 1;
  return {
    cv: {
      versionId: input.cvVersionId,
      version: cvVersion,
      displayName: "Secure fixture CV",
      fileName: "secure-fixture.pdf",
      mimeType: "application/pdf",
      byteSize: 128,
      pageCount: 1,
      parseStatus: input.cvParseStatus ?? "READY",
      confirmedAt: now.toISOString(),
      checksumSha256: digestA,
    },
    jd: {
      jobId: job.id,
      slug: job.slug,
      title: job.title,
      company: input.fixture.company.displayName,
      location: job.location,
      employmentType: job.employmentType,
      workArrangement: job.workArrangement,
      requiredExperienceYears: 2,
      requirements: ["TypeScript delivery"],
      requiredSkills: [{ code: "typescript", label: "TypeScript" }],
      preferredSkills: [{ code: "testing", label: "Testing" }],
      requiredLanguages: [],
      jdVersion: job.version,
      jdUpdatedAt: job.updatedAt.toISOString(),
      jdText: "TypeScript delivery with testing experience.",
      parseStatus: input.jdParseStatus ?? "READY",
    },
  } as const;
}

async function createSyntheticCheck(
  repository: PrivateCvMatchRepository,
  fixture: Fixture,
  input: {
    key: string;
    jobId: string;
    cvVersionId?: string;
    expiresAt: Date;
    createdAt?: Date;
    cvParseStatus?: "READY" | "PARTIAL" | "FAILED";
    jdParseStatus?: "READY" | "PARTIAL" | "FAILED";
  },
) {
  const snapshots = privateSnapshots({
    fixture,
    jobId: input.jobId,
    cvVersionId: input.cvVersionId ?? fixture.confirmedCvId,
    cvParseStatus: input.cvParseStatus,
    jdParseStatus: input.jdParseStatus,
  });
  return repository.createCheck({
    id: `cf501-${input.key}-${randomUUID()}`,
    candidateUserId: fixture.candidateUserId,
    cvVersionId: snapshots.cv.versionId,
    cvVersion: snapshots.cv.version,
    cvDigest: snapshots.cv.checksumSha256,
    jobPostingId: snapshots.jd.jobId,
    jdVersion: snapshots.jd.jdVersion,
    jdDigest: digestB,
    scoringConfigVersion: PRIVATE_SCORING_CONFIG_VERSION,
    creationDedupeKey: `${input.key}-${randomUUID()}`
      .padEnd(64, "x")
      .slice(0, 64),
    cvSnapshot: snapshots.cv,
    jdSnapshot: snapshots.jd,
    expiresAt: input.expiresAt,
    createdAt: input.createdAt ?? new Date(input.expiresAt.getTime() - 60_000),
  });
}

describe.sequential("CF-501 isolated PostgreSQL evidence", () => {
  let fixture: Fixture;
  let repository: PrivateCvMatchRepository;
  let service: PrivateCvMatchService;
  let primaryCheckId = "";

  beforeAll(async () => {
    fixture = await createCandidateFirstDatabaseFixture("cf501-postgres", now);
    repository = new PrivateCvMatchRepository();
    service = new PrivateCvMatchService({
      repository,
      enqueue: async () => undefined,
      now: () => now,
    });

    const created = await service.create(
      fixture.candidateUserId,
      { jobId: fixture.jobs.active.id, cvVersionId: fixture.confirmedCvId },
      `cf501-create-${randomUUID()}`,
    );
    primaryCheckId = created.check.id;
    const claimed = await repository.claimNextAttempt(
      "cf501-initial-worker",
      now,
      120_000,
    );
    if (!claimed) throw new Error("CF501_INITIAL_ATTEMPT_NOT_CLAIMED");

    await repository.saveAutomaticResult({
      attemptId: claimed.id,
      workerId: "cf501-initial-worker",
      calculatedAt: now,
      result: {
        resultId: `cf501-result-${randomUUID()}`,
        score: 80,
        weight: 0.4,
        weightedContribution: 32,
        matchedRequirements: [
          {
            id: "typescript",
            label: "TypeScript",
            kind: "REQUIRED",
            matched: true,
          },
          {
            id: "testing",
            label: "Testing",
            kind: "PREFERRED",
            matched: false,
          },
        ],
        gaps: [
          {
            code: "testing",
            title: "Testing",
            description: "Testing evidence was not detected.",
            kind: "PREFERRED",
          },
        ],
        requiredExperience: 2,
        detectedExperience: 3,
        evidenceCoverage: 1,
        evidenceConfidence: 95,
        evidence: [
          {
            criterionId: "typescript",
            criterionVersion: "v1",
            classification: "SKILL",
            quote: "TypeScript",
            location: { section: "Skills", page: 1 },
            confidence: 0.95,
            exclusionFlags: [],
          },
        ],
        parserProvenance: {
          parserVersion: "private-cv-match-parser-v1",
          cvStatus: "READY",
          jdStatus: "READY",
        },
        mayBeIncomplete: false,
        cvVersion: `cv-${claimed.check.cvVersionId}-v${claimed.check.cvVersion}`,
        jdVersion: `jd-${claimed.check.jobPostingId}-v${claimed.check.jdVersion}`,
        configVersion: claimed.check.scoringConfigVersion,
      },
    });
    await repository.beginAi({
      attemptId: claimed.id,
      workerId: "cf501-initial-worker",
      now,
      leaseMilliseconds: 120_000,
    });
    await repository.publishLimited({
      attemptId: claimed.id,
      workerId: "cf501-initial-worker",
      failureCode: "AI_PROVIDER_TIMEOUT",
      completedAt: now,
    });
  });

  afterAll(async () => {
    if (fixture) {
      await deleteCandidateFirstDatabaseFixture(fixture).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("persists immutable CV/JD/config lineage and rejects result mutation", async () => {
    const row = await prisma.privateCvMatchCheck.findUniqueOrThrow({
      where: { id: primaryCheckId },
      include: {
        currentAttempt: { include: { deterministicResult: true } },
      },
    });
    expect(row.cvVersionId).toBe(fixture.confirmedCvId);
    expect(row.cvSnapshot).toMatchObject({
      versionId: fixture.confirmedCvId,
      version: row.cvVersion,
      checksumSha256: row.cvDigest,
    });
    expect(row.jdSnapshot).toMatchObject({
      jobId: fixture.jobs.active.id,
      jdVersion: row.jdVersion,
    });
    expect(row.currentAttempt?.scoringPolicyVersion).toBe(
      row.scoringConfigVersion,
    );
    const resultId = row.currentAttempt?.deterministicResult?.id;
    if (!resultId) throw new Error("CF501_RESULT_NOT_PUBLISHED");
    await expect(
      prisma.privateAutomaticMatchResult.update({
        where: { id: resultId },
        data: { score: 81 },
      }),
    ).rejects.toThrow(/immutable/u);
  });

  it("keeps read/list/retry/delete private to the owning Candidate", async () => {
    await expect(
      service.get(fixture.employerUserId, primaryCheckId),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", status: 404 });
    await expect(
      service.retryAi(
        fixture.employerUserId,
        primaryCheckId,
        "cf501-cross-retry-key",
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", status: 404 });
    await expect(
      service.delete(fixture.employerUserId, primaryCheckId),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", status: 404 });
    await expect(service.list(fixture.employerUserId)).resolves.toEqual({
      items: [],
    });
    await expect(
      service.get(fixture.candidateUserId, primaryCheckId),
    ).resolves.toMatchObject({
      id: primaryCheckId,
      candidateUserId: fixture.candidateUserId,
      state: "LIMITED",
    });
  });

  it("converges concurrent retry requests to one AI retry attempt", async () => {
    const results = await Promise.all([
      service.retryAi(
        fixture.candidateUserId,
        primaryCheckId,
        "cf501-concurrent-retry-key",
      ),
      service.retryAi(
        fixture.candidateUserId,
        primaryCheckId,
        "cf501-concurrent-retry-key",
      ),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.check.id === primaryCheckId)).toBe(
      true,
    );
    await expect(
      prisma.privateCvMatchAttempt.count({
        where: { checkId: primaryCheckId, trigger: "AI_RETRY" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.privateCvMatchCommandReceipt.count({
        where: { checkId: primaryCheckId, commandKind: "RETRY_AI" },
      }),
    ).resolves.toBe(1);
  });

  it("keeps expired, revoked, and physically deleted checks neutrally denied", async () => {
    const expired = await createSyntheticCheck(repository, fixture, {
      key: "expired",
      jobId: fixture.jobs.activeSecond.id,
      createdAt: new Date(now.getTime() - 120_000),
      expiresAt: new Date(now.getTime() - 60_000),
    });
    const revoked = await createSyntheticCheck(repository, fixture, {
      key: "revoked",
      jobId: fixture.jobs.activeSecond.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    expect(
      await repository.revokeOwnedCheck(
        fixture.candidateUserId,
        revoked.id,
        now,
      ),
    ).toBe(true);

    const deleted = await createSyntheticCheck(repository, fixture, {
      key: "deleted",
      jobId: fixture.jobs.activeSecond.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    expect(
      await repository.revokeOwnedCheck(
        fixture.candidateUserId,
        deleted.id,
        now,
      ),
    ).toBe(true);
    await prisma.privateCvMatchCheck.update({
      where: { id: deleted.id },
      data: { deleteAfter: now },
    });
    const cleanupClaim = await repository.claimCleanup("cf501-cleanup", now);
    expect(cleanupClaim).toBe(deleted.id);
    expect(
      await repository.physicallyDeleteClaimed(
        deleted.id,
        "cf501-cleanup",
        now,
      ),
    ).toBe(true);

    for (const checkId of [expired.id, revoked.id, deleted.id]) {
      await expect(
        service.get(fixture.candidateUserId, checkId),
      ).rejects.toMatchObject({
        code: "UNAVAILABLE",
        status: 404,
      });
      await expect(
        service.retryAi(
          fixture.candidateUserId,
          checkId,
          `cf501-neutral-${checkId}`,
        ),
      ).rejects.toMatchObject({ code: "UNAVAILABLE", status: 404 });
      await expect(
        service.delete(fixture.candidateUserId, checkId),
      ).rejects.toMatchObject({ code: "UNAVAILABLE", status: 404 });
    }
  });

  it("supports owner delete while preserving neutral denial afterward", async () => {
    await expect(
      service.delete(fixture.candidateUserId, primaryCheckId),
    ).resolves.toBeUndefined();
    await expect(
      service.get(fixture.candidateUserId, primaryCheckId),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      status: 404,
    });
  });

  it("proves private company cleanup commits and rolls back inside PostgreSQL transactions", async () => {
    const rollbackCheck = await createSyntheticCheck(repository, fixture, {
      key: "rollback",
      jobId: fixture.jobs.activeSecond.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    await expect(
      prisma.$transaction(async (transaction) => {
        await deleteCompanyScopedCandidatePrivateData(transaction, [
          fixture.jobs.activeSecond.id,
        ]);
        throw new Error("CF501_ROLLBACK_PROBE");
      }),
    ).rejects.toThrow("CF501_ROLLBACK_PROBE");
    await expect(
      prisma.privateCvMatchCheck.findUnique({
        where: { id: rollbackCheck.id },
      }),
    ).resolves.toMatchObject({ id: rollbackCheck.id });

    await prisma.$transaction((transaction) =>
      deleteCompanyScopedCandidatePrivateData(transaction, [
        fixture.jobs.activeSecond.id,
      ]),
    );
    await expect(
      prisma.privateCvMatchCheck.count({
        where: { jobPostingId: fixture.jobs.activeSecond.id },
      }),
    ).resolves.toBe(0);
  });

  it("keeps worker logs content-free when deterministic work fails", async () => {
    const loggingCheck = await createSyntheticCheck(repository, fixture, {
      key: "logging",
      jobId: fixture.jobs.active.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    await repository.setCvTextSnapshot(
      loggingCheck.id,
      "CV_PRIVATE_CONTENT must never be logged\nSkills\nTypeScript",
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const worker = new PrivateMatchWorker({
      repository,
      now: () => now,
      workerId: "cf501-log-worker",
      classifier: {
        classify: async () => ({
          isCv: true,
          confidence: 0.95,
          source: "DETERMINISTIC_FALLBACK" as const,
        }),
      },
      automatic: {
        match: async () => {
          throw new Error("CV_PRIVATE_CONTENT JD_PRIVATE_CONTENT");
        },
      },
    });
    await expect(worker.processNext()).resolves.toBe("FAILED");
    const serialized = [
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]
      .flat()
      .map((value) => String(value))
      .join("\n");
    expect(serialized).toContain(loggingCheck.id);
    expect(serialized).not.toContain("CV_PRIVATE_CONTENT");
    expect(serialized).not.toContain("JD_PRIVATE_CONTENT");
  });

  it("deletes company-scoped private rows through the real deletion transaction", async () => {
    const companyCheck = await createSyntheticCheck(repository, fixture, {
      key: "company-delete",
      jobId: fixture.jobs.active.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    const result = await deleteRecruiterCompany(
      fixture.employerUserId,
      fixture.company.id,
    );
    expect(result).toMatchObject({
      deleted: true,
      companyId: fixture.company.id,
    });
    await expect(
      prisma.privateCvMatchCheck.findUnique({ where: { id: companyCheck.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.company.findUnique({ where: { id: fixture.company.id } }),
    ).resolves.toBeNull();
  });
});
