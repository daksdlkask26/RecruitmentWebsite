import { beforeEach, describe, expect, it, vi } from "vitest";

type ReviewStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "MERGED"
  | "DEDUPLICATED";

const {
  state,
  resetState,
  auditEvents,
  rationales,
  mockExecute,
  prisma,
  MockPrismaAdminCommandRepository,
  MockAuditRepository,
  MockRationaleService,
} = vi.hoisted(() => {
  const fixedNow = new Date("2026-09-03T04:00:00.000Z");
  const titleId = "title-accountant-occ-r01-accounting";
  const occupationId = "occ-r01-accounting";
  const facetId = "r01-accounting";
  type Review = {
    id: string;
    catalogVersionId: string;
    openKey: string | null;
    originalTitle: string;
    normalizedTitle: string;
    context: Record<string, unknown>;
    suggestedTitleId: string | null;
    suggestedTranslationVi: string | null;
    suggestedTranslationEn: string | null;
    suggestedOccupationId: string | null;
    suggestedFacetIds: string[];
    suggestedSkillSignals: string[];
    confidence: number;
    status: ReviewStatus;
    version: number;
    decisionReason: string | null;
    resultCatalogVersionId: string | null;
    reviewedByAdminUserId: string | null;
    reviewedAt: Date | null;
    deduplicatedIntoReviewId: string | null;
    deduplicatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type Catalog = {
    id: string;
    version: string;
    status: "DRAFT" | "PUBLISHED" | "RETIRED";
    revision: number;
    isActive: boolean;
    parentVersion: string | null;
    catalogPayload: Record<string, unknown>;
  };

  const state = {
    authorized: true,
    failAudit: false,
    failRationale: false,
    forceConflict: false,
    review: null as Review | null,
    source: null as Catalog | null,
    draft: null as Catalog | null,
    sourceTitles: [] as Array<Record<string, unknown>>,
    draftTitles: [] as Array<Record<string, unknown>>,
    sourceTranslations: [] as Array<Record<string, unknown>>,
    sourceAliases: [] as Array<Record<string, unknown>>,
    sourceOccupations: [] as Array<Record<string, unknown>>,
    sourceFacets: [] as Array<Record<string, unknown>>,
    sourceTitleFacets: [] as Array<Record<string, unknown>>,
    aliases: [] as Array<Record<string, unknown>>,
    listRows: [] as Array<Record<string, unknown>>,
  };

  const auditEvents: unknown[] = [];
  const rationales: unknown[] = [];
  const receiptResults = new Map<string, Record<string, unknown>>();

  const grantFindFirst = vi.fn(async () =>
    state.authorized ? { id: "grant-1" } : null,
  );
  const reviewFindUnique = vi.fn(async () =>
    state.review
      ? { ...state.review, context: { ...state.review.context } }
      : null,
  );
  const reviewCount = vi.fn(async () => state.listRows.length);
  const reviewFindMany = vi.fn(async () => state.listRows);
  const catalogFindUnique = vi.fn(
    async (input: { where: { id: string }; select?: unknown }) => {
      if (input.where.id === state.source?.id) return state.source;
      if (input.where.id !== state.draft?.id) return null;
      return input.select
        ? { catalogPayload: state.draft.catalogPayload }
        : state.draft;
    },
  );
  const catalogFindFirst = vi.fn(async () => null);
  const catalogCreate = vi.fn(
    async (input: { data: Record<string, unknown> }) => {
      const data = input.data;
      state.draft = {
        id: String(data.id),
        version: String(data.version),
        status: "DRAFT",
        revision: 1,
        isActive: false,
        parentVersion: String(data.parentVersion),
        catalogPayload:
          data.catalogPayload &&
          typeof data.catalogPayload === "object" &&
          !Array.isArray(data.catalogPayload)
            ? (data.catalogPayload as Record<string, unknown>)
            : {},
      };
      state.draftTitles = state.sourceTitles.map((title) => ({
        ...title,
        catalogVersionId: state.draft?.id,
      }));
      return state.draft;
    },
  );
  const catalogUpdate = vi.fn(
    async (input: { data: { catalogPayload?: Record<string, unknown> } }) => {
      if (input.data.catalogPayload && state.draft) {
        state.draft.catalogPayload = input.data.catalogPayload;
      }
      return state.draft;
    },
  );
  const jobTitleFindMany = vi.fn(async () => state.sourceTitles);
  const jobTitleFindFirst = vi.fn(
    async (input: { where: { catalogVersionId: string; titleId: string } }) =>
      input.where.catalogVersionId === state.draft?.id
        ? (state.draftTitles.find(
            (title) => title.titleId === input.where.titleId,
          ) ?? null)
        : null,
  );
  const jobTitleCreateMany = vi.fn(async () => ({ count: 1 }));
  const jobTitleUpdate = vi.fn(
    async (input: { where: { id: string }; data: Record<string, unknown> }) => {
      const title = state.draftTitles.find(
        (candidate) => candidate.id === input.where.id,
      );
      if (!title) return null;
      Object.assign(title, input.data);
      return title;
    },
  );
  const translationFindMany = vi.fn(async () => state.sourceTranslations);
  const translationCreateMany = vi.fn(async () => ({ count: 2 }));
  const translationUpsert = vi.fn(
    async (input: {
      where: {
        catalogVersionId_titleId_locale: {
          catalogVersionId: string;
          titleId: string;
          locale: "VI" | "EN";
        };
      };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = input.where.catalogVersionId_titleId_locale;
      const existing = state.sourceTranslations.find(
        (translation) =>
          translation.catalogVersionId === key.catalogVersionId &&
          translation.titleId === key.titleId &&
          translation.locale === key.locale,
      );
      if (existing) Object.assign(existing, input.update);
      else state.sourceTranslations.push({ ...input.create });
      return existing ?? input.create;
    },
  );
  const occupationFindMany = vi.fn(async () => state.sourceOccupations);
  const occupationCreateMany = vi.fn(async () => ({ count: 1 }));
  const aliasFindMany = vi.fn(async () => state.sourceAliases);
  const aliasFindFirst = vi.fn(
    async (input: {
      where: {
        catalogVersionId: string;
        targetType: string;
        targetId: string;
        normalizedPhrase: string;
        locale: null;
      };
    }) =>
      state.aliases.find(
        (alias) =>
          alias.catalogVersionId === input.where.catalogVersionId &&
          alias.targetType === input.where.targetType &&
          alias.targetId === input.where.targetId &&
          alias.normalizedPhrase === input.where.normalizedPhrase &&
          alias.locale === null,
      ) ?? null,
  );
  const aliasCreateMany = vi.fn(async () => ({ count: 1 }));
  const aliasCreate = vi.fn(
    async (input: { data: Record<string, unknown> }) => {
      state.aliases.push(input.data);
      return input.data;
    },
  );
  const facetFindMany = vi.fn(async () => state.sourceFacets);
  const facetCreateMany = vi.fn(async () => ({ count: 1 }));
  const titleFacetFindMany = vi.fn(async () => state.sourceTitleFacets);
  const titleFacetCreateMany = vi.fn(async () => ({ count: 1 }));
  const reviewUpdateMany = vi.fn(
    async (input: {
      where: { id: string; version: number; status: ReviewStatus };
      data: Record<string, unknown>;
    }) => {
      if (state.forceConflict) return { count: 0 };
      if (
        !state.review ||
        state.review.id !== input.where.id ||
        state.review.version !== input.where.version ||
        state.review.status !== input.where.status
      )
        return { count: 0 };
      const incrementsVersion = typeof input.data.version === "object";
      Object.assign(state.review, {
        ...input.data,
        ...(incrementsVersion ? { version: state.review.version + 1 } : {}),
      });
      return { count: 1 };
    },
  );

  const tx = {
    platformAdministratorGrant: { findFirst: grantFindFirst },
    searchMappingReview: {
      findUnique: reviewFindUnique,
      updateMany: reviewUpdateMany,
    },
    searchCatalogVersion: {
      findUnique: catalogFindUnique,
      findFirst: catalogFindFirst,
      create: catalogCreate,
      update: catalogUpdate,
    },
    searchOccupation: {
      findMany: occupationFindMany,
      createMany: occupationCreateMany,
    },
    searchJobTitle: {
      findMany: jobTitleFindMany,
      findFirst: jobTitleFindFirst,
      createMany: jobTitleCreateMany,
      update: jobTitleUpdate,
    },
    searchJobTitleTranslation: {
      findMany: translationFindMany,
      createMany: translationCreateMany,
      upsert: translationUpsert,
    },
    searchAlias: {
      findMany: aliasFindMany,
      findFirst: aliasFindFirst,
      createMany: aliasCreateMany,
      create: aliasCreate,
    },
    searchFacet: { findMany: facetFindMany, createMany: facetCreateMany },
    searchTitleFacet: {
      findMany: titleFacetFindMany,
      createMany: titleFacetCreateMany,
    },
  };

  const prisma = {
    platformAdministratorGrant: { findFirst: grantFindFirst },
    searchCatalogVersion: { findFirst: catalogFindFirst },
    searchMappingReview: {
      count: reviewCount,
      findMany: reviewFindMany,
      findUnique: reviewFindUnique,
    },
  };

  const mockExecute = vi.fn(
    async (
      identity: unknown,
      operation: (
        transaction: never,
        correlationId: string,
      ) => Promise<unknown>,
    ) => {
      const idempotencyKey =
        identity && typeof identity === "object" && "idempotencyKey" in identity
          ? String((identity as { idempotencyKey: unknown }).idempotencyKey)
          : "";
      const replay = receiptResults.get(idempotencyKey);
      if (replay) return { ...replay, replayed: true };
      const snapshot = structuredClone(state);
      try {
        const result = await operation(tx as never, "correlation-review-1");
        const envelope =
          result && typeof result === "object" && !Array.isArray(result)
            ? {
                ...(result as Record<string, unknown>),
                correlationId: "correlation-review-1",
              }
            : { correlationId: "correlation-review-1" };
        if (idempotencyKey) receiptResults.set(idempotencyKey, envelope);
        return envelope;
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  );

  class MockPrismaAdminCommandRepository {
    execute = mockExecute;
  }

  class MockAuditRepository {
    constructor(transaction: unknown) {
      void transaction;
    }

    async append(input: unknown) {
      if (state.failAudit) throw new Error("AUDIT_WRITE_FAILED");
      auditEvents.push(input);
      return "audit-review-1";
    }
  }

  class MockRationaleService {
    async create(transaction: unknown, input: unknown) {
      void transaction;
      if (state.failRationale) throw new Error("RATIONALE_WRITE_FAILED");
      rationales.push(input);
      return { id: "rationale-review-1" };
    }
  }

  const resetState = () => {
    state.authorized = true;
    state.failAudit = false;
    state.failRationale = false;
    state.forceConflict = false;
    state.review = {
      id: "review-1",
      catalogVersionId: "catalog-source-1",
      openKey: "search-mapping:accountant",
      originalTitle: "Accountant",
      normalizedTitle: "accountant",
      context: { sampleJobIds: ["job-1"] },
      suggestedTitleId: titleId,
      suggestedTranslationVi: "Kế toán",
      suggestedTranslationEn: "Accountant",
      suggestedOccupationId: occupationId,
      suggestedFacetIds: [facetId],
      suggestedSkillSignals: ["excel"],
      confidence: 0.55,
      status: "PENDING",
      version: 3,
      decisionReason: null,
      resultCatalogVersionId: null,
      reviewedByAdminUserId: null,
      reviewedAt: null,
      deduplicatedIntoReviewId: null,
      deduplicatedAt: null,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    };
    state.source = {
      id: "catalog-source-1",
      version: "2026-09-03.1",
      status: "PUBLISHED",
      revision: 4,
      isActive: true,
      parentVersion: null,
      catalogPayload: {
        version: "2026-09-03.1",
        titleDefinitions: [
          {
            titleId,
            occupationId,
            canonical: { vi: "Kế toán", en: "Accountant" },
            aliases: { vi: [], en: [] },
            facetIds: [facetId],
            translationStatus: "REQUIRES_REVIEW",
            mappingSource: "TAXONOMY_INFERENCE",
            mappingConfidence: 0.55,
            reviewReason: "Needs review",
            status: "REQUIRES_REVIEW",
          },
        ],
      },
    };
    state.draft = null;
    state.sourceTitles = [
      {
        id: "title-row-1",
        catalogVersionId: "catalog-source-1",
        titleId,
        occupationId,
        canonicalVi: "Kế toán",
        canonicalEn: "Accountant",
        aliasesVi: [],
        aliasesEn: [],
        abbreviations: [],
        excludedTerms: [],
        skillSignals: ["excel"],
        facetIds: [facetId],
        translationStatus: "REQUIRES_REVIEW",
        mappingSource: "TAXONOMY_INFERENCE",
        mappingConfidence: 0.55,
        reviewReason: "Needs review",
      },
    ];
    state.draftTitles = [];
    state.sourceTranslations = [
      {
        id: "translation-vi-1",
        catalogVersionId: "catalog-source-1",
        titleId,
        locale: "VI",
        value: "Kế toán",
        status: "REQUIRES_REVIEW",
        source: "TAXONOMY_INFERENCE",
        confidence: 0.55,
        reviewReason: "Needs review",
      },
      {
        id: "translation-en-1",
        catalogVersionId: "catalog-source-1",
        titleId,
        locale: "EN",
        value: "Accountant",
        status: "REQUIRES_REVIEW",
        source: "TAXONOMY_INFERENCE",
        confidence: 0.55,
        reviewReason: "Needs review",
      },
    ];
    state.sourceAliases = [];
    state.sourceOccupations = [
      {
        id: "occupation-row-1",
        catalogVersionId: "catalog-source-1",
        occupationId,
        labelVi: "Kế toán",
        labelEn: "Accounting",
        aliasesVi: [],
        aliasesEn: [],
        sortOrder: 1,
      },
    ];
    state.sourceFacets = [
      {
        id: "facet-row-1",
        catalogVersionId: "catalog-source-1",
        facetId,
        kind: "INDUSTRY",
        labelVi: "Kế toán",
        labelEn: "Accounting",
      },
    ];
    state.sourceTitleFacets = [
      {
        id: "title-facet-row-1",
        catalogVersionId: "catalog-source-1",
        titleId,
        facetId,
        required: false,
      },
    ];
    state.aliases = [];
    state.listRows = [state.review];
    auditEvents.length = 0;
    rationales.length = 0;
    receiptResults.clear();
    mockExecute.mockClear();
  };

  return {
    state,
    resetState,
    auditEvents,
    rationales,
    mockExecute,
    prisma,
    MockPrismaAdminCommandRepository,
    MockAuditRepository,
    MockRationaleService,
  };
});

vi.mock("@/backend/database/prisma", () => ({ prisma }));
vi.mock("@/backend/repositories/admin/prisma-admin-command-repository", () => ({
  PrismaAdminCommandRepository: MockPrismaAdminCommandRepository,
  AdminCommandConflict: class AdminCommandConflict extends Error {
    constructor(
      public readonly code: string,
      public readonly currentVersion?: number,
    ) {
      super(code);
    }
  },
}));
vi.mock("@/backend/repositories/audit/prisma-audit-repository", () => ({
  PrismaAuditRepository: MockAuditRepository,
}));
vi.mock("@/backend/admin/rationales/privileged-rationale-service", () => ({
  PrivilegedRationaleService: MockRationaleService,
}));

import { SearchMappingReviewAdminService } from "@/backend/admin/search/search-mapping-review-admin-service";

const authority = {
  userId: "admin-1",
  sessionId: "session-1",
  grantId: "grant-1",
  proofAt: new Date("2026-09-03T03:55:00.000Z"),
};

describe("SearchMappingReviewAdminService behavior", () => {
  beforeEach(() => {
    resetState();
  });

  it("lists and details reviews with bounded, deterministic query behavior", async () => {
    const service = new SearchMappingReviewAdminService();

    await expect(
      service.list(authority, {
        page: 1,
        perPage: 25,
        q: "account",
        status: "PENDING",
      }),
    ).resolves.toMatchObject({
      total: 1,
      data: [{ id: "review-1", status: "PENDING" }],
      meta: { stateDefinitionVersion: "search-state-v1" },
    });
    await expect(service.detail(authority, "review-1")).resolves.toMatchObject({
      id: "review-1",
      originalTitle: "Accountant",
    });
  });

  it("blocks list, detail, and command when the administrator grant is unavailable", async () => {
    state.authorized = false;
    const service = new SearchMappingReviewAdminService();

    await expect(service.list(authority, {})).rejects.toThrow("ACTION_BLOCKED");
    await expect(service.detail(authority, "review-1")).rejects.toThrow(
      "ACTION_BLOCKED",
    );
    await expect(
      service.command(
        authority,
        "review-1",
        {
          command: "REJECT",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "Not enough evidence to map this title.",
        },
        3,
        "review-idem-1",
      ),
    ).rejects.toThrow("ACTION_BLOCKED");
  });

  it("approves a review and keeps the relational mirror, payload, audit, and rationale aligned", async () => {
    const service = new SearchMappingReviewAdminService();
    const result = await service.command(
      authority,
      "review-1",
      {
        command: "APPROVE",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "Reviewer verified the bilingual title mapping.",
        titleId: "title-accountant-occ-r01-accounting",
        translationVi: "Kế toán",
        translationEn: "Accountant",
        occupationId: "occ-r01-accounting",
        facetIds: ["r01-accounting"],
      },
      3,
      "review-approve-1",
    );

    expect(result).toMatchObject({
      id: "review-1",
      status: "APPROVED",
      version: 4,
      resultCatalogVersionId: "search-catalog-draft-review-1",
      correlationId: "correlation-review-1",
    });
    expect(state.review).toMatchObject({
      status: "APPROVED",
      version: 4,
      openKey: null,
      reviewedByAdminUserId: "admin-1",
      resultCatalogVersionId: "search-catalog-draft-review-1",
    });
    expect(state.draftTitles[0]).toMatchObject({
      canonicalVi: "Kế toán",
      canonicalEn: "Accountant",
      translationStatus: "HUMAN_VERIFIED",
      mappingSource: "MANUAL_REVIEW",
      mappingConfidence: 1,
    });
    expect(state.sourceTranslations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogVersionId: "search-catalog-draft-review-1",
          locale: "VI",
          status: "HUMAN_VERIFIED",
          source: "MANUAL_REVIEW",
          confidence: 1,
        }),
        expect.objectContaining({
          catalogVersionId: "search-catalog-draft-review-1",
          locale: "EN",
          status: "HUMAN_VERIFIED",
          source: "MANUAL_REVIEW",
          confidence: 1,
        }),
      ]),
    );
    const definitions = state.draft?.catalogPayload.titleDefinitions;
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          titleId: "title-accountant-occ-r01-accounting",
          translationStatus: "HUMAN_VERIFIED",
          mappingSource: "MANUAL_REVIEW",
          mappingConfidence: 1,
          canonical: { vi: "Kế toán", en: "Accountant" },
        }),
      ]),
    );
    expect(auditEvents).toEqual([
      expect.objectContaining({
        actorUserId: "admin-1",
        actorSessionId: "session-1",
        correlationId: "correlation-review-1",
        action: "admin.search_mapping_review_approved",
        targetId: "review-1",
        context: expect.objectContaining({
          priorState: "PENDING",
          resultingState: "APPROVED",
          targetVersion: 4,
          parentCatalogVersionId: "catalog-source-1",
          parentCatalogVersion: "2026-09-03.1",
          resultCatalogVersionId: "search-catalog-draft-review-1",
          draftVersion: expect.stringMatching(/^draft-[0-9a-f]{58}$/u),
          beforeReference: expect.objectContaining({
            reviewId: "review-1",
            status: "PENDING",
            version: 3,
          }),
          afterReference: expect.objectContaining({
            reviewId: "review-1",
            status: "APPROVED",
            version: 4,
          }),
        }),
      }),
    ]);
    expect(rationales).toEqual([
      expect.objectContaining({
        correlationId: "correlation-review-1",
        explanation: "Reviewer verified the bilingual title mapping.",
      }),
    ]);
  });

  it("records an intentional untranslated decision without claiming HUMAN_VERIFIED", async () => {
    const service = new SearchMappingReviewAdminService();
    await expect(
      service.command(
        authority,
        "review-1",
        {
          command: "INTENTIONAL_UNTRANSLATED",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation:
            "The title is a stable industry term and should remain literal.",
          titleId: "title-accountant-occ-r01-accounting",
          translationEn: "Accountant",
          occupationId: "occ-r01-accounting",
          facetIds: ["r01-accounting"],
        },
        3,
        "review-intentional-1",
      ),
    ).resolves.toMatchObject({
      status: "APPROVED",
      version: 4,
      resultCatalogVersionId: "search-catalog-draft-review-1",
    });
    expect(state.draftTitles[0]).toEqual(
      expect.objectContaining({
        canonicalVi: "Accountant",
        canonicalEn: "Accountant",
        aliasesVi: [],
        translationStatus: "INTENTIONAL_UNTRANSLATED",
        mappingSource: "MANUAL_REVIEW",
        mappingConfidence: 1,
      }),
    );
    expect(state.sourceTranslations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locale: "VI",
          status: "INTENTIONAL_UNTRANSLATED",
          value: "Accountant",
        }),
        expect.objectContaining({
          locale: "EN",
          status: "INTENTIONAL_UNTRANSLATED",
          value: "Accountant",
        }),
      ]),
    );
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "admin.search_mapping_review_intentional_untranslated",
        context: expect.objectContaining({
          resultingState: "APPROVED",
          outcome: "SEARCH_MAPPING_REVIEW_INTENTIONAL_UNTRANSLATED",
        }),
      }),
    ]);
  });

  it("rejects without creating a draft and records the authenticated decision", async () => {
    const service = new SearchMappingReviewAdminService();
    await expect(
      service.command(
        authority,
        "review-1",
        {
          command: "REJECT",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "The submitted mapping is not sufficiently supported.",
        },
        3,
        "review-reject-1",
      ),
    ).resolves.toMatchObject({
      status: "REJECTED",
      version: 4,
      resultCatalogVersionId: null,
    });
    expect(state.draft).toBeNull();
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "admin.search_mapping_review_rejected",
        actorUserId: "admin-1",
        correlationId: "correlation-review-1",
      }),
    ]);
  });

  it("merges an unresolved phrase into the requested title and mirrors the alias", async () => {
    const service = new SearchMappingReviewAdminService();
    await expect(
      service.command(
        authority,
        "review-1",
        {
          command: "MERGE",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "Reviewer confirmed this phrase is the same title.",
          targetTitleId: "title-accountant-occ-r01-accounting",
        },
        3,
        "review-merge-1",
      ),
    ).resolves.toMatchObject({
      status: "MERGED",
      version: 4,
      resultCatalogVersionId: "search-catalog-draft-review-1",
    });

    expect(state.draftTitles[0]).toMatchObject({
      aliasesVi: ["Accountant"],
      aliasesEn: ["Accountant"],
    });
    expect(state.aliases).toEqual([
      expect.objectContaining({
        catalogVersionId: "search-catalog-draft-review-1",
        targetType: "TITLE",
        targetId: "title-accountant-occ-r01-accounting",
        normalizedPhrase: "accountant",
        locale: null,
        source: "MANUAL_REVIEW",
      }),
    ]);
    expect(state.draft?.catalogPayload.titleDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          titleId: "title-accountant-occ-r01-accounting",
          aliases: { vi: ["Accountant"], en: ["Accountant"] },
        }),
      ]),
    );
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "admin.search_mapping_review_merged",
        context: expect.objectContaining({
          targetTitleId: "title-accountant-occ-r01-accounting",
          resultCatalogVersionId: "search-catalog-draft-review-1",
        }),
      }),
    ]);
  });

  it("keeps alias identifiers collision-resistant for long phrases on a reused draft", async () => {
    const service = new SearchMappingReviewAdminService();
    const firstPhrase = `E2E ${"x".repeat(150)}`;
    const secondPhrase = `E2E ${"x".repeat(149)}y`;

    state.review = { ...state.review!, originalTitle: firstPhrase };
    await service.command(
      authority,
      "review-1",
      {
        command: "MERGE",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "The first long phrase is an equivalent title.",
        targetTitleId: "title-accountant-occ-r01-accounting",
      },
      3,
      "review-merge-long-1",
    );
    const firstId = state.aliases[0]?.id;

    state.review = {
      ...state.review!,
      status: "PENDING",
      version: 3,
      originalTitle: secondPhrase,
      resultCatalogVersionId: null,
      reviewedByAdminUserId: null,
      reviewedAt: null,
      decisionReason: null,
    };
    await service.command(
      authority,
      "review-1",
      {
        command: "MERGE",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "The second long phrase is an equivalent title.",
        targetTitleId: "title-accountant-occ-r01-accounting",
      },
      3,
      "review-merge-long-2",
    );

    const ids = state.aliases.map((alias) => alias.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(firstId).not.toBe(ids[1]);
    expect(ids.every((id) => typeof id === "string" && id.length <= 180)).toBe(
      true,
    );
  });

  it("keeps VI and EN translation identifiers distinct for long title IDs", async () => {
    const service = new SearchMappingReviewAdminService();
    const longTitleId = `title-${"long-title-segment-".repeat(8)}x`;
    const sourceTitle = state.sourceTitles[0];
    const source = state.source;
    if (!source) throw new Error("TEST_SOURCE_CATALOG_MISSING");
    state.review = {
      ...state.review!,
      suggestedTitleId: longTitleId,
    };
    state.sourceTitles = [
      {
        ...sourceTitle,
        id: "title-row-long",
        titleId: longTitleId,
      },
    ];
    if (!state.source) throw new Error("state.source expected");
    source.catalogPayload.titleDefinitions = [
      {
        ...(
          source.catalogPayload.titleDefinitions as Array<
            Record<string, unknown>
          >
        )[0],
        titleId: longTitleId,
      },
    ];

    await service.command(
      authority,
      "review-1",
      {
        command: "APPROVE",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "The long title identifier remains safely bilingual.",
        titleId: longTitleId,
      },
      3,
      "review-translation-long-1",
    );

    const translations = state.sourceTranslations.filter(
      (translation) =>
        translation.catalogVersionId === "search-catalog-draft-review-1",
    );
    expect(translations).toHaveLength(2);
    expect(
      new Set(translations.map((translation) => translation.id)).size,
    ).toBe(2);
    expect(translations.map((translation) => translation.locale)).toEqual(
      expect.arrayContaining(["VI", "EN"]),
    );
  });

  it("keeps sequential review drafts on unique catalog versions", async () => {
    const service = new SearchMappingReviewAdminService();
    const firstReviewId = state.review?.id;
    await service.command(
      authority,
      firstReviewId ?? "review-1",
      {
        command: "APPROVE",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "The first review creates an isolated draft version.",
      },
      3,
      "review-draft-version-1",
    );
    const firstVersion = state.draft?.version;

    state.review = {
      ...state.review!,
      id: "review-2",
      status: "PENDING",
      version: 3,
      resultCatalogVersionId: null,
      reviewedByAdminUserId: null,
      reviewedAt: null,
      decisionReason: null,
    };
    await service.command(
      authority,
      "review-2",
      {
        command: "APPROVE",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "The second review must not reuse the first version.",
      },
      3,
      "review-draft-version-2",
    );
    const secondVersion = state.draft?.version;

    expect(firstVersion).toMatch(/^draft-[0-9a-f]{58}$/u);
    expect(secondVersion).toMatch(/^draft-[0-9a-f]{58}$/u);
    expect(secondVersion).not.toBe(firstVersion);
  });

  it("fails stale commands before making any decision", async () => {
    const service = new SearchMappingReviewAdminService();
    await expect(
      service.command(
        authority,
        "review-1",
        {
          command: "REJECT",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "The mapping needs a different reviewer decision.",
        },
        2,
        "review-stale-1",
      ),
    ).rejects.toMatchObject({ code: "STALE_CONFLICT", currentVersion: 3 });
    expect(state.review).toMatchObject({ status: "PENDING", version: 3 });
    expect(auditEvents).toHaveLength(0);
    expect(rationales).toHaveLength(0);
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("turns a concurrent optimistic-write miss into a conflict without a decision", async () => {
    state.forceConflict = true;
    const service = new SearchMappingReviewAdminService();
    await expect(
      service.command(
        authority,
        "review-1",
        {
          command: "REJECT",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "A competing reviewer changed this row first.",
        },
        3,
        "review-concurrent-1",
      ),
    ).rejects.toMatchObject({ code: "STALE_CONFLICT" });
    expect(state.review).toMatchObject({ status: "PENDING", version: 3 });
    expect(auditEvents).toHaveLength(0);
    expect(rationales).toHaveLength(0);
  });

  it("rolls back draft and mirror writes when audit persistence fails", async () => {
    state.failAudit = true;
    const service = new SearchMappingReviewAdminService();
    await expect(
      service.command(
        authority,
        "review-1",
        {
          command: "APPROVE",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "The audit writer is intentionally unavailable.",
          titleId: "title-accountant-occ-r01-accounting",
          translationVi: "Kế toán",
          translationEn: "Accountant",
        },
        3,
        "review-rollback-1",
      ),
    ).rejects.toThrow("AUDIT_WRITE_FAILED");
    expect(state.draft).toBeNull();
    expect(state.review).toMatchObject({ status: "PENDING", version: 3 });
    expect(rationales).toHaveLength(0);
  });

  it("replays an idempotent decision without duplicating draft, audit, or rationale", async () => {
    const service = new SearchMappingReviewAdminService();
    const command = {
      command: "APPROVE" as const,
      confirmation: true as const,
      reasonCategory: "OTHER" as const,
      explanation: "Reviewer verified the bilingual title mapping.",
      titleId: "title-accountant-occ-r01-accounting",
      translationVi: "Kế toán",
      translationEn: "Accountant",
    };
    const first = await service.command(
      authority,
      "review-1",
      command,
      3,
      "review-idem-1",
    );
    const replay = await service.command(
      authority,
      "review-1",
      command,
      3,
      "review-idem-1",
    );
    expect(replay).toMatchObject({ ...first, replayed: true });
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(auditEvents).toHaveLength(1);
    expect(rationales).toHaveLength(1);
  });
});
