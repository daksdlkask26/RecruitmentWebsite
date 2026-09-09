import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeLegacyRecruiterJobs,
  closeRecruiterJob,
  createRecruiterJob,
  deleteRecruiterCompany,
  reactivateRecruiterJob,
  readRecruiterCompanySettings,
  readRecruiterJobManagementData,
  resolveRecruiterJobIdForNavigation,
  syncRecruiterCompanyToCatalogue,
  updateRecruiterJob,
  updateRecruiterCompanySettings,
} from "@/backend/services/jobs/recruiter-job-posting-data";
import { jobReviewSnapshotFromCatalog } from "@/backend/jobs/review/job-post-review-policy";
import { createEmptyJobPosting } from "@/shared/contracts/recruiter-job-posting";

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  temporaryWrites: new Map<string, string>(),
}));

const prismaMocks = vi.hoisted(() => {
  const transaction = {
    company: { findUnique: vi.fn(), delete: vi.fn() },
    companyMembership: { findFirst: vi.fn() },
    jobPosting: { findMany: vi.fn(), deleteMany: vi.fn() },
    jobApplication: { findMany: vi.fn(), deleteMany: vi.fn() },
    applicationDocument: { findMany: vi.fn() },
    applicationDocumentLegalHold: { findFirst: vi.fn() },
    activityLegalHold: { findFirst: vi.fn() },
    jobReport: { findFirst: vi.fn(), deleteMany: vi.fn() },
    moderationReport: { findFirst: vi.fn() },
    messagingReport: { findFirst: vi.fn(), deleteMany: vi.fn() },
    jobPostReviewAggregate: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    jobPostReviewVersion: { findMany: vi.fn(), deleteMany: vi.fn() },
    jobPostReviewHistory: { deleteMany: vi.fn() },
    jobPostReviewPrivateNote: { deleteMany: vi.fn() },
    jobPostRevisionRequest: { deleteMany: vi.fn() },
    jobPostFeaturedPlacement: { deleteMany: vi.fn() },
    jobPostEnforcementTarget: { deleteMany: vi.fn() },
    jobPostOperationalHistory: { deleteMany: vi.fn() },
    recruitmentThread: { findMany: vi.fn(), deleteMany: vi.fn() },
    messagingConversation: { findMany: vi.fn(), deleteMany: vi.fn() },
    privateCvMatchCheck: { updateMany: vi.fn(), deleteMany: vi.fn() },
    savedJob: { deleteMany: vi.fn() },
    applicationArtifactPromotion: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    companyDeletionRequest: { create: vi.fn(), update: vi.fn() },
    companyDeletionManifestEntry: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    exportRequest: { deleteMany: vi.fn() },
    aiSuggestedInterviewQuestion: { deleteMany: vi.fn() },
    applicationScoringResult: { deleteMany: vi.fn() },
    aiAssessmentAttempt: { deleteMany: vi.fn() },
    scoringWorkItem: { deleteMany: vi.fn() },
    aiAssessment: { deleteMany: vi.fn() },
    automaticMatchResult: { deleteMany: vi.fn() },
    recruiterVerificationRequest: { deleteMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    company: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    jobPostReviewAggregate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    jobPosting: {
      findUnique: vi.fn(),
    },
    applicationDocument: { findFirst: vi.fn() },
    applicationArtifactPromotion: { findFirst: vi.fn() },
    companyDeletionRequest: { findUnique: vi.fn(), update: vi.fn() },
    companyDeletionManifestEntry: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    transaction,
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
});

vi.mock("node:fs/promises", () => {
  const stat = vi.fn(async (path: string) => ({
    isFile: () => path.endsWith(".json"),
    isDirectory: () => !path.endsWith(".json"),
  }));
  const open = vi.fn(async (path: string) => ({
    writeFile: async (value: string) => {
      fsMocks.temporaryWrites.set(path, value);
    },
    sync: async () => undefined,
    close: async () => undefined,
  }));
  const rename = vi.fn(async (source: string, target: string) => {
    await fsMocks.writeFile(
      target,
      fsMocks.temporaryWrites.get(source),
      "utf8",
    );
  });
  const rm = vi.fn(async () => undefined);
  const mocked = {
    readFile: fsMocks.readFile,
    writeFile: fsMocks.writeFile,
    stat,
    open,
    rename,
    rm,
  };
  return {
    default: mocked,
    ...mocked,
  };
});

vi.mock("@/backend/database/prisma", () => ({
  prisma: prismaMocks,
}));

const company = {
  id: "company-1",
  slug: "northstar-labs",
  name: "Northstar Labs",
  logo: "https://example.com/logo.png",
  size: "51-200 employees",
  industry: "Technology",
  address: "Ho Chi Minh City",
  website: null,
  description: "A product company.",
  ownerUserId: "recruiter-1",
  memberUserIds: [],
  taxCode: "1234567890",
  verificationStatus: "approved",
};

function completeJob(id: string) {
  const job = createEmptyJobPosting("company-1");
  return {
    ...job,
    id,
    slug: id,
    title: "Product Designer",
    shortPitch: "Build thoughtful hiring experiences.",
    description: {
      ...job.description,
      overview: "Own end-to-end product design.",
    },
  };
}

describe("recruiter JSON job persistence", () => {
  beforeEach(() => {
    fsMocks.readFile.mockReset();
    fsMocks.writeFile.mockReset();
    fsMocks.writeFile.mockResolvedValue(undefined);
    fsMocks.temporaryWrites.clear();
    prismaMocks.company.findMany.mockReset();
    prismaMocks.company.findMany.mockResolvedValue([]);
    prismaMocks.company.findUnique.mockReset();
    prismaMocks.company.findUnique.mockResolvedValue(null);
    prismaMocks.company.update.mockReset();
    prismaMocks.company.update.mockResolvedValue({});
    prismaMocks.jobPostReviewAggregate.findMany.mockReset();
    prismaMocks.jobPostReviewAggregate.findMany.mockResolvedValue([]);
    prismaMocks.jobPostReviewAggregate.findUnique.mockReset();
    prismaMocks.jobPostReviewAggregate.findUnique.mockResolvedValue(null);
    prismaMocks.jobPosting.findUnique.mockReset();
    prismaMocks.jobPosting.findUnique.mockResolvedValue(null);
    for (const delegate of Object.values(prismaMocks.transaction)) {
      for (const method of Object.values(delegate)) {
        if (typeof method === "function" && "mockReset" in method) {
          method.mockReset();
        }
      }
    }
    prismaMocks.transaction.companyMembership.findFirst.mockResolvedValue({
      id: "membership-1",
    });
    prismaMocks.transaction.company.findUnique.mockResolvedValue({
      id: "db-company-1",
      verificationState: "ACTIVE",
    });
    prismaMocks.transaction.jobPosting.findMany.mockResolvedValue([]);
    prismaMocks.transaction.jobApplication.findMany.mockResolvedValue([]);
    prismaMocks.transaction.applicationDocument.findMany.mockResolvedValue([]);
    prismaMocks.transaction.applicationArtifactPromotion.findMany.mockResolvedValue(
      [],
    );
    prismaMocks.transaction.applicationDocumentLegalHold.findFirst.mockResolvedValue(
      null,
    );
    prismaMocks.transaction.activityLegalHold.findFirst.mockResolvedValue(null);
    prismaMocks.transaction.jobReport.findFirst.mockResolvedValue(null);
    prismaMocks.transaction.moderationReport.findFirst.mockResolvedValue(null);
    prismaMocks.transaction.messagingReport.findFirst.mockResolvedValue(null);
    prismaMocks.transaction.$queryRaw.mockResolvedValue([]);
    prismaMocks.transaction.companyDeletionRequest.create.mockResolvedValue({
      id: "deletion-request-1",
    });
    prismaMocks.transaction.companyDeletionRequest.update.mockResolvedValue({});
    prismaMocks.transaction.companyDeletionManifestEntry.createMany.mockResolvedValue(
      { count: 1 },
    );
    prismaMocks.transaction.companyDeletionManifestEntry.updateMany.mockResolvedValue(
      { count: 1 },
    );
    prismaMocks.transaction.jobPostReviewAggregate.findMany.mockResolvedValue(
      [],
    );
    prismaMocks.transaction.jobPostReviewVersion.findMany.mockResolvedValue([]);
    prismaMocks.transaction.recruitmentThread.findMany.mockResolvedValue([]);
    prismaMocks.transaction.messagingConversation.findMany.mockResolvedValue(
      [],
    );
    prismaMocks.transaction.company.delete.mockResolvedValue({});
    prismaMocks.transaction.auditEvent.create.mockResolvedValue({});
    prismaMocks.companyDeletionRequest.findUnique.mockResolvedValue({
      id: "deletion-request-1",
      state: "PURGING",
      purgeState: "PENDING",
      retentionEligibleAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    prismaMocks.companyDeletionManifestEntry.findMany.mockResolvedValue([]);
    prismaMocks.companyDeletionManifestEntry.count.mockResolvedValue(0);
    prismaMocks.companyDeletionManifestEntry.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaMocks.companyDeletionManifestEntry.update.mockResolvedValue({});
    prismaMocks.companyDeletionRequest.update.mockResolvedValue({});
  });

  it("maps an old public posting notification to an authorized catalogue job", async () => {
    prismaMocks.jobPosting.findUnique.mockResolvedValue({
      reviewAggregate: { jobId: "catalog-job-1" },
    });

    await expect(
      resolveRecruiterJobIdForNavigation("public-job-1", [
        { id: "catalog-job-1" },
      ]),
    ).resolves.toBe("catalog-job-1");
    expect(prismaMocks.jobPosting.findUnique).toHaveBeenCalledWith({
      where: { id: "public-job-1" },
      select: { reviewAggregate: { select: { jobId: true } } },
    });
  });

  it("does not resolve a public posting outside the authorized job projection", async () => {
    prismaMocks.jobPosting.findUnique.mockResolvedValue({
      reviewAggregate: { jobId: "other-company-job" },
    });

    await expect(
      resolveRecruiterJobIdForNavigation("public-job-1", [
        { id: "catalog-job-1" },
      ]),
    ).resolves.toBeNull();
  });

  it("exposes an admin-approved database company to recruiter settings", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: null,
        websiteUrl: null,
        publicDescription: null,
        publicLocation: null,
        size: null,
        industry: null,
        address: null,
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    const settings = await readRecruiterCompanySettings("recruiter-1");

    expect(settings).toMatchObject({
      id: "db-company-1",
      name: "Northstar Labs",
      verificationStatus: "approved",
      profileComplete: false,
      missingProfileFields: ["industry", "size", "address", "logo"],
    });
  });

  it("records the approved database company owner in the recruiter catalogue", async () => {
    prismaMocks.company.findUnique.mockResolvedValue({
      id: "db-company-new",
      slug: "new-company",
      legalName: "New Company",
      displayName: "New Company",
      logoUrl: null,
      websiteUrl: null,
      publicDescription: null,
      publicLocation: "Ho Chi Minh City",
      size: null,
      industry: null,
      address: null,
      entityType: null,
      normalizedTaxIdentifier: "9876543210",
      memberships: [
        { userId: "invited-recruiter", role: "OWNER" },
        { userId: "existing-recruiter", role: "RECRUITER" },
      ],
    });
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    await expect(
      syncRecruiterCompanyToCatalogue("db-company-new"),
    ).resolves.toMatchObject({
      synced: true,
      companyId: "db-company-new",
    });

    const companiesWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("companies.json"),
    );
    expect(JSON.parse(String(companiesWrite?.[1]))).toContainEqual(
      expect.objectContaining({
        id: "db-company-new",
        ownerUserId: "invited-recruiter",
        memberUserIds: ["invited-recruiter", "existing-recruiter"],
        verificationStatus: "approved",
      }),
    );
  });

  it("keeps a registry entity type out of the company display name", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-2",
        slug: "vnpt",
        legalName:
          "TẬP ĐOÀN BƯU CHÍNH VIỄN THÔNG VIỆT NAM (LOẠI HÌNH DOANH NGHIỆP: CÔNG TY TNHH)",
        displayName:
          "TẬP ĐOÀN BƯU CHÍNH VIỄN THÔNG VIỆT NAM (LOẠI HÌNH DOANH NGHIỆP: CÔNG TY TNHH)",
        logoUrl: null,
        websiteUrl: null,
        publicDescription: null,
        publicLocation: null,
        size: null,
        industry: null,
        address: null,
        entityType: null,
        normalizedTaxIdentifier: "0100684378",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    await expect(
      readRecruiterCompanySettings("recruiter-1"),
    ).resolves.toMatchObject({
      name: "TẬP ĐOÀN BƯU CHÍNH VIỄN THÔNG VIỆT NAM",
      entityType: "CÔNG TY TNHH",
    });
  });

  it("allows an approved database member to open job posting management", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: "https://example.com/logo.png",
        websiteUrl: "https://northstar.example.com",
        publicDescription: "A product company.",
        publicLocation: "Ho Chi Minh City",
        size: "51-200 employees",
        industry: "Technology",
        address: "Ho Chi Minh City",
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    const data = await readRecruiterJobManagementData("recruiter-1");

    expect(data.recruiterUserId).toBe("recruiter-1");
    expect(data.companyId).toBe("db-company-1");
    expect(data.companies).toHaveLength(1);
    expect(data.companyProfileComplete).toBe(true);
  });

  it("keeps an unassigned submitted job in pending approval", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: "https://example.com/logo.png",
        websiteUrl: "https://northstar.example.com",
        publicDescription: "A product company.",
        publicLocation: "Ho Chi Minh City",
        size: "51-200 employees",
        industry: "Technology",
        address: "Ho Chi Minh City",
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    const pendingJob = {
      ...completeJob("pending-job"),
      companyId: "db-company-1",
    };
    const pendingVersion = {
      id: "pending-version-1",
      sequence: 1,
      state: "PENDING_REVIEW",
      reasonCode: null,
      publicExplanation: null,
      submittedAt: new Date("2026-08-25T00:00:00Z"),
      decidedAt: null,
      snapshot: jobReviewSnapshotFromCatalog(pendingJob, "db-company-1"),
    };
    prismaMocks.jobPostReviewAggregate.findMany.mockResolvedValue([
      {
        jobId: pendingJob.id,
        companyId: "db-company-1",
        version: 1,
        pendingVersion,
        versions: [pendingVersion],
        correctionRequests: [],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([pendingJob]);
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    const data = await readRecruiterJobManagementData("recruiter-1");

    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0]).toMatchObject({
      id: "pending-job",
      status: "pending_approval",
      review: {
        reviewId: "pending-version-1",
        state: "PENDING_REVIEW",
        readOnly: true,
      },
    });
  });

  it("projects a closed aggregate as closed even when its approved version is current", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: "https://example.com/logo.png",
        websiteUrl: "https://northstar.example.com",
        publicDescription: "A product company.",
        publicLocation: "Ho Chi Minh City",
        size: "51-200 employees",
        industry: "Technology",
        address: "Ho Chi Minh City",
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    const closedJob = {
      ...completeJob("closed-job"),
      companyId: "db-company-1",
      status: "active" as const,
    };
    const approvedVersion = {
      id: "approved-version-1",
      sequence: 1,
      state: "APPROVED",
      reasonCode: null,
      publicExplanation: null,
      submittedAt: new Date("2026-08-25T00:00:00Z"),
      decidedAt: new Date("2026-08-25T01:00:00Z"),
      snapshot: jobReviewSnapshotFromCatalog(closedJob, "db-company-1"),
    };
    prismaMocks.jobPostReviewAggregate.findMany.mockResolvedValue([
      {
        jobId: closedJob.id,
        companyId: "db-company-1",
        version: 3,
        closedAt: new Date("2026-08-25T02:00:00Z"),
        pendingVersion: null,
        versions: [approvedVersion],
        correctionRequests: [],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([closedJob]);
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    const data = await readRecruiterJobManagementData("recruiter-1");

    expect(data.jobs[0]).toMatchObject({
      id: "closed-job",
      status: "closed",
      review: { state: "APPROVED" },
    });
  });

  it("keeps the current JSON draft timestamp after a review is withdrawn", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: "https://example.com/logo.png",
        websiteUrl: "https://northstar.example.com",
        publicDescription: "A product company.",
        publicLocation: "Ho Chi Minh City",
        size: "51-200 employees",
        industry: "Technology",
        address: "Ho Chi Minh City",
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    const submittedJob = {
      ...completeJob("withdrawn-job"),
      companyId: "db-company-1",
      title: "Submitted title",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const workingDraft = {
      ...submittedJob,
      title: "Current draft title",
      status: "draft" as const,
      updatedAt: "2026-08-25T02:00:00.000Z",
    };
    const withdrawnVersion = {
      id: "withdrawn-version-1",
      sequence: 1,
      state: "WITHDRAWN",
      reasonCode: null,
      publicExplanation: null,
      submittedAt: new Date("2026-08-25T00:00:00.000Z"),
      decidedAt: new Date("2026-08-25T01:00:00.000Z"),
      snapshot: jobReviewSnapshotFromCatalog(submittedJob, "db-company-1"),
    };
    prismaMocks.jobPostReviewAggregate.findMany.mockResolvedValue([
      {
        jobId: workingDraft.id,
        companyId: "db-company-1",
        version: 2,
        pendingVersion: null,
        versions: [withdrawnVersion],
        correctionRequests: [],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([workingDraft]);
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    const data = await readRecruiterJobManagementData("recruiter-1");

    expect(data.jobs[0]).toMatchObject({
      id: "withdrawn-job",
      title: "Current draft title",
      status: "draft",
      updatedAt: "2026-08-25T02:00:00.000Z",
      review: { state: "WITHDRAWN", readOnly: false },
    });
  });

  it("freshly aggregates jobs across every active company membership", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: null,
        websiteUrl: null,
        publicDescription: null,
        publicLocation: "Ho Chi Minh City",
        size: "51-200 employees",
        industry: "Technology",
        address: "Ho Chi Minh City",
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
      {
        id: "db-company-2",
        slug: "second-company",
        legalName: "Second Company",
        displayName: "Second Company",
        logoUrl: null,
        websiteUrl: null,
        publicDescription: null,
        publicLocation: "Hanoi",
        size: "51-200 employees",
        industry: "Technology",
        address: "Hanoi",
        entityType: null,
        normalizedTaxIdentifier: "9876543210",
        memberships: [{ userId: "recruiter-1", role: "RECRUITER" }],
      },
    ]);
    const firstJob = {
      ...completeJob("job-company-1"),
      companyId: "db-company-1",
    };
    const secondJob = {
      ...completeJob("job-company-2"),
      companyId: "db-company-2",
    };
    let jobsText = JSON.stringify([firstJob, secondJob]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return jobsText;
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    const firstRead = await readRecruiterJobManagementData("recruiter-1");
    expect(firstRead.jobs.map((job) => job.id)).toEqual([
      "job-company-1",
      "job-company-2",
    ]);

    const newJob = {
      ...completeJob("job-company-2-new"),
      companyId: "db-company-2",
      stats: { viewCount: 3, applicantCount: 17 },
    };
    jobsText = JSON.stringify([firstJob, secondJob, newJob]);
    const refreshedRead = await readRecruiterJobManagementData("recruiter-1");

    expect(refreshedRead.jobs.map((job) => job.id)).toEqual([
      "job-company-1",
      "job-company-2",
      "job-company-2-new",
    ]);
    expect(
      refreshedRead.jobs.find((job) => job.id === "job-company-2-new"),
    ).toMatchObject({
      companyId: "db-company-2",
      stats: { applicantCount: 17 },
    });
  });

  it("creates and updates a draft for the selected authorized company", async () => {
    const secondCompany = {
      ...company,
      id: "company-2",
      slug: "second-company",
      name: "Second Company",
      ownerUserId: null,
      memberUserIds: ["recruiter-1"],
      taxCode: "9876543210",
    };
    const secondCompanyJob = {
      ...completeJob("second-company-job"),
      companyId: "company-2",
      status: "draft" as const,
    };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([secondCompanyJob]);
      if (path.endsWith("companies.json"))
        return JSON.stringify([company, secondCompany]);
      throw new Error("Unexpected mock path: " + path);
    });

    const created = await createRecruiterJob(
      "recruiter-1",
      { ...completeJob("new-second-company-job"), companyId: "company-2" },
      "draft",
    );
    expect(created).toMatchObject({
      companyId: "company-2",
      company: { id: "company-2", role: "MEMBER" },
    });

    const updated = await updateRecruiterJob("recruiter-1", {
      ...secondCompanyJob,
      title: "Updated second-company role",
    });
    expect(updated).toMatchObject({
      id: "second-company-job",
      companyId: "company-2",
      company: { id: "company-2", role: "MEMBER" },
      title: "Updated second-company role",
    });
  });

  it("uses active database membership when legacy catalog membership is stale", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: null,
        websiteUrl: null,
        publicDescription: null,
        publicLocation: "Ho Chi Minh City",
        size: "51-200 employees",
        industry: "Technology",
        address: "Ho Chi Minh City",
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "RECRUITER" }],
      },
    ]);
    const catalogCompany = {
      ...company,
      ownerUserId: null,
      memberUserIds: [],
      verificationStatus: "pending",
    };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) {
        return JSON.stringify([
          { ...completeJob("legacy-job"), companyId: company.id },
        ]);
      }
      if (path.endsWith("companies.json")) {
        return JSON.stringify([catalogCompany]);
      }
      throw new Error("Unexpected mock path: " + path);
    });

    await expect(
      authorizeLegacyRecruiterJobs("recruiter-1", ["legacy-job"]),
    ).resolves.toEqual(
      new Map([
        [
          "legacy-job",
          {
            jobId: "legacy-job",
            companyId: company.id,
            jobTitle: "Product Designer",
          },
        ],
      ]),
    );
  });

  it("saves a complete profile for a database-backed company", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "dava",
        legalName: "Dava",
        displayName: "Dava",
        logoUrl: "https://example.com/old-logo.png",
        websiteUrl: "https://example.com/old",
        publicDescription: "Old description",
        publicLocation: "Ho Chi Minh City",
        size: "1-50 employees",
        industry: "Game Development",
        address: "Ho Chi Minh, District 8",
        entityType: null,
        normalizedTaxIdentifier: "2000000000",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    const saved = await updateRecruiterCompanySettings("recruiter-1", {
      name: "Dava",
      industry: "Game Development",
      size: "1-50 employees",
      address: "Ho Chi Minh, District 8",
      logo: "https://example.com/dava-logo.png",
      website: "https://example.com/Dava",
      description: "A verified SmartHire employer.",
    });

    expect(saved.profileComplete).toBe(true);
    expect(saved.missingProfileFields).toEqual([]);
    const companiesWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("companies.json"),
    );
    expect(companiesWrite).toBeDefined();
    expect(JSON.parse(String(companiesWrite?.[1]))).toContainEqual(
      expect.objectContaining({
        id: "db-company-1",
        name: "Dava",
        taxCode: "2000000000",
      }),
    );
    expect(prismaMocks.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "db-company-1" } }),
    );
  });

  it("deletes a legacy company, its jobs, and its applications", async () => {
    const job = completeJob("legacy-job-1");
    const application = {
      id: "legacy-application-1",
      jobId: job.id,
      userId: "candidate-1",
      appliedAt: "2026-01-01T00:00:00.000Z",
      status: "applied",
    };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([job]);
      if (path.endsWith("companies.json")) return JSON.stringify([company]);
      if (path.endsWith("applications.json"))
        return JSON.stringify([application]);
      throw new Error("Unexpected mock path: " + path);
    });

    await expect(
      deleteRecruiterCompany("recruiter-1", company.id),
    ).resolves.toEqual({ companyId: company.id, deleted: true });

    const companiesWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("companies.json"),
    );
    expect(JSON.parse(String(companiesWrite?.[1]))).toEqual([]);
    const jobsWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("jobs.json"),
    );
    expect(JSON.parse(String(jobsWrite?.[1]))).toEqual([]);
    const applicationsWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("applications.json"),
    );
    expect(JSON.parse(String(applicationsWrite?.[1]))).toEqual([]);
  });

  it("hard-deletes an approved database company instead of deactivating it", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: null,
        websiteUrl: null,
        publicDescription: null,
        publicLocation: null,
        size: "51-200 employees",
        industry: "Technology",
        address: "Ho Chi Minh City",
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    await expect(
      deleteRecruiterCompany("recruiter-1", "db-company-1"),
    ).resolves.toEqual({ companyId: "db-company-1", deleted: true });

    expect(prismaMocks.transaction.company.delete).toHaveBeenCalledWith({
      where: { id: "db-company-1" },
    });
    expect(prismaMocks.transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "company.deleted",
          targetId: "db-company-1",
          context: expect.objectContaining({
            deletionResult: "HARD_DELETED",
            resultingState: "DELETED",
          }),
        }),
      }),
    );
    expect(prismaMocks.company.update).not.toHaveBeenCalled();
  });

  it("records a deletion request and blocks all physical deletion under an active legal hold", async () => {
    prismaMocks.company.findMany.mockResolvedValue([
      {
        id: "db-company-1",
        slug: "northstar-labs",
        legalName: "Northstar Labs",
        displayName: "Northstar Labs",
        logoUrl: null,
        websiteUrl: null,
        publicDescription: null,
        publicLocation: null,
        size: "51-200 employees",
        industry: "Technology",
        address: "Ho Chi Minh City",
        entityType: null,
        normalizedTaxIdentifier: "1234567890",
        memberships: [{ userId: "recruiter-1", role: "OWNER" }],
      },
    ]);
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });
    prismaMocks.transaction.jobPosting.findMany.mockResolvedValue([
      { id: "job-1" },
    ]);
    prismaMocks.transaction.jobApplication.findMany.mockResolvedValue([
      { id: "application-1" },
    ]);
    prismaMocks.transaction.applicationDocument.findMany.mockResolvedValue([
      {
        id: "document-1",
        storageKeyEncrypted: "application-locator-1",
        storagePurposeVersion: "application-document-v1",
        sourceArtifactId: null,
      },
    ]);
    prismaMocks.transaction.applicationDocumentLegalHold.findFirst.mockResolvedValue(
      { id: "hold-1" },
    );

    await expect(
      deleteRecruiterCompany("recruiter-1", "db-company-1"),
    ).resolves.toEqual({
      companyId: "db-company-1",
      deleted: false,
      status: "BLOCKED_BY_LEGAL_HOLD",
      requestId: "deletion-request-1",
    });
    expect(prismaMocks.transaction.company.delete).not.toHaveBeenCalled();
    expect(
      prismaMocks.transaction.jobApplication.deleteMany,
    ).not.toHaveBeenCalled();
    expect(
      prismaMocks.transaction.companyDeletionRequest.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "BLOCKED_BY_LEGAL_HOLD",
          holdState: "ACTIVE",
          purgeState: "BLOCKED",
        }),
      }),
    );
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ["job", "jobReport", "JOB_REPORT_ACTIVE"],
    ["moderation", "moderationReport", "MODERATION_REPORT_ACTIVE"],
    ["messaging", "messagingReport", "MESSAGING_REPORT_ACTIVE"],
  ] as const)(
    "blocks company deletion when an active %s report requires retention",
    async (_kind, source, code) => {
      prismaMocks.company.findMany.mockResolvedValue([
        {
          id: "db-company-1",
          slug: "northstar-labs",
          legalName: "Northstar Labs",
          displayName: "Northstar Labs",
          logoUrl: null,
          websiteUrl: null,
          publicDescription: null,
          publicLocation: null,
          size: "51-200 employees",
          industry: "Technology",
          address: "Ho Chi Minh City",
          entityType: null,
          normalizedTaxIdentifier: "1234567890",
          memberships: [{ userId: "recruiter-1", role: "OWNER" }],
        },
      ]);
      fsMocks.readFile.mockImplementation(async (path: string) => {
        if (path.endsWith("jobs.json")) return "[]";
        if (path.endsWith("companies.json")) return "[]";
        throw new Error("Unexpected mock path: " + path);
      });
      if (source === "jobReport") {
        prismaMocks.transaction.jobPosting.findMany.mockResolvedValue([
          { id: "job-1" },
        ]);
        prismaMocks.transaction.jobReport.findFirst.mockResolvedValue({
          id: "report-1",
        });
      } else if (source === "messagingReport") {
        prismaMocks.transaction.recruitmentThread.findMany.mockResolvedValue([
          { id: "thread-1" },
        ]);
        prismaMocks.transaction.messagingReport.findFirst.mockResolvedValue({
          id: "report-1",
        });
      } else {
        prismaMocks.transaction.moderationReport.findFirst.mockResolvedValue({
          id: "report-1",
        });
      }

      await expect(
        deleteRecruiterCompany("recruiter-1", "db-company-1"),
      ).resolves.toMatchObject({
        companyId: "db-company-1",
        deleted: false,
        status: "BLOCKED_BY_LEGAL_HOLD",
        requestId: "deletion-request-1",
      });
      expect(prismaMocks.transaction.company.delete).not.toHaveBeenCalled();
      expect(prismaMocks.transaction.companyDeletionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            holdState: "ACTIVE",
            purgeState: "BLOCKED",
            lastFailureCode: code,
          }),
        }),
      );
    },
  );

  it("rejects company deletion for an authorized non-owner", async () => {
    const memberCompany = {
      ...company,
      ownerUserId: "another-recruiter",
      memberUserIds: ["recruiter-1"],
    };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json"))
        return JSON.stringify([memberCompany]);
      throw new Error("Unexpected mock path: " + path);
    });

    await expect(
      deleteRecruiterCompany("recruiter-1", memberCompany.id),
    ).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    expect(
      fsMocks.writeFile.mock.calls.some(([path]) =>
        String(path).endsWith("companies.json"),
      ),
    ).toBe(false);
  });

  it("persists every expanded jobs.json field for a recruiter posting", async () => {
    const job = completeJob("new-job");
    job.salary = {
      min: 29_000_000,
      max: 33_000_000,
      currency: "VND",
      period: "month",
      isNegotiable: true,
    };
    job.experience = { minYears: 3, label: "3+ years" };
    job.level = "senior";
    job.employmentType = "contract";
    job.workOnSaturday = true;
    job.education = "Bachelor's degree or above";
    job.age = "24-35";
    job.numberOfHires = 3;
    job.isUrgent = true;
    job.location = {
      city: "Ho Chi Minh City",
      district: null,
      isNationwideRemote: true,
    };
    job.description = {
      overview: "Own end-to-end product design.",
      topReasonsToJoin: ["Own meaningful product decisions"],
      responsibilities: ["Own platform reliability"],
      requirements: ["Strong TypeScript"],
      benefits: [{ icon: "gift", label: "Holiday and Tet bonus" }],
      generalInfo: {
        reportsTo: "Head of Engineering",
        department: "Engineering",
        workingHours: "Monday-Friday, 9:00-18:00",
        workAddress: "District 1, Ho Chi Minh City",
      },
    };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json")) return JSON.stringify([company]);
      if (path.endsWith("applications.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    await createRecruiterJob("recruiter-1", job, "draft");

    const jobWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("jobs.json"),
    );
    const persisted = JSON.parse(String(jobWrite?.[1])) as Array<typeof job>;
    expect(persisted.at(-1)).toMatchObject({
      salary: job.salary,
      experience: job.experience,
      level: "senior",
      employmentType: "contract",
      workOnSaturday: true,
      education: "Bachelor's degree or above",
      age: "24-35",
      numberOfHires: 3,
      isUrgent: true,
      location: job.location,
      description: {
        ...job.description,
        generalInfo: {
          ...job.description.generalInfo,
          department: "Software Development",
        },
      },
    });
  });

  it("persists an incomplete recruiter draft with a stable fallback slug", async () => {
    const draft = createEmptyJobPosting("company-1");
    draft.subIndustry = "";
    draft.shortPitch = "";
    draft.location.city = "";
    draft.description.overview = "";
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return "[]";
      if (path.endsWith("companies.json")) return JSON.stringify([company]);
      if (path.endsWith("applications.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    const saved = await createRecruiterJob("recruiter-1", draft, "draft");

    expect(saved).toMatchObject({
      title: "",
      shortPitch: "",
      subIndustry: "",
      location: { city: "" },
      description: { overview: "" },
      status: "draft",
    });
    expect(saved.slug).toMatch(/^untitled-job-remote-/u);
  });
  it("appends a posting without normalizing untouched legacy job statuses", async () => {
    const existing = { ...completeJob("legacy-job"), status: "open" };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([existing]);
      if (path.endsWith("companies.json")) return JSON.stringify([company]);
      if (path.endsWith("applications.json")) return "[]";
      throw new Error("Unexpected mock path: " + path);
    });

    await createRecruiterJob("recruiter-1", completeJob("new-job"), "draft");

    const jobWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("jobs.json"),
    );
    expect(jobWrite).toBeDefined();
    const persisted = JSON.parse(String(jobWrite?.[1])) as Array<{
      id: string;
      status: string;
    }>;
    expect(persisted[0]).toMatchObject({
      id: "legacy-job",
      status: "open",
    });
    expect(persisted.at(-1)?.status).toBe("draft");
  });

  it("updates an approved recruiter projection without persisting review metadata", async () => {
    const existing = {
      ...completeJob("approved-job"),
      status: "active" as const,
      applyDeadline: "2099-12-31T23:59:59.000Z",
    };
    const recruiterProjection = {
      ...existing,
      company,
      review: {
        reviewId: "review-1",
        jobId: existing.id,
        sequence: 1,
        state: "APPROVED" as const,
        readOnly: false,
        reasonCode: null,
        publicExplanation: null,
        submittedAt: "2026-08-18T00:00:00.000Z",
        decidedAt: "2026-08-18T01:00:00.000Z",
        version: 1,
      },
      correctionRequest: {
        id: "correction-1",
        publicExplanation: "Keep the approved version live.",
        hideImmediately: false,
        createdAt: "2026-08-18T02:00:00.000Z",
      },
      previousIndustryCode: existing.industryCode,
      title: "Updated Product Designer",
    };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([existing]);
      if (path.endsWith("companies.json")) return JSON.stringify([company]);
      throw new Error("Unexpected mock path: " + path);
    });

    const saved = await updateRecruiterJob("recruiter-1", recruiterProjection);

    expect(saved.title).toBe("Updated Product Designer");
    const jobWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("jobs.json"),
    );
    const persisted = JSON.parse(String(jobWrite?.[1])) as Array<
      Record<string, unknown>
    >;
    expect(persisted[0]).not.toHaveProperty("review");
    expect(persisted[0]).not.toHaveProperty("correctionRequest");
    expect(persisted[0]).not.toHaveProperty("company");
  });

  it("closes an active recruiter job and persists only the lifecycle change", async () => {
    const existing = {
      ...completeJob("close-job"),
      status: "active" as const,
    };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([existing]);
      if (path.endsWith("companies.json")) return JSON.stringify([company]);
      throw new Error("Unexpected mock path: " + path);
    });

    const saved = await closeRecruiterJob("recruiter-1", existing.id, "r03");

    expect(saved).toMatchObject({ id: existing.id, status: "closed" });
    const jobWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("jobs.json"),
    );
    const persisted = JSON.parse(String(jobWrite?.[1])) as Array<
      Record<string, unknown>
    >;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: existing.id,
      status: "closed",
    });
  });

  it("reactivates a closed recruiter job and persists only the lifecycle change", async () => {
    const existing = {
      ...completeJob("reactivate-job"),
      status: "closed" as const,
    };
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("jobs.json")) return JSON.stringify([existing]);
      if (path.endsWith("companies.json")) return JSON.stringify([company]);
      throw new Error("Unexpected mock path: " + path);
    });

    const saved = await reactivateRecruiterJob(
      "recruiter-1",
      existing.id,
      "r03",
    );

    expect(saved).toMatchObject({ id: existing.id, status: "active" });
    const jobWrite = fsMocks.writeFile.mock.calls.find(([path]) =>
      String(path).endsWith("jobs.json"),
    );
    const persisted = JSON.parse(String(jobWrite?.[1])) as Array<
      Record<string, unknown>
    >;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: existing.id,
      status: "active",
    });
  });
});
