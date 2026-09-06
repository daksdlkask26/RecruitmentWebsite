import { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  CvStorageError,
  sensitiveStorageLocator,
  type PrivateCvStorage,
} from "@/backend/cv/storage/private-cv-storage";
import { CvCleanupCoordinator } from "@/backend/cv/workers/cleanup";
import { CvWorkerRuntime } from "@/backend/cv/workers/cv-worker-runtime";
import {
  createCvArtifactDeleteProcessor,
  CvWorkerPipeline,
} from "@/backend/cv/workers/pipeline";
import { CvStorageReconciliation } from "@/backend/cv/workers/reconciliation";
import { PrismaCvWorkRepository } from "@/backend/repositories/cv-import/prisma-cv-work-repository";
import { CvRetentionService } from "@/backend/services/cv-import/cv-retention-service";
import { ControlledClock } from "@/backend/time/clock";
import {
  cleanupCvRecoveryAccounts,
  seedCvRecoveryImport,
  type CvRecoveryStage,
  type SeededCvRecoveryImport,
} from "../../../helpers/cv-failure-retry-fixture";
import {
  createJobBoardDatabaseFixture,
  deleteJobBoardDatabaseFixture,
} from "../../../helpers/job-board-database-fixture";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const initial = new Date("2026-08-02T00:00:00.000Z");
const accounts: string[] = [];

async function seed(
  label: string,
  stage: CvRecoveryStage = "PARSE",
  mode: "PROCESSING" | "TERMINAL_FAILURE" = "TERMINAL_FAILURE",
): Promise<SeededCvRecoveryImport> {
  const client = await pool.connect();
  try {
    const fixture = await seedCvRecoveryImport(client, label, {
      stage,
      mode,
      now: initial,
    });
    accounts.push(fixture.accountId);
    return fixture;
  } finally {
    client.release();
  }
}

class ReconciliationStorage implements PrivateCvStorage {
  readonly deleted: string[] = [];
  deleteFailures = new Set<string>();
  missing = new Set<string>();
  inventoryItems: Array<{
    locator: ReturnType<typeof sensitiveStorageLocator>;
    bytes: number;
    createdAt?: Date;
  }> = [];

  async assertReady() {}
  async put(): Promise<never> {
    throw new Error("unused");
  }
  open(locator: string): AsyncIterable<Uint8Array> {
    const missing = this.missing.has(locator);
    return (async function* () {
      if (missing) throw new CvStorageError("CV_STORAGE_OBJECT_NOT_FOUND");
      yield Uint8Array.of(1);
    })();
  }
  async delete(locator: string) {
    this.deleted.push(locator);
    if (this.deleteFailures.has(locator)) {
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
    return { deleted: true } as const;
  }
  async inventory() {
    return { items: this.inventoryItems };
  }
}

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterEach(async () => {
  if (!accounts.length) return;
  const client = await pool.connect();
  try {
    await cleanupCvRecoveryAccounts(client, accounts.splice(0));
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("CV deletion and storage reconciliation", () => {
  it("wins a race with an active worker and rejects every late stage commit", async () => {
    const fixture = await seed("delete-worker-race", "PARSE", "PROCESSING");
    const retention = new CvRetentionService(new ControlledClock(initial));
    await retention.deleteOwnedImport({
      accountId: fixture.accountId,
      uploadId: fixture.uploadId,
    });
    const repository = new PrismaCvWorkRepository();
    await expect(
      repository.assertStageResultCommitAllowed({
        stage: "PARSE",
        id: fixture.parseId ?? "missing_parse",
        uploadId: fixture.uploadId,
        accountId: fixture.accountId,
        owner: fixture.leaseOwner,
        now: new Date(initial.getTime() + 1),
      }),
    ).rejects.toThrow("CV_STAGE_RESULT_DISCARDED");
    const state = await pool.query<{ status: string; active: string }>(
      `SELECT upload."status"::text AS status,
              (SELECT COUNT(*)::text FROM "CvParseJob" job
                WHERE job."uploadId" = upload."id" AND job."status" IN ('QUEUED','PROCESSING')) AS active
         FROM "CvUpload" upload WHERE upload."id" = $1`,
      [fixture.uploadId],
    );
    expect(state.rows[0]).toEqual({ status: "CANCELLED", active: "0" });
  });

  it("recovers a bounded physical-delete lease, treats provider absence as success, and only then transitions to DELETED", async () => {
    const fixture = await seed("delete-lease", "SCAN");
    await pool.query(
      `UPDATE "CvAccountQuota" SET "retainedBytes" = 1 WHERE "accountId" = $1`,
      [fixture.accountId],
    );
    const clock = new ControlledClock(initial);
    const outcome = await new CvRetentionService(clock).deleteOwnedImport({
      accountId: fixture.accountId,
      uploadId: fixture.uploadId,
    });
    const due = new Date(outcome.deleteAfter);
    const repository = new PrismaCvWorkRepository();
    const crashed = await repository.claimStage({
      stage: "DELETE",
      owner: "crashed-delete-owner",
      now: due,
      limit: 1,
      leaseMs: 1_000,
    });
    expect(crashed).toHaveLength(1);
    await expect(
      repository.claimStage({
        stage: "DELETE",
        owner: "early-delete-owner",
        now: new Date(due.getTime() + 999),
        limit: 1,
        leaseMs: 1_000,
      }),
    ).resolves.toEqual([]);
    const recoveredAt = new Date(due.getTime() + 1_001);
    const recovered = await repository.claimStage({
      stage: "DELETE",
      owner: "recovered-delete-owner",
      now: recoveredAt,
      limit: 1,
      leaseMs: 1_000,
    });
    expect(recovered.map(({ id }) => id)).toEqual([fixture.sourceId]);
    await expect(
      repository.finalizeStage({
        stage: "DELETE",
        id: fixture.sourceId,
        owner: "crashed-delete-owner",
        status: "DELETED",
        now: recoveredAt,
      }),
    ).resolves.toBe(false);

    const absentStorage: PrivateCvStorage = {
      async assertReady() {},
      async put() {
        throw new Error("unused");
      },
      open() {
        return (async function* () {})();
      },
      async delete() {
        return { deleted: false };
      },
      async inventory() {
        return { items: [] };
      },
    };
    const deleted = await createCvArtifactDeleteProcessor(absentStorage)(
      recovered[0]!,
      { signal: new AbortController().signal, now: recoveredAt },
    );
    expect(deleted).toEqual({ status: "DELETED" });
    expect(
      await repository.finalizeStage({
        stage: "DELETE",
        id: fixture.sourceId,
        owner: "recovered-delete-owner",
        status: "DELETED",
        now: new Date(recoveredAt.getTime() + 1),
      }),
    ).toBe(true);
    const metrics: unknown[] = [];
    clock.set(new Date(recoveredAt.getTime() + 2));
    const cleanup = new CvCleanupCoordinator(clock, {
      emitMetric: (metric) => {
        metrics.push(metric);
      },
    });
    await cleanup.runOnce();
    const final = await pool.query<{ status: string; retainedBytes: number }>(
      `SELECT upload."status"::text AS status, quota."retainedBytes"
         FROM "CvUpload" upload JOIN "CvAccountQuota" quota
           ON quota."accountId" = upload."accountId" WHERE upload."id" = $1`,
      [fixture.uploadId],
    );
    expect(final.rows[0]).toEqual({ status: "DELETED", retainedBytes: 0 });
    expect(metrics).toEqual([
      expect.objectContaining({ metric: "cv_cleanup_lag_ms" }),
    ]);
  });

  it("bounds failed cleanup attempts at 100", async () => {
    const fixture = await seed("delete-attempt-cap", "SCAN");
    const outcome = await new CvRetentionService(
      new ControlledClock(initial),
    ).deleteOwnedImport({
      accountId: fixture.accountId,
      uploadId: fixture.uploadId,
    });
    await pool.query(
      `UPDATE "CvStoredArtifact" SET "deleteAttempts" = 99 WHERE "id" = $1`,
      [fixture.sourceId],
    );
    const repository = new PrismaCvWorkRepository();
    const claim = await repository.claimStage({
      stage: "DELETE",
      owner: "capped-delete-owner",
      now: new Date(outcome.deleteAfter),
      limit: 1,
      leaseMs: 1_000,
    });
    expect(claim).toHaveLength(1);
    expect(
      await repository.finalizeStage({
        stage: "DELETE",
        id: fixture.sourceId,
        owner: "capped-delete-owner",
        status: "DELETE_FAILED",
        failureCode: "CV_STORAGE_OPERATION_FAILED",
        now: new Date(new Date(outcome.deleteAfter).getTime() + 1),
      }),
    ).toBe(true);
    expect(
      await repository.claimStage({
        stage: "DELETE",
        owner: "over-cap-owner",
        now: new Date(new Date(outcome.deleteAfter).getTime() + 2),
        limit: 1,
        leaseMs: 1_000,
      }),
    ).toEqual([]);
  });

  it("schedules missing references safely and deletes only grace-aged untracked inventory", async () => {
    const fixture = await seed("reconciliation");
    const storage = new ReconciliationStorage();
    const jobFixture = await createJobBoardDatabaseFixture("cv-reconciliation");
    try {
      const jobPostingId = jobFixture.jobs.active.id;
      const draftLocator = "draft_cover_letter_locator_1";
      const draftCoverLetter = JSON.stringify({
        kind: "FILE",
        file: {
          versionId: "draft-cover-version-1",
          displayName: "cover.pdf",
          fileName: "cover.pdf",
          mimeType: "application/pdf",
          byteSize: 9,
          parseStatus: "NOT_APPLICABLE",
          storageKey: draftLocator,
          checksumSha256: "a".repeat(64),
        },
      });
      const locators = await pool.query<{ storageLocator: string }>(
        `SELECT "storageLocator" FROM "CvStoredArtifact" WHERE "uploadId" = $1 ORDER BY "kind"`,
        [fixture.uploadId],
      );
      await pool.query(
        `INSERT INTO "CandidateApplicationDraft" (
           "id", "candidateUserId", "jobPostingId", "revision", "personalInfoDraft",
           "selectedCvId", "coverLetterDraft", "messageDraft", "confirmationAccepted",
           "createdAt", "updatedAt", "expiresAt"
         ) VALUES ($1, $2, $3, 1, '{}'::jsonb, NULL, $4::jsonb, NULL, false, $5, $5, $6)`,
        [
          `reconciliation-draft-${fixture.accountId}`,
          fixture.accountId,
          jobPostingId,
          draftCoverLetter,
          initial,
          new Date(initial.getTime() + 24 * 60 * 60_000),
        ],
      );
      storage.missing.add(locators.rows[0]!.storageLocator);
      const runAt = new Date(initial.getTime() + 2 * 60 * 60_000);
      storage.inventoryItems = [
        {
          locator: sensitiveStorageLocator(locators.rows[0]!.storageLocator),
          bytes: 1,
          createdAt: initial,
        },
        {
          locator: sensitiveStorageLocator("orphan_locator_abcdefghijkl"),
          bytes: 7,
          createdAt: initial,
        },
        {
          locator: sensitiveStorageLocator(draftLocator),
          bytes: 9,
          createdAt: initial,
        },
        {
          locator: sensitiveStorageLocator("recent_locator_abcdefghijkl"),
          bytes: 8,
          createdAt: runAt,
        },
      ];
      const result = await new CvStorageReconciliation(
        storage,
        new ControlledClock(runAt),
      ).runOnce();
      expect(result).toMatchObject({
        referencesChecked: 2,
        missingScheduled: 1,
        inventoryChecked: 4,
        orphansDeleted: 1,
      });
      expect(storage.deleted).toEqual(["orphan_locator_abcdefghijkl"]);
      const state = await pool.query<{ status: string; failureCode: string }>(
        `SELECT "status"::text AS status, "failureCode" FROM "CvUpload" WHERE "id" = $1`,
        [fixture.uploadId],
      );
      expect(state.rows[0]).toEqual({
        status: "VALIDATION_FAILED",
        failureCode: "ARTIFACT_INTEGRITY_FAILED",
      });
      const audit = await pool.query<{ serialized: string }>(
        `SELECT json_agg(audit)::text AS serialized FROM "AuditEvent" audit
          WHERE audit."action" = 'cv_import.reconciled' AND audit."occurredAt" = $1`,
        [runAt],
      );
      expect(audit.rows[0]?.serialized).not.toMatch(
        /orphan_locator|storageLocator/iu,
      );
    } finally {
      await deleteJobBoardDatabaseFixture(jobFixture);
    }
  });

  it("continues reconciliation when an orphan delete fails", async () => {
    await seed("reconciliation-delete-failure");
    const storage = new ReconciliationStorage();
    const failedLocator = "orphan_delete_failure_locator";
    const deletedLocator = "orphan_delete_success_locator";
    storage.deleteFailures.add(failedLocator);
    storage.inventoryItems = [
      {
        locator: sensitiveStorageLocator(failedLocator),
        bytes: 7,
        createdAt: initial,
      },
      {
        locator: sensitiveStorageLocator(deletedLocator),
        bytes: 8,
        createdAt: initial,
      },
    ];

    const runAt = new Date(initial.getTime() + 2 * 60 * 60_000);
    const result = await new CvStorageReconciliation(
      storage,
      new ControlledClock(runAt),
    ).runOnce();

    expect(result).toMatchObject({
      inventoryChecked: 2,
      orphansDeleted: 1,
    });
    expect(storage.deleted).toEqual([failedLocator, deletedLocator]);
  });

  it("requires cleanup even for a delete-only runtime when processing is disabled", async () => {
    const pipeline = new CvWorkerPipeline({
      DELETE: async () => ({ status: "DELETED" }),
    });
    const repository = {
      claimStage: vi.fn(async () => []),
      finalizeStage: vi.fn(async () => true),
      releaseWorkerLeases: vi.fn(async () => 0),
    };
    const runtime = new CvWorkerRuntime({
      pipeline,
      repository,
      readiness: vi.fn(async () => undefined),
      observability: { emitLog: vi.fn(), emitMetric: vi.fn() },
    });
    await expect(runtime.assertReady()).resolves.toBeUndefined();
  });
});
