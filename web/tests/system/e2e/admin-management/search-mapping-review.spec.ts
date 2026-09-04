import { test, expect } from "./admin-e2e-fixture";
import { adminE2eControl } from "./admin-e2e-process";
import { freshTotp } from "./admin-e2e-totp";

type SearchMappingScenario = {
  runId: string;
  reviewId: string;
  titleId: string;
  catalogVersionId: string;
  originalTitle: string;
};

type SearchMappingState = {
  review: {
    id: string;
    status: string;
    version: number;
    resultCatalogVersionId: string | null;
    reviewedByAdminUserId: string | null;
    reviewedAt: string | null;
  };
  draft: {
    id: string;
    version: string;
    status: string;
    parentVersion: string | null;
  } | null;
  targetTitle: {
    titleId: string;
    translationStatus: string;
    mappingSource: string;
    mappingConfidence: number;
    aliasesVi: string[];
    aliasesEn: string[];
  } | null;
  aliases: Array<{
    phrase: string;
    normalizedPhrase: string;
    locale: string | null;
    source: string;
    confidence: number;
  }>;
  audits: Array<{
    action: string;
    result: string;
    actorUserId: string | null;
    actorSessionId: string | null;
    correlationId: string;
    context: Record<string, unknown>;
  }>;
  rationaleCount: number;
};

type SearchCatalogState = {
  row: {
    id: string;
    version: string;
    status: string;
    isActive: boolean;
    revision: number;
    parentVersion: string | null;
    publishedAt: string | null;
    retiredAt: string | null;
  };
  active: {
    id: string;
    version: string;
    status: string;
    isActive: boolean;
    revision: number;
  } | null;
  parent: {
    id: string;
    version: string;
    status: string;
    isActive: boolean;
    revision: number;
  } | null;
  audits: Array<{
    action: string;
    result: string;
    actorUserId: string | null;
    actorSessionId: string | null;
    correlationId: string;
    context: Record<string, unknown>;
  }>;
};

const adminOrigin =
  process.env.ADMIN_E2E_ORIGIN ?? "http://console.admin.localhost:3001";

async function openReview(
  adminPage: import("@playwright/test").Page,
  scenario: SearchMappingScenario,
) {
  await adminPage.goto(`${adminOrigin}/#/search-mapping-reviews`);
  const search = adminPage.getByLabel("Search title or title ID");
  await search.fill(scenario.originalTitle);
  const row = adminPage.getByText(scenario.originalTitle, { exact: true });
  await expect(row).toBeVisible();
  await row.click();
  await expect(
    adminPage.getByRole("heading", { name: scenario.originalTitle }),
  ).toBeVisible();
  await expect(
    adminPage.getByText("Mapping context", { exact: true }),
  ).toBeVisible();
}

async function completeAction(
  adminPage: import("@playwright/test").Page,
  adminAuth: {
    grantId: string;
    totpSecret: string;
    lastLoginTotpCode?: string;
  },
  action: "approve" | "merge" | "reject",
  targetTitleId?: string,
) {
  const actionLabel =
    action === "approve"
      ? "Approve mapping"
      : action === "merge"
        ? "Merge into title"
        : "Reject";
  await adminPage.getByRole("button", { name: actionLabel }).click();
  const dialog = adminPage.getByRole("dialog", {
    name:
      action === "approve"
        ? "Approve search mapping"
        : action === "merge"
          ? "Merge search mapping"
          : "Reject search mapping",
  });
  await expect(dialog).toBeVisible();
  if (action === "merge") {
    await dialog.getByLabel("Target title ID").fill(targetTitleId ?? "");
  }
  await dialog.getByLabel("Reason category").click();
  await adminPage.getByRole("option", { name: "Other", exact: true }).click();
  await dialog
    .getByLabel("Private administrator rationale")
    .fill(`E2E ${action} mapping decision with bounded reviewer rationale.`);
  await expect(dialog.getByRole("button", { name: "Confirm" })).toBeEnabled();

  // Force the first request through the real step-up boundary. The retry must
  // keep the same idempotency key and complete the original browser operation.
  await adminE2eControl("expire-proof", adminAuth.grantId);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  const stepUp = adminPage.getByRole("dialog", {
    name: "Verify sensitive action",
  });
  await expect(stepUp).toBeVisible();
  const code = await freshTotp(
    adminAuth.totpSecret,
    adminAuth.lastLoginTotpCode ?? "",
  );
  await stepUp.getByLabel("Six-digit authenticator code").fill(code);
  await stepUp.getByRole("button", { name: "Verify" }).click();
  await expect(stepUp).toBeHidden();
  await expect(dialog).toBeHidden();
}

async function openCatalogVersion(
  adminPage: import("@playwright/test").Page,
  version: string,
  id?: string,
) {
  if (id) {
    await adminPage.goto(
      `${adminOrigin}/#/search-catalog-versions/${encodeURIComponent(id)}/show`,
    );
  } else {
    await adminPage.goto(`${adminOrigin}/#/search-catalog-versions`);
    const search = adminPage.getByLabel("Search version");
    await search.fill(version);
    const row = adminPage.getByRole("row").filter({ hasText: version }).last();
    await expect(row).toBeVisible();
    await row.click();
  }
  await expect(adminPage.getByRole("heading", { name: version })).toBeVisible();
}

async function completeCatalogAction(
  adminPage: import("@playwright/test").Page,
  adminAuth: {
    grantId: string;
    totpSecret: string;
    lastLoginTotpCode?: string;
  },
  action: "publish" | "rollback",
) {
  const actionLabel = action === "publish" ? "Publish" : "Make active";
  const dialogName =
    action === "publish"
      ? "Publish catalog version"
      : "Activate previous catalog version";
  await adminPage.getByRole("button", { name: actionLabel }).click();
  const dialog = adminPage.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Reason category").click();
  await adminPage.getByRole("option", { name: "Other", exact: true }).click();
  await dialog
    .getByLabel("Private administrator rationale")
    .fill(`E2E ${action} catalog lifecycle decision with bounded rationale.`);
  await expect(dialog.getByRole("button", { name: "Confirm" })).toBeEnabled();

  await adminE2eControl("expire-proof", adminAuth.grantId);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  const stepUp = adminPage.getByRole("dialog", {
    name: "Verify sensitive action",
  });
  await expect(stepUp).toBeVisible();
  const code = await freshTotp(
    adminAuth.totpSecret,
    adminAuth.lastLoginTotpCode ?? "",
  );
  await stepUp.getByLabel("Six-digit authenticator code").fill(code);
  await stepUp.getByRole("button", { name: "Verify" }).click();
  await expect(stepUp).toBeHidden();
  await expect(dialog).toBeHidden();
}

test.describe.configure({ mode: "serial" });

test.describe("search mapping review browser lifecycle", () => {
  test("lists context and approves through step-up with immutable provenance", async ({
    adminPage,
    adminAuth,
  }) => {
    const scenario = await adminE2eControl<SearchMappingScenario>(
      "create-search-mapping",
      adminAuth.runId,
    );
    await openReview(adminPage, scenario);
    await expect(
      adminPage.getByText("Impact preview:", { exact: false }),
    ).toHaveCount(0);
    await completeAction(adminPage, adminAuth, "approve");
    await expect(
      adminPage.getByText("APPROVED", { exact: true }),
    ).toBeVisible();

    const state = await adminE2eControl<SearchMappingState>(
      "inspect-search-mapping",
      scenario.reviewId,
    );
    expect(state.review.status).toBe("APPROVED");
    expect(state.review.version).toBe(2);
    expect(state.review.reviewedByAdminUserId).toBe(adminAuth.userId);
    expect(state.review.reviewedAt).toBeTruthy();
    expect(state.draft?.status).toBe("DRAFT");
    expect(state.draft?.parentVersion).toBeTruthy();
    expect(state.targetTitle).toMatchObject({
      titleId: scenario.titleId,
      translationStatus: "HUMAN_VERIFIED",
      mappingSource: "MANUAL_REVIEW",
      mappingConfidence: 1,
    });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "admin.search_mapping_review_approved",
      result: "SUCCESS",
      actorUserId: adminAuth.userId,
    });
    expect(state.audits[0]?.actorSessionId).toBeTruthy();
    expect(state.audits[0]?.correlationId).toBeTruthy();
    expect(state.audits[0]?.context).toMatchObject({
      parentCatalogVersionId: scenario.catalogVersionId,
      beforeReference: {
        reviewId: scenario.reviewId,
        status: "PENDING",
        version: 1,
      },
      afterReference: {
        reviewId: scenario.reviewId,
        status: "APPROVED",
        version: 2,
      },
    });
    expect(state.rationaleCount).toBe(1);
  });

  test("merges an alias and rejects a second pending mapping without partial state", async ({
    adminPage,
    adminAuth,
  }) => {
    const mergeScenario = await adminE2eControl<SearchMappingScenario>(
      "create-search-mapping",
      adminAuth.runId,
    );
    await openReview(adminPage, mergeScenario);
    await completeAction(adminPage, adminAuth, "merge", mergeScenario.titleId);
    await expect(adminPage.getByText("MERGED", { exact: true })).toBeVisible();
    const merged = await adminE2eControl<SearchMappingState>(
      "inspect-search-mapping",
      mergeScenario.reviewId,
    );
    expect(merged.review.status).toBe("MERGED");
    expect(merged.targetTitle?.titleId).toBe(mergeScenario.titleId);
    expect(merged.targetTitle?.aliasesVi).toContain(
      mergeScenario.originalTitle,
    );
    expect(merged.targetTitle?.aliasesEn).toContain(
      mergeScenario.originalTitle,
    );
    expect(merged.aliases).toContainEqual(
      expect.objectContaining({
        phrase: mergeScenario.originalTitle,
        locale: null,
        source: "MANUAL_REVIEW",
        confidence: 1,
      }),
    );
    expect(merged.audits[0]?.action).toBe("admin.search_mapping_review_merged");
    expect(merged.rationaleCount).toBe(1);

    const rejectScenario = await adminE2eControl<SearchMappingScenario>(
      "create-search-mapping",
      adminAuth.runId,
    );
    await openReview(adminPage, rejectScenario);
    await completeAction(adminPage, adminAuth, "reject");
    await expect(
      adminPage.getByText("REJECTED", { exact: true }),
    ).toBeVisible();
    const rejected = await adminE2eControl<SearchMappingState>(
      "inspect-search-mapping",
      rejectScenario.reviewId,
    );
    expect(rejected.review.status).toBe("REJECTED");
    expect(rejected.review.resultCatalogVersionId).toBeNull();
    expect(rejected.draft).toBeNull();
    expect(rejected.targetTitle).toBeNull();
    expect(rejected.audits).toHaveLength(1);
    expect(rejected.audits[0]?.action).toBe(
      "admin.search_mapping_review_rejected",
    );
    expect(rejected.rationaleCount).toBe(1);
  });

  test("publishes a draft, observes the runtime switch, and rolls back safely", async ({
    adminPage,
    adminAuth,
  }) => {
    const scenario = await adminE2eControl<SearchMappingScenario>(
      "create-search-mapping",
      adminAuth.runId,
    );
    await openReview(adminPage, scenario);
    await completeAction(adminPage, adminAuth, "approve");

    const approved = await adminE2eControl<SearchMappingState>(
      "inspect-search-mapping",
      scenario.reviewId,
    );
    expect(approved.draft).not.toBeNull();
    const draft = approved.draft;
    if (!draft || !draft.parentVersion) {
      throw new Error("ADMIN_E2E_SEARCH_DRAFT_PARENT_MISSING");
    }

    let draftWasPublished = false;
    try {
      await openCatalogVersion(adminPage, draft.version, draft.id);
      await expect(
        adminPage.getByRole("button", { name: "Publish" }),
      ).toBeVisible();
      await completeCatalogAction(adminPage, adminAuth, "publish");
      draftWasPublished = true;

      const published = await adminE2eControl<SearchCatalogState>(
        "inspect-search-catalog",
        draft.id,
      );
      expect(published.row).toMatchObject({
        status: "PUBLISHED",
        isActive: true,
        parentVersion: draft.parentVersion,
      });
      expect(published.active?.id).toBe(draft.id);
      expect(published.audits.at(-1)).toMatchObject({
        action: "admin.search_catalog_version_published",
        result: "SUCCESS",
        actorUserId: adminAuth.userId,
      });
      expect(published.audits.at(-1)?.actorSessionId).toBeTruthy();
      expect(published.audits.at(-1)?.correlationId).toBeTruthy();

      const runtimeAfterPublish = await adminPage.request.get(
        "http://localhost:3001/api/jobs?limit=1",
      );
      const publishedBody = await runtimeAfterPublish.text();
      expect(
        runtimeAfterPublish.ok(),
        `runtime after publish status=${runtimeAfterPublish.status()} body=${publishedBody.slice(0, 500)}`,
      ).toBe(true);
      const publishedPayload = JSON.parse(publishedBody) as {
        searchMetadata?: { catalogVersion?: string };
      };
      expect(publishedPayload.searchMetadata?.catalogVersion).toBe(
        draft.version,
      );

      const parent = published.parent;
      if (!parent) throw new Error("ADMIN_E2E_SEARCH_PARENT_MISSING");
      await openCatalogVersion(adminPage, parent.version, parent.id);
      await expect(
        adminPage.getByRole("button", { name: "Make active" }),
      ).toBeVisible();
      await completeCatalogAction(adminPage, adminAuth, "rollback");
      draftWasPublished = false;

      const rolledBack = await adminE2eControl<SearchCatalogState>(
        "inspect-search-catalog",
        draft.id,
      );
      expect(rolledBack.row.status).toBe("RETIRED");
      expect(rolledBack.row.isActive).toBe(false);
      expect(rolledBack.active?.version).toBe(draft.parentVersion);
      expect(rolledBack.audits.at(-1)).toMatchObject({
        action: "admin.search_catalog_version_published",
        result: "SUCCESS",
        actorUserId: adminAuth.userId,
      });
      const parentAfterRollback = rolledBack.parent
        ? await adminE2eControl<SearchCatalogState>(
            "inspect-search-catalog",
            rolledBack.parent.id,
          )
        : null;
      expect(parentAfterRollback?.audits.at(-1)).toMatchObject({
        action: "admin.search_catalog_version_rolled_back",
        result: "SUCCESS",
        actorUserId: adminAuth.userId,
      });
      expect(parentAfterRollback?.audits.at(-1)?.actorSessionId).toBeTruthy();
      expect(parentAfterRollback?.audits.at(-1)?.correlationId).toBeTruthy();

      const runtimeAfterRollback = await adminPage.request.get(
        "http://localhost:3001/api/jobs?limit=1",
      );
      const rolledBackBody = await runtimeAfterRollback.text();
      expect(
        runtimeAfterRollback.ok(),
        `runtime after rollback status=${runtimeAfterRollback.status()} body=${rolledBackBody.slice(0, 500)}`,
      ).toBe(true);
      const rolledBackPayload = JSON.parse(rolledBackBody) as {
        searchMetadata?: { catalogVersion?: string };
      };
      expect(rolledBackPayload.searchMetadata?.catalogVersion).toBe(
        draft.parentVersion,
      );
    } finally {
      // Keep a failed browser assertion from leaving the fixture catalog active.
      // The normal path above performs this through the real admin UI; this
      // best-effort retry is only a cleanup guard and never changes production
      // data outside the run-owned fixture.
      if (draftWasPublished) {
        try {
          const active = await adminE2eControl<SearchCatalogState>(
            "inspect-search-catalog",
            draft.id,
          );
          if (active.active?.id === draft.id && active.parent) {
            const parent = active.parent;
            await openCatalogVersion(adminPage, parent.version, parent.id);
            await completeCatalogAction(adminPage, adminAuth, "rollback");
          }
        } catch {
          // Preserve the original assertion failure; teardown will report any
          // active fixture catalog that remains.
        }
      }
    }
  });
});
