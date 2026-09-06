import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { normalizeSearchText } from "@/backend/services/jobs/search-normalization";
import { assertTestDatabaseEnvironment } from "./test-database-guard";

export type JobBoardDatabaseFixture = Awaited<
  ReturnType<typeof createJobBoardDatabaseFixture>
>;
export type JobBoardDatabaseFixtureOptions = Readonly<{
  includeSearchRankingFixtures?: boolean;
}>;
const checksum = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

type JobBoardFixtureNamespace = Readonly<{
  company: Readonly<{ id: string }>;
  userIds: string[];
  suffix: string;
  /** Skill rows this fixture actually created; shared rows are never owned. */
  createdSkillIds?: readonly string[];
}>;

async function createJobBoardDatabaseFixtureUnsafe(
  now = new Date("2026-08-01T08:00:00.000Z"),
  options: JobBoardDatabaseFixtureOptions = {},
  namespace: Readonly<{ suffix: string; userIds: string[] }>,
) {
  assertTestDatabaseEnvironment();
  const { suffix, userIds } = namespace;
  const createdSkillIds: string[] = [];
  const company = await prisma.company.create({
    data: {
      id: `company-${suffix}`,
      slug: `smart-hire-${suffix}`,
      legalName: "Công Ty SmartHire Limited",
      displayName: "Công Ty SmartHire",
      publicDescription: "A disposable company used by integration tests.",
      publicLocation: "Hồ Chí Minh",
      verifiedAt: new Date(now.getTime() - 30 * 24 * 60 * 60_000),
      verificationState: "ACTIVE",
    },
  });

  for (const [index, userId] of userIds.entries()) {
    const email = `${userId}@example.test`;
    await prisma.userAccount.create({
      data: {
        id: userId,
        name: `Job Candidate ${index + 1}`,
        email,
        normalizedEmail: email,
        emailVerified: true,
        state: "ACTIVE",
        candidateIdentity: {
          create: {
            profile: {
              create: {
                headline: "TypeScript Engineer",
                location: "Hồ Chí Minh",
                summary: "Builds accessible recruitment products.",
              },
            },
            cvs: {
              create: [
                {
                  id: `cv-confirmed-${index}-${suffix}`,
                  displayName: "Confirmed CV",
                  fileName: "candidate.pdf",
                  mimeType: "application/pdf",
                  byteSize: 32_000,
                  storageKey: `fixtures/${suffix}/${index}/confirmed.pdf`,
                  checksumSha256: checksum(`${suffix}:${index}:confirmed`),
                  confirmedAt: now,
                },
                {
                  id: `cv-unconfirmed-${index}-${suffix}`,
                  displayName: "Unconfirmed CV",
                  fileName: "draft.pdf",
                  mimeType: "application/pdf",
                  byteSize: 16_000,
                  storageKey: `fixtures/${suffix}/${index}/draft.pdf`,
                  checksumSha256: checksum(`${suffix}:${index}:draft`),
                },
              ],
            },
          },
        },
      },
    });
  }

  let skill = await prisma.skill.findUnique({
    where: { normalizedName: "typescript" },
  });
  if (!skill) {
    try {
      skill = await prisma.skill.create({
        data: {
          id: `skill-${suffix}`,
          name: "TypeScript",
          normalizedName: "typescript",
        },
      });
      createdSkillIds.push(skill.id);
    } catch (error) {
      skill = await prisma.skill.findUnique({
        where: { normalizedName: "typescript" },
      });
      if (!skill) throw error;
    }
  }
  const sharedSkill = skill;
  let pythonSkill: typeof sharedSkill | null = null;
  if (options.includeSearchRankingFixtures) {
    pythonSkill = await prisma.skill.findUnique({
      where: { normalizedName: "python" },
    });
    if (!pythonSkill) {
      try {
        pythonSkill = await prisma.skill.create({
          data: {
            id: `skill-python-${suffix}`,
            name: "Python",
            normalizedName: "python",
          },
        });
        createdSkillIds.push(pythonSkill.id);
      } catch (error) {
        pythonSkill = await prisma.skill.findUnique({
          where: { normalizedName: "python" },
        });
        if (!pythonSkill) throw error;
      }
    }
  }
  const base = {
    companyId: company.id,
    industryId: "r03",
    subIndustryId: "r03-software-development",
    industryCode: "r03",
    subIndustryCode: "r03-software-development",
    summary: "Build useful and accessible recruitment products.",
    description:
      "Create production-grade web experiences for Vietnamese users.",
    responsibilities: "Design, implement, test, and review product increments.",
    requirements: "Strong TypeScript fundamentals and collaborative delivery.",
    benefits: "Flexible work and a learning budget.",
    employmentType: "FULL_TIME" as const,
    experienceLevel: "MID" as const,
    workArrangement: "HYBRID" as const,
    salaryMin: 25_000_000,
    salaryMax: 45_000_000,
    salaryCurrency: "VND",
    salaryPeriod: "MONTH" as const,
    approvedAt: new Date(now.getTime() - 14 * 24 * 60 * 60_000),
    version: 1,
  };

  async function createJob(input: {
    key: string;
    title: string;
    location: string;
    status: "ACTIVE" | "CLOSED" | "EXPIRED" | "PENDING_REVIEW" | "REMOVED";
    publishedAt: Date;
    applicationDeadline?: Date | null;
    industryCode?: string;
    industryId?: string;
    subIndustryCode?: string;
    subIndustryId?: string;
    skills?: readonly { skillId: string; displayName: string }[];
  }) {
    const skillEntries = input.skills?.length
      ? input.skills
      : [{ skillId: sharedSkill.id, displayName: "TypeScript" }];
    return prisma.jobPosting.create({
      data: {
        ...base,
        industryCode: input.industryCode ?? base.industryCode,
        industryId: input.industryId ?? base.industryId,
        subIndustryCode: input.subIndustryCode ?? base.subIndustryCode,
        subIndustryId: input.subIndustryId ?? base.subIndustryId,
        id: `job-${input.key}-${suffix}`,
        slug: `${input.key}-${suffix}`,
        title: input.title,
        normalizedTitle: normalizeSearchText(input.title),
        location: input.location,
        normalizedLocation: normalizeSearchText(input.location),
        searchDocumentNormalized: normalizeSearchText(
          `${input.title} ${company.displayName} ${input.location} TypeScript ${base.description}`,
          60_000,
        ),
        status: input.status,
        publishedAt: input.publishedAt,
        applicationDeadline: input.applicationDeadline ?? null,
        closedAt:
          input.status === "CLOSED" || input.status === "EXPIRED" ? now : null,
        removedAt: input.status === "REMOVED" ? now : null,
        skills: {
          create: skillEntries.map((entry, position) => ({
            skillId: entry.skillId,
            displayName: entry.displayName,
            required: true,
            position,
          })),
        },
        questions:
          input.key === "active"
            ? {
                create: [
                  {
                    id: `question-text-${suffix}`,
                    prompt:
                      "How many years of relevant experience do you have?",
                    kind: "TEXT",
                    required: true,
                    position: 0,
                  },
                  {
                    id: `question-boolean-${suffix}`,
                    prompt: "Can you work in a hybrid arrangement?",
                    kind: "BOOLEAN",
                    required: true,
                    position: 1,
                  },
                ],
              }
            : undefined,
      },
      include: { questions: true, skills: true },
    });
  }

  const jobs = {
    active: await createJob({
      key: "active",
      title: "Lập trình viên TypeScript",
      location: "Hồ Chí Minh",
      status: "ACTIVE",
      publishedAt: new Date(now.getTime() - 2 * 24 * 60 * 60_000),
      applicationDeadline: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
    }),
    activeSecond: await createJob({
      key: "active-second",
      title: "Kỹ sư Phần mềm",
      location: "Đà Nẵng",
      status: "ACTIVE",
      publishedAt: new Date(now.getTime() - 24 * 60 * 60_000),
      applicationDeadline: new Date(now.getTime() + 21 * 24 * 60 * 60_000),
    }),
    closed: await createJob({
      key: "closed",
      title: "Closed Engineer",
      location: "Hà Nội",
      status: "CLOSED",
      publishedAt: new Date(now.getTime() - 20 * 24 * 60 * 60_000),
    }),
    expired: await createJob({
      key: "expired",
      title: "Expired Engineer",
      location: "Hà Nội",
      status: "EXPIRED",
      publishedAt: new Date(now.getTime() - 30 * 24 * 60 * 60_000),
      applicationDeadline: new Date(now.getTime() - 24 * 60 * 60_000),
    }),
    pending: await createJob({
      key: "pending",
      title: "Pending Engineer",
      location: "Huế",
      status: "PENDING_REVIEW",
      publishedAt: new Date(now.getTime() - 24 * 60 * 60_000),
    }),
    removed: await createJob({
      key: "removed",
      title: "Removed Engineer",
      location: "Cần Thơ",
      status: "REMOVED",
      publishedAt: new Date(now.getTime() - 24 * 60 * 60_000),
    }),
    future: await createJob({
      key: "future",
      title: "Future Engineer",
      location: "Hải Phòng",
      status: "ACTIVE",
      publishedAt: new Date(now.getTime() + 24 * 60 * 60_000),
    }),
  };

  const rankingJobs = options.includeSearchRankingFixtures
    ? {
        seoSpecialist: await createJob({
          key: "seo-specialist",
          title: "SEO Specialist",
          location: "Hồ Chí Minh",
          status: "ACTIVE",
          publishedAt: new Date(now.getTime() - 2 * 60 * 60_000),
          applicationDeadline: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
          industryCode: "r02",
          industryId: "r02",
          subIndustryCode: "r02-digital-marketing",
          subIndustryId: "r02-digital-marketing",
        }),
        seoExecutive: await createJob({
          key: "seo-executive",
          title: "SEO Executive",
          location: "Hồ Chí Minh",
          status: "ACTIVE",
          publishedAt: new Date(now.getTime() - 3 * 60 * 60_000),
          applicationDeadline: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
          industryCode: "r02",
          industryId: "r02",
          subIndustryCode: "r02-digital-marketing",
          subIndustryId: "r02-digital-marketing",
        }),
        electronicsEngineer: await createJob({
          key: "electronics-engineer",
          title: "Electronics Engineer",
          location: "Hồ Chí Minh",
          status: "ACTIVE",
          publishedAt: new Date(now.getTime() - 60 * 60_000),
          applicationDeadline: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
        }),
        pythonDeveloper: await createJob({
          key: "python-developer",
          title: "Python Developer",
          location: "Hồ Chí Minh",
          status: "ACTIVE",
          publishedAt: new Date(now.getTime() - 30 * 60_000),
          applicationDeadline: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
          skills: pythonSkill
            ? [{ skillId: pythonSkill.id, displayName: "Python" }]
            : undefined,
        }),
      }
    : null;

  return {
    now,
    suffix,
    company,
    userIds,
    confirmedCvIds: userIds.map(
      (_, index) => `cv-confirmed-${index}-${suffix}`,
    ),
    unconfirmedCvIds: userIds.map(
      (_, index) => `cv-unconfirmed-${index}-${suffix}`,
    ),
    jobs,
    rankingJobs,
    createdSkillIds,
  };
}

export async function createJobBoardDatabaseFixture(
  label = "job-board",
  now = new Date("2026-08-01T08:00:00.000Z"),
  options: JobBoardDatabaseFixtureOptions = {},
) {
  assertTestDatabaseEnvironment();
  const suffix = randomUUID();
  const userIds = [`job-${label}-a-${suffix}`, `job-${label}-b-${suffix}`];
  try {
    return await createJobBoardDatabaseFixtureUnsafe(now, options, {
      suffix,
      userIds,
    });
  } catch (error) {
    try {
      await deleteJobBoardDatabaseFixture({
        company: { id: `company-${suffix}` },
        userIds,
        suffix,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Job-board fixture creation and rollback both failed for ${suffix}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

export async function deleteJobBoardDatabaseFixture(
  fixture: JobBoardFixtureNamespace,
) {
  assertTestDatabaseEnvironment();
  const jobIds = (
    await prisma.jobPosting.findMany({
      where: { companyId: fixture.company.id },
      select: { id: true },
    })
  ).map((job) => job.id);
  const applicationIds = (
    await prisma.jobApplication.findMany({
      where: { jobPostingId: { in: jobIds } },
      select: { id: true },
    })
  ).map((application) => application.id);
  const threadIds = (
    await prisma.recruitmentThread.findMany({
      where: { applicationId: { in: applicationIds } },
      select: { id: true },
    })
  ).map((thread) => thread.id);
  await prisma.recruitmentNotificationWork.deleteMany({
    where: { applicationId: { in: applicationIds } },
  });
  await prisma.emailOutbox.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await prisma.moderationReport.deleteMany({
    where: {
      OR: [
        { reporterUserId: { in: fixture.userIds } },
        { jobReference: { in: jobIds } },
        { applicationReference: { in: applicationIds } },
      ],
    },
  });
  await prisma.applicationAnswer.deleteMany({
    where: { applicationId: { in: applicationIds } },
  });
  await prisma.applicationArtifactPromotion.deleteMany({
    where: {
      OR: [
        { jobPostingId: { in: jobIds } },
        { jobApplicationId: { in: applicationIds } },
      ],
    },
  });
  await prisma.inAppNotification.deleteMany({
    where: {
      OR: [
        { recipientUserId: { in: fixture.userIds } },
        { contextId: { in: applicationIds } },
      ],
    },
  });
  await prisma.recruitmentMessage.deleteMany({
    where: {
      OR: [
        { threadId: { in: threadIds } },
        { senderUserId: { in: fixture.userIds } },
      ],
    },
  });
  await prisma.recruitmentThread.deleteMany({
    where: { id: { in: threadIds } },
  });
  await prisma.jobApplicationAttemptCounter.deleteMany({
    where: {
      candidateUserId: { in: fixture.userIds },
      jobPostingId: { in: jobIds },
    },
  });
  await prisma.jobApplication.deleteMany({
    where: { id: { in: applicationIds } },
  });
  // AuditEvent is database-enforced append-only. Keep immutable evidence and
  // remove only mutable fixture rows below; attempting to delete audit rows
  // makes teardown fail after an otherwise successful integration test.
  await prisma.jobReport.deleteMany({
    where: { jobPostingId: { in: jobIds } },
  });
  await prisma.savedJob.deleteMany({ where: { jobPostingId: { in: jobIds } } });
  await prisma.candidateCv.deleteMany({
    where: { candidateUserId: { in: fixture.userIds } },
  });
  await prisma.applicationQuestion.deleteMany({
    where: { jobPostingId: { in: jobIds } },
  });
  await prisma.jobPostingSkill.deleteMany({
    where: { jobPostingId: { in: jobIds } },
  });
  await prisma.jobPosting.deleteMany({ where: { id: { in: jobIds } } });
  // Candidate-first CV rows are protected by database immutability triggers
  // once a scan, extraction, parse, or confirmation reaches a terminal state.
  // Test teardown is the one explicitly authorized retention operation: remove
  // the complete per-account CV graph in one transaction with the isolated
  // retention mode enabled. This keeps production deletion semantics intact
  // while preventing a failed cleanup from leaving fixture users behind.
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT set_config('smarthire.cv_retention_mode', 'on', true)
    `;
    const uploads = await transaction.cvUpload.findMany({
      where: { accountId: { in: fixture.userIds } },
      select: { id: true },
    });
    const uploadIds = uploads.map((upload) => upload.id);
    if (uploadIds.length) {
      await transaction.cvImportConfirmation.deleteMany({
        where: { uploadId: { in: uploadIds } },
      });
      await transaction.cvProcessingConsent.deleteMany({
        where: { uploadId: { in: uploadIds } },
      });
      await transaction.cvRetryRequest.deleteMany({
        where: { uploadId: { in: uploadIds } },
      });
      await transaction.cvDraft.deleteMany({
        where: { uploadId: { in: uploadIds } },
      });
      await transaction.cvParseJob.deleteMany({
        where: { uploadId: { in: uploadIds } },
      });
      await transaction.cvExtraction.deleteMany({
        where: { uploadId: { in: uploadIds } },
      });
      await transaction.cvScanAssessment.deleteMany({
        where: { uploadId: { in: uploadIds } },
      });
      await transaction.cvStoredArtifact.deleteMany({
        where: { uploadId: { in: uploadIds } },
      });
      await transaction.cvUpload.deleteMany({
        where: { id: { in: uploadIds } },
      });
    }
    await transaction.cvAccountQuota.deleteMany({
      where: { accountId: { in: fixture.userIds } },
    });
  });
  const candidateSkillIds = [
    ...(fixture.createdSkillIds ?? []),
    ...(!fixture.createdSkillIds
      ? [`skill-${fixture.suffix}`, `skill-python-${fixture.suffix}`]
      : []),
  ];
  if (candidateSkillIds.length) {
    // A concurrent fixture may have won the normalized-name race and still
    // reference a skill created by this fixture.  Re-check every relation
    // immediately before deletion; a shared/global skill is never removed.
    const [jobSkillRefs, profileSkillRefs] = await Promise.all([
      prisma.jobPostingSkill.findMany({
        where: { skillId: { in: candidateSkillIds } },
        select: { skillId: true },
      }),
      prisma.candidateProfileSkill.findMany({
        where: { skillId: { in: candidateSkillIds } },
        select: { skillId: true },
      }),
    ]);
    const referencedSkillIds = new Set([
      ...jobSkillRefs.map((row) => row.skillId),
      ...profileSkillRefs.map((row) => row.skillId),
    ]);
    const unreferencedSkillIds = candidateSkillIds.filter(
      (skillId) => !referencedSkillIds.has(skillId),
    );
    if (unreferencedSkillIds.length) {
      await prisma.skill.deleteMany({
        where: { id: { in: unreferencedSkillIds } },
      });
    }
  }
  await prisma.companyMembership.deleteMany({
    where: {
      companyId: fixture.company.id,
      userId: { in: fixture.userIds },
    },
  });
  await prisma.company.deleteMany({ where: { id: fixture.company.id } });
  await prisma.candidateIdentity.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await prisma.authProviderAccount.deleteMany({
    where: { userId: { in: fixture.userIds } },
  });
  await prisma.userAccount.deleteMany({
    where: { id: { in: fixture.userIds } },
  });
}
