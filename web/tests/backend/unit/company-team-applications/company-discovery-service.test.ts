import { describe, expect, it, vi } from "vitest";
import {
  CompanyDiscoveryService,
  companySizeRange,
  openRoles,
} from "@/backend/services/companies/company-discovery-service";
import {
  approvedCompanyFixture,
  publicJobCardFixture,
} from "../../../helpers/company-team-applications-fixture";

describe("Company discovery service", () => {
  it("does not expose team roles when a public company has no active Owner", () => {
    expect(openRoles([], false)).toEqual([]);
    expect(openRoles([{ role: "HR_MANAGER", state: "OPEN" }], false)).toEqual(
      [],
    );
  });
  it.each([
    [0, "Unavailable"],
    [1, "1–10 employees"],
    [10, "1–10 employees"],
    [11, "11–50 employees"],
    [50, "11–50 employees"],
    [51, "51–200 employees"],
    [201, "201–500 employees"],
    [501, "501–1,000 employees"],
    [1_001, "1,001+ employees"],
  ])("maps %d active employees to a public range", (count, expected) => {
    expect(companySizeRange(count)).toBe(expected);
  });

  it("returns only safe company cards and paginates deterministically", async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({
        items: [approvedCompanyFixture],
        total: 1,
      }),
      findById: vi.fn(),
    };
    const service = new CompanyDiscoveryService(repository as never);
    const result = await service.list({ page: 1, limit: 24 });
    expect(result).toEqual({
      items: [
        {
          companyId: approvedCompanyFixture.id,
          slug: approvedCompanyFixture.slug,
          name: approvedCompanyFixture.displayName,
          logoUrl: null,
          description: approvedCompanyFixture.publicDescription,
        },
      ],
      page: 1,
      total: 1,
      totalPages: 1,
    });
  });

  it("passes a normalized company search term to the public repository", async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: vi.fn(),
    };
    const service = new CompanyDiscoveryService(repository as never);

    await service.list({ q: "  Northstar Labs  ", page: 2, limit: 24 });

    expect(repository.list).toHaveBeenCalledWith({
      q: "Northstar Labs",
      page: 2,
      limit: 24,
    });
  });

  it("passes the location filter and preserves the public directory projection", async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            ...approvedCompanyFixture,
            publicLocation: "Thanh Khe District, Da Nang",
            industry: "Information Technology",
            openPositionCount: 14,
          },
        ],
        total: 180,
        locations: [
          "Thanh Khe District, Da Nang",
          "District 3, Ho Chi Minh City",
        ],
      }),
      findById: vi.fn(),
    };
    const service = new CompanyDiscoveryService(repository as never);

    const result = await service.list({ location: "  Can Tho  " });

    expect(repository.list).toHaveBeenCalledWith({
      q: "",
      location: "Can Tho",
      page: 1,
      limit: 24,
    });
    expect(result.items[0]).toMatchObject({
      industry: "Information Technology",
      location: "Da Nang",
      openPositionCount: 14,
    });
    expect(result.locations).toEqual(["Da Nang", "Ho Chi Minh City"]);
  });

  it("scopes detail jobs to the selected company and exposes open team roles", async () => {
    const repository = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue({
        ...approvedCompanyFixture,
        activeEmployeeCount: 12,
      }),
    };
    const jobs = {
      searchScoped: vi.fn().mockResolvedValue({
        items: [publicJobCardFixture],
        total: 1,
        nextCursor: null,
        page: 1,
        totalPages: 1,
      }),
    };
    const opportunities = {
      listForCompany: vi.fn().mockResolvedValue([
        { role: "HR_MANAGER", state: "OPEN" },
        { role: "RECRUITER", state: "CLOSED" },
      ]),
    };
    const service = new CompanyDiscoveryService(
      repository as never,
      jobs as never,
      opportunities as never,
    );
    const result = await service.detail(
      approvedCompanyFixture.id,
      { kind: "user", userId: "candidate-1", sessionId: "session-1" },
      { q: "recruiter", location: "Ho Chi Minh City" },
    );
    expect(result.sizeRange).toBe("11–50 employees");
    expect(result.teamRoles).toEqual(["HR_MANAGER"]);
    expect(result.jobs).toEqual([publicJobCardFixture]);
    expect(jobs.searchScoped).toHaveBeenCalledWith(
      { q: "recruiter", location: "Ho Chi Minh City" },
      { kind: "user", userId: "candidate-1", sessionId: "session-1" },
      expect.any(Date),
      { companyId: approvedCompanyFixture.id },
    );
  });

  it("keeps an unconfigured supported role open until an Owner closes it", async () => {
    const repository = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(approvedCompanyFixture),
    };
    const jobs = {
      searchScoped: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        nextCursor: null,
        page: 1,
        totalPages: 0,
      }),
    };
    const opportunities = {
      listForCompany: vi
        .fn()
        .mockResolvedValue([{ role: "HR_MANAGER", state: "OPEN" }]),
    };
    const service = new CompanyDiscoveryService(
      repository as never,
      jobs as never,
      opportunities as never,
    );

    const result = await service.detail(approvedCompanyFixture.id, {
      kind: "visitor",
    });

    expect(result.teamRoles).toEqual(["HR_MANAGER", "RECRUITER"]);
  });

  it("keeps ordinary jobs discoverable while hiding team applications without an Owner", async () => {
    const repository = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue({
        ...approvedCompanyFixture,
        activeOwnerCount: 0,
      }),
    };
    const jobs = {
      searchScoped: vi.fn().mockResolvedValue({
        items: [publicJobCardFixture],
        total: 1,
        nextCursor: null,
        page: 1,
        totalPages: 1,
      }),
    };
    const opportunities = { listForCompany: vi.fn().mockResolvedValue([]) };
    const result = await new CompanyDiscoveryService(
      repository as never,
      jobs as never,
      opportunities as never,
    ).detail(approvedCompanyFixture.id, { kind: "visitor" });

    expect(result.teamRoles).toEqual([]);
    expect(result.jobs).toEqual([publicJobCardFixture]);
  });
});
