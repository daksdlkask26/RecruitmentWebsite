import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/backend/database/prisma";
import { getHomePublicSnapshot } from "@/backend/services/home/get-home-page-context";
import { JobDiscoveryService } from "@/backend/services/jobs/job-discovery-service";
import { PrismaPublicJobRepository } from "@/backend/repositories/jobs/prisma-public-job-repository";
import { PrismaHomePublicCompanyRepository } from "@/backend/repositories/home/prisma-home-public-company-repository";
import { PrismaCompanyDiscoveryRepository } from "@/backend/repositories/companies/prisma-company-discovery-repository";
import { CompanyDiscoveryService } from "@/backend/services/companies/company-discovery-service";
import {
  findEligiblePrivateMatchJob,
  listEligiblePrivateMatchJobs,
} from "@/backend/private-cv-match/private-cv-match-service";
import {
  createJobBoardDatabaseFixture,
  deleteJobBoardDatabaseFixture,
  type JobBoardDatabaseFixture,
} from "../../../helpers/job-board-database-fixture";

const visitor = { kind: "visitor" } as const;

describe("Candidate-first Phase 4 discovery parity", () => {
  let fixture: JobBoardDatabaseFixture;
  let archivedReviewId: string | undefined;
  const now = new Date("2026-08-01T08:00:00.000Z");

  beforeAll(async () => {
    fixture = await createJobBoardDatabaseFixture("phase4-parity", now);
    const review = await prisma.jobPostReviewAggregate.create({
      data: {
        jobId: fixture.jobs.activeSecond.id,
        companyId: fixture.company.id,
        publicJobPostingId: fixture.jobs.activeSecond.id,
        visibilityState: "ARCHIVED",
      },
      select: { id: true },
    });
    archivedReviewId = review.id;
  });

  afterAll(async () => {
    if (archivedReviewId) {
      await prisma.jobPostReviewAggregate.delete({
        where: { id: archivedReviewId },
      });
    }
    if (fixture) await deleteJobBoardDatabaseFixture(fixture);
  });

  async function readSurfaces(companyId: string) {
    const jobs = new JobDiscoveryService();
    const publicJobs = new PrismaPublicJobRepository();
    const homeCompanies = new PrismaHomePublicCompanyRepository();
    const companies = new PrismaCompanyDiscoveryRepository();
    const companyDetail = new CompanyDiscoveryService();

    const [home, jobSearch, directory, privateJobs] = await Promise.all([
      getHomePublicSnapshot(
        {
          searchJobs: async (actor) =>
            (await jobs.search({ limit: 50, sort: "NEWEST" }, actor, now))
              .items,
          careerPaths: async () => [],
          listCompanies: (clock) => homeCompanies.list(clock, 50),
          countCompanies: (clock) => homeCompanies.count(clock),
        },
        now,
      ),
      jobs.search({ limit: 50, sort: "NEWEST" }, visitor, now),
      companies.list({ page: 1, limit: 50 }),
      listEligiblePrivateMatchJobs(now),
    ]);

    const detail = await companyDetail
      .detail(companyId, visitor, { limit: 50, sort: "NEWEST" }, now)
      .catch(() => null);
    const directJobs = await Promise.all(
      Object.values(fixture.jobs).map(async (job) => ({
        id: job.id,
        detail: await publicJobs.findPublicBySlug(job.slug, null, now),
        action: await publicJobs.findPublicActionTarget(job.id, now),
        private: await findEligiblePrivateMatchJob(job.id, now),
      })),
    );
    return {
      homeJobIds: home.jobs.items.map((job) => job.id),
      homeCompany: home.spotlights.items.find(
        (company) => company.slug === fixture.company.slug,
      ),
      homeCompanyCount: home.companyCount,
      jobSearchIds: jobSearch.items.map((job) => job.id),
      directoryCompany: directory.items.find(
        (company) => company.id === companyId,
      ),
      directoryTotal: directory.total,
      detailJobIds: detail?.jobs.map((job) => job.id) ?? null,
      detailOpenPositionCount: detail?.openPositionCount ?? null,
      privateJobIds: privateJobs.map((job) => job.id),
      directJobs,
    };
  }

  function expectVisible(result: Awaited<ReturnType<typeof readSurfaces>>) {
    expect(result.homeJobIds).toContain(fixture.jobs.active.id);
    expect(result.jobSearchIds).toContain(fixture.jobs.active.id);
    expect(result.directoryCompany?.id).toBe(fixture.company.id);
    expect(result.detailJobIds).toContain(fixture.jobs.active.id);
    expect(result.privateJobIds).toContain(fixture.jobs.active.id);
    expect(
      result.directJobs.find((job) => job.id === fixture.jobs.active.id),
    ).toEqual(
      expect.objectContaining({
        detail: expect.objectContaining({ id: fixture.jobs.active.id }),
        action: expect.objectContaining({ id: fixture.jobs.active.id }),
        private: expect.objectContaining({ id: fixture.jobs.active.id }),
      }),
    );
  }

  function expectHidden(result: Awaited<ReturnType<typeof readSurfaces>>) {
    expect(result.homeJobIds).not.toContain(fixture.jobs.active.id);
    expect(result.jobSearchIds).not.toContain(fixture.jobs.active.id);
    expect(result.directoryCompany).toBeUndefined();
    expect(result.detailJobIds).toBeNull();
    expect(result.privateJobIds).not.toContain(fixture.jobs.active.id);
    expect(
      result.directJobs.find((job) => job.id === fixture.jobs.active.id),
    ).toEqual(
      expect.objectContaining({ detail: null, action: null, private: null }),
    );
  }

  it("keeps visibility identical across Home, Jobs, Company, direct links, saved actions, and private picker", async () => {
    const active = await readSurfaces(fixture.company.id);
    expectVisible(active);
    expect(active.homeCompany?.openPositionCount).toBe(1);
    expect(active.directoryCompany?.openPositionCount).toBe(1);
    expect(active.detailOpenPositionCount).toBe(1);

    const discoveryHiddenIds = [
      fixture.jobs.future.id,
      fixture.jobs.pending.id,
      fixture.jobs.removed.id,
      fixture.jobs.activeSecond.id,
    ];
    for (const id of discoveryHiddenIds) {
      expect(active.jobSearchIds).not.toContain(id);
      expect(active.homeJobIds).not.toContain(id);
      expect(active.privateJobIds).not.toContain(id);
      const direct = active.directJobs.find((job) => job.id === id);
      expect(direct).toEqual(
        expect.objectContaining({ detail: null, action: null, private: null }),
      );
    }
    for (const id of [fixture.jobs.closed.id, fixture.jobs.expired.id]) {
      expect(active.jobSearchIds).not.toContain(id);
      expect(active.homeJobIds).not.toContain(id);
      expect(active.privateJobIds).not.toContain(id);
      const direct = active.directJobs.find((job) => job.id === id);
      expect(direct?.detail).toEqual(expect.objectContaining({ id }));
      expect(direct?.action).toEqual(
        expect.objectContaining({ id, acceptsApplications: false }),
      );
      expect(direct?.private).toBeNull();
    }

    for (const state of [
      {
        verificationState: "UNVERIFIED" as const,
        verifiedAt: null,
        verificationInactiveAt: null,
      },
      {
        verificationState: "INACTIVE" as const,
        verifiedAt: new Date(now.getTime() - 1_000),
        verificationInactiveAt: now,
      },
      {
        verificationState: "ACTIVE" as const,
        verifiedAt: new Date(now.getTime() - 1_000),
        verificationInactiveAt: null,
        moderationState: "BANNED" as const,
      },
    ]) {
      await prisma.company.update({
        where: { id: fixture.company.id },
        data: state,
      });
      const hidden = await readSurfaces(fixture.company.id);
      expectHidden(hidden);
    }
  });
});
