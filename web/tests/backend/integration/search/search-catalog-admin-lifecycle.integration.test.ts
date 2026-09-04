import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import type { AdminAuthority } from "@/backend/security/admin-request-boundary";
import { AdminCommandConflict } from "@/backend/repositories/admin/prisma-admin-command-repository";
import { SearchCatalogVersionAdminService } from "@/backend/admin/search/search-catalog-version-admin-service";
import { searchCatalogProvider } from "@/backend/services/search/catalogs/search-catalog-provider";

const suffix = randomUUID();
const userId = `search-admin-lifecycle-user-${suffix}`;
const email = `${userId}@example.test`;
const sessionId = `search-admin-lifecycle-session-${suffix}`;
const grantId = `search-admin-lifecycle-grant-${suffix}`;
const draftId = `search-admin-lifecycle-draft-${suffix}`;
const draftVersion = `search-admin-lifecycle-${suffix}`.slice(0, 64);

let sourceId: string | undefined;
let sourceState:
  | {
      status: "DRAFT" | "PUBLISHED" | "RETIRED";
      isActive: boolean;
      revision: number;
      publishedAt: Date | null;
      publishedByAdminUserId: string | null;
      retiredAt: Date | null;
      retiredByAdminUserId: string | null;
    }
  | undefined;

async function removeFixtureCatalog() {
  if (sourceId) {
    await prisma.searchCatalogVersion.updateMany({
      where: { id: draftId },
      data: {
        isActive: false,
        status: "RETIRED",
        retiredAt: new Date(),
        retiredByAdminUserId: userId,
      },
    });
    if (sourceState) {
      await prisma.searchCatalogVersion.update({
        where: { id: sourceId },
        data: sourceState,
      });
    }
  }

  const events = await prisma.auditEvent.findMany({
    where: { actorUserId: userId },
    select: { correlationId: true },
  });
  const correlationIds = events.map((event) => event.correlationId);
  if (correlationIds.length) {
    await prisma.privilegedActionRationale.deleteMany({
      where: { correlationId: { in: correlationIds } },
    });
  }
  await prisma.adminCommandReceipt.deleteMany({
    where: { targetReference: draftId },
  });
  // AuditEvent is intentionally append-only. The fixture's immutable audit
  // evidence is retained; all mutable fixture rows below are removed.
  await prisma.searchMappingReview.deleteMany({
    where: { catalogVersionId: draftId },
  });
  await prisma.searchTitleFacet.deleteMany({
    where: { catalogVersionId: draftId },
  });
  await prisma.searchAlias.deleteMany({ where: { catalogVersionId: draftId } });
  await prisma.searchJobTitleTranslation.deleteMany({
    where: { catalogVersionId: draftId },
  });
  await prisma.searchJobTitle.deleteMany({
    where: { catalogVersionId: draftId },
  });
  await prisma.searchFacet.deleteMany({ where: { catalogVersionId: draftId } });
  await prisma.searchOccupation.deleteMany({
    where: { catalogVersionId: draftId },
  });
  await prisma.searchCatalogVersion.deleteMany({ where: { id: draftId } });
  // A failed test process can leave a non-active draft behind. Only clean
  // rows with this test-owned prefix; immutable audit rows remain untouched.
  const staleDrafts = await prisma.searchCatalogVersion.findMany({
    where: {
      id: { startsWith: "search-admin-lifecycle-draft-" },
      isActive: false,
    },
    select: { id: true },
  });
  for (const stale of staleDrafts) {
    if (stale.id === draftId) continue;
    await prisma.searchMappingReview.deleteMany({
      where: { catalogVersionId: stale.id },
    });
    await prisma.searchTitleFacet.deleteMany({
      where: { catalogVersionId: stale.id },
    });
    await prisma.searchAlias.deleteMany({
      where: { catalogVersionId: stale.id },
    });
    await prisma.searchJobTitleTranslation.deleteMany({
      where: { catalogVersionId: stale.id },
    });
    await prisma.searchJobTitle.deleteMany({
      where: { catalogVersionId: stale.id },
    });
    await prisma.searchFacet.deleteMany({
      where: { catalogVersionId: stale.id },
    });
    await prisma.searchOccupation.deleteMany({
      where: { catalogVersionId: stale.id },
    });
    await prisma.searchCatalogVersion.deleteMany({
      where: { id: stale.id, isActive: false },
    });
  }
  await prisma.platformAdministratorGrant.deleteMany({
    where: { id: grantId },
  });
  await prisma.session.deleteMany({ where: { id: sessionId } });
  await prisma.userAccount.deleteMany({ where: { id: userId } });
}

afterAll(async () => {
  await removeFixtureCatalog();
  searchCatalogProvider.invalidate();
});

describe("search catalog admin lifecycle", () => {
  it("publishes, rolls back, rejects stale/concurrent commands, and changes runtime", async () => {
    const source = await prisma.searchCatalogVersion.findFirstOrThrow({
      where: { isActive: true, status: "PUBLISHED" },
      select: {
        id: true,
        version: true,
        status: true,
        isActive: true,
        revision: true,
        catalogPayload: true,
        publishedAt: true,
        publishedByAdminUserId: true,
        retiredAt: true,
        retiredByAdminUserId: true,
      },
    });
    sourceId = source.id;
    sourceState = {
      status: source.status,
      isActive: source.isActive,
      revision: source.revision,
      publishedAt: source.publishedAt,
      publishedByAdminUserId: source.publishedByAdminUserId,
      retiredAt: source.retiredAt,
      retiredByAdminUserId: source.retiredByAdminUserId,
    };
    if (!source.catalogPayload) {
      throw new Error("SEARCH_CATALOG_FIXTURE_SOURCE_PAYLOAD_MISSING");
    }

    const [occupations, titles, translations, aliases, facets, titleFacets] =
      await Promise.all([
        prisma.searchOccupation.findMany({
          where: { catalogVersionId: source.id },
          select: {
            occupationId: true,
            labelVi: true,
            labelEn: true,
            aliasesVi: true,
            aliasesEn: true,
            sortOrder: true,
          },
        }),
        prisma.searchJobTitle.findMany({
          where: { catalogVersionId: source.id },
          select: {
            titleId: true,
            occupationId: true,
            canonicalVi: true,
            canonicalEn: true,
            aliasesVi: true,
            aliasesEn: true,
            abbreviations: true,
            excludedTerms: true,
            skillSignals: true,
            facetIds: true,
            translationStatus: true,
            mappingSource: true,
            mappingConfidence: true,
            reviewReason: true,
          },
        }),
        prisma.searchJobTitleTranslation.findMany({
          where: { catalogVersionId: source.id },
          select: {
            titleId: true,
            locale: true,
            value: true,
            status: true,
            source: true,
            confidence: true,
            reviewReason: true,
          },
        }),
        prisma.searchAlias.findMany({
          where: { catalogVersionId: source.id },
          select: {
            targetType: true,
            targetId: true,
            phrase: true,
            normalizedPhrase: true,
            locale: true,
            source: true,
            confidence: true,
          },
        }),
        prisma.searchFacet.findMany({
          where: { catalogVersionId: source.id },
          select: { facetId: true, kind: true, labelVi: true, labelEn: true },
        }),
        prisma.searchTitleFacet.findMany({
          where: { catalogVersionId: source.id },
          select: { titleId: true, facetId: true, required: true },
        }),
      ]);

    const payload = JSON.parse(JSON.stringify(source.catalogPayload)) as Record<
      string,
      unknown
    >;
    payload.version = draftVersion;
    const now = new Date();
    await prisma.userAccount.create({
      data: {
        id: userId,
        name: "Search Lifecycle Fixture",
        email,
        normalizedEmail: email,
        state: "ACTIVE",
        emailVerified: true,
        twoFactorEnabled: true,
      },
    });
    await prisma.session.create({
      data: {
        id: sessionId,
        token: `search-admin-lifecycle-token-${suffix}`,
        userId,
        expiresAt: new Date(now.getTime() + 86_400_000),
        absoluteExpiresAt: new Date(now.getTime() + 86_400_000),
      },
    });
    await prisma.platformAdministratorGrant.create({
      data: { id: grantId, userId },
    });
    await prisma.administratorSessionPolicy.create({
      data: {
        grantId,
        designatedSessionId: sessionId,
        initialTwoFactorAt: now,
        latestTwoFactorProofAt: now,
        designationVersion: 1,
      },
    });

    await prisma.searchCatalogVersion.create({
      data: {
        id: draftId,
        version: draftVersion,
        status: "DRAFT",
        isActive: false,
        revision: 1,
        parentVersion: source.version,
        changeReason: "Search lifecycle integration fixture",
        createdByAdminUserId: userId,
        catalogPayload: payload as Prisma.InputJsonValue,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.searchOccupation.createMany({
        data: occupations.map((row) => ({
          id: `search-lifecycle-occupation-${randomUUID()}`,
          catalogVersionId: draftId,
          ...row,
        })),
      });
      await tx.searchJobTitle.createMany({
        data: titles.map((row) => ({
          id: `search-lifecycle-title-${randomUUID()}`,
          catalogVersionId: draftId,
          ...row,
        })),
      });
      await tx.searchJobTitleTranslation.createMany({
        data: translations.map((row) => ({
          id: `search-lifecycle-translation-${randomUUID()}`,
          catalogVersionId: draftId,
          ...row,
        })),
      });
      await tx.searchAlias.createMany({
        data: aliases.map((row) => ({
          id: `search-lifecycle-alias-${randomUUID()}`,
          catalogVersionId: draftId,
          ...row,
        })),
      });
      await tx.searchFacet.createMany({
        data: facets.map((row) => ({
          id: `search-lifecycle-facet-${randomUUID()}`,
          catalogVersionId: draftId,
          ...row,
        })),
      });
      await tx.searchTitleFacet.createMany({
        data: titleFacets.map((row) => ({
          id: `search-lifecycle-title-facet-${randomUUID()}`,
          catalogVersionId: draftId,
          ...row,
        })),
      });
    });

    const authority: AdminAuthority = {
      userId,
      sessionId,
      grantId,
      proofAt: now,
    };
    const service = new SearchCatalogVersionAdminService();
    const publish = await service.command(
      authority,
      draftId,
      {
        command: "PUBLISH",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "Publish lifecycle fixture for runtime verification.",
      },
      1,
      `search-lifecycle-publish-${suffix}`,
    );
    expect(publish).toMatchObject({
      catalogVersion: draftVersion,
      status: "PUBLISHED",
      isActive: true,
      revision: 2,
      runtimeSupported: true,
    });
    expect((await searchCatalogProvider.getActiveSnapshot()).version).toBe(
      draftVersion,
    );

    const replay = await service.command(
      authority,
      draftId,
      {
        command: "PUBLISH",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "Publish lifecycle fixture for runtime verification.",
      },
      1,
      `search-lifecycle-publish-${suffix}`,
    );
    expect(replay).toMatchObject({
      replayed: true,
      correlationId: publish.correlationId,
    });

    await expect(
      service.command(
        authority,
        draftId,
        {
          command: "ROLLBACK",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "Reject stale lifecycle command safely.",
        },
        1,
        `search-lifecycle-stale-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(AdminCommandConflict);

    const rollback = await service.command(
      authority,
      source.id,
      {
        command: "ROLLBACK",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "Rollback lifecycle fixture to the prior catalog.",
      },
      source.revision,
      `search-lifecycle-rollback-${suffix}`,
    );
    expect(rollback).toMatchObject({
      catalogVersion: source.version,
      status: "PUBLISHED",
      isActive: true,
      revision: source.revision + 1,
      runtimeSupported: true,
    });
    expect((await searchCatalogProvider.getActiveSnapshot()).version).toBe(
      source.version,
    );

    const concurrent = await Promise.allSettled([
      service.command(
        authority,
        draftId,
        {
          command: "ROLLBACK",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "Concurrent rollback race A for lifecycle fixture.",
        },
        2,
        `search-lifecycle-race-a-${suffix}`,
      ),
      service.command(
        authority,
        draftId,
        {
          command: "ROLLBACK",
          confirmation: true,
          reasonCategory: "OTHER",
          explanation: "Concurrent rollback race B for lifecycle fixture.",
        },
        2,
        `search-lifecycle-race-b-${suffix}`,
      ),
    ]);
    expect(
      concurrent.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrent.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const rejected = concurrent.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(AdminCommandConflict);

    const restore = await service.command(
      authority,
      source.id,
      {
        command: "ROLLBACK",
        confirmation: true,
        reasonCategory: "OTHER",
        explanation: "Restore lifecycle fixture baseline after race test.",
      },
      source.revision + 1,
      `search-lifecycle-restore-${suffix}`,
    );
    expect(restore).toMatchObject({
      catalogVersion: source.version,
      status: "PUBLISHED",
      isActive: true,
    });
    expect(
      await prisma.searchCatalogVersion.count({ where: { isActive: true } }),
    ).toBe(1);

    const events = await prisma.auditEvent.findMany({
      where: {
        actorUserId: userId,
        action: {
          in: [
            "admin.search_catalog_version_published",
            "admin.search_catalog_version_rolled_back",
          ],
        },
      },
      select: {
        correlationId: true,
        actorUserId: true,
        actorSessionId: true,
        context: true,
      },
    });
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.every((event) => event.actorUserId === userId)).toBe(true);
    expect(events.every((event) => event.actorSessionId === sessionId)).toBe(
      true,
    );
    expect(
      events.every((event) => {
        const context = event.context as Record<string, unknown>;
        return (
          typeof context.reasonCategory === "string" &&
          typeof context.priorState === "string" &&
          typeof context.resultingState === "string" &&
          typeof context.targetVersion === "number" &&
          typeof context.runtimeCatalogVersion === "string"
        );
      }),
    ).toBe(true);
    expect(
      await prisma.privilegedActionRationale.count({
        where: {
          correlationId: { in: events.map((event) => event.correlationId) },
        },
      }),
    ).toBe(events.length);
  }, 90_000);
});
