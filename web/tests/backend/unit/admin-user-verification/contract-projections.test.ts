import { describe, expect, it } from "vitest";
import {
  accountDirectoryFilterSchema,
  accountDirectoryItemSchema,
  moderationHistoryItemSchema,
} from "@/shared/contracts/admin/resources";
import {
  verificationRejectCommandSchema,
  moderationCommandSchema,
} from "@/shared/contracts/admin/commands";

describe("Feature 009 contract projections", () => {
  it("normalizes the directory defaults and rejects inverted inclusive dates", () => {
    expect(
      accountDirectoryFilterSchema.parse({
        q: "  Alice ",
        registeredFrom: "2026-01-01",
        registeredTo: "2026-01-31",
      }),
    ).toMatchObject({
      q: "Alice",
      type: "ALL",
      status: "ALL",
      page: 1,
      pageSize: 25,
    });
    expect(() =>
      accountDirectoryFilterSchema.parse({
        registeredFrom: "2026-02-01",
        registeredTo: "2026-01-01",
      }),
    ).toThrow();
  });

  it("coerces URL pagination values before applying the fixed page-size allowlist", () => {
    expect(
      accountDirectoryFilterSchema.parse({ page: "1", pageSize: "25" }),
    ).toMatchObject({ page: 1, pageSize: 25 });
  });

  it("keeps unavailable aggregates distinct from numeric zero", () => {
    expect(
      accountDirectoryItemSchema.parse({
        id: "account-1",
        accountReference: "account-1",
        displayName: "A",
        maskedEmail: "a***@example.test",
        registeredAt: "2026-01-01T00:00:00.000Z",
        type: "RECRUITER",
        status: "SUSPENDED",
        version: 3,
        hasCandidateIdentity: false,
        activeMembershipCount: 1,
        hasActiveAdministratorGrant: false,
        counts: { kind: "RECRUITER", unavailable: true },
      }).counts,
    ).toEqual({ kind: "RECRUITER", unavailable: true });
  });

  it("requires the seven allowlisted rejection categories and normalized reason", () => {
    const result = verificationRejectCommandSchema.parse({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      expectedVersion: 1,
      confirmation: true,
      category: "OTHER",
      applicantComment: "  The supplied evidence is not readable. ",
    });
    expect(result.applicantComment).toBe(
      "The supplied evidence is not readable.",
    );
    expect(() =>
      verificationRejectCommandSchema.parse({
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        expectedVersion: 1,
        confirmation: true,
        category: "NOPE",
        applicantComment: "too short",
      }),
    ).toThrow();
  });

  it("uses the canonical moderation command body", () => {
    expect(
      moderationCommandSchema.parse({
        category: "OTHER",
        reason: "A valid administrator reason.",
      }),
    ).toEqual({ category: "OTHER", reason: "A valid administrator reason." });
  });

  it("projects historical reinstate rows as Restore", () => {
    expect(
      moderationHistoryItemSchema.parse({
        id: "audit-1",
        action: "RESTORE",
        actorRef: "admin-1",
        priorState: "SUSPENDED",
        resultingState: "ACTIVE",
        category: "INCIDENT_RESOLVED",
        result: "SUCCEEDED",
        occurredAt: "2026-01-01T00:00:00.000Z",
        correlationId: "corr-1",
      }).action,
    ).toBe("RESTORE");
  });
});
