import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration095 = readFileSync(
  "prisma/migrations/095_company_deletion_manifest/migration.sql",
  "utf8",
);
const migration096 = readFileSync(
  "prisma/migrations/096_recruitment_notification_delivery/migration.sql",
  "utf8",
);
const notificationWorkFoundation = readFileSync(
  "prisma/migrations/009_job_board_advanced_search/migration.sql",
  "utf8",
);

describe("CF-301 migration 095 to 096 compatibility", () => {
  it("deploys 096 additively on the schema established before 095", () => {
    expect(notificationWorkFoundation).toContain(
      'CREATE TABLE "RecruitmentNotificationWork"',
    );
    expect(migration095).not.toContain(
      'DROP TABLE "RecruitmentNotificationWork"',
    );
    expect(migration096).toContain(
      "ADD VALUE IF NOT EXISTS 'RECRUITMENT_NOTIFICATION'",
    );
    expect(migration096).toContain('ADD COLUMN "leaseOwner" TEXT');
    expect(migration096).toContain('ADD COLUMN "leaseExpiresAt" TIMESTAMP(3)');
    expect(migration096).toContain(
      'CREATE INDEX "RecruitmentNotificationWork_leaseExpiresAt_idx"',
    );
    expect(migration096).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE|UPDATE)\b/iu);
  });

  it("keeps the pre-096 writer shape nullable", () => {
    expect(migration096).toMatch(
      /ADD COLUMN "leaseOwner" TEXT,\s*ADD COLUMN "leaseExpiresAt" TIMESTAMP\(3\);/u,
    );
    expect(migration096).not.toMatch(
      /ADD COLUMN "(?:leaseOwner|leaseExpiresAt)"[^\n]*NOT NULL/iu,
    );
  });
});
