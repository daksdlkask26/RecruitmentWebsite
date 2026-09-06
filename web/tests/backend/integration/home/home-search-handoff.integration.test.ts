import { describe, expect, it, vi } from "vitest";
import { JobDiscoveryService } from "@/backend/services/jobs/job-discovery-service";
import {
  buildHomeJobSearch,
  emptyHomeSearchDraft,
} from "@/frontend/features/home/home-search-config";

function queryInput(params: URLSearchParams) {
  return {
    q: params.get("q") ?? "",
    location: params.get("location") ?? "",
    workArrangement: params.getAll("workArrangement"),
    employmentType: params.getAll("employmentType"),
    experienceLevel: params.getAll("experienceLevel"),
    skills: params.getAll("skills"),
  };
}

describe("Home search to existing Job Discovery handoff", () => {
  it("accepts concise hero criteria and preserves an editable empty result", async () => {
    const params = buildHomeJobSearch({
      ...emptyHomeSearchDraft,
      keyword: "Frontend",
      location: "Hà Nội",
    });
    const search = vi
      .fn()
      .mockResolvedValue({ rows: [], total: 0, nextCursor: null });
    const result = await new JobDiscoveryService({ search } as never).search(
      queryInput(params),
      { kind: "visitor" },
      new Date("2026-08-12T00:00:00.000Z"),
    );
    expect(result.items).toEqual([]);
    expect(result.criteria).toMatchObject({
      // The response preserves the candidate's editable casing while the
      // repository receives normalized search variants internally.
      q: "Frontend",
      location: "ha noi",
      workArrangement: [],
      employmentType: [],
      experienceLevel: [],
      skills: [],
    });
    expect(search).toHaveBeenCalledOnce();
  });

  it("rejects unknown or private values before the repository boundary", async () => {
    const search = vi.fn();
    await expect(
      new JobDiscoveryService({ search } as never).search(
        { ...queryInput(new URLSearchParams()), role: "candidate" },
        { kind: "visitor" },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(search).not.toHaveBeenCalled();
  });
});
