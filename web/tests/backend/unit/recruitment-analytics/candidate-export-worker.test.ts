import { describe, expect, it, vi } from "vitest";
import { CandidateExportWorker } from "@/backend/exports/candidate-export-worker";

function request() {
  return {
    id: "export-1",
    requesterUserId: "owner-1",
    companyId: "company-1",
    jobPostingId: "job-1",
    format: "CSV" as const,
    dataCutoff: new Date("2026-09-21T00:00:00.000Z"),
    attemptCount: 1,
  };
}

function dependencies() {
  let obligation:
    | {
        id: string;
        exportRequestId: string;
        requesterUserId: string;
        format: "CSV";
        rowCount: number;
        occurredAt: Date;
        attemptCount: number;
        nextAttemptAt: Date;
      }
    | undefined;
  const requests = {
    claimNext: vi.fn().mockResolvedValue(request()),
    succeed: vi.fn().mockResolvedValue({ count: 1 }),
    fail: vi.fn().mockResolvedValue({ count: 1 }),
    claimPendingAuditObligations: vi
      .fn()
      .mockImplementation(async (_workerId: string, current: Date) => {
        if (!obligation || obligation.nextAttemptAt > current) return [];
        obligation.attemptCount += 1;
        return [obligation];
      }),
    ensureAuditObligation: vi.fn().mockImplementation(async () => {
      obligation = {
        id: "audit-obligation-1",
        exportRequestId: "export-1",
        requesterUserId: "owner-1",
        format: "CSV",
        rowCount: 0,
        occurredAt: new Date("2026-09-21T00:00:00.000Z"),
        attemptCount: 0,
        nextAttemptAt: new Date("2026-09-21T00:00:00.000Z"),
      };
      return obligation;
    }),
    completeAuditObligation: vi.fn().mockImplementation(async () => {
      obligation = undefined;
      return { count: 1 };
    }),
    failAuditObligation: vi
      .fn()
      .mockImplementation(
        async (
          _id: string,
          _workerId: string,
          _code: string,
          _now: Date,
          retry: boolean,
          nextAttemptAt: Date,
        ) => {
          if (obligation && retry) obligation.nextAttemptAt = nextAttemptAt;
          else obligation = undefined;
          return { count: 1 };
        },
      ),
  };
  const storage = {
    put: vi.fn().mockResolvedValue({
      locator: "artifact-1",
      checksum: "checksum-1",
      byteCount: 12,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const authorization = {
    employerJob: vi.fn().mockResolvedValue({ companyId: "company-1" }),
  };
  const audit = {
    appendIdempotent: vi.fn().mockResolvedValue("audit-1"),
  };
  const analytics = {
    listCandidateExportRows: vi.fn().mockResolvedValue([]),
  };
  return { requests, storage, authorization, audit, analytics };
}

describe("candidate export completion", () => {
  it("keeps a claimed artifact when the audit sink is unavailable and retries it", async () => {
    const deps = dependencies();
    deps.audit.appendIdempotent
      .mockRejectedValueOnce(new Error("AUDIT_DB_UNAVAILABLE"))
      .mockResolvedValueOnce("audit-1");
    const worker = new CandidateExportWorker(
      deps.requests as never,
      deps.analytics as never,
      deps.storage as never,
      deps.authorization as never,
      deps.audit as never,
    );

    await expect(
      worker.runOnce(
        "00000000-0000-4000-8000-000000000001",
        new Date("2026-09-21T01:00:00.000Z"),
      ),
    ).resolves.toBe(true);
    expect(deps.requests.succeed).toHaveBeenCalledOnce();
    expect(deps.requests.ensureAuditObligation).toHaveBeenCalledOnce();
    expect(deps.storage.delete).not.toHaveBeenCalled();
    expect(deps.requests.failAuditObligation).toHaveBeenCalledOnce();
    expect(deps.requests.failAuditObligation).toHaveBeenCalledWith(
      "audit-obligation-1",
      "00000000-0000-4000-8000-000000000001",
      "AUDIT_DB_UNAVAILABLE",
      new Date("2026-09-21T01:00:00.000Z"),
      true,
      new Date("2026-09-21T01:00:30.000Z"),
    );

    await expect(
      worker.reconcileAuditObligations(new Date("2026-09-21T01:01:00.000Z")),
    ).resolves.toEqual({ claimed: 1, completed: 1 });
    expect(deps.requests.completeAuditObligation).toHaveBeenCalledOnce();
    expect(deps.storage.delete).not.toHaveBeenCalled();
  });

  it("dead-letters an audit obligation at the retry ceiling", async () => {
    const deps = dependencies();
    deps.requests.claimPendingAuditObligations.mockResolvedValue([
      {
        id: "audit-obligation-poison",
        exportRequestId: "export-poison",
        requesterUserId: "owner-1",
        format: "CSV",
        rowCount: 1,
        occurredAt: new Date("2026-09-21T00:00:00.000Z"),
        attemptCount: 3,
      },
    ]);
    deps.audit.appendIdempotent.mockRejectedValue(
      new Error("AUDIT_DB_UNAVAILABLE"),
    );
    const worker = new CandidateExportWorker(
      deps.requests as never,
      deps.analytics as never,
      deps.storage as never,
      deps.authorization as never,
      deps.audit as never,
    );
    const failureAt = new Date("2026-09-21T02:00:00.000Z");

    await expect(
      worker.reconcileAuditObligations(failureAt, 25, "audit-worker-1"),
    ).resolves.toEqual({ claimed: 1, completed: 0 });
    expect(deps.requests.failAuditObligation).toHaveBeenCalledWith(
      "audit-obligation-poison",
      "audit-worker-1",
      "AUDIT_DB_UNAVAILABLE",
      failureAt,
      false,
      failureAt,
    );
  });

  it("deletes only an artifact whose completion compare-and-set was lost", async () => {
    const deps = dependencies();
    deps.requests.succeed.mockResolvedValue({ count: 0 });
    const worker = new CandidateExportWorker(
      deps.requests as never,
      deps.analytics as never,
      deps.storage as never,
      deps.authorization as never,
      deps.audit as never,
    );

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(deps.storage.delete).toHaveBeenCalledWith("artifact-1");
    expect(deps.requests.ensureAuditObligation).not.toHaveBeenCalled();
    expect(deps.audit.appendIdempotent).not.toHaveBeenCalled();
  });
});
