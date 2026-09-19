import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const retryMigration = readFileSync(
  "prisma/migrations/051_private_match_retry_deterministic_pointer/migration.sql",
  "utf8",
);

describe("private CV match retry persistence", () => {
  it("allows AI retries to reuse the immutable deterministic result", () => {
    expect(schema).toContain("deterministicResultId String?");
    expect(schema).not.toContain(
      "deterministicResultId String?                   @unique",
    );
    expect(schema).toContain(
      "aiResultId            String?                   @unique",
    );
    expect(schema).toContain(
      '@@unique([checkId, attemptNumber], map: "PrivateCvMatchAttempt_check_attempt_key")',
    );
    expect(schema).toContain(
      'attemptPointers       PrivateCvMatchAttempt[]  @relation("PrivateAttemptAutomaticPointer")',
    );
    expect(retryMigration).toContain(
      'DROP INDEX IF EXISTS "PrivateCvMatchAttempt_deterministicResultId_key"',
    );
    expect(retryMigration).toContain(
      'CREATE INDEX "PrivateCvMatchAttempt_deterministic_result_idx"',
    );
  });
});
