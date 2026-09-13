import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/backend/database/prisma";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import {
  createJobBoardDatabaseFixture,
  deleteJobBoardDatabaseFixture,
} from "./job-board-database-fixture";
import { seedCleanJobApplicationCv } from "./job-application-cv-fixture";

export type CandidateFirstDatabaseFixture = Awaited<
  ReturnType<typeof createCandidateFirstDatabaseFixture>
>;

const password = "Candidate-first fixture 2026!";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const fixtureStorageLocatorPattern = /^[A-Za-z0-9_-]{32,128}$/u;

async function cleanupCandidateFirstStorage(userIds: readonly string[]) {
  try {
    const [artifacts, candidateCvs, applicationDocuments, promotions] =
      await Promise.all([
        prisma.cvStoredArtifact.findMany({
          where: { accountId: { in: [...userIds] } },
          select: { storageLocator: true },
        }),
        prisma.candidateCv.findMany({
          where: { candidateUserId: { in: [...userIds] } },
          select: { storageKey: true },
        }),
        prisma.applicationDocument.findMany({
          where: { application: { candidateUserId: { in: [...userIds] } } },
          select: { storageKeyEncrypted: true },
        }),
        prisma.applicationArtifactPromotion.findMany({
          where: { candidateUserId: { in: [...userIds] } },
          select: { storageKeyEncrypted: true },
        }),
      ]);
    const locators = [
      ...artifacts.map((row) => row.storageLocator),
      ...candidateCvs.map((row) => row.storageKey),
      ...applicationDocuments.map((row) => row.storageKeyEncrypted),
      ...promotions.map((row) => row.storageKeyEncrypted),
    ].filter(
      (locator): locator is string =>
        typeof locator === "string" &&
        fixtureStorageLocatorPattern.test(locator),
    );
    if (!locators.length) return;
    const storage = createCvWorkerStorage();
    await storage.assertReady();
    await Promise.all(
      [...new Set(locators)].map((locator) =>
        storage.delete(locator).catch(() => undefined),
      ),
    );
  } catch {
    // Database teardown remains useful when the optional fixture storage is
    // unavailable. The caller still removes the complete DB namespace.
  }
}

/**
 * Disposable, self-contained data for the first Candidate journey.  The
 * underlying job-board fixture gives us two accounts, profiles, confirmed
 * CVs, a verified company and public jobs; this layer adds the persisted
 * application, notification and assigned recruitment message the smoke flow
 * needs to exercise read projections.
 */
export async function createCandidateFirstDatabaseFixture(
  label = "candidate-first",
  now = new Date("2026-09-05T08:00:00.000Z"),
) {
  const databaseFixture = await createJobBoardDatabaseFixture(
    `candidate-first-${label}`,
    now,
  );
  try {
    const candidateUserId = databaseFixture.userIds[0]!;
    const employerUserId = databaseFixture.userIds[1]!;
    const job = databaseFixture.jobs.active;
    const legacyConfirmedCvId = databaseFixture.confirmedCvIds[0]!;
    const secureCv = await seedCleanJobApplicationCv({
      candidateUserId,
      now,
      label: `candidate-first-${databaseFixture.suffix}`,
      purpose: "PROFILE_IMPORT",
      processingMode: "IMPORT_AND_PARSE",
    });
    await prisma.candidateCv.delete({ where: { id: legacyConfirmedCvId } });
    const confirmedCvId = secureCv.candidateCvId;
    const applicationId = `application-candidate-first-${databaseFixture.suffix}`;
    const membershipId = `membership-candidate-first-${databaseFixture.suffix}`;
    const threadId = `thread-candidate-first-${databaseFixture.suffix}`;
    const messageId = `message-candidate-first-${databaseFixture.suffix}`;
    const notificationId = `notification-candidate-first-${databaseFixture.suffix}`;
    const applicationKey = `candidate-first-${databaseFixture.suffix}`;
    const correlationId = `candidate-first-correlation-${databaseFixture.suffix}`;
    const cv = await prisma.candidateCv.findUniqueOrThrow({
      where: { id: confirmedCvId },
    });
    const candidate = await prisma.userAccount.findUniqueOrThrow({
      where: { id: candidateUserId },
      select: { email: true },
    });
    const employer = await prisma.userAccount.findUniqueOrThrow({
      where: { id: employerUserId },
      select: { email: true },
    });

    await prisma.authProviderAccount.create({
      data: {
        id: `account-candidate-first-${databaseFixture.suffix}`,
        accountId: candidateUserId,
        providerId: "credential",
        userId: candidateUserId,
        password: await hashPassword(password),
      },
    });
    await prisma.authProviderAccount.create({
      data: {
        id: `account-employer-candidate-first-${databaseFixture.suffix}`,
        accountId: employerUserId,
        providerId: "credential",
        userId: employerUserId,
        password: await hashPassword(password),
      },
    });
    const membership = await prisma.companyMembership.create({
      data: {
        id: membershipId,
        companyId: databaseFixture.company.id,
        userId: employerUserId,
        role: "OWNER",
        priorApprovedRole: "OWNER",
        status: "ACTIVE",
      },
    });

    await prisma.jobApplication.create({
      data: {
        id: applicationId,
        candidateUserId,
        jobPostingId: job.id,
        applicationAttemptNumber: 1,
        selectedCvId: cv.id,
        cvFileRef: cv.storageKey,
        contactSnapshot: {
          fullName: "Job Candidate 1",
          email: candidate.email,
          phone: "0901234567",
          location: "Ho Chi Minh City",
        },
        aiAnalysisConsent: false,
        scoringStatus: "NOT_REQUESTED",
        stage: "APPLIED",
        stageVersion: 1,
        lastStageChangedAt: now,
        profileSnapshot: {
          v: 1,
          candidateName: "Job Candidate 1",
          email: candidate.email,
          headline: "TypeScript Engineer",
          summary: "Builds accessible recruitment products.",
          phone: "0901234567",
          location: "Ho Chi Minh City",
          skills: [{ id: "fixture-skill-typescript", label: "TypeScript" }],
          experience: [],
          education: [],
        },
        cvSnapshot: {
          cvId: cv.id,
          cvVersion: cv.version,
          displayName: cv.displayName,
          fileName: cv.fileName,
          mimeType: cv.mimeType,
          byteSize: cv.byteSize,
          storageKey: cv.storageKey,
          checksumSha256: cv.checksumSha256,
        },
        jobSnapshot: {
          jobId: job.id,
          slug: job.slug,
          title: job.title,
          companyName: databaseFixture.company.displayName,
          location: job.location,
          employmentType: job.employmentType,
          experienceLevel: job.experienceLevel,
          workArrangement: job.workArrangement,
          requiredSkills: job.skills?.map((skill) => skill.displayName) ?? [],
          jobVersion: job.version,
        },
        consentVersion: "2026-09-01",
        consentedAt: now,
        idempotencyKey: applicationKey,
        submissionBindingDigest: digest(
          `${candidateUserId}:${job.id}:${applicationKey}`,
        ),
        submittedAt: now,
        contactConsent: {
          create: {
            sharedAt: null,
            withdrawnAt: now,
            version: 1,
          },
        },
        stageEvents: {
          create: {
            id: `stage-event-candidate-first-${databaseFixture.suffix}`,
            fromStage: null,
            toStage: "APPLIED",
            actorUserId: candidateUserId,
            actorType: "CANDIDATE",
            candidateVisible: true,
            occurredAt: now,
            applicationVersion: 1,
            idempotencyKey: `stage-event-${applicationKey}`,
          },
        },
        intake: {
          create: {
            state: "SENT_TO_RECRUITER",
            progressPercent: 100,
            receivedAt: now,
            checkingStartedAt: now,
            sentAt: now,
            version: 1,
            updatedAt: now,
          },
        },
        notificationPreference: {
          create: {
            emailEnabled: true,
            inAppEnabled: true,
            version: 1,
            updatedAt: now,
          },
        },
        publicUpdates: {
          create: {
            id: `public-update-candidate-first-${databaseFixture.suffix}`,
            kind: "SUBMITTED",
            publicStage: "APPLICATION_SUBMITTED",
            title: "Application submitted",
            effectiveAt: now,
            deduplicationKey: `public-update-${applicationKey}`,
            sourceEventReference: `stage-event-candidate-first-${databaseFixture.suffix}`,
          },
        },
      },
    });

    await prisma.recruitmentThread.create({
      data: {
        id: threadId,
        applicationId,
        companyId: databaseFixture.company.id,
        jobPostingId: job.id,
        candidateUserId,
        assignedMembershipId: membership.id,
        state: "OPEN",
        nextMessageSequence: 2,
        lastMessageSequence: 1,
        lastMessageAt: now,
      },
    });
    await prisma.recruitmentMessage.create({
      data: {
        id: messageId,
        threadId,
        sequence: 1,
        senderUserId: employerUserId,
        senderMembershipId: membership.id,
        clientOperationId: `fixture-message-${databaseFixture.suffix}`,
        content: "Thanks for applying. We will review your profile shortly.",
        createdAt: now,
      },
    });
    await prisma.inAppNotification.create({
      data: {
        id: notificationId,
        recipientUserId: candidateUserId,
        kind: "APPLICATION_SUBMITTED",
        category: "APPLICATION",
        severity: "LOW",
        audience: "USER",
        recipientRole: "CANDIDATE",
        title: "Application submitted",
        summary: "Your application was submitted successfully.",
        href: `/jobs/applied/${applicationId}`,
        contextType: "APPLICATION",
        contextId: applicationId,
        deduplicationKey: `notification-${applicationKey}`,
        correlationId,
        occurrenceCount: 1,
        createdAt: now,
        lastOccurredAt: now,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      },
    });

    return {
      ...databaseFixture,
      candidateUserId,
      employerUserId,
      employerEmail: employer.email,
      employerPassword: password,
      candidateEmail: candidate.email,
      candidatePassword: password,
      confirmedCvId,
      applicationId,
      membershipId,
      threadId,
      messageId,
      notificationId,
    };
  } catch (error) {
    await cleanupCandidateFirstStorage(databaseFixture.userIds);
    try {
      await deleteJobBoardDatabaseFixture(databaseFixture);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Candidate-first fixture creation and rollback both failed for ${databaseFixture.suffix}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

export async function deleteCandidateFirstDatabaseFixture(
  fixture: Pick<
    CandidateFirstDatabaseFixture,
    "company" | "userIds" | "suffix"
  >,
) {
  await cleanupCandidateFirstStorage(fixture.userIds);
  await deleteJobBoardDatabaseFixture(fixture);
}
