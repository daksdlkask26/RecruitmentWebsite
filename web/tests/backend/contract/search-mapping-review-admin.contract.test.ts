import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  searchMappingReviewCommandSchema,
  searchMappingReviewListQuerySchema,
} from "@/shared/contracts/admin/search-mapping-review";
import {
  searchMappingReviewBatchItemSchema,
  searchMappingReviewBatchManifestSchema,
} from "@/shared/contracts/admin/search-mapping-review-batch";
import { authenticationAuditEventSchema } from "@/backend/audit/events";

const listRoute = readFileSync(
  "src/app/api/admin/search-mapping-reviews/route.ts",
  "utf8",
);
const commandRoute = readFileSync(
  "src/app/api/admin/search-mapping-reviews/[reviewId]/[action]/route.ts",
  "utf8",
);

describe("search mapping review admin route contract", () => {
  it("protects list and command routes with the existing admin boundary", () => {
    for (const source of [listRoute, commandRoute]) {
      expect(source).toContain("AdminRequestBoundary");
      expect(source).toContain("adminJson");
      expect(source).toContain("adminRouteError");
      expect(source).not.toMatch(/console\.log\(|stack|internalScore/u);
    }
    for (const marker of [
      "require(request, {\n      sensitive: true,",
      "parseAdminJson",
      "searchMappingReviewCommandSchema",
      "commandHeaders(request, { strictIfMatch: true })",
      "idempotencyKey",
      "expectedVersion",
      "command.command !== expected",
    ])
      expect(commandRoute).toContain(marker);
  });

  it("keeps query and command inputs bounded and mutually exclusive", () => {
    expect(
      searchMappingReviewListQuerySchema.safeParse({
        page: 0,
        perPage: 101,
      }).success,
    ).toBe(false);
    expect(
      searchMappingReviewListQuerySchema.safeParse({
        page: 1,
        perPage: 25,
        q: "a".repeat(161),
      }).success,
    ).toBe(false);
    expect(
      searchMappingReviewCommandSchema.safeParse({
        command: "MERGE",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "A reviewer supplied a bounded rationale.",
        targetTitleId: "not-a-title-id",
      }).success,
    ).toBe(false);
    expect(
      searchMappingReviewCommandSchema.safeParse({
        command: "REJECT",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "A reviewer supplied a bounded rationale.",
        targetTitleId: "title-accountant-occ-r01-accounting",
      }).success,
    ).toBe(false);
  });

  it("requires a strict If-Match version and idempotency key for every action", () => {
    expect(commandRoute).toContain("strictIfMatch: true");
    expect(commandRoute).toContain("!headers.idempotencyKey");
    expect(commandRoute).toContain(
      "!Number.isInteger(headers.expectedVersion)",
    );
    expect(commandRoute).toContain(
      'new AdminHttpError(400, "VALIDATION_FAILED")',
    );
  });

  it("exposes intentional-untranslated as a distinct, non-Vietnamese command", () => {
    expect(commandRoute).toContain('"intentional-untranslated"');
    expect(
      searchMappingReviewCommandSchema.safeParse({
        command: "INTENTIONAL_UNTRANSLATED",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "This established industry title remains literal.",
        titleId: "title-financial-analyst-occ-r04-accounting-finance",
        translationEn: "Financial Analyst",
      }).success,
    ).toBe(true);
    expect(
      searchMappingReviewCommandSchema.safeParse({
        command: "INTENTIONAL_UNTRANSLATED",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "This established industry title remains literal.",
        titleId: "title-financial-analyst-occ-r04-accounting-finance",
        translationEn: "Financial Analyst",
        translationVi: "Chuyên viên phân tích tài chính",
      }).success,
    ).toBe(false);
  });

  it("keeps intentional-untranslated drafts literal and without VI aliases", () => {
    const base = {
      titleId: "title-webmaster-occ-r03-information-technology",
      originalTitle: "Webmaster",
      canonicalEn: "Webmaster",
      canonicalVi: "Webmaster",
      aliasesVi: [],
      aliasesEn: ["Webmaster"],
      abbreviations: [],
      occupationId: "occ-r03-information-technology",
      facetIds: [],
      proposedDecision: "INTENTIONAL_UNTRANSLATED" as const,
      confidence: 0.6,
      rationale: "The title is a commonly used industry loanword.",
      humanApproved: false,
      reviewer: null,
    };
    expect(searchMappingReviewBatchItemSchema.safeParse(base).success).toBe(
      true,
    );
    expect(
      searchMappingReviewBatchItemSchema.safeParse({
        ...base,
        aliasesVi: ["webmaster"],
      }).success,
    ).toBe(false);
    expect(
      searchMappingReviewBatchItemSchema.safeParse({
        ...base,
        canonicalVi: "quản trị website",
      }).success,
    ).toBe(false);
    expect(
      searchMappingReviewBatchManifestSchema.safeParse({
        schemaVersion: "search-mapping-review-batch-v1",
        generatedAt: "2026-09-03T13:00:00.000Z",
        catalogVersion: "2026-09-03.1-2026-09-03.1",
        source: "TAXONOMY_CONTEXT_RULES",
        humanApprovalRequired: true,
        humanReviewConfirmed: false,
        reviewer: null,
        counts: {
          total: 1,
          approve: 0,
          intentionalUntranslated: 1,
          merge: 0,
          reject: 0,
        },
        items: [base],
      }).success,
    ).toBe(true);
  });

  it("allows only bounded provenance references in the append-only audit event", () => {
    expect(() =>
      authenticationAuditEventSchema.parse({
        occurredAt: new Date("2026-09-03T04:00:00.000Z"),
        actorType: "user",
        actorUserId: "admin-1",
        actorSessionId: "session-1",
        action: "admin.search_mapping_review_merged",
        targetType: "search_mapping_review",
        targetId: "review-1",
        result: "SUCCESS",
        correlationId: "correlation-review-1",
        context: {
          priorState: "PENDING",
          resultingState: "MERGED",
          targetVersion: 4,
          parentCatalogVersionId: "catalog-source-1",
          parentCatalogVersion: "2026-09-03.1",
          targetTitleId: "title-accountant-occ-r01-accounting",
          beforeReference: {
            reviewId: "review-1",
            status: "PENDING",
            version: 3,
            openKey: "search-mapping:accountant",
          },
          afterReference: {
            reviewId: "review-1",
            status: "MERGED",
            version: 4,
            resultCatalogVersionId: "catalog-draft-1",
            draftVersion: "2026-09-03.1-draft-review-1",
          },
        },
      }),
    ).not.toThrow();
  });
});
