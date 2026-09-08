import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { PrismaCvWorkRepository } from "@/backend/repositories/cv-import/prisma-cv-work-repository";
import { ScanStageProcessor } from "@/backend/cv/workers/scan-stage";
import { CvWorkerRuntime } from "@/backend/cv/workers/cv-worker-runtime";
import { CvWorkerPipeline } from "@/backend/cv/workers/pipeline";
import { CvFixtureClock } from "../../../helpers/cv-import-fixture";
import {
  cleanupCvRecoveryAccounts,
  grantExactRecoveryConsent,
  seedCvRecoveryImport,
  type SeededCvRecoveryImport,
} from "../../../helpers/cv-failure-retry-fixture";

type RetryOutcome = Readonly<{
  uploadId: string;
  status: "SCAN_QUEUED" | "EXTRACTION_QUEUED" | "PARSE_QUEUED";
  scanRetriesRemaining: number;
  parseRetriesRemaining: number;
  extractionRetriesRemaining?: number;
}>;

type RetryCvImportServiceShape = Readonly<{
  execute(input: {
    accountId: string;
    uploadId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<RetryOutcome>;
}>;

type RetryCvImportServiceModule = Readonly<{
  RetryCvImportService: new () => RetryCvImportServiceShape;
}>;

type AutomaticScanRepository = Readonly<{
  scheduleAutomaticScanRetry(input: {
    uploadId: string;
    priorAssessmentId: string;
    now: Date;
  }): Promise<Readonly<{ id: string; attemptNumber: number }>>;
}>;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const accounts: string[] = [];
const initial = new Date("2026-08-01T05:00:00.000Z");

async function retryService(): Promise<RetryCvImportServiceShape> {
  // Kept non-literal so this TDD suite typechecks before T098 creates the
  // production module. Runtime loading is expected to fail until then.
  const moduleId = "@/backend/services/cv-import/retry-cv-import";
  const feature = await vi.importActual<RetryCvImportServiceModule>(moduleId);
  return new feature.RetryCvImportService();
}

async function failParseAttempt(id: string, completedAt: Date) {
  await pool.query(
    `UPDATE "CvParseJob"
        SET "status" = 'FAILED', "failureCode" = 'PARSER_UNAVAILABLE',
            "completedAt" = $2, "leaseOwner" = NULL, "leaseExpiresAt" = NULL
      WHERE "id" = $1`,
    [id, completedAt],
  );
}

async function failScanAttempt(id: string, completedAt: Date) {
  await pool.query(
    `UPDATE "CvScanAssessment"
        SET "status" = 'INDETERMINATE', "failureCode" = 'SCANNER_UNAVAILABLE',
            "completedAt" = $2, "leaseOwner" = NULL, "leaseExpiresAt" = NULL
      WHERE "id" = $1`,
    [id, completedAt],
  );
}

async function failExtractionAttempt(id: string, completedAt: Date) {
  await pool.query(
    `UPDATE "CvExtraction"
        SET "status" = 'FAILED', "failureCode" = 'OCR_UNAVAILABLE',
            "completedAt" = $2, "leaseOwner" = NULL, "leaseExpiresAt" = NULL
      WHERE "id" = $1`,
    [id, completedAt],
  );
}

async function candidateRetry(
  seeded: SeededCvRecoveryImport,
  idempotencyKey: string,
  now: Date,
) {
  return (await retryService()).execute({
    accountId: seeded.accountId,
    uploadId: seeded.uploadId,
    idempotencyKey,
    now,
  });
}

afterEach(async () => {
  const client = await pool.connect();
  try {
    await cleanupCvRecoveryAccounts(client, accounts.splice(0));
  } finally {
    client.release();
  }
});

afterAll(async () => pool.end());

describe.sequential("controlled CV retry policy", () => {
  it("schedules an automatic retry only after the failed lease is durably finalized", async () => {
    const claim = {
      id: "runtime-scan-attempt-fixture",
      uploadId: "runtime-scan-upload-fixture",
      accountId: "runtime-scan-account-fixture",
      attemptNumber: 1,
      leaseOwner: "runtime-worker-fixture",
      leaseExpiresAt: new Date(initial.getTime() + 60_000),
    };
    let offered = false;
    const finalized = vi.fn(async () => true);
    const scheduled = vi.fn(async () => ({
      id: "runtime-scan-retry-fixture",
      attemptNumber: 2,
    }));
    const observability = {
      emitLog: vi.fn(),
      emitMetric: vi.fn(),
    };
    const repository = {
      claimStage: vi.fn(async ({ stage }: { stage: string }) => {
        if (stage !== "SCAN" || offered) return [];
        offered = true;
        return [claim];
      }),
      finalizeStage: finalized,
      releaseWorkerLeases: vi.fn(async () => 0),
      scheduleAutomaticScanRetry: scheduled,
    };
    const pipeline = new CvWorkerPipeline({
      SCAN: async () => ({
        status: "INDETERMINATE",
        failureCode: "SCANNER_UNAVAILABLE",
      }),
    });
    const runtime = new CvWorkerRuntime({
      repository: repository as never,
      pipeline,
      clock: new CvFixtureClock(initial),
      owner: claim.leaseOwner,
      concurrency: 1,
      batchSize: 1,
      leaseMs: 60_000,
      pollMs: 10,
      observability,
    });

    expect(await runtime.pollOnce()).toBe(1);
    await vi.waitFor(() => expect(scheduled).toHaveBeenCalledOnce());
    expect(finalized).toHaveBeenCalledBefore(scheduled);
    expect(scheduled).toHaveBeenCalledWith({
      uploadId: claim.uploadId,
      priorAssessmentId: claim.id,
      now: new Date(initial.getTime() + 2_000),
    });
    expect(observability.emitLog).toHaveBeenCalledTimes(2);
    expect(observability.emitMetric).toHaveBeenCalledTimes(2);
    expect(observability.emitMetric).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metric: "cv_stage_outcome_total",
        dimensions: expect.objectContaining({
          stage: "SCAN",
          state: "INDETERMINATE",
          resultCode: "SCANNER_UNAVAILABLE",
        }),
      }),
    );
    expect(observability.emitMetric).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metric: "cv_stage_outcome_total",
        dimensions: expect.objectContaining({
          stage: "SCAN",
          state: "AUTOMATIC_RETRY_QUEUED",
        }),
      }),
    );
    await runtime.shutdown();
  });

  it("requires a parse-capable runtime lease to outlive the 60-second hard deadline with margin", () => {
    const pipeline = new CvWorkerPipeline({
      PARSE: async () => ({ status: "SUCCEEDED" }),
      DELETE: async () => ({ status: "DELETED" }),
    });
    expect(
      () =>
        new CvWorkerRuntime({
          pipeline,
          leaseMs: 60_000,
        }),
    ).toThrow("CV_WORKER_PARSE_LEASE_TOO_SHORT");
    expect(
      () =>
        new CvWorkerRuntime({
          pipeline,
          leaseMs: 65_000,
        }),
    ).not.toThrow();
  });

  it("stays alive but claims no work while scanner definitions are stale", async () => {
    const readiness = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("CV_SCANNER_DEFINITIONS_STALE"), {
          code: "CV_SCANNER_DEFINITIONS_STALE",
        }),
      )
      .mockResolvedValue(undefined);
    const repository = {
      claimStage: vi.fn(async () => []),
      finalizeStage: vi.fn(async () => true),
      releaseWorkerLeases: vi.fn(async () => 0),
    };
    const sleep = vi.fn(async (milliseconds: number) => {
      if (milliseconds === 1_000) await runtime.shutdown();
    });
    const runtime = new CvWorkerRuntime({
      repository: repository as never,
      pipeline: new CvWorkerPipeline({
        DELETE: async () => ({ status: "DELETED" }),
      }),
      readiness,
      pollMs: 1_000,
      sleep,
    });

    await expect(runtime.run()).resolves.toBeUndefined();
    expect(readiness).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 60_000, expect.any(AbortSignal));
    expect(repository.claimStage).toHaveBeenCalledOnce();
    expect(repository.releaseWorkerLeases).toHaveBeenCalledOnce();
  });

  it("uses fixed 2/5-second backoff and permits exactly three automatic parse attempts", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "parse-auto-cycle", {
      stage: "PARSE",
      mode: "TERMINAL_FAILURE",
      now: initial,
      automaticAttemptsUsed: 1,
    });
    accounts.push(seeded.accountId);
    client.release();
    const clock = new CvFixtureClock(initial);
    const repository = new PrismaCvWorkRepository();
    clock.advance(2_000);
    const second = await repository.scheduleAutomaticParseRetry({
      uploadId: seeded.uploadId,
      priorJobId: seeded.parseId!,
      now: clock.now(),
    });
    expect(second.attemptNumber).toBe(2);
    await failParseAttempt(second.id, clock.now());
    clock.advance(5_000);
    const third = await repository.scheduleAutomaticParseRetry({
      uploadId: seeded.uploadId,
      priorJobId: second.id,
      now: clock.now(),
    });
    expect(third.attemptNumber).toBe(3);
    await failParseAttempt(third.id, clock.now());
    clock.advance(5_000);
    await expect(
      repository.scheduleAutomaticParseRetry({
        uploadId: seeded.uploadId,
        priorJobId: third.id,
        now: clock.now(),
      }),
    ).rejects.toThrow("CV_PARSE_RETRY_LIMIT_REACHED");
    const history = await pool.query<{
      attemptNumber: number;
      trigger: string;
      createdAt: Date;
    }>(
      `SELECT "attemptNumber", "trigger"::text, "createdAt"
         FROM "CvParseJob" WHERE "uploadId" = $1 ORDER BY "attemptNumber"`,
      [seeded.uploadId],
    );
    expect(
      history.rows.map(({ attemptNumber, trigger }) => ({
        attemptNumber,
        trigger,
      })),
    ).toEqual([
      { attemptNumber: 1, trigger: "INITIAL" },
      { attemptNumber: 2, trigger: "AUTOMATIC_RETRY" },
      { attemptNumber: 3, trigger: "AUTOMATIC_RETRY" },
    ]);
    expect(history.rows[1]!.createdAt.getTime() - initial.getTime()).toBe(
      2_000,
    );
    expect(
      history.rows[2]!.createdAt.getTime() -
        history.rows[1]!.createdAt.getTime(),
    ).toBe(5_000);
  });

  it("rejects an automatic parse retry before its fixed backoff is due", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "parse-backoff", {
      stage: "PARSE",
      mode: "TERMINAL_FAILURE",
      now: initial,
    });
    accounts.push(seeded.accountId);
    client.release();
    await expect(
      new PrismaCvWorkRepository().scheduleAutomaticParseRetry({
        uploadId: seeded.uploadId,
        priorJobId: seeded.parseId!,
        now: new Date(initial.getTime() + 1_999),
      }),
    ).rejects.toThrow("CV_RETRY_BACKOFF_PENDING");
  });

  it("bounds the complete automatic scan cycle to three attempts and five minutes from initial start", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "scan-auto-cycle", {
      stage: "SCAN",
      mode: "TERMINAL_FAILURE",
      now: initial,
      automaticAttemptsUsed: 1,
    });
    accounts.push(seeded.accountId);
    client.release();
    const repository = new PrismaCvWorkRepository() as PrismaCvWorkRepository &
      AutomaticScanRepository;
    const second = await repository.scheduleAutomaticScanRetry({
      uploadId: seeded.uploadId,
      priorAssessmentId: seeded.scanId,
      now: new Date(initial.getTime() + 2_000),
    });
    await failScanAttempt(second.id, new Date(initial.getTime() + 2_000));
    const third = await repository.scheduleAutomaticScanRetry({
      uploadId: seeded.uploadId,
      priorAssessmentId: second.id,
      now: new Date(initial.getTime() + 7_000),
    });
    await failScanAttempt(third.id, new Date(initial.getTime() + 7_000));
    await expect(
      repository.scheduleAutomaticScanRetry({
        uploadId: seeded.uploadId,
        priorAssessmentId: third.id,
        now: new Date(initial.getTime() + 7_001),
      }),
    ).rejects.toThrow("CV_SCAN_RETRY_LIMIT_REACHED");
    const lateClient = await pool.connect();
    const late = await seedCvRecoveryImport(
      lateClient,
      "scan-five-minute-cap",
      {
        stage: "SCAN",
        mode: "TERMINAL_FAILURE",
        now: initial,
      },
    );
    accounts.push(late.accountId);
    lateClient.release();
    await expect(
      repository.scheduleAutomaticScanRetry({
        uploadId: late.uploadId,
        priorAssessmentId: late.scanId,
        now: new Date(initial.getTime() + 5 * 60_000 + 1),
      }),
    ).rejects.toThrow("CV_SCAN_RETRY_WINDOW_EXHAUSTED");

    const nearDeadlineClient = await pool.connect();
    const nearDeadline = await seedCvRecoveryImport(
      nearDeadlineClient,
      "scan-near-five-minute-cap",
      {
        stage: "SCAN",
        mode: "TERMINAL_FAILURE",
        now: initial,
      },
    );
    accounts.push(nearDeadline.accountId);
    nearDeadlineClient.release();
    await expect(
      repository.scheduleAutomaticScanRetry({
        uploadId: nearDeadline.uploadId,
        priorAssessmentId: nearDeadline.scanId,
        now: new Date(initial.getTime() + 5 * 60_000 - 29_999),
      }),
    ).rejects.toThrow("CV_SCAN_RETRY_WINDOW_EXHAUSTED");
  });

  it("terminalizes automatic scan work claimed too late to finish within five minutes without invoking the scanner", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "scan-late-queued", {
      stage: "SCAN",
      mode: "TERMINAL_FAILURE",
      now: initial,
    });
    accounts.push(seeded.accountId);
    client.release();
    const repository = new PrismaCvWorkRepository();
    const retry = await repository.scheduleAutomaticScanRetry({
      uploadId: seeded.uploadId,
      priorAssessmentId: seeded.scanId,
      now: new Date(initial.getTime() + 2_000),
    });
    const claimedAt = new Date(initial.getTime() + 5 * 60_000 - 29_000);
    const claims = await repository.claimStage({
      stage: "SCAN",
      owner: "late-scan-worker",
      now: claimedAt,
      limit: 1,
      leaseMs: 90_000,
    });
    expect(claims).toMatchObject([{ id: retry.id }]);
    const storage = { assertReady: vi.fn(async () => undefined) };
    const reader = { verify: vi.fn() };
    const scanner = {
      scan: vi.fn(),
      assessmentMetadata: vi.fn(() => null),
    };
    const processor = new ScanStageProcessor({
      storage,
      reader,
      scanner,
    } as never);
    await expect(
      processor.process(claims[0]!, {
        signal: new AbortController().signal,
        now: claimedAt,
        currentTime: () => claimedAt,
      }),
    ).resolves.toEqual({
      status: "INDETERMINATE",
      failureCode: "SCANNER_UNAVAILABLE",
    });
    expect(storage.assertReady).not.toHaveBeenCalled();
    expect(reader.verify).not.toHaveBeenCalled();
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(
      await repository.finalizeStage({
        stage: "SCAN",
        id: retry.id,
        owner: "late-scan-worker",
        status: "INDETERMINATE",
        failureCode: "SCANNER_UNAVAILABLE",
        now: claimedAt,
      }),
    ).toBe(true);
    await expect(
      pool.query<{ status: string; failureCode: string | null }>(
        `SELECT "status"::text, "failureCode" FROM "CvUpload" WHERE "id" = $1`,
        [seeded.uploadId],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: "SCAN_FAILED", failureCode: "SCANNER_UNAVAILABLE" }],
    });
  });

  it("copies the exact external consent binding to an automatic retry and leaves it claimable", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "external-auto-consent", {
      stage: "PARSE",
      mode: "TERMINAL_FAILURE",
      parserClass: "EXTERNAL_OPENAI",
      now: initial,
    });
    accounts.push(seeded.accountId);
    const consentEventId = await grantExactRecoveryConsent(
      client,
      seeded,
      initial,
    );
    await client.query("BEGIN");
    try {
      await client.query(
        `SELECT set_config('smarthire.cv_retention_mode', 'on', true)`,
      );
      await client.query(
        `UPDATE "CvParseJob" SET "consentEventId" = $2 WHERE "id" = $1`,
        [seeded.parseId, consentEventId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const repository = new PrismaCvWorkRepository();
    const retry = await repository.scheduleAutomaticParseRetry({
      uploadId: seeded.uploadId,
      priorJobId: seeded.parseId!,
      now: new Date(initial.getTime() + 2_000),
    });
    const binding = await pool.query<{ consentEventId: string | null }>(
      `SELECT "consentEventId" FROM "CvParseJob" WHERE "id" = $1`,
      [retry.id],
    );
    expect(binding.rows[0]?.consentEventId).toBe(consentEventId);
    await expect(
      repository.claimStage({
        stage: "PARSE",
        owner: "external-retry-worker",
        now: new Date(initial.getTime() + 2_001),
        limit: 1,
        leaseMs: 65_000,
      }),
    ).resolves.toMatchObject([{ id: retry.id }]);
  });

  it("writes one safe audit only for an authorized terminal finalization and a newly scheduled retry", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "worker-safe-audit", {
      stage: "PARSE",
      now: initial,
    });
    accounts.push(seeded.accountId);
    client.release();
    const repository = new PrismaCvWorkRepository();
    expect(
      await repository.finalizeStage({
        stage: "PARSE",
        id: seeded.parseId!,
        owner: seeded.leaseOwner,
        status: "FAILED",
        failureCode: "PARSER_UNAVAILABLE",
        now: initial,
      }),
    ).toBe(true);
    expect(
      await repository.finalizeStage({
        stage: "PARSE",
        id: seeded.parseId!,
        owner: "stale-worker",
        status: "FAILED",
        failureCode: "PARSER_UNAVAILABLE",
        now: initial,
      }),
    ).toBe(false);
    await repository.scheduleAutomaticParseRetry({
      uploadId: seeded.uploadId,
      priorJobId: seeded.parseId!,
      now: new Date(initial.getTime() + 2_000),
    });
    await repository.scheduleAutomaticParseRetry({
      uploadId: seeded.uploadId,
      priorJobId: seeded.parseId!,
      now: new Date(initial.getTime() + 2_001),
    });
    const audits = await pool.query<{
      state: string;
      failureCode: string | null;
    }>(
      `SELECT "context"->>'state' AS state,
              "context"->>'failureCode' AS "failureCode"
         FROM "AuditEvent"
        WHERE "targetId" = $1 AND "action" = 'cv_import.stage_completed'
        ORDER BY "occurredAt", "id"`,
      [seeded.uploadId],
    );
    expect(audits.rows).toEqual([
      { state: "FAILED", failureCode: "PARSER_UNAVAILABLE" },
      { state: "AUTOMATIC_RETRY_QUEUED", failureCode: null },
    ]);
  });

  it.each([
    ["SCAN" as const, "SCAN_QUEUED" as const],
    ["PARSE" as const, "PARSE_QUEUED" as const],
  ])(
    "permits at most two candidate-owned single-attempt %s retries",
    async (stage, queuedStatus) => {
      const client = await pool.connect();
      const seeded = await seedCvRecoveryImport(client, `candidate-${stage}`, {
        stage,
        mode: "TERMINAL_FAILURE",
        now: initial,
        automaticAttemptsUsed: 3,
      });
      accounts.push(seeded.accountId);
      client.release();
      const first = await candidateRetry(
        seeded,
        `candidate-${stage.toLowerCase()}-key-0001`,
        initial,
      );
      expect(first.status).toBe(queuedStatus);
      const firstAttempt = await pool.query<{ id: string }>(
        stage === "SCAN"
          ? `SELECT "scanAssessmentId" AS id FROM "CvRetryRequest" WHERE "uploadId" = $1 ORDER BY "createdAt" DESC LIMIT 1`
          : `SELECT "parseJobId" AS id FROM "CvRetryRequest" WHERE "uploadId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        [seeded.uploadId],
      );
      if (stage === "SCAN")
        await failScanAttempt(firstAttempt.rows[0]!.id, initial);
      else await failParseAttempt(firstAttempt.rows[0]!.id, initial);
      await pool.query(
        `UPDATE "CvUpload" SET "status" = $2::"CvUploadStatus" WHERE "id" = $1`,
        [seeded.uploadId, stage === "SCAN" ? "SCAN_FAILED" : "PARSE_FAILED"],
      );
      await expect(
        candidateRetry(
          seeded,
          `candidate-${stage.toLowerCase()}-key-0002`,
          new Date(initial.getTime() + 1),
        ),
      ).resolves.toMatchObject({ status: queuedStatus });
      const secondAttempt = await pool.query<{ id: string }>(
        stage === "SCAN"
          ? `SELECT "scanAssessmentId" AS id FROM "CvRetryRequest" WHERE "uploadId" = $1 ORDER BY "createdAt" DESC LIMIT 1`
          : `SELECT "parseJobId" AS id FROM "CvRetryRequest" WHERE "uploadId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        [seeded.uploadId],
      );
      if (stage === "SCAN")
        await failScanAttempt(secondAttempt.rows[0]!.id, initial);
      else await failParseAttempt(secondAttempt.rows[0]!.id, initial);
      await pool.query(
        `UPDATE "CvUpload" SET "status" = $2::"CvUploadStatus" WHERE "id" = $1`,
        [seeded.uploadId, stage === "SCAN" ? "SCAN_FAILED" : "PARSE_FAILED"],
      );
      await expect(
        candidateRetry(
          seeded,
          `candidate-${stage.toLowerCase()}-key-0003`,
          new Date(initial.getTime() + 2),
        ),
      ).rejects.toMatchObject({ code: "RETRY_LIMIT_REACHED" });
      const attempts = await pool.query<{ count: number }>(
        stage === "SCAN"
          ? `SELECT count(*)::int AS count FROM "CvScanAssessment" WHERE "uploadId" = $1`
          : `SELECT count(*)::int AS count FROM "CvParseJob" WHERE "uploadId" = $1`,
        [seeded.uploadId],
      );
      expect(attempts.rows[0]?.count).toBe(3);
    },
  );

  it("retries extraction against the existing CLEAN scan without rescanning", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "candidate-extraction", {
      stage: "EXTRACTION",
      mode: "TERMINAL_FAILURE",
      failureCode: "OCR_UNAVAILABLE",
      now: initial,
      automaticAttemptsUsed: 3,
    });
    accounts.push(seeded.accountId);
    client.release();

    const first = await candidateRetry(
      seeded,
      "candidate-extraction-key-0001",
      initial,
    );
    expect(first).toMatchObject({
      status: "EXTRACTION_QUEUED",
      extractionRetriesRemaining: 1,
    });
    const firstBinding = await pool.query<{
      stage: string;
      priorExtractionId: string;
      extractionId: string;
    }>(
      `SELECT "stage"::text,
              "priorExtractionId",
              "extractionId"
         FROM "CvRetryRequest" retry
         JOIN "CvExtraction" extraction
           ON extraction."id" = retry."extractionId"
        WHERE retry."uploadId" = $1
        ORDER BY extraction."attemptNumber"
        LIMIT 1`,
      [seeded.uploadId],
    );
    expect(firstBinding.rows[0]).toMatchObject({
      stage: "EXTRACTION",
      priorExtractionId: seeded.extractionId,
    });
    expect(firstBinding.rows[0]!.extractionId).not.toBe(seeded.extractionId);
    const firstState = await pool.query<{
      status: string;
      failureCode: string | null;
      scans: number;
      extractions: number;
    }>(
      `SELECT upload."status"::text,
              upload."failureCode",
              (SELECT count(*)::int FROM "CvScanAssessment"
                WHERE "uploadId" = upload."id") AS scans,
              (SELECT count(*)::int FROM "CvExtraction"
                WHERE "uploadId" = upload."id") AS extractions
         FROM "CvUpload" upload
        WHERE upload."id" = $1`,
      [seeded.uploadId],
    );
    expect(firstState.rows[0]).toEqual({
      status: "EXTRACTION_QUEUED",
      failureCode: null,
      scans: 1,
      extractions: 2,
    });

    await failExtractionAttempt(firstBinding.rows[0]!.extractionId, initial);
    await pool.query(
      `UPDATE "CvUpload"
          SET "status" = 'EXTRACTION_FAILED',
              "failureCode" = 'OCR_UNAVAILABLE'
        WHERE "id" = $1`,
      [seeded.uploadId],
    );
    await expect(
      candidateRetry(
        seeded,
        "candidate-extraction-key-0001",
        new Date(initial.getTime() + 1),
      ),
    ).resolves.toEqual(first);

    const second = await candidateRetry(
      seeded,
      "candidate-extraction-key-0002",
      new Date(initial.getTime() + 2),
    );
    expect(second).toMatchObject({
      status: "EXTRACTION_QUEUED",
      extractionRetriesRemaining: 0,
    });
    const secondBinding = await pool.query<{
      priorExtractionId: string;
      extractionId: string;
    }>(
      `SELECT retry."priorExtractionId", retry."extractionId"
         FROM "CvRetryRequest" retry
         JOIN "CvExtraction" extraction
           ON extraction."id" = retry."extractionId"
        WHERE retry."uploadId" = $1
        ORDER BY extraction."attemptNumber" DESC
        LIMIT 1`,
      [seeded.uploadId],
    );
    expect(secondBinding.rows[0]!.priorExtractionId).toBe(
      firstBinding.rows[0]!.extractionId,
    );
    expect(secondBinding.rows[0]!.extractionId).not.toBe(
      firstBinding.rows[0]!.extractionId,
    );
    await failExtractionAttempt(secondBinding.rows[0]!.extractionId, initial);
    await pool.query(
      `UPDATE "CvUpload"
          SET "status" = 'EXTRACTION_FAILED',
              "failureCode" = 'OCR_UNAVAILABLE'
        WHERE "id" = $1`,
      [seeded.uploadId],
    );
    await expect(
      candidateRetry(
        seeded,
        "candidate-extraction-key-0003",
        new Date(initial.getTime() + 3),
      ),
    ).rejects.toMatchObject({ code: "RETRY_LIMIT_REACHED" });
    const finalState = await pool.query<{
      retries: number;
      scans: number;
      extractions: number;
      status: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM "CvRetryRequest"
           WHERE "uploadId" = $1 AND "stage" = 'EXTRACTION') AS retries,
         (SELECT count(*)::int FROM "CvScanAssessment"
           WHERE "uploadId" = $1) AS scans,
         (SELECT count(*)::int FROM "CvExtraction"
           WHERE "uploadId" = $1) AS extractions,
         "status"::text
         FROM "CvUpload" WHERE "id" = $1`,
      [seeded.uploadId],
    );
    expect(finalState.rows[0]).toEqual({
      retries: 2,
      scans: 1,
      extractions: 3,
      status: "EXTRACTION_FAILED",
    });
  });

  it("never restarts an automatic cycle after a candidate retry", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "candidate-no-nesting", {
      stage: "PARSE",
      mode: "TERMINAL_FAILURE",
      now: initial,
      automaticAttemptsUsed: 3,
    });
    accounts.push(seeded.accountId);
    client.release();
    await candidateRetry(seeded, "candidate-no-nesting-key", initial);
    const retry = await pool.query<{ id: string }>(
      `SELECT "parseJobId" AS id FROM "CvRetryRequest" WHERE "uploadId" = $1`,
      [seeded.uploadId],
    );
    await failParseAttempt(retry.rows[0]!.id, initial);
    await expect(
      new PrismaCvWorkRepository().scheduleAutomaticParseRetry({
        uploadId: seeded.uploadId,
        priorJobId: retry.rows[0]!.id,
        now: new Date(initial.getTime() + 5_000),
      }),
    ).rejects.toThrow("CV_CANDIDATE_RETRY_HAS_NO_AUTOMATIC_CYCLE");
  });

  it("requires a live exact external consent binding before consuming a parse retry", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "external-consent", {
      stage: "PARSE",
      mode: "TERMINAL_FAILURE",
      parserClass: "EXTERNAL_OPENAI",
      now: initial,
      automaticAttemptsUsed: 3,
    });
    accounts.push(seeded.accountId);
    client.release();
    await expect(
      candidateRetry(seeded, "external-consent-key-0001", initial),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    const before = await pool.query<{
      retries: number;
      candidateRetriesUsed: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM "CvRetryRequest" WHERE "uploadId" = $1) AS retries,
         "candidateParseRetriesUsed" AS "candidateRetriesUsed"
         FROM "CvUpload" WHERE "id" = $1`,
      [seeded.uploadId],
    );
    expect(before.rows[0]).toEqual({ retries: 0, candidateRetriesUsed: 0 });
    const grantClient = await pool.connect();
    await grantExactRecoveryConsent(grantClient, seeded, initial);
    grantClient.release();
    await expect(
      candidateRetry(seeded, "external-consent-key-0002", initial),
    ).resolves.toMatchObject({ status: "PARSE_QUEUED" });
  });

  it("replays the exact prior/new binding and rejects an account-key rebound", async () => {
    const client = await pool.connect();
    const first = await seedCvRecoveryImport(client, "replay-first", {
      stage: "SCAN",
      mode: "TERMINAL_FAILURE",
      now: initial,
      automaticAttemptsUsed: 3,
    });
    const second = await seedCvRecoveryImport(client, "replay-second", {
      stage: "SCAN",
      mode: "TERMINAL_FAILURE",
      now: initial,
      automaticAttemptsUsed: 3,
      existingAccount: {
        accountId: first.accountId,
        profileId: first.profileId,
      },
    });
    accounts.push(first.accountId);
    client.release();
    const key = "candidate-replay-binding-key";
    const original = await candidateRetry(first, key, initial);
    const bindingBefore = await pool.query<{
      id: string;
      priorScanAssessmentId: string;
      scanAssessmentId: string;
    }>(
      `SELECT "id", "priorScanAssessmentId", "scanAssessmentId"
         FROM "CvRetryRequest" WHERE "uploadId" = $1
         ORDER BY "createdAt", "id" LIMIT 1`,
      [first.uploadId],
    );
    await failScanAttempt(bindingBefore.rows[0]!.scanAssessmentId, initial);
    await pool.query(
      `UPDATE "CvUpload" SET "status" = 'SCAN_FAILED' WHERE "id" = $1`,
      [first.uploadId],
    );
    await candidateRetry(
      first,
      "candidate-later-state-key",
      new Date(initial.getTime() + 1),
    );
    await expect(
      candidateRetry(first, key, new Date(initial.getTime() + 2)),
    ).resolves.toEqual(original);
    expect(
      await pool.query(
        `SELECT "priorScanAssessmentId", "scanAssessmentId"
           FROM "CvRetryRequest" WHERE "id" = $1`,
        [bindingBefore.rows[0]!.id],
      ),
    ).toMatchObject({
      rows: [
        {
          priorScanAssessmentId: bindingBefore.rows[0]!.priorScanAssessmentId,
          scanAssessmentId: bindingBefore.rows[0]!.scanAssessmentId,
        },
      ],
    });
    await expect(candidateRetry(second, key, initial)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it.each([
    ["expired upload", { expired: true }],
    ["deleted source", { deletedSource: true }],
  ])(
    "denies retry for an %s without consuming a counter",
    async (_label, flags) => {
      const safeLabel = _label.replaceAll(" ", "-");
      const client = await pool.connect();
      const seeded = await seedCvRecoveryImport(client, `denied-${safeLabel}`, {
        stage: "SCAN",
        mode: "TERMINAL_FAILURE",
        now: initial,
        automaticAttemptsUsed: 3,
        ...flags,
      });
      accounts.push(seeded.accountId);
      client.release();
      await expect(
        candidateRetry(seeded, `denied-retry-${safeLabel}-key`, initial),
      ).rejects.toMatchObject({ code: "IMPORT_STATE_CONFLICT" });
      const state = await pool.query<{
        retries: number;
        candidateRetriesUsed: number;
      }>(
        `SELECT
         (SELECT count(*)::int FROM "CvRetryRequest" WHERE "uploadId" = $1) AS retries,
         "candidateScanRetriesUsed" AS "candidateRetriesUsed"
         FROM "CvUpload" WHERE "id" = $1`,
        [seeded.uploadId],
      );
      expect(state.rows[0]).toEqual({ retries: 0, candidateRetriesUsed: 0 });
    },
  );

  it("recovers an expired lease after a crash while rejecting the stale owner", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "lease-crash", {
      stage: "PARSE",
      mode: "PROCESSING",
      now: initial,
    });
    accounts.push(seeded.accountId);
    await client.query(
      `UPDATE "CvParseJob"
          SET "status" = 'QUEUED', "failureCode" = NULL, "completedAt" = NULL,
              "leaseOwner" = NULL, "leaseExpiresAt" = NULL
        WHERE "id" = $1`,
      [seeded.parseId],
    );
    client.release();
    const repository = new PrismaCvWorkRepository();
    const crashed = await repository.claimStage({
      stage: "PARSE",
      owner: "crashed-owner",
      now: initial,
      limit: 1,
      leaseMs: 1_000,
    });
    expect(crashed).toHaveLength(1);
    expect(
      await repository.claimStage({
        stage: "PARSE",
        owner: "early-owner",
        now: new Date(initial.getTime() + 999),
        limit: 1,
        leaseMs: 1_000,
      }),
    ).toEqual([]);
    const recoveredAt = new Date(initial.getTime() + 1_001);
    const recovered = await repository.claimStage({
      stage: "PARSE",
      owner: "recovered-owner",
      now: recoveredAt,
      limit: 1,
      leaseMs: 1_000,
    });
    expect(recovered.map(({ id }) => id)).toEqual([seeded.parseId]);
    expect(
      await repository.finalizeStage({
        stage: "PARSE",
        id: seeded.parseId!,
        owner: "crashed-owner",
        status: "FAILED",
        now: recoveredAt,
      }),
    ).toBe(false);
  });

  it("keeps attempt and retry history immutable after exact binding", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "immutable-history", {
      stage: "SCAN",
      mode: "TERMINAL_FAILURE",
      now: initial,
      automaticAttemptsUsed: 3,
    });
    accounts.push(seeded.accountId);
    client.release();
    await candidateRetry(seeded, "immutable-history-key", initial);
    const rows = await pool.query<{ retryId: string; attemptId: string }>(
      `SELECT "id" AS "retryId", "scanAssessmentId" AS "attemptId"
         FROM "CvRetryRequest" WHERE "uploadId" = $1`,
      [seeded.uploadId],
    );
    await failScanAttempt(rows.rows[0]!.attemptId, initial);
    await expect(
      pool.query(
        `UPDATE "CvRetryRequest" SET "stage" = 'PARSE' WHERE "id" = $1`,
        [rows.rows[0]!.retryId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(
        `UPDATE "CvScanAssessment" SET "failureCode" = 'CHANGED' WHERE "id" = $1`,
        [rows.rows[0]!.attemptId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("leaves cap exhaustion terminal with no hidden queued work", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "cap-exhaustion", {
      stage: "PARSE",
      mode: "TERMINAL_FAILURE",
      now: initial,
      automaticAttemptsUsed: 3,
      candidateRetriesUsed: 2,
    });
    accounts.push(seeded.accountId);
    client.release();
    await expect(
      candidateRetry(seeded, "cap-exhaustion-key", initial),
    ).rejects.toMatchObject({ code: "RETRY_LIMIT_REACHED" });
    const state = await pool.query<{
      status: string;
      active: number;
      retryRows: number;
    }>(
      `SELECT upload."status"::text,
              (SELECT count(*)::int FROM "CvParseJob"
                WHERE "uploadId" = upload."id" AND "status" IN ('QUEUED', 'PROCESSING')) AS active,
              (SELECT count(*)::int FROM "CvRetryRequest"
                WHERE "uploadId" = upload."id") AS "retryRows"
         FROM "CvUpload" upload WHERE upload."id" = $1`,
      [seeded.uploadId],
    );
    expect(state.rows[0]).toEqual({
      status: "PARSE_FAILED",
      active: 0,
      retryRows: 0,
    });
  });

  it("uses purpose-separated 32-byte endpoint digests rather than storing raw keys", async () => {
    const client = await pool.connect();
    const seeded = await seedCvRecoveryImport(client, "key-digest", {
      stage: "SCAN",
      mode: "TERMINAL_FAILURE",
      now: initial,
      automaticAttemptsUsed: 3,
    });
    accounts.push(seeded.accountId);
    client.release();
    const rawKey = `raw-key-${randomBytes(16).toString("hex")}`;
    await candidateRetry(seeded, rawKey, initial);
    const binding = await pool.query<{
      bytes: number;
      containsRaw: boolean;
    }>(
      `SELECT octet_length("idempotencyDigest")::int AS bytes,
              encode("idempotencyDigest", 'escape') LIKE '%' || $2 || '%' AS "containsRaw"
         FROM "CvRetryRequest" WHERE "uploadId" = $1`,
      [seeded.uploadId, rawKey],
    );
    expect(binding.rows[0]).toEqual({ bytes: 32, containsRaw: false });
  });
});
