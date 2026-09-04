import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repository = readFileSync(
  "src/backend/repositories/jobs/prisma-public-job-repository.ts",
  "utf8",
);
const visibilityPolicy = readFileSync(
  "src/backend/repositories/jobs/candidate-visible-job-policy.ts",
  "utf8",
);

describe("candidate visibility for managed jobs", () => {
  it("keeps a closed post readable while discovery remains active-only", () => {
    expect(repository).toContain('status: { in: ["ACTIVE", "CLOSED"] }');
    expect(visibilityPolicy).toMatch(/j\."status"\s*=\s*'ACTIVE'/);
    expect(visibilityPolicy).toContain('visibilityState: "PUBLISHED"');
    expect(visibilityPolicy).toContain('verificationState: "ACTIVE"');
  });
});
