import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string) {
  return readFile(path, "utf8");
}

describe("Candidate-first Phase 8 platform boundaries", () => {
  it("keeps recruiter job mutations behind the shared boundary before service work", async () => {
    const route = await source("src/app/api/recruiter/job-postings/route.ts");
    const post = route.slice(route.indexOf("export async function POST"));
    expect(post).toContain("requireJobActor(request, { mutation: true })");
    expect(post).toContain("parseBoundedJson(");
    expect(
      post.indexOf("requireJobActor(request, { mutation: true })"),
    ).toBeLessThan(post.indexOf("createRecruiterJob"));
  });

  it("keeps completion, backup, and readiness contracts on fenced paths", async () => {
    const exportWorker = await source(
      "src/backend/exports/candidate-export-worker.ts",
    );
    const backup = await source("src/backend/backup/backup-service.ts");
    const exportRepository = await source(
      "src/backend/repositories/analytics/prisma-export-request-repository.ts",
    );
    const health = await source("src/app/api/health/route.ts");
    const live = await source("src/app/api/health/live/route.ts");
    expect(exportWorker).toContain("completion.count !== 1");
    expect(exportWorker).toContain("ensureAuditObligation");
    expect(exportWorker).toContain("auditObligation:");
    expect(exportRepository).toContain("exportAuditObligation.upsert");
    expect(exportRepository).toContain("transaction.call(this.db, complete)");
    expect(backup).toContain('status: "LEASED", leaseExpiresAt: { lt: now }');
    expect(backup).toContain("leaseEpoch");
    expect(health).toContain('status: health.status === "ok" ? 200 : 503');
    expect(live).toContain('status: "ok"');
  });

  it("keeps adjacent recruiter candidate mutations behind the same boundary", async () => {
    const routes = [
      "src/app/api/recruiter/jobs/[jobId]/scoring/rescore/route.ts",
      "src/app/api/recruiter/applications/[applicationId]/scoring/score/route.ts",
      "src/app/api/recruiter/applications/[applicationId]/scoring/retry-ai/route.ts",
      "src/app/api/recruiter/applications/[applicationId]/priority/route.ts",
    ];

    for (const path of routes) {
      const route = await source(path);
      const mutation = route.slice(route.indexOf("export async function POST"));
      expect(mutation).toContain(
        "requireAccountRequest(request, { mutation: true })",
      );
      expect(mutation).toContain(
        "parseBoundedJson(request, z.unknown(), 16 * 1024)",
      );
      expect(
        mutation.indexOf("requireAccountRequest(request, { mutation: true })"),
      ).toBeLessThan(mutation.indexOf("parseBoundedJson("));
    }
  });

  it("keeps new schema changes additive and migration ordered", async () => {
    const schema = await source("prisma/schema.prisma");
    const migration = await source(
      "prisma/migrations/098_export_audit_obligation/migration.sql",
    );
    const backupMigration = await source(
      "prisma/migrations/099_backup_lease_fencing/migration.sql",
    );
    expect(schema).toContain("model ExportAuditObligation");
    expect(schema).toContain("leaseEpoch");
    expect(migration).toContain('CREATE TABLE "ExportAuditObligation"');
    expect(backupMigration).toContain('ADD COLUMN "leaseEpoch"');
  });
});
