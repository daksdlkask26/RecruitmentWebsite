import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/backend/database/prisma";
import { CandidateApplicationTrackingService } from "@/backend/candidate-applications/candidate-application-tracking-service";
import { PrismaCandidateApplicationRepository } from "@/backend/repositories/candidate-applications/prisma-candidate-application-repository";
import { PrismaTeamApplicationRepository } from "@/backend/repositories/company-members/prisma-team-application-repository";
import { TeamApplicationService } from "@/backend/services/company-members/team-application-service";
import { TeamApplicationOwnerService } from "@/backend/services/company-members/team-application-owner-service";
import { openTeamApplicationCv } from "@/backend/services/company-members/team-application-cv-service";
import type { Prisma } from "@/backend/generated/prisma/client";
import { assertTestDatabaseEnvironment } from "../../../helpers/test-database-guard";
import { createJobBoardDatabaseFixture } from "../../../helpers/job-board-database-fixture";

const fixtureNow = new Date("2026-09-11T03:00:00.000Z");
const equalSubmittedAt = new Date("2026-09-10T10:00:00.000Z");
const candidateStatuses = [
  "SUBMITTED",
  "VIEWED",
  "REJECTED",
  "INVITATION_SENT",
  "WITHDRAWN",
  "JOINED",
] as const;
const ordinaryStages = [
  "APPLIED",
  "VIEWED",
  "SHORTLISTED",
  "INTERVIEWING",
  "OFFERED",
  "HIRED",
  "OFFER_DECLINED",
  "REJECTED",
  "WAITLISTED",
] as const;

type CandidateFixture = { userId: string; cvId: string };
type CompanyFixture = {
  id: string;
  roleIds: Record<"HR_MANAGER" | "RECRUITER", string>;
};

let databaseFixture: Awaited<
  ReturnType<
    typeof import("../../../helpers/job-board-database-fixture").createJobBoardDatabaseFixture
  >
>;
let candidateA: CandidateFixture;
let candidateB: CandidateFixture;
let candidateEmpty: CandidateFixture;
let candidate24: CandidateFixture;
let candidate25: CandidateFixture;
let candidate100: CandidateFixture;
let candidate101: CandidateFixture;
let activeCompanies: CompanyFixture[];
let inactiveCompanyId: string;
let removedMembershipCompanyId: string;
let inactiveCompanyScope: CompanyFixture;
let removedMembershipCompanyScope: CompanyFixture;
let ordinaryJobIds: string[] = [];
const ordinaryIds = new Map<string, string[]>();
const teamIds = new Map<string, string[]>();

const candidateRepository = new PrismaCandidateApplicationRepository();
const candidateService = new CandidateApplicationTrackingService(
  candidateRepository,
);
const teamRepository = new PrismaTeamApplicationRepository();
const teamService = new TeamApplicationService(teamRepository);
const ownerService = new TeamApplicationOwnerService(teamRepository);

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function createExtraCandidate(key: string): Promise<CandidateFixture> {
  assertTestDatabaseEnvironment();
  const userId = `phase3-candidate-${key}-${databaseFixture.suffix}`;
  const cvId = `phase3-cv-${key}-${databaseFixture.suffix}`;
  const email = `${userId}@example.test`;
  await prisma.userAccount.create({
    data: {
      id: userId,
      name: `Phase 3 Candidate ${key}`,
      email,
      normalizedEmail: email,
      emailVerified: true,
      state: "ACTIVE",
      candidateIdentity: {
        create: {
          profile: {
            create: {
              headline: "Pagination test candidate",
              location: "Ho Chi Minh City",
              summary: "Isolated Candidate-first pagination fixture.",
            },
          },
          cvs: {
            create: {
              id: cvId,
              displayName: "Pagination CV",
              fileName: "pagination.pdf",
              mimeType: "application/pdf",
              byteSize: 32_000,
              storageKey: `phase3/${databaseFixture.suffix}/${key}.pdf`,
              checksumSha256: digest(`${databaseFixture.suffix}:${key}`),
              confirmedAt: fixtureNow,
            },
          },
        },
      },
    },
  });
  return { userId, cvId };
}

async function createCompany(
  key: string,
  state: "ACTIVE" | "INACTIVE" = "ACTIVE",
) {
  assertTestDatabaseEnvironment();
  return prisma.company.create({
    data: {
      id: `phase3-company-${key}-${databaseFixture.suffix}`,
      slug: `phase3-company-${key}-${databaseFixture.suffix}`,
      legalName: `Phase 3 ${key} Ltd`,
      displayName: `Phase 3 ${key}`,
      publicDescription: "Isolated Candidate-first pagination fixture.",
      publicLocation: "Ho Chi Minh City",
      verifiedAt: state === "ACTIVE" ? fixtureNow : null,
      verificationState: state,
      verificationInactiveAt: state === "ACTIVE" ? null : fixtureNow,
      moderationState: "ACTIVE",
    },
  });
}

async function createCompanyScopes() {
  assertTestDatabaseEnvironment();
  const baseCompany = databaseFixture.company;
  const company2 = await createCompany("two");
  const company3 = await createCompany("three");
  const inactive = await createCompany("inactive", "INACTIVE");
  const removed = await createCompany("removed");
  const companies = [baseCompany, company2, company3];
  const roleIds = new Map<string, Record<"HR_MANAGER" | "RECRUITER", string>>();
  for (const company of [...companies, inactive, removed]) {
    const roles = {
      HR_MANAGER: `phase3-opportunity-hr-${company.id}`,
      RECRUITER: `phase3-opportunity-recruiter-${company.id}`,
    };
    await prisma.teamOpportunity.createMany({
      data: [
        { id: roles.HR_MANAGER, companyId: company.id, role: "HR_MANAGER" },
        { id: roles.RECRUITER, companyId: company.id, role: "RECRUITER" },
      ],
    });
    roleIds.set(company.id, roles);
  }
  await prisma.companyMembership.createMany({
    data: [
      ...companies.map((company) => ({
        companyId: company.id,
        userId: databaseFixture.userIds[1]!,
        role: "OWNER" as const,
        priorApprovedRole: "OWNER" as const,
        status: "ACTIVE" as const,
      })),
      {
        companyId: inactive.id,
        userId: databaseFixture.userIds[1]!,
        role: "OWNER" as const,
        priorApprovedRole: "OWNER" as const,
        status: "SUSPENDED" as const,
      },
      {
        companyId: removed.id,
        userId: databaseFixture.userIds[1]!,
        role: "OWNER" as const,
        priorApprovedRole: "OWNER" as const,
        status: "REMOVED" as const,
        removedAt: fixtureNow,
      },
    ],
  });
  activeCompanies = companies.map((company) => ({
    id: company.id,
    roleIds: roleIds.get(company.id)!,
  }));
  inactiveCompanyId = inactive.id;
  removedMembershipCompanyId = removed.id;
  inactiveCompanyScope = {
    id: inactive.id,
    roleIds: roleIds.get(inactive.id)!,
  };
  removedMembershipCompanyScope = {
    id: removed.id,
    roleIds: roleIds.get(removed.id)!,
  };
}

async function createOrdinaryJobs() {
  assertTestDatabaseEnvironment();
  const source = databaseFixture.jobs.active;
  const rows = Array.from({ length: 210 }, (_, index) => ({
    id: `phase3-job-${String(index + 1).padStart(3, "0")}-${databaseFixture.suffix}`,
    companyId: databaseFixture.company.id,
    industryId: source.industryId,
    subIndustryId: source.subIndustryId,
    industryCode: source.industryCode,
    subIndustryCode: source.subIndustryCode,
    slug: `phase3-job-${String(index + 1).padStart(3, "0")}-${databaseFixture.suffix}`,
    title: `Phase 3 Pagination Job ${index + 1}`,
    normalizedTitle: `phase 3 pagination job ${index + 1}`,
    summary: "Isolated pagination fixture job.",
    description: "Isolated pagination fixture job.",
    responsibilities: "Isolated pagination fixture job.",
    requirements: "Isolated pagination fixture job.",
    benefits: "Isolated pagination fixture job.",
    education: null,
    numberOfHires: 1,
    age: null,
    location: source.location,
    normalizedLocation: source.normalizedLocation,
    employmentType: source.employmentType,
    experienceLevel: source.experienceLevel,
    workArrangement: source.workArrangement,
    salaryMin: source.salaryMin,
    salaryMax: source.salaryMax,
    salaryCurrency: source.salaryCurrency,
    salaryPeriod: source.salaryPeriod,
    searchDocumentNormalized: "phase 3 pagination fixture",
    status: "ACTIVE" as const,
    approvedAt: fixtureNow,
    publishedAt: fixtureNow,
    applicationDeadline: new Date(fixtureNow.getTime() + 86_400_000),
    version: 1,
  }));
  await prisma.jobPosting.createMany({ data: rows });
  ordinaryJobIds = rows.map((row) => row.id);
}

function ordinaryRows(
  candidate: CandidateFixture,
  prefix: string,
  count: number,
  includeStatusMix: boolean,
): Prisma.JobApplicationCreateManyInput[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const stage = includeStatusMix
      ? ordinaryStages[index % ordinaryStages.length]
      : "APPLIED";
    const withdrawn = includeStatusMix && index % 11 === 0;
    return {
      id: `${prefix}-n${String(number).padStart(4, "0")}`,
      candidateUserId: candidate.userId,
      jobPostingId: ordinaryJobIds[Math.floor(index / 5)]!,
      applicationAttemptNumber: (index % 5) + 1,
      selectedCvId: candidate.cvId,
      cvFileRef: `phase3/${prefix}.pdf`,
      contactSnapshot: {
        fullName: `Candidate ${candidate.userId}`,
        email: `${candidate.userId}@example.test`,
        phone: "0900000000",
        location: "Ho Chi Minh City",
      },
      scoringStatus: "NOT_REQUESTED",
      stage,
      stageVersion: 1,
      lastStageChangedAt: equalSubmittedAt,
      withdrawalOutcome: withdrawn ? "CANDIDATE_WITHDRAWN" : null,
      withdrawnAt: withdrawn ? equalSubmittedAt : null,
      withdrawnByUserId: withdrawn ? candidate.userId : null,
      withdrawalVersion: withdrawn ? 1 : null,
      profileSnapshot: { candidateName: `Candidate ${candidate.userId}` },
      cvSnapshot: {
        cvId: candidate.cvId,
        displayName: "Pagination CV",
        fileName: "pagination.pdf",
        mimeType: "application/pdf",
        byteSize: 32_000,
        cvVersion: 1,
      },
      jobSnapshot: {
        title: databaseFixture.jobs.active.title,
        companyName: databaseFixture.company.displayName,
        location: databaseFixture.jobs.active.location,
        employmentType: databaseFixture.jobs.active.employmentType,
        experienceLevel: databaseFixture.jobs.active.experienceLevel,
        workArrangement: databaseFixture.jobs.active.workArrangement,
        jobVersion: databaseFixture.jobs.active.version,
      },
      consentVersion: "phase3",
      consentedAt: equalSubmittedAt,
      idempotencyKey: `phase3-idempotency-${prefix}-${number}`,
      submissionBindingDigest: digest(`${prefix}:${number}`),
      submittedAt: equalSubmittedAt,
    };
  });
}

async function createOrdinaryFixtures() {
  assertTestDatabaseEnvironment();
  const groups = [
    {
      candidate: candidateEmpty,
      prefix: "phase3-empty",
      count: 0,
      mixed: false,
    },
    { candidate: candidateB, prefix: "phase3-one", count: 1, mixed: false },
    { candidate: candidate24, prefix: "phase3-24", count: 24, mixed: false },
    { candidate: candidate25, prefix: "phase3-25", count: 25, mixed: false },
    { candidate: candidate100, prefix: "phase3-100", count: 100, mixed: false },
    { candidate: candidate101, prefix: "phase3-101", count: 101, mixed: false },
    {
      candidate: candidateA,
      prefix: `phase3-1000-${databaseFixture.suffix}`,
      count: 1_000,
      mixed: true,
    },
  ];
  for (const group of groups) {
    const rows = ordinaryRows(
      group.candidate,
      group.prefix,
      group.count,
      group.mixed,
    );
    if (rows.length) await prisma.jobApplication.createMany({ data: rows });
    ordinaryIds.set(
      group.candidate.userId,
      rows.map((row) => row.id!),
    );
  }
}

function teamRows(
  company: CompanyFixture,
  prefix: string,
  count: number,
  candidate: CandidateFixture = candidateA,
): Prisma.TeamApplicationCreateManyInput[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const role = number % 2 === 0 ? "HR_MANAGER" : "RECRUITER";
    return {
      id: `${prefix}-n${String(number).padStart(4, "0")}`,
      candidateUserId: candidate.userId,
      companyId: company.id,
      teamOpportunityId: company.roleIds[role],
      appliedRole: role,
      applicationEmail: `${databaseFixture.userIds[0]}@example.test`,
      cvDisplayName: "Pagination CV",
      cvFileName: "pagination.pdf",
      cvMimeType: "application/pdf",
      cvByteSize: 32_000,
      cvStorageKey: `${prefix}/${number}.pdf`,
      cvChecksumSha256: digest(`${prefix}:${number}`),
      activeKey: null,
      status: candidateStatuses[index % candidateStatuses.length],
      submittedAt: equalSubmittedAt,
    };
  });
}

async function createTeamFixtures() {
  assertTestDatabaseEnvironment();
  for (const [index, company] of activeCompanies.entries()) {
    const count = index === 0 ? 1_000 : index === 1 ? 101 : 25;
    const prefix = `phase3-team-${index + 1}-${databaseFixture.suffix}`;
    const rows = teamRows(company, prefix, count);
    await prisma.teamApplication.createMany({ data: rows });
    teamIds.set(
      company.id,
      rows.map((row) => row.id!),
    );
  }
  const oneRows = teamRows(
    inactiveCompanyScope,
    `phase3-team-one-${databaseFixture.suffix}`,
    1,
    candidateB,
  );
  const twentyFourRows = teamRows(
    removedMembershipCompanyScope,
    `phase3-team-24-${databaseFixture.suffix}`,
    24,
    candidate24,
  );
  await prisma.teamApplication.createMany({
    data: [...oneRows, ...twentyFourRows],
  });
}

async function collectCandidate(
  userId: string,
  input: {
    limit: number;
    filter?:
      | "ALL"
      | "APPLICATION_SUBMITTED"
      | "UNDER_REVIEW"
      | "INTERVIEW"
      | "OUTCOME"
      | "WITHDRAWN";
    sort?: "SUBMITTED_DESC" | "SUBMITTED_ASC";
  },
  firstPage?: Awaited<
    ReturnType<InstanceType<typeof CandidateApplicationTrackingService>["list"]>
  >,
) {
  const ids: string[] = [];
  let cursor: string | undefined;
  let page = firstPage;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    page ??= await candidateService.list(
      { userId, sessionId: "phase3-session" },
      { ...input, ...(cursor ? { cursor } : {}) },
    );
    ids.push(...page.applications.map((item) => item.applicationId));
    if (!page.hasMore) {
      expect(page.nextCursor).toBeNull();
      return { ids, last: page };
    }
    expect(page.nextCursor).toEqual(expect.any(String));
    cursor = page.nextCursor!;
    page = undefined;
  }
  throw new Error("candidate traversal exceeded 100 pages");
}

async function collectCandidateTeam(
  userId: string,
  sort: "SUBMITTED_DESC" | "SUBMITTED_ASC" = "SUBMITTED_DESC",
  firstPage?: Awaited<ReturnType<TeamApplicationService["listCandidate"]>>,
) {
  const ids: string[] = [];
  let cursor: string | undefined;
  let page = firstPage;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    page ??= await teamService.listCandidate(userId, {
      limit: 24,
      sort,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map((item) => item.applicationId));
    if (!page.hasMore) {
      expect(page.nextCursor).toBeNull();
      return { ids, last: page };
    }
    expect(page.nextCursor).toEqual(expect.any(String));
    cursor = page.nextCursor!;
    page = undefined;
  }
  throw new Error("candidate team traversal exceeded 100 pages");
}

async function collectOwner(
  companyId: string,
  input: {
    limit: number;
    status?: (typeof candidateStatuses)[number];
    role?: "HR_MANAGER" | "RECRUITER";
    sort?: "SUBMITTED_DESC" | "SUBMITTED_ASC";
  },
  firstPage?: Awaited<ReturnType<TeamApplicationOwnerService["list"]>>,
) {
  const ids: string[] = [];
  let cursor: string | undefined;
  let page = firstPage;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    page ??= await ownerService.list(databaseFixture.userIds[1]!, companyId, {
      ...input,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map((item) => item.applicationId));
    if (!page.hasMore) {
      expect(page.nextCursor).toBeNull();
      return { ids, last: page };
    }
    expect(page.nextCursor).toEqual(expect.any(String));
    cursor = page.nextCursor!;
    page = undefined;
  }
  throw new Error("owner traversal exceeded 100 pages");
}

function explainSummary(rows: Array<Record<string, unknown>>) {
  const payload = rows[0]?.["QUERY PLAN"];
  const root = Array.isArray(payload)
    ? (payload[0] as Record<string, unknown> | undefined)
    : undefined;
  const plan = (root?.Plan ?? {}) as Record<string, unknown>;
  return {
    nodeType: plan["Node Type"],
    actualRows: plan["Actual Rows"],
    actualTotalTimeMs: plan["Actual Total Time"],
  };
}

describe("Candidate-first Phase 3 isolated pagination", () => {
  beforeAll(async () => {
    assertTestDatabaseEnvironment();
    databaseFixture = await createJobBoardDatabaseFixture(
      "candidate-phase3-pagination",
      fixtureNow,
    );
    candidateA = {
      userId: databaseFixture.userIds[0]!,
      cvId: databaseFixture.confirmedCvIds[0]!,
    };
    candidateB = {
      userId: databaseFixture.userIds[1]!,
      cvId: databaseFixture.confirmedCvIds[1]!,
    };
    candidateEmpty = await createExtraCandidate("empty");
    candidate24 = await createExtraCandidate("twenty-four");
    candidate25 = await createExtraCandidate("twenty-five");
    candidate100 = await createExtraCandidate("one-hundred");
    candidate101 = await createExtraCandidate("one-hundred-one");
    await createCompanyScopes();
    await createOrdinaryJobs();
    await createOrdinaryFixtures();
    await createTeamFixtures();
  }, 120_000);

  afterAll(async () => {
    if (!databaseFixture) return;
    assertTestDatabaseEnvironment();
    await prisma.company.deleteMany({
      where: {
        id: {
          in: [
            ...activeCompanies.slice(1).map((company) => company.id),
            inactiveCompanyId,
            removedMembershipCompanyId,
          ],
        },
      },
    });
    await import("../../../helpers/job-board-database-fixture").then(
      ({ deleteJobBoardDatabaseFixture }) =>
        deleteJobBoardDatabaseFixture(databaseFixture),
    );
    await prisma.candidateCv.deleteMany({
      where: {
        candidateUserId: {
          in: [
            candidateEmpty.userId,
            candidate24.userId,
            candidate25.userId,
            candidate100.userId,
            candidate101.userId,
          ],
        },
      },
    });
    await prisma.candidateIdentity.deleteMany({
      where: {
        userId: {
          in: [
            candidateEmpty.userId,
            candidate24.userId,
            candidate25.userId,
            candidate100.userId,
            candidate101.userId,
          ],
        },
      },
    });
    await prisma.userAccount.deleteMany({
      where: {
        id: {
          in: [
            candidateEmpty.userId,
            candidate24.userId,
            candidate25.userId,
            candidate100.userId,
            candidate101.userId,
          ],
        },
      },
    });
  }, 120_000);

  it("covers empty and boundary-sized ordinary Candidate fixtures", async () => {
    const empty = await collectCandidate(candidateEmpty.userId, { limit: 24 });
    expect(empty.ids).toEqual([]);
    expect(empty.last.total).toBe(0);

    const one = await collectCandidate(candidateB.userId, { limit: 24 });
    expect(one.ids).toEqual(ordinaryIds.get(candidateB.userId));
    expect(one.last.total).toBe(1);

    const twentyFour = await collectCandidate(candidate24.userId, {
      limit: 24,
    });
    expect(twentyFour.ids).toHaveLength(24);
    expect(new Set(twentyFour.ids)).toEqual(
      new Set(ordinaryIds.get(candidate24.userId)),
    );

    const twentyFive = await collectCandidate(candidate25.userId, {
      limit: 24,
    });
    expect(twentyFive.ids).toHaveLength(25);
    expect(new Set(twentyFive.ids)).toEqual(
      new Set(ordinaryIds.get(candidate25.userId)),
    );

    const oneHundred = await collectCandidate(candidate100.userId, {
      limit: 100,
    });
    expect(oneHundred.ids).toHaveLength(100);
    expect(new Set(oneHundred.ids)).toEqual(
      new Set(ordinaryIds.get(candidate100.userId)),
    );

    const oneHundredOne = await collectCandidate(candidate101.userId, {
      limit: 100,
    });
    expect(oneHundredOne.ids).toHaveLength(101);
    expect(new Set(oneHundredOne.ids)).toEqual(
      new Set(ordinaryIds.get(candidate101.userId)),
    );
  });

  it("traverses 1,000 ordinary applications exactly once with stable equal-key ordering", async () => {
    const result = await collectCandidate(candidateA.userId, { limit: 100 });
    const expected = ordinaryIds.get(candidateA.userId)!;
    expect(result.ids).toHaveLength(1_000);
    expect(new Set(result.ids)).toEqual(new Set(expected));
    expect(result.last.total).toBe(1_000);
    expect(result.ids).toEqual(
      [...expected].sort((left, right) => right.localeCompare(left)),
    );
    expect(new Set(result.ids).size).toBe(1_000);
  });

  it("filters ordinary applications on the server and reports authoritative counts", async () => {
    const expected = ordinaryIds.get(candidateA.userId)!;
    const all = await candidateService.list(
      { userId: candidateA.userId, sessionId: "phase3-session" },
      { limit: 24, filter: "ALL", sort: "SUBMITTED_DESC" },
    );
    expect(all.counts.ALL).toBe(1_000);
    expect(all.counts.WITHDRAWN).toBe(
      expected.filter((_, index) => index % 11 === 0).length,
    );
    expect(all.counts.APPLICATION_SUBMITTED).toBeGreaterThan(0);
    expect(all.counts.UNDER_REVIEW).toBeGreaterThan(0);
    expect(all.counts.INTERVIEW).toBeGreaterThan(0);
    expect(all.counts.OUTCOME).toBeGreaterThan(0);

    const withdrawn = await collectCandidate(candidateA.userId, {
      limit: 24,
      filter: "WITHDRAWN",
      sort: "SUBMITTED_DESC",
    });
    expect(withdrawn.ids).toHaveLength(all.counts.WITHDRAWN);
    expect(withdrawn.ids.every((id) => expected.includes(id))).toBe(true);
  });

  it("proves ordinary Candidate insertion boundaries in both sort directions", async () => {
    // The cursor is an exclusive position in the already-issued ordered
    // snapshot. Rows inserted strictly before that position are outside the
    // traversal guarantee; rows inserted at or after it must be reachable
    // exactly once without replaying the first page.
    for (const sort of ["SUBMITTED_DESC", "SUBMITTED_ASC"] as const) {
      const prefix = `phase3-ordinary-insertion-${sort.toLowerCase()}-${databaseFixture.suffix}`;
      const seedSubmittedAt =
        sort === "SUBMITTED_DESC"
          ? new Date("2026-09-12T00:00:00.000Z")
          : new Date("2026-09-01T00:00:00.000Z");
      const seedRows = ordinaryRows(candidateA, prefix, 30, false).map(
        (row, index) => ({
          ...row,
          jobPostingId: ordinaryJobIds[200 + Math.floor(index / 5)]!,
          applicationAttemptNumber: (index % 5) + 1,
          submittedAt: seedSubmittedAt,
          lastStageChangedAt: seedSubmittedAt,
          consentedAt: seedSubmittedAt,
        }),
      );
      const seedIds = seedRows.map((row) => row.id!);
      const insertionIds =
        sort === "SUBMITTED_DESC"
          ? [`${prefix}-n9999-before`, `${prefix}-n0006-at`, `${prefix}-after`]
          : [`${prefix}-n0000-before`, `${prefix}-n0025-at`, `${prefix}-after`];
      await prisma.jobApplication.createMany({ data: seedRows });
      try {
        const first = await candidateService.list(
          { userId: candidateA.userId, sessionId: "phase3-session" },
          { limit: 24, filter: "ALL", sort },
        );
        expect(
          first.applications.filter((item) =>
            seedIds.includes(item.applicationId),
          ),
        ).toHaveLength(24);
        expect(first.nextCursor).toEqual(expect.any(String));

        const insertionRows = ordinaryRows(
          candidateA,
          `${prefix}-inserted`,
          3,
          false,
        ).map((row, index) => ({
          ...row,
          id: insertionIds[index]!,
          jobPostingId: ordinaryJobIds[206 + index]!,
          applicationAttemptNumber: 1,
          submittedAt:
            index === 0
              ? sort === "SUBMITTED_DESC"
                ? new Date("2026-09-13T00:00:00.000Z")
                : new Date("2026-08-31T00:00:00.000Z")
              : index === 1
                ? seedSubmittedAt
                : sort === "SUBMITTED_DESC"
                  ? new Date("2026-09-11T00:00:00.000Z")
                  : new Date("2026-09-09T00:00:00.000Z"),
          lastStageChangedAt: seedSubmittedAt,
          consentedAt: seedSubmittedAt,
        }));
        await prisma.jobApplication.createMany({ data: insertionRows });

        const traversal = await collectCandidate(
          candidateA.userId,
          { limit: 24, filter: "ALL", sort },
          first,
        );
        expect(new Set(traversal.ids).size).toBe(traversal.ids.length);
        for (const id of [...seedIds, insertionIds[1]!, insertionIds[2]!])
          expect(traversal.ids).toContain(id);
        expect(traversal.ids).not.toContain(insertionIds[0]);
      } finally {
        await prisma.jobApplication.deleteMany({
          where: { id: { in: [...seedIds, ...insertionIds] } },
        });
      }
    }
  });

  it("keeps Candidate and Owner Team lists bounded, filtered and isolated", async () => {
    const firstCompany = activeCompanies[0]!;
    const secondCompany = activeCompanies[1]!;
    const thirdCompany = activeCompanies[2]!;
    const ownerId = databaseFixture.userIds[1]!;
    const owner1000 = await collectOwner(firstCompany.id, { limit: 100 });
    expect(owner1000.ids).toHaveLength(1_000);
    expect(new Set(owner1000.ids)).toEqual(
      new Set(teamIds.get(firstCompany.id)),
    );

    const owner101 = await collectOwner(secondCompany.id, { limit: 100 });
    expect(owner101.ids).toHaveLength(101);
    expect(new Set(owner101.ids)).toEqual(
      new Set(teamIds.get(secondCompany.id)),
    );

    const owner25 = await collectOwner(thirdCompany.id, { limit: 24 });
    expect(owner25.ids).toHaveLength(25);
    expect(new Set(owner25.ids)).toEqual(new Set(teamIds.get(thirdCompany.id)));

    const candidatePage = await teamService.listCandidate(candidateA.userId, {
      limit: 24,
      sort: "SUBMITTED_DESC",
    });
    expect(candidatePage.total).toBe(1_126);
    expect(
      candidatePage.items.every((item) => !("applicationEmail" in item)),
    ).toBe(true);
    expect(candidatePage.items.every((item) => !("cvStorageKey" in item))).toBe(
      true,
    );

    const status = await collectOwner(firstCompany.id, {
      limit: 24,
      status: "REJECTED",
    });
    expect(status.ids).toHaveLength(
      teamIds
        .get(firstCompany.id)!
        .filter(
          (_, index) =>
            candidateStatuses[index % candidateStatuses.length] === "REJECTED",
        ).length,
    );
    const role = await collectOwner(firstCompany.id, {
      limit: 24,
      role: "HR_MANAGER",
    });
    expect(role.ids).toHaveLength(500);

    const emptyCandidateTeam = await teamService.listCandidate(
      candidateEmpty.userId,
      { limit: 24 },
    );
    expect(emptyCandidateTeam.items).toEqual([]);
    expect(emptyCandidateTeam.total).toBe(0);
    const oneCandidateTeam = await collectCandidateTeam(candidateB.userId);
    expect(oneCandidateTeam.ids).toHaveLength(1);
    expect(oneCandidateTeam.last.total).toBe(1);
    const twentyFourCandidateTeam = await collectCandidateTeam(
      candidate24.userId,
      "SUBMITTED_ASC",
    );
    expect(twentyFourCandidateTeam.ids).toHaveLength(24);
    expect(twentyFourCandidateTeam.last.total).toBe(24);
    const candidateTeam = await collectCandidateTeam(candidateA.userId);
    const expectedCandidateTeam = activeCompanies.flatMap(
      (company) => teamIds.get(company.id) ?? [],
    );
    expect(candidateTeam.ids).toHaveLength(1_126);
    expect(new Set(candidateTeam.ids)).toEqual(new Set(expectedCandidateTeam));
    const submittedOwner = await ownerService.list(ownerId, firstCompany.id, {
      limit: 24,
      status: "SUBMITTED",
    });
    expect(submittedOwner.pendingCount).toBe(submittedOwner.total);
    expect(status.last.pendingCount).toBe(0);
  });

  it("covers Owner Team Application 0, 1 and 24-row boundaries", async () => {
    const ownerId = databaseFixture.userIds[1]!;
    const company = await createCompany("owner-boundaries");
    const scope: CompanyFixture = {
      id: company.id,
      roleIds: {
        HR_MANAGER: `phase3-opportunity-hr-${company.id}`,
        RECRUITER: `phase3-opportunity-recruiter-${company.id}`,
      },
    };
    try {
      await prisma.teamOpportunity.createMany({
        data: [
          {
            id: scope.roleIds.HR_MANAGER,
            companyId: scope.id,
            role: "HR_MANAGER",
          },
          {
            id: scope.roleIds.RECRUITER,
            companyId: scope.id,
            role: "RECRUITER",
          },
        ],
      });
      await prisma.companyMembership.create({
        data: {
          companyId: scope.id,
          userId: ownerId,
          role: "OWNER",
          priorApprovedRole: "OWNER",
          status: "ACTIVE",
        },
      });

      const empty = await ownerService.list(ownerId, scope.id, { limit: 24 });
      expect(empty.items).toEqual([]);
      expect(empty.total).toBe(0);
      expect(empty.pendingCount).toBe(0);

      const oneRows = teamRows(
        scope,
        `phase3-owner-boundary-one-${databaseFixture.suffix}`,
        1,
      );
      await prisma.teamApplication.createMany({ data: oneRows });
      const one = await ownerService.list(ownerId, scope.id, { limit: 24 });
      expect(one.items).toHaveLength(1);
      expect(one.total).toBe(1);

      const twentyFourRows = teamRows(
        scope,
        `phase3-owner-boundary-24-${databaseFixture.suffix}`,
        23,
      );
      await prisma.teamApplication.createMany({ data: twentyFourRows });
      const twentyFour = await collectOwner(scope.id, { limit: 24 });
      expect(twentyFour.ids).toHaveLength(24);
      expect(new Set(twentyFour.ids).size).toBe(24);
      expect(twentyFour.last.total).toBe(24);
    } finally {
      await prisma.company.delete({ where: { id: scope.id } });
    }
  });

  it("proves Candidate Team and Owner insertion boundaries in both sort directions", async () => {
    // A cursor is an exclusive position in the already-issued keyset. New
    // rows at or after that position remain traversable exactly once; a row
    // inserted strictly before it is intentionally outside this bounded
    // snapshot contract.
    const company = activeCompanies[0]!;
    const ownerId = databaseFixture.userIds[1]!;
    for (const sort of ["SUBMITTED_DESC", "SUBMITTED_ASC"] as const) {
      const prefix = `phase3-team-insertion-${sort.toLowerCase()}-${databaseFixture.suffix}`;
      const seedSubmittedAt =
        sort === "SUBMITTED_DESC"
          ? new Date("2026-09-12T00:00:00.000Z")
          : new Date("2026-09-01T00:00:00.000Z");
      const seedRows = teamRows(company, `${prefix}-seed`, 30).map((row) => ({
        ...row,
        appliedRole: "RECRUITER" as const,
        teamOpportunityId: company.roleIds.RECRUITER,
        status: "SUBMITTED" as const,
        submittedAt: seedSubmittedAt,
      }));
      const seedIds = seedRows.map((row) => row.id!);
      await prisma.teamApplication.createMany({ data: seedRows });
      const insertionIds =
        sort === "SUBMITTED_DESC"
          ? [`${prefix}-n9999-before`, `${prefix}-n0006-at`, `${prefix}-after`]
          : [
              `${prefix}-n0000-before`,
              `${prefix}-seed-n0025-at`,
              `${prefix}-after`,
            ];
      try {
        const candidateFirst = await teamService.listCandidate(
          candidateA.userId,
          { limit: 24, sort },
        );
        const ownerFirst = await ownerService.list(ownerId, company.id, {
          limit: 24,
          sort,
        });
        expect(
          candidateFirst.items.filter((item) =>
            seedIds.includes(item.applicationId),
          ),
        ).toHaveLength(24);
        expect(
          ownerFirst.items.filter((item) =>
            seedIds.includes(item.applicationId),
          ),
        ).toHaveLength(24);
        expect(candidateFirst.nextCursor).toEqual(expect.any(String));
        expect(ownerFirst.nextCursor).toEqual(expect.any(String));

        const insertionRows = teamRows(company, `${prefix}-inserted`, 3).map(
          (row, index) => ({
            ...row,
            id: insertionIds[index]!,
            appliedRole: "RECRUITER" as const,
            teamOpportunityId: company.roleIds.RECRUITER,
            status: "SUBMITTED" as const,
            submittedAt:
              index === 0
                ? sort === "SUBMITTED_DESC"
                  ? new Date("2026-09-13T00:00:00.000Z")
                  : new Date("2026-08-31T00:00:00.000Z")
                : index === 1
                  ? seedSubmittedAt
                  : sort === "SUBMITTED_DESC"
                    ? new Date("2026-09-11T00:00:00.000Z")
                    : new Date("2026-09-09T00:00:00.000Z"),
          }),
        );
        await prisma.teamApplication.createMany({ data: insertionRows });

        const candidateTraversal = await collectCandidateTeam(
          candidateA.userId,
          sort,
          candidateFirst,
        );
        const ownerTraversal = await collectOwner(
          company.id,
          { limit: 24, sort },
          ownerFirst,
        );
        for (const traversal of [candidateTraversal, ownerTraversal]) {
          expect(new Set(traversal.ids).size).toBe(traversal.ids.length);
          for (const id of [...seedIds, insertionIds[1]!, insertionIds[2]!]) {
            expect(traversal.ids).toContain(id);
          }
          expect(traversal.ids).not.toContain(insertionIds[0]);
        }
      } finally {
        await prisma.teamApplication.deleteMany({
          where: { id: { in: [...seedIds, ...insertionIds] } },
        });
      }
    }
  });

  it("binds Owner scope to session, company, filters and cursor with neutral denials", async () => {
    const firstCompany = activeCompanies[0]!;
    const secondCompany = activeCompanies[1]!;
    const ownerId = databaseFixture.userIds[1]!;
    const eligibleCompanies = await ownerService.listEligibleCompanies(ownerId);
    expect(eligibleCompanies).toHaveLength(3);
    expect(eligibleCompanies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstCompany.id }),
        expect.objectContaining({ id: secondCompany.id }),
        expect.objectContaining({ id: activeCompanies[2]!.id }),
      ]),
    );
    expect(eligibleCompanies.map((company) => company.id)).not.toEqual(
      expect.arrayContaining([inactiveCompanyId, removedMembershipCompanyId]),
    );
    const firstPage = await ownerService.list(ownerId, firstCompany.id, {
      limit: 24,
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    await expect(ownerService.list(ownerId)).rejects.toMatchObject({
      code: "TEAM_OWNER_FORBIDDEN",
    });
    await expect(
      ownerService.list(ownerId, secondCompany.id, {
        cursor: firstPage.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: "TEAM_APPLICATION_CURSOR_INVALID" });
    await expect(
      ownerService.list(ownerId, firstCompany.id, {
        cursor: firstPage.nextCursor!,
        sort: "SUBMITTED_ASC",
      }),
    ).rejects.toMatchObject({ code: "TEAM_APPLICATION_CURSOR_INVALID" });
    await expect(
      ownerService.list(ownerId, firstCompany.id, {
        cursor: firstPage.nextCursor!,
        role: "HR_MANAGER",
      }),
    ).rejects.toMatchObject({ code: "TEAM_APPLICATION_CURSOR_INVALID" });
    await expect(
      ownerService.list(ownerId, firstCompany.id, {
        cursor: firstPage.nextCursor!,
        status: "REJECTED",
      }),
    ).rejects.toMatchObject({ code: "TEAM_APPLICATION_CURSOR_INVALID" });
    await expect(
      ownerService.list(ownerId, firstCompany.id, {
        cursor: "v2.invalid.cursor",
      }),
    ).rejects.toMatchObject({ code: "TEAM_APPLICATION_CURSOR_INVALID" });

    const crossCompanyId = teamIds.get(secondCompany.id)![0]!;
    await expect(
      ownerService.get(ownerId, crossCompanyId, firstCompany.id),
    ).rejects.toMatchObject({ code: "TEAM_OWNER_FORBIDDEN" });
    await expect(
      ownerService.get(ownerId, crossCompanyId),
    ).rejects.toMatchObject({
      code: "TEAM_OWNER_FORBIDDEN",
    });
    await expect(
      openTeamApplicationCv(ownerId, crossCompanyId, firstCompany.id),
    ).rejects.toMatchObject({
      code: "TEAM_CV_UNAVAILABLE",
    });
    await expect(
      ownerService.get(ownerId, "unknown-team-application", firstCompany.id),
    ).rejects.toMatchObject({ code: "TEAM_OWNER_FORBIDDEN" });
    await expect(
      ownerService.list(ownerId, inactiveCompanyId),
    ).rejects.toMatchObject({
      code: "TEAM_OWNER_FORBIDDEN",
    });
    await expect(
      ownerService.list(ownerId, removedMembershipCompanyId),
    ).rejects.toMatchObject({ code: "TEAM_OWNER_FORBIDDEN" });

    await prisma.company.update({
      where: { id: firstCompany.id },
      data: { moderationState: "BANNED" },
    });
    try {
      await expect(
        ownerService.list(ownerId, firstCompany.id),
      ).rejects.toMatchObject({
        code: "TEAM_OWNER_FORBIDDEN",
      });
    } finally {
      await prisma.company.update({
        where: { id: firstCompany.id },
        data: { moderationState: "ACTIVE" },
      });
    }

    const candidatePage = await candidateService.list(
      { userId: candidateA.userId, sessionId: "phase3-session" },
      { limit: 24 },
    );
    await expect(
      candidateService.list(
        { userId: candidateB.userId, sessionId: "phase3-session" },
        { limit: 24, cursor: candidatePage.nextCursor! },
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_LIST_CURSOR_INVALID" });
    await expect(
      candidateService.list(
        { userId: candidateA.userId, sessionId: "phase3-session" },
        {
          limit: 24,
          cursor: candidatePage.nextCursor!,
          sort: "SUBMITTED_ASC",
        },
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_LIST_CURSOR_INVALID" });
    await expect(
      candidateService.list(
        { userId: candidateA.userId, sessionId: "phase3-session" },
        {
          limit: 24,
          cursor: candidatePage.nextCursor!,
          filter: "WITHDRAWN",
        },
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_LIST_CURSOR_INVALID" });
  });

  it("keeps invitation retry idempotent and does not introduce scoring or membership side effects", async () => {
    const company = activeCompanies[0]!;
    const applicationId = teamIds
      .get(company.id)!
      .find((id) => id.endsWith("n0001"))!;
    const beforeMemberships = await prisma.companyMembership.count({
      where: { companyId: company.id, userId: candidateA.userId },
    });
    const first = await ownerService.accept(
      databaseFixture.userIds[1]!,
      applicationId,
      "RECRUITER",
      company.id,
    );
    const second = await ownerService.accept(
      databaseFixture.userIds[1]!,
      applicationId,
      "RECRUITER",
      company.id,
    );
    expect(first).toMatchObject({
      status: "INVITATION_SENT",
      idempotent: false,
    });
    expect(second).toMatchObject({
      status: "INVITATION_SENT",
      idempotent: true,
    });
    expect(
      await prisma.companyMembership.count({
        where: { companyId: company.id, userId: candidateA.userId },
      }),
    ).toBe(beforeMemberships);
    expect(
      await prisma.jobApplication.count({
        where: { candidateUserId: candidateA.userId },
      }),
    ).toBe(ordinaryIds.get(candidateA.userId)!.length);
  });

  it("records 1,000-row list/count query plans and timings without adding a speculative index", async () => {
    const candidatePlan = await prisma.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id" FROM "JobApplication" WHERE "candidateUserId" = $1 ORDER BY "submittedAt" DESC, "id" DESC LIMIT 101',
      candidateA.userId,
    );
    const candidateCountPlan = await prisma.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*) FROM "JobApplication" WHERE "candidateUserId" = $1',
      candidateA.userId,
    );
    const ownerPlan = await prisma.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id" FROM "TeamApplication" WHERE "companyId" = $1 ORDER BY "submittedAt" DESC, "id" DESC LIMIT 101',
      activeCompanies[0]!.id,
    );
    const ownerCountPlan = await prisma.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*) FROM "TeamApplication" WHERE "companyId" = $1 AND "status" IN (\'SUBMITTED\', \'VIEWED\')',
      activeCompanies[0]!.id,
    );
    const candidateStarted = performance.now();
    await candidateRepository.list({
      candidateUserId: candidateA.userId,
      limit: 100,
      filter: "ALL",
      sort: "SUBMITTED_DESC",
      cursor: null,
    });
    const candidateMs = performance.now() - candidateStarted;
    const ownerStarted = performance.now();
    await teamRepository.listForOwner({
      companyId: activeCompanies[0]!.id,
      limit: 100,
      sort: "SUBMITTED_DESC",
      cursor: null,
    });
    const ownerMs = performance.now() - ownerStarted;
    const evidence = {
      candidateList: explainSummary(candidatePlan),
      candidateCount: explainSummary(candidateCountPlan),
      ownerList: explainSummary(ownerPlan),
      ownerPendingCount: explainSummary(ownerCountPlan),
      candidateRepositoryMs: Number(candidateMs.toFixed(2)),
      ownerRepositoryMs: Number(ownerMs.toFixed(2)),
    };
    console.log(`CF304_QUERY_PLAN_EVIDENCE ${JSON.stringify(evidence)}`);
    expect(
      Number.isFinite(Number(evidence.candidateList.actualTotalTimeMs)),
    ).toBe(true);
    expect(
      Number.isFinite(Number(evidence.candidateCount.actualTotalTimeMs)),
    ).toBe(true);
    expect(Number.isFinite(Number(evidence.ownerList.actualTotalTimeMs))).toBe(
      true,
    );
    expect(
      Number.isFinite(Number(evidence.ownerPendingCount.actualTotalTimeMs)),
    ).toBe(true);
    expect(candidateMs).toBeLessThan(5_000);
    expect(ownerMs).toBeLessThan(5_000);
  });
});
