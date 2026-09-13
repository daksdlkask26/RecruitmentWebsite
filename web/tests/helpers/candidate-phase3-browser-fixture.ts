import { createHash } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import {
  createCandidateFirstDatabaseFixture,
  deleteCandidateFirstDatabaseFixture,
} from "./candidate-first-database-fixture";
import { seedCleanJobApplicationCv } from "./job-application-cv-fixture";

const fixtureNow = new Date("2026-09-11T05:00:00.000Z");

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function createBrowserCompany(suffix: string, key: "two" | "three") {
  return prisma.company.create({
    data: {
      id: `phase3-browser-company-${key}-${suffix}`,
      slug: `phase3-browser-company-${key}-${suffix}`,
      legalName: `Phase 3 Browser ${key} Ltd`,
      displayName: `Phase 3 Browser ${key}`,
      publicDescription: "Isolated Candidate-first browser fixture.",
      publicLocation: "Ho Chi Minh City",
      verifiedAt: fixtureNow,
      verificationState: "ACTIVE",
      verificationInactiveAt: null,
      moderationState: "ACTIVE",
    },
  });
}

async function deleteBrowserCompanies(companyIds: readonly string[]) {
  if (!companyIds.length) return;
  await prisma.company.deleteMany({ where: { id: { in: [...companyIds] } } });
}

export async function createCandidatePhase3BrowserFixture(label = "browser") {
  const base = await createCandidateFirstDatabaseFixture(
    `phase3-${label}`,
    fixtureNow,
  );
  const extraCompanyIds: string[] = [];
  try {
    const candidate = await prisma.userAccount.findUniqueOrThrow({
      where: { id: base.candidateUserId },
      select: { email: true },
    });
    const cv = await prisma.candidateCv.findUniqueOrThrow({
      where: { id: base.confirmedCvId },
      select: {
        id: true,
        displayName: true,
        fileName: true,
        mimeType: true,
        byteSize: true,
        storageKey: true,
        version: true,
      },
    });
    const ordinaryJobs = await prisma.jobPosting.findMany({
      where: {
        id: {
          in: [
            base.jobs.activeSecond.id,
            base.jobs.closed.id,
            base.jobs.expired.id,
            base.jobs.removed.id,
            base.jobs.future.id,
          ],
        },
      },
      select: {
        id: true,
        title: true,
        location: true,
        employmentType: true,
        experienceLevel: true,
        workArrangement: true,
        version: true,
        company: { select: { displayName: true } },
      },
    });
    if (ordinaryJobs.length !== 5) {
      throw new Error("PHASE3_BROWSER_ORDINARY_JOBS_INCOMPLETE");
    }
    const companyTwo = await createBrowserCompany(base.suffix, "two");
    const companyThree = await createBrowserCompany(base.suffix, "three");
    extraCompanyIds.push(companyTwo.id, companyThree.id);
    const companies = [base.company, companyTwo, companyThree];
    const roleIds = new Map<
      string,
      Record<"HR_MANAGER" | "RECRUITER", string>
    >();
    for (const company of companies) {
      const roles = {
        HR_MANAGER: `phase3-browser-hr-${company.id}`,
        RECRUITER: `phase3-browser-recruiter-${company.id}`,
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
        {
          companyId: companyTwo.id,
          userId: base.employerUserId,
          role: "OWNER",
          priorApprovedRole: "OWNER",
          status: "ACTIVE",
        },
        {
          companyId: companyThree.id,
          userId: base.employerUserId,
          role: "OWNER",
          priorApprovedRole: "OWNER",
          status: "ACTIVE",
        },
      ],
    });

    const teamCv = await seedCleanJobApplicationCv({
      candidateUserId: base.candidateUserId,
      now: fixtureNow,
      label: `phase3-team-${base.suffix}`,
      purpose: "TEAM_APPLICATION_DIRECT",
      processingMode: "SCAN_ONLY",
    });
    const ordinaryApplications: Prisma.JobApplicationCreateManyInput[] =
      Array.from({ length: 25 }, (_, index) => {
        const submittedAt = new Date(fixtureNow.getTime() - index * 60_000);
        const stage = index === 24 ? "INTERVIEWING" : "APPLIED";
        const applicationJob = ordinaryJobs[index % ordinaryJobs.length]!;
        const applicationAttemptNumber =
          Math.floor(index / ordinaryJobs.length) + 1;
        return {
          id: `phase3-browser-ordinary-${base.suffix}-${String(index + 1).padStart(3, "0")}`,
          candidateUserId: base.candidateUserId,
          jobPostingId: applicationJob.id,
          applicationAttemptNumber,
          selectedCvId: cv.id,
          cvFileRef: cv.storageKey,
          contactSnapshot: {
            fullName: "Job Candidate 1",
            email: candidate.email,
            phone: "0901234567",
            location: "Ho Chi Minh City",
          },
          scoringStatus: "NOT_REQUESTED" as const,
          stage,
          stageVersion: 1,
          lastStageChangedAt: submittedAt,
          profileSnapshot: { candidateName: "Job Candidate 1" },
          cvSnapshot: {
            cvId: cv.id,
            displayName: cv.displayName,
            fileName: cv.fileName,
            mimeType: cv.mimeType,
            byteSize: cv.byteSize,
            cvVersion: cv.version,
          },
          jobSnapshot: {
            title: applicationJob.title,
            companyName: applicationJob.company.displayName,
            location: applicationJob.location,
            employmentType: applicationJob.employmentType,
            experienceLevel: applicationJob.experienceLevel,
            workArrangement: applicationJob.workArrangement,
            jobVersion: applicationJob.version,
          },
          consentVersion: "phase3-browser",
          consentedAt: submittedAt,
          idempotencyKey: `phase3-browser-ordinary-key-${base.suffix}-${index + 1}`,
          submissionBindingDigest: digest(
            `ordinary:${base.suffix}:${index + 1}`,
          ),
          submittedAt,
        };
      });
    await prisma.jobApplication.createMany({ data: ordinaryApplications });

    const baseTeamApplications = Array.from({ length: 25 }, (_, index) => {
      const primary = index === 0;
      const submittedAt = primary
        ? new Date(fixtureNow.getTime() + 5 * 60_000)
        : new Date(fixtureNow.getTime() - index * 60_000);
      return {
        id: `phase3-browser-team-${base.suffix}-${String(index + 1).padStart(3, "0")}`,
        candidateUserId: base.candidateUserId,
        companyId: base.company.id,
        teamOpportunityId: roleIds.get(base.company.id)!.RECRUITER,
        appliedRole: "RECRUITER" as const,
        applicationEmail: candidate.email,
        cvDisplayName: primary ? "secure-fixture.pdf" : "candidate-resume.pdf",
        cvFileName: primary ? "secure-fixture.pdf" : "candidate-resume.pdf",
        cvMimeType: "application/pdf",
        cvByteSize: primary ? teamCv.byteSize : 64,
        cvStorageKey: primary
          ? teamCv.storageLocator
          : `phase3-browser-dummy-cv-${base.suffix}-${index + 1}`,
        cvChecksumSha256: primary
          ? teamCv.checksumSha256
          : digest(`dummy-cv:${base.suffix}:${index + 1}`),
        cvSourceArtifactId: primary ? teamCv.artifactId : null,
        cvScanAssessmentId: primary ? teamCv.assessmentId : null,
        activeKey: null,
        status: "SUBMITTED" as const,
        submittedAt,
      };
    });
    await prisma.teamApplication.createMany({ data: baseTeamApplications });
    await prisma.teamApplication.createMany({
      data: [
        {
          id: `phase3-browser-team-two-${base.suffix}`,
          candidateUserId: base.candidateUserId,
          companyId: companyTwo.id,
          teamOpportunityId: roleIds.get(companyTwo.id)!.HR_MANAGER,
          appliedRole: "HR_MANAGER",
          applicationEmail: candidate.email,
          cvDisplayName: "candidate-resume.pdf",
          cvFileName: "candidate-resume.pdf",
          cvMimeType: "application/pdf",
          cvByteSize: 64,
          cvStorageKey: `phase3-browser-dummy-two-${base.suffix}`,
          cvChecksumSha256: digest(`dummy-two:${base.suffix}`),
          activeKey: null,
          status: "VIEWED",
          submittedAt: fixtureNow,
        },
        {
          id: `phase3-browser-team-three-${base.suffix}`,
          candidateUserId: base.candidateUserId,
          companyId: companyThree.id,
          teamOpportunityId: roleIds.get(companyThree.id)!.RECRUITER,
          appliedRole: "RECRUITER",
          applicationEmail: candidate.email,
          cvDisplayName: "candidate-resume.pdf",
          cvFileName: "candidate-resume.pdf",
          cvMimeType: "application/pdf",
          cvByteSize: 64,
          cvStorageKey: `phase3-browser-dummy-three-${base.suffix}`,
          cvChecksumSha256: digest(`dummy-three:${base.suffix}`),
          activeKey: null,
          status: "WITHDRAWN",
          submittedAt: fixtureNow,
        },
      ],
    });

    return {
      ...base,
      ordinaryApplicationCount: ordinaryApplications.length,
      teamApplicationCount: baseTeamApplications.length,
      teamApplicationId: baseTeamApplications[0]!.id,
      applicationId: base.applicationId,
      activeJobId: base.jobs.active.id,
      companyIds: companies.map((company) => company.id),
      companyTwoId: companyTwo.id,
      companyThreeId: companyThree.id,
    };
  } catch (error) {
    await deleteBrowserCompanies(extraCompanyIds);
    await deleteCandidateFirstDatabaseFixture(base);
    throw error;
  }
}

export async function deleteCandidatePhase3BrowserFixture(
  fixture: Awaited<ReturnType<typeof createCandidatePhase3BrowserFixture>>,
) {
  await deleteBrowserCompanies([fixture.companyTwoId, fixture.companyThreeId]);
  await deleteCandidateFirstDatabaseFixture(fixture);
}
