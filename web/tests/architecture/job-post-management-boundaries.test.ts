import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), "src", path), "utf8");

describe("job post management architecture boundaries", () => {
  it("keeps App Router routes behind the request boundary and service", () => {
    for (const path of [
      "app/api/admin/job-postings/route.ts",
      "app/api/admin/job-postings/[jobId]/route.ts",
      "app/api/admin/job-postings/[jobId]/[action]/route.ts",
    ]) {
      const route = source(path);
      expect(route).toContain("AdminRequestBoundary");
      expect(route).toContain("JobPostManagementService");
      expect(route).not.toMatch(/backend\/(database|generated|repositories)/u);
    }
  });

  it("keeps persistence in a server-only repository and public reads fail closed", () => {
    const repository = source(
      "backend/repositories/jobs/prisma-job-post-management-repository.ts",
    );
    const publicRepository = source(
      "backend/repositories/jobs/prisma-public-job-repository.ts",
    );
    expect(repository).toMatch(/^import "server-only";/u);
    expect(repository).toContain("pg_advisory_xact_lock");
    expect(publicRepository).toContain("getPublicCompanyWhere");
    expect(publicRepository).toContain("candidateVisibleJobWhere");
    expect(publicRepository).toContain('visibilityState: "PUBLISHED"');
  });
});
