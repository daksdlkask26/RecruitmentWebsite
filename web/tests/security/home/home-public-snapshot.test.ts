import { describe, expect, it, vi } from "vitest";
import { getHomePublicSnapshot } from "@/backend/services/home/get-home-page-context";
import { homeCareerPaths, jobCard } from "../../helpers/home/home-fixtures";

const now = new Date("2026-09-14T00:00:00.000Z");

describe("Home public snapshot boundary", () => {
  it("uses a visitor actor and strips account, action, and match fields", async () => {
    const actors: unknown[] = [];
    const privateJob = jobCard({
      actions: {
        authenticated: true,
        saved: true,
        applied: true,
        canSave: true,
        canReport: true,
        canApply: true,
      },
    });

    const snapshot = await getHomePublicSnapshot(
      {
        searchJobs: async (actor) => {
          actors.push(actor);
          return [privateJob];
        },
        careerPaths: async (actor) => {
          actors.push(actor);
          return homeCareerPaths;
        },
        listCompanies: async () => [
          {
            slug: "public-company",
            displayName: "Public Company",
            logoUrl: null,
            publicDescription: "Public description",
            publicLocation: "Ha Noi",
            industry: "Technology",
            size: "51-200",
            openPositionCount: 1,
          },
        ],
        countCompanies: async () => 1,
      },
      now,
    );

    expect(actors).toEqual([{ kind: "visitor" }, { kind: "visitor" }]);
    expect(snapshot.jobs.status).toBe("ready");
    expect(snapshot.jobs.items[0]).not.toHaveProperty("saved");
    expect(snapshot.jobs.items[0]).not.toHaveProperty("canSave");
    expect(JSON.stringify(snapshot)).not.toMatch(
      /userId|sessionId|csrf|matchScore|matchSource|saved|canSave|Private Name/iu,
    );
  });

  it("keeps public sections independently recoverable", async () => {
    const snapshot = await getHomePublicSnapshot(
      {
        searchJobs: async () => [jobCard()],
        careerPaths: async () => homeCareerPaths,
        listCompanies: vi.fn().mockRejectedValue(new Error("company provider")),
        countCompanies: vi.fn().mockRejectedValue(new Error("count provider")),
      },
      now,
    );

    expect(snapshot.jobs.status).toBe("ready");
    expect(snapshot.spotlights).toEqual({
      status: "error",
      items: [],
      recovery: { kind: "reloadHome" },
    });
    expect(snapshot.companyCount).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("provider");
  });
});
