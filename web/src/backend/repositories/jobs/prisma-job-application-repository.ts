import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/backend/generated/prisma/client";
import {
  ApplicationArtifactPromotionState,
  ApplicationDocumentKind,
} from "@/backend/generated/prisma/enums";
import { prisma } from "@/backend/database/prisma";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import {
  ApplicationRepositoryError,
  type DirectApplicationCv,
  prepareApplicationSubmission,
} from "@/backend/services/jobs/application-policy";
import { DIRECT_APPLICATION_CV_ID } from "@/shared/contracts/jobs/actions";
import {
  hasReachedApplicationLimit,
  isActiveApplication,
} from "@/backend/services/jobs/application-attempt-policy";
import { ensureCandidateCvLibrary } from "@/backend/services/profile/candidate-cv-library";
import type {
  ApplicationForm,
  ApplicationSubmission,
  ApplicationOutcome,
} from "@/shared/contracts/jobs/actions";
import { createInAppNotification } from "@/backend/notifications/notification-service";
import { NotificationRecipientPolicy } from "@/backend/notifications/notification-recipient-policy";
import { createApplicationDocumentStorage } from "@/backend/applications/storage/factory";
import type { ApplicationDocumentStoragePort } from "@/backend/applications/storage/application-document-storage";
import { CV_SECURITY_POLICY_VERSION } from "@/shared/contracts/cv-import/common";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";
import {
  acquireCompanyDeletionObjectLock,
  assertCompanyDeletionObjectCanBeReferenced,
} from "@/backend/services/jobs/company-deletion-object-lock";

type CandidateApplicationForm = {
  job: {
    id: string;
    title: string;
    location: string;
    company: { displayName: string };
  };
  profileReady: boolean;
  missingProfileFields: string[];
  profileRevision: number;
  profileBasics: ApplicationForm["profileBasics"];
  contact?: ApplicationForm["contact"];
  cvs: Array<
    Omit<ApplicationForm["cvs"][number], "confirmedAt"> & { confirmedAt: Date }
  >;
  questions: ApplicationForm["questions"];
  existingApplication: ApplicationOutcome | null;
  applicationCount?: number;
};

export type ApplicationRepositoryPort = {
  getCandidateForm(
    userId: string,
    jobId: string,
    now: Date,
  ): Promise<CandidateApplicationForm | null>;
  submit(input: {
    candidateUserId: string;
    sessionId: string;
    jobId: string;
    idempotencyKey: string;
    submissionBindingDigest: string;
    command: ApplicationSubmission;
    directCv?: DirectApplicationCv;
    directCoverLetter?: DirectApplicationCv;
    activeConsentVersion: string;
    occurredAt: Date;
    correlationId: string;
    draftId?: string;
    expectedDraftRevision?: number;
  }): Promise<{ application: ApplicationOutcome; created: boolean }>;
};

const outcome = (
  row: {
    id: string;
    jobPostingId: string;
    stage: string;
    submittedAt: Date;
    stageVersion?: number;
    aiAnalysisConsent?: boolean;
    aiMatchScore?: number | null;
    applicationAttemptNumber?: number;
  },
  created: boolean,
): ApplicationOutcome => ({
  applicationId: row.id,
  jobId: row.jobPostingId,
  stage: "APPLIED",
  stageVersion: row.stageVersion ?? 1,
  submittedAt: row.submittedAt.toISOString(),
  created,
  message: created
    ? "Application submitted."
    : "Your application was already submitted.",
  aiAnalysisConsent: row.aiAnalysisConsent,
  aiMatchScore: row.aiMatchScore,
  applicationAttemptNumber: row.applicationAttemptNumber,
});

type PromotedArtifact = Readonly<{
  promotionId: string;
  storageKey: string;
  kind: ApplicationDocumentKind;
  checksumSha256: string;
}>;

type DurableApplicationState = Readonly<{
  id: string;
  applicationDocuments: Array<{
    storageKeyEncrypted: string;
    contentDigestHmac: string;
  }>;
}>;

type ArtifactReconciliation = "PRESERVED" | "CLEANED" | "UNKNOWN";

export class PrismaJobApplicationRepository implements ApplicationRepositoryPort {
  constructor(
    private readonly db: typeof prisma = prisma,
    private readonly applicationStorage?: ApplicationDocumentStoragePort,
  ) {}

  private documentStorage() {
    return this.applicationStorage ?? createApplicationDocumentStorage();
  }

  private async submitSerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.db.$transaction(operation, {
          isolationLevel: "Serializable",
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";
        if (!retryable || attempt === maxAttempts) throw error;
        // Only the callback is retried. Its writes are all in the serializable
        // transaction, so no provider delivery or post-commit work repeats.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, attempt * 10);
        });
      }
    }
    throw new Error("APPLICATION_SUBMISSION_RETRY_EXHAUSTED");
  }

  private markArtifactsOwned(input: {
    directCv?: DirectApplicationCv;
    directCoverLetter?: DirectApplicationCv;
  }) {
    input.directCv?.claimOwnership?.();
    input.directCoverLetter?.claimOwnership?.();
  }

  private preserveArtifactsOnUnknown(input: {
    directCv?: DirectApplicationCv;
    directCoverLetter?: DirectApplicationCv;
  }) {
    input.directCv?.preserveOnUnknown?.();
    input.directCoverLetter?.preserveOnUnknown?.();
  }

  /**
   * A promotion is staged before the application transaction so a rollback or
   * an unavailable database still leaves a durable cleanup record.  The
   * ledger is intentionally conservative: a missing row or a failed read is
   * an unknown outcome and therefore never authorizes object deletion.
   */
  private async stageArtifacts(
    input: Parameters<ApplicationRepositoryPort["submit"]>[0],
    artifacts: readonly PromotedArtifact[],
  ) {
    const staged: string[] = [];
    try {
      for (const artifact of artifacts) {
        await this.db.$transaction(async (tx) => {
          await acquireCompanyDeletionObjectLock(tx, artifact.storageKey);
          await assertCompanyDeletionObjectCanBeReferenced(
            tx,
            artifact.storageKey,
          );
          await tx.applicationArtifactPromotion.create({
            data: {
              id: artifact.promotionId,
              candidateUserId: input.candidateUserId,
              jobPostingId: input.jobId,
              kind: artifact.kind,
              storagePurposeVersion: "application-document-v1",
              storageKeyEncrypted: artifact.storageKey,
              contentDigestSha256: artifact.checksumSha256,
              state: ApplicationArtifactPromotionState.PROMOTED,
              orphanDeleteAfter: new Date(
                input.occurredAt.getTime() + 24 * 60 * 60 * 1000,
              ),
            },
          });
        });
        staged.push(artifact.promotionId);
      }
      return staged;
    } catch (error) {
      this.preserveArtifactsOnUnknown(input);
      throw error;
    }
  }

  private async findDurableApplication(
    input: Parameters<ApplicationRepositoryPort["submit"]>[0],
    applicationId?: string,
  ): Promise<DurableApplicationState | null> {
    if (applicationId) {
      return this.db.jobApplication.findUnique({
        where: { id: applicationId },
        select: {
          id: true,
          applicationDocuments: {
            where: { deletedAt: null },
            select: {
              storageKeyEncrypted: true,
              contentDigestHmac: true,
            },
          },
        },
      });
    }
    return this.db.jobApplication.findUnique({
      where: {
        candidateUserId_idempotencyKey: {
          candidateUserId: input.candidateUserId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: {
        id: true,
        applicationDocuments: {
          where: { deletedAt: null },
          select: {
            storageKeyEncrypted: true,
            contentDigestHmac: true,
          },
        },
      },
    });
  }

  private async reconcileArtifacts(
    input: Parameters<ApplicationRepositoryPort["submit"]>[0],
    artifacts: readonly PromotedArtifact[],
    storage: ApplicationDocumentStoragePort | null,
    options: { applicationId?: string; allowCleanup: boolean },
  ): Promise<ArtifactReconciliation> {
    if (!artifacts.length) return "CLEANED";
    try {
      const rows = await this.db.applicationArtifactPromotion.findMany({
        where: {
          id: { in: artifacts.map((artifact) => artifact.promotionId) },
        },
        select: {
          id: true,
          state: true,
          jobApplicationId: true,
          storageKeyEncrypted: true,
          contentDigestSha256: true,
        },
      });
      if (rows.length !== artifacts.length) {
        this.preserveArtifactsOnUnknown(input);
        return "UNKNOWN";
      }
      const application = await this.findDurableApplication(
        input,
        options.applicationId,
      );
      if (!application) {
        if (!options.allowCleanup || !storage) {
          this.preserveArtifactsOnUnknown(input);
          return "UNKNOWN";
        }
        // A deterministic domain error means the transaction was rolled back.
        // Before deleting, prove that no other application already references
        // the locator; this protects a replay or a shared storage key.
        for (const artifact of artifacts) {
          const peer = await this.db.applicationDocument.findFirst({
            where: {
              storageKeyEncrypted: artifact.storageKey,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (peer) {
            this.preserveArtifactsOnUnknown(input);
            return "UNKNOWN";
          }
        }
        let cleaned = 0;
        for (const artifact of artifacts) {
          const row = rows.find(
            (candidate) => candidate.id === artifact.promotionId,
          );
          if (!row) {
            this.preserveArtifactsOnUnknown(input);
            return "UNKNOWN";
          }
          try {
            await storage.delete(artifact.storageKey);
            await this.db.applicationArtifactPromotion.update({
              where: { id: row.id },
              data: {
                state: ApplicationArtifactPromotionState.DELETED,
                deletedAt: input.occurredAt,
                lastSafeFailureCode: null,
                attemptCount: { increment: 1 },
              },
            });
            cleaned += 1;
          } catch {
            await this.db.applicationArtifactPromotion
              .update({
                where: { id: row.id },
                data: {
                  state: ApplicationArtifactPromotionState.DELETE_FAILED,
                  attemptCount: { increment: 1 },
                  lastSafeFailureCode: "APPLICATION_STORAGE_DELETE_FAILED",
                },
              })
              .catch(() => undefined);
            this.preserveArtifactsOnUnknown(input);
            return "PRESERVED";
          }
        }
        return cleaned === artifacts.length ? "CLEANED" : "PRESERVED";
      }

      let cleaned = 0;
      for (const artifact of artifacts) {
        const row = rows.find(
          (candidate) => candidate.id === artifact.promotionId,
        );
        if (!row) {
          this.preserveArtifactsOnUnknown(input);
          return "UNKNOWN";
        }
        const ownedDocument = application.applicationDocuments.find(
          (document) => document.storageKeyEncrypted === artifact.storageKey,
        );
        if (
          row.state === ApplicationArtifactPromotionState.COMMITTED ||
          row.jobApplicationId
        ) {
          if (
            !row.contentDigestSha256 ||
            row.contentDigestSha256 !== artifact.checksumSha256 ||
            !ownedDocument ||
            ownedDocument.contentDigestHmac !== artifact.checksumSha256
          ) {
            await this.db.applicationArtifactPromotion.update({
              where: { id: row.id },
              data: {
                lastSafeFailureCode: "APPLICATION_ARTIFACT_DIGEST_MISMATCH",
              },
            });
            this.preserveArtifactsOnUnknown(input);
            return "UNKNOWN";
          }
          this.markArtifactsOwned(input);
          continue;
        }
        if (ownedDocument) {
          // A matching locator is only safe to retain when its digest also
          // agrees.  A collision or changed digest is retained for manual
          // reconciliation rather than being deleted.
          if (
            row.contentDigestSha256 !== artifact.checksumSha256 ||
            ownedDocument.contentDigestHmac !== artifact.checksumSha256
          ) {
            await this.db.applicationArtifactPromotion.update({
              where: { id: row.id },
              data: {
                lastSafeFailureCode: "APPLICATION_ARTIFACT_DIGEST_MISMATCH",
              },
            });
            this.preserveArtifactsOnUnknown(input);
            return "UNKNOWN";
          }
          await this.db.applicationArtifactPromotion.update({
            where: { id: row.id },
            data: {
              state: ApplicationArtifactPromotionState.COMMITTED,
              jobApplicationId: application.id,
              lastSafeFailureCode: null,
            },
          });
          this.markArtifactsOwned(input);
          continue;
        }
        if (!options.allowCleanup || !storage) {
          this.preserveArtifactsOnUnknown(input);
          return "PRESERVED";
        }
        try {
          await storage.delete(artifact.storageKey);
          await this.db.applicationArtifactPromotion.update({
            where: { id: row.id },
            data: {
              state: ApplicationArtifactPromotionState.DELETED,
              deletedAt: input.occurredAt,
              lastSafeFailureCode: null,
              attemptCount: { increment: 1 },
            },
          });
          cleaned += 1;
        } catch {
          await this.db.applicationArtifactPromotion
            .update({
              where: { id: row.id },
              data: {
                state: ApplicationArtifactPromotionState.DELETE_FAILED,
                attemptCount: { increment: 1 },
                lastSafeFailureCode: "APPLICATION_STORAGE_DELETE_FAILED",
              },
            })
            .catch(() => undefined);
          this.preserveArtifactsOnUnknown(input);
          return "PRESERVED";
        }
      }
      return cleaned === artifacts.length ? "CLEANED" : "PRESERVED";
    } catch {
      this.preserveArtifactsOnUnknown(input);
      return "UNKNOWN";
    }
  }

  async getCandidateForm(userId: string, jobId: string, now: Date) {
    await ensureCandidateCvLibrary(userId, this.db);
    const [candidate, job, existingApplication, attemptCounter] =
      await Promise.all([
        this.db.candidateIdentity.findFirst({
          where: { userId, user: { state: "ACTIVE" } },
          include: {
            user: { select: { name: true, email: true } },
            profile: {
              select: {
                headline: true,
                summary: true,
                location: true,
                phone: true,
                revision: true,
              },
            },
            cvs: {
              where: {
                confirmedAt: { not: null },
                archivedAt: null,
                byteSize: { gte: 1, lte: 5_000_000 },
                mimeType: {
                  in: [
                    "application/pdf",
                    "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  ],
                },
                sourceArtifactId: { not: null },
                scanAssessmentId: { not: null },
                sourceArtifact: {
                  is: {
                    kind: "SOURCE_DOCUMENT",
                    status: "AVAILABLE",
                    deletedAt: null,
                    contentInaccessibleAt: null,
                    upload: {
                      is: {
                        status: { in: ["SECURITY_CLEAN", "CONFIRMED"] },
                        purpose: { in: ["PROFILE_IMPORT", "PROFILE_DIRECT"] },
                        policyVersion: CV_SECURITY_POLICY_VERSION,
                        deletedAt: null,
                        contentInaccessibleAt: null,
                      },
                    },
                  },
                },
                scanAssessment: {
                  is: {
                    status: "CLEAN",
                    completedAt: { not: null },
                    policyVersion: CV_SECURITY_POLICY_VERSION,
                  },
                },
              },
              orderBy: { confirmedAt: "desc" },
              select: {
                id: true,
                displayName: true,
                fileName: true,
                mimeType: true,
                byteSize: true,
                version: true,
                confirmedAt: true,
                sourceArtifactId: true,
                scanAssessmentId: true,
                sourceArtifact: { select: { id: true } },
                scanAssessment: {
                  select: { id: true, sourceArtifactId: true },
                },
              },
            },
          },
        }),
        this.db.jobPosting.findFirst({
          where: {
            id: jobId,
            status: "ACTIVE",
            approvedAt: { not: null },
            publishedAt: { not: null, lte: now },
            OR: [
              { applicationDeadline: null },
              { applicationDeadline: { gt: now } },
            ],
            company: { verifiedAt: { not: null } },
          },
          select: {
            id: true,
            title: true,
            location: true,
            company: { select: { displayName: true } },
            questions: {
              where: { active: true },
              orderBy: { position: "asc" },
              select: {
                id: true,
                prompt: true,
                description: true,
                kind: true,
                required: true,
                options: true,
                version: true,
              },
            },
          },
        }),
        this.db.jobApplication.findFirst({
          where: {
            candidateUserId: userId,
            jobPostingId: jobId,
            withdrawalOutcome: null,
            stage: { not: "REJECTED" },
          },
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        }),
        this.db.jobApplicationAttemptCounter.findUnique({
          where: {
            candidateUserId_jobPostingId: {
              candidateUserId: userId,
              jobPostingId: jobId,
            },
          },
          select: { applicationCount: true },
        }),
      ]);
    if (!candidate || !job) return null;
    const missingProfileFields = [
      !candidate.user.name.trim() ? "name" : null,
      !candidate.profile?.location?.trim() ? "location" : null,
    ].filter((field): field is string => field !== null);
    return {
      job,
      profileReady: missingProfileFields.length === 0,
      missingProfileFields,
      profileRevision: candidate.profile?.revision ?? 0,
      profileBasics: {
        headline: candidate.profile?.headline ?? null,
        summary: candidate.profile?.summary ?? null,
        phone: candidate.profile?.phone ?? null,
        location: candidate.profile?.location ?? null,
      },
      contact: {
        fullName: candidate.user.name,
        email: candidate.user.email,
        phone: candidate.profile?.phone ?? "",
      },
      cvs: candidate.cvs.flatMap((cv) => {
        if (
          !cv.confirmedAt ||
          cv.sourceArtifactId !== cv.sourceArtifact?.id ||
          cv.scanAssessmentId !== cv.scanAssessment?.id ||
          cv.scanAssessment.sourceArtifactId !== cv.sourceArtifact?.id ||
          ![
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ].includes(cv.mimeType)
        )
          return [];
        return [
          {
            id: cv.id,
            displayName: cv.displayName,
            fileName: cv.fileName,
            byteSize: cv.byteSize,
            mimeType:
              cv.mimeType as CandidateApplicationForm["cvs"][number]["mimeType"],
            version: cv.version,
            confirmedAt: cv.confirmedAt,
          },
        ];
      }),
      questions: job.questions.map((question) => ({
        ...question,
        options: Array.isArray(question.options)
          ? question.options.filter(
              (value): value is string => typeof value === "string",
            )
          : null,
      })),
      existingApplication: existingApplication
        ? outcome(existingApplication, false)
        : null,
      applicationCount: attemptCounter?.applicationCount ?? 0,
    };
  }

  async submit(input: Parameters<ApplicationRepositoryPort["submit"]>[0]) {
    await ensureCandidateCvLibrary(input.candidateUserId, this.db);
    if (input.directCv) {
      // Non-HTTP callers must not revive the legacy unscanned/plaintext path.
      throw new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE");
    }
    let promotedStorage: ApplicationDocumentStoragePort | null = null;
    let promotedApplicationDocument:
      | {
          storageKey: string;
          fileName: string;
          mediaType: string;
          byteLength: number;
          checksumSha256: string;
          sourceCvId: string;
          sourceCvVersion: number;
        }
      | undefined;
    let promotedCoverLetterDocument:
      | {
          promotionId: string;
          storageKey: string;
          fileName: string;
          mediaType: string;
          byteLength: number;
          checksumSha256: string;
        }
      | undefined;
    let stagedPromotionIds: string[] = [];
    let promotedArtifacts: PromotedArtifact[] = [];
    try {
      const existingByKey = await this.db.jobApplication.findUnique({
        where: {
          candidateUserId_idempotencyKey: {
            candidateUserId: input.candidateUserId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existingByKey) {
        if (
          existingByKey.submissionBindingDigest !==
          input.submissionBindingDigest
        ) {
          throw new ApplicationRepositoryError("IDEMPOTENCY_KEY_REUSED");
        }
        return { application: outcome(existingByKey, false), created: false };
      }
      const existingDuplicate = await this.db.jobApplication.findFirst({
        where: {
          candidateUserId: input.candidateUserId,
          jobPostingId: input.jobId,
          withdrawalOutcome: null,
          stage: { not: "REJECTED" },
        },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      });
      if (existingDuplicate && isActiveApplication(existingDuplicate)) {
        return {
          application: outcome(existingDuplicate, false),
          created: false,
        };
      }
      const selectedSourceCv = input.directCv
        ? null
        : await this.db.candidateCv.findUnique({
            where: { id: input.command.cvId },
            select: {
              id: true,
              candidateUserId: true,
              fileName: true,
              mimeType: true,
              byteSize: true,
              storageKey: true,
              checksumSha256: true,
              version: true,
              confirmedAt: true,
              archivedAt: true,
              sourceArtifactId: true,
              scanAssessmentId: true,
              sourceArtifact: {
                select: { uploadId: true, storageLocator: true },
              },
            },
          });
      const sourceCv = selectedSourceCv
        ? {
            ...selectedSourceCv,
            uploadId: selectedSourceCv.sourceArtifact?.uploadId ?? null,
          }
        : null;
      if (sourceCv?.candidateUserId === input.candidateUserId) {
        if (
          !sourceCv.sourceArtifactId ||
          !sourceCv.scanAssessmentId ||
          !sourceCv.sourceArtifact?.uploadId
        ) {
          throw new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE");
        }
        const opened = await new OpenSafeCvArtifactService().open({
          candidateUserId: input.candidateUserId,
          uploadId: sourceCv.sourceArtifact.uploadId,
          artifactId: sourceCv.sourceArtifactId,
          assessmentId: sourceCv.scanAssessmentId,
          allowedPurposes: [
            "PROFILE_IMPORT",
            "PROFILE_DIRECT",
            "JOB_APPLICATION_DIRECT",
          ],
        });
        try {
          if (
            opened.byteLength !== sourceCv.byteSize ||
            opened.evidence.checksumSha256.toLowerCase() !==
              sourceCv.checksumSha256.toLowerCase() ||
            opened.evidence.storageLocator !==
              sourceCv.sourceArtifact.storageLocator
          ) {
            throw new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE");
          }
        } finally {
          await opened.dispose();
        }
        promotedApplicationDocument = {
          storageKey:
            sourceCv.sourceArtifact?.storageLocator ?? sourceCv.storageKey,
          fileName: sourceCv.fileName,
          mediaType: sourceCv.mimeType,
          byteLength: sourceCv.byteSize,
          checksumSha256: sourceCv.checksumSha256,
          sourceCvId: sourceCv.id,
          sourceCvVersion: sourceCv.version,
        };
      }
      if (!promotedApplicationDocument) {
        throw new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE");
      }
      if (input.directCoverLetter) {
        promotedStorage ??= this.documentStorage();
        promotedCoverLetterDocument = {
          promotionId: randomUUID(),
          storageKey: input.directCoverLetter.storageKey,
          fileName: input.directCoverLetter.fileName,
          mediaType: input.directCoverLetter.mimeType,
          byteLength: input.directCoverLetter.byteSize,
          checksumSha256: input.directCoverLetter.checksumSha256,
        };
      }
      promotedArtifacts = [
        ...(promotedCoverLetterDocument
          ? [
              {
                promotionId: promotedCoverLetterDocument.promotionId,
                storageKey: promotedCoverLetterDocument.storageKey,
                kind: ApplicationDocumentKind.COVER_LETTER,
                checksumSha256: promotedCoverLetterDocument.checksumSha256,
              },
            ]
          : []),
      ];
      stagedPromotionIds = await this.stageArtifacts(input, promotedArtifacts);

      // Materialize every object only after its durable promotion row exists.
      // A lost storage response is then recoverable by the retention worker.
      await input.directCoverLetter?.ensureStored?.();
      const objectKeysToCommit = [
        promotedApplicationDocument?.storageKey,
        promotedCoverLetterDocument?.storageKey,
      ]
        .filter((key): key is string => Boolean(key))
        .filter((key, index, keys) => keys.indexOf(key) === index)
        .sort();
      const result = await this.submitSerializable(async (tx) => {
        for (const objectKey of objectKeysToCommit) {
          await acquireCompanyDeletionObjectLock(tx, objectKey);
          await assertCompanyDeletionObjectCanBeReferenced(tx, objectKey);
        }
        const sameKey = await tx.jobApplication.findUnique({
          where: {
            candidateUserId_idempotencyKey: {
              candidateUserId: input.candidateUserId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (sameKey) {
          if (sameKey.submissionBindingDigest !== input.submissionBindingDigest)
            throw new ApplicationRepositoryError("IDEMPOTENCY_KEY_REUSED");
          return { application: outcome(sameKey, false), created: false };
        }
        await tx.$queryRaw`
            SELECT "userId"
            FROM "CandidateIdentity"
            WHERE "userId" = ${input.candidateUserId}
            FOR UPDATE
          `;
        const duplicate = await tx.jobApplication.findFirst({
          where: {
            candidateUserId: input.candidateUserId,
            jobPostingId: input.jobId,
            withdrawalOutcome: null,
            stage: { not: "REJECTED" },
          },
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        });
        if (duplicate && isActiveApplication(duplicate))
          return { application: outcome(duplicate, false), created: false };

        const attemptCounter = await tx.jobApplicationAttemptCounter.findUnique(
          {
            where: {
              candidateUserId_jobPostingId: {
                candidateUserId: input.candidateUserId,
                jobPostingId: input.jobId,
              },
            },
            select: { applicationCount: true },
          },
        );
        const currentApplicationCount = attemptCounter?.applicationCount ?? 0;
        if (hasReachedApplicationLimit(currentApplicationCount)) {
          throw new ApplicationRepositoryError("APPLICATION_MAX_ATTEMPTS");
        }
        const nextApplicationAttemptNumber = currentApplicationCount + 1;

        if (input.draftId) {
          const draft = await tx.candidateApplicationDraft.findFirst({
            where: {
              id: input.draftId,
              candidateUserId: input.candidateUserId,
              jobPostingId: input.jobId,
              expiresAt: { gt: input.occurredAt },
            },
            select: {
              id: true,
              revision: true,
              confirmationAccepted: true,
            },
          });
          if (
            !draft ||
            draft.revision !== input.expectedDraftRevision ||
            !draft.confirmationAccepted
          ) {
            throw new ApplicationRepositoryError(
              !draft || draft.revision !== input.expectedDraftRevision
                ? "APPLICATION_DRAFT_CONFLICT"
                : "APPLICATION_CONFIRMATION_REQUIRED",
            );
          }
        }

        const candidate = await tx.candidateIdentity.findFirst({
          where: { userId: input.candidateUserId, user: { state: "ACTIVE" } },
          include: {
            user: { select: { name: true, email: true } },
            profile: {
              include: {
                skills: {
                  orderBy: { position: "asc" },
                  include: { skill: true },
                },
                experiences: { orderBy: { position: "asc" } },
                education: { orderBy: { position: "asc" } },
              },
            },
          },
        });
        if (input.directCv && input.command.cvId !== DIRECT_APPLICATION_CV_ID) {
          throw new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE");
        }
        const cv = input.directCv
          ? await tx.candidateCv.create({
              data: {
                id: input.directCv.id,
                candidateUserId: input.candidateUserId,
                displayName: input.directCv.displayName,
                fileName: input.directCv.fileName,
                mimeType: input.directCv.mimeType,
                byteSize: input.directCv.byteSize,
                storageKey: input.directCv.storageKey,
                checksumSha256: input.directCv.checksumSha256,
                version: 1,
                confirmedAt: input.occurredAt,
              },
            })
          : await tx.candidateCv.findUnique({
              where: { id: input.command.cvId },
            });
        if (!cv || cv.candidateUserId !== input.candidateUserId) {
          throw new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE");
        }
        // A CV document must carry the exact evidence pair that was opened
        // above. The nullable columns exist only for legacy rows; they are
        // never a valid fallback for a newly committed application.
        if (!cv.sourceArtifactId || !cv.scanAssessmentId) {
          throw new ApplicationRepositoryError("APPLICATION_CV_INELIGIBLE");
        }
        const job = await tx.jobPosting.findFirst({
          where: {
            id: input.jobId,
            status: "ACTIVE",
            approvedAt: { not: null },
            publishedAt: { not: null, lte: input.occurredAt },
            OR: [
              { applicationDeadline: null },
              { applicationDeadline: { gt: input.occurredAt } },
            ],
            company: { verifiedAt: { not: null } },
          },
          include: {
            company: { select: { id: true, displayName: true } },
            reviewAggregate: { select: { jobId: true } },
            skills: {
              where: { required: true },
              orderBy: { position: "asc" },
              select: { displayName: true },
            },
            questions: {
              where: { active: true },
              orderBy: { position: "asc" },
            },
          },
        });
        if (!candidate?.profile)
          throw new ApplicationRepositoryError(
            "APPLICATION_PROFILE_INCOMPLETE",
          );
        if (!job)
          throw new ApplicationRepositoryError(
            "JOB_NO_LONGER_ACCEPTING_APPLICATIONS",
          );
        const prepared = prepareApplicationSubmission(
          {
            candidate: {
              userId: candidate.userId,
              name: candidate.user.name,
              email: candidate.user.email,
              headline: candidate.profile.headline,
              summary: candidate.profile.summary,
              phone: candidate.profile.phone,
              location: candidate.profile.location,
              skills: candidate.profile.skills.map((item) => ({
                id: item.skillId,
                label: item.displayName,
              })),
              experience: candidate.profile.experiences.map((item) => ({
                title: item.title,
                company: item.company,
                startDate: item.startDate,
                endDate: item.endDate,
              })),
              education: candidate.profile.education.map((item) => ({
                institution: item.institution,
                degree: item.degree,
                field: item.field,
              })),
            },
            cv,
            job: {
              id: job.id,
              version: job.version,
              title: job.title,
              companyId: job.company.id,
              companyName: job.company.displayName,
              location: job.location,
              employmentType: job.employmentType,
              experienceLevel: job.experienceLevel,
              workArrangement: job.workArrangement,
              requiredSkills: job.skills.map((skill) => skill.displayName),
            },
            questions: input.draftId
              ? []
              : job.questions.map((question) => ({
                  id: question.id,
                  prompt: question.prompt,
                  description: question.description,
                  kind: question.kind,
                  required: question.required,
                  options: Array.isArray(question.options)
                    ? question.options.filter(
                        (value): value is string => typeof value === "string",
                      )
                    : null,
                  version: question.version,
                })),
          },
          {
            ...input.command,
            // The transport sentinel was checked before creating this CV.
            // Domain validation must compare against the concrete owned row,
            // not reject the materialized application-CV bridge.
            ...(input.directCv ? { cvId: cv.id } : {}),
            ...(input.directCoverLetter ? { coverLetter: null } : {}),
          },
          input.activeConsentVersion,
          input.occurredAt,
        );
        const cvFileRef =
          input.command.cvFileRef &&
          input.command.cvFileRef !== input.command.cvId
            ? input.command.cvFileRef
            : prepared.cvSnapshot.storageKey;
        if (attemptCounter) {
          const counterUpdated =
            await tx.jobApplicationAttemptCounter.updateMany({
              where: {
                candidateUserId: input.candidateUserId,
                jobPostingId: input.jobId,
                applicationCount: currentApplicationCount,
              },
              data: { applicationCount: nextApplicationAttemptNumber },
            });
          if (counterUpdated.count !== 1) {
            throw new ApplicationRepositoryError(
              "APPLICATION_ATTEMPT_COUNTER_CONFLICT",
            );
          }
        } else {
          await tx.jobApplicationAttemptCounter.create({
            data: {
              candidateUserId: input.candidateUserId,
              jobPostingId: input.jobId,
              applicationCount: nextApplicationAttemptNumber,
            },
          });
        }
        const submittedStageEventId = randomUUID();
        const created = await tx.jobApplication.create({
          data: {
            candidateUserId: input.candidateUserId,
            jobPostingId: input.jobId,
            applicationAttemptNumber: nextApplicationAttemptNumber,
            selectedCvId: cv.id,
            cvFileRef,
            contactSnapshot: input.command.contactSnapshot
              ? (input.command.contactSnapshot as Prisma.InputJsonValue)
              : undefined,
            contactConsent: {
              create: {
                sharedAt:
                  input.command.shareContactWithRecruiter === true
                    ? input.occurredAt
                    : null,
                withdrawnAt:
                  input.command.shareContactWithRecruiter === true
                    ? null
                    : input.occurredAt,
                version: 1,
              },
            },
            aiAnalysisConsent: input.command.aiAnalysisConsent ?? false,
            // Group 1 does not calculate or infer a score. Later scoring
            // groups own the versioned evaluation records.
            aiMatchScore: null,
            scoringStatus: input.command.aiAnalysisConsent
              ? "PENDING"
              : "NOT_REQUESTED",
            stage: "APPLIED",
            coverLetter: prepared.coverLetter,
            profileSnapshot: prepared.profileSnapshot as Prisma.InputJsonValue,
            cvSnapshot: prepared.cvSnapshot as Prisma.InputJsonValue,
            jobSnapshot: {
              ...prepared.jobSnapshot,
              // The draft is consumed in this transaction. Keep the
              // normalized replay inputs with the immutable submission
              // snapshot so CandidateApplicationSubmissionService can
              // reject a rebound idempotency key without reopening a draft.
              submissionBinding: {
                v: 1,
                candidateUserId: input.candidateUserId,
                jobId: input.jobId,
                draftId: input.draftId ?? null,
                expectedDraftRevision: input.expectedDraftRevision ?? null,
                shareContactWithRecruiter:
                  input.command.shareContactWithRecruiter === true,
              },
            } as Prisma.InputJsonValue,
            consentVersion: input.command.consentVersion,
            consentedAt: prepared.consentedAt,
            idempotencyKey: input.idempotencyKey,
            submissionBindingDigest: input.submissionBindingDigest,
            submittedAt: input.occurredAt,
            stageVersion: 1,
            lastStageChangedAt: input.occurredAt,
            submissionMessage: input.command.message ?? null,
            legacyDocumentState: "CURRENT",
            applicationDocuments: {
              create: [
                {
                  kind: ApplicationDocumentKind.CV,
                  storagePurposeVersion: "application-document-v1",
                  storageKeyEncrypted:
                    promotedApplicationDocument?.storageKey ??
                    prepared.cvSnapshot.storageKey,
                  originalFilenameEncrypted:
                    promotedApplicationDocument?.fileName ??
                    prepared.cvSnapshot.fileName,
                  mediaType:
                    promotedApplicationDocument?.mediaType ??
                    prepared.cvSnapshot.mimeType,
                  byteLength:
                    promotedApplicationDocument?.byteLength ??
                    prepared.cvSnapshot.byteSize,
                  contentDigestHmac:
                    promotedApplicationDocument?.checksumSha256 ??
                    prepared.cvSnapshot.checksumSha256,
                  sourceCandidateCvId:
                    promotedApplicationDocument?.sourceCvId ?? cv.id,
                  sourceCandidateCvVersion:
                    promotedApplicationDocument?.sourceCvVersion ?? cv.version,
                  // The legacy non-FK column remains for compatibility only;
                  // it is populated from the same evidence FK, never from a
                  // synthetic/random assessment identifier.
                  safetyAssessmentId: cv.scanAssessmentId,
                  sourceArtifactId: cv.sourceArtifactId,
                  scanAssessmentId: cv.scanAssessmentId,
                  committedAt: input.occurredAt,
                },
                ...(promotedCoverLetterDocument
                  ? [
                      {
                        kind: ApplicationDocumentKind.COVER_LETTER,
                        storagePurposeVersion: "application-document-v1",
                        storageKeyEncrypted:
                          promotedCoverLetterDocument.storageKey,
                        originalFilenameEncrypted:
                          promotedCoverLetterDocument.fileName,
                        mediaType: promotedCoverLetterDocument.mediaType,
                        byteLength: promotedCoverLetterDocument.byteLength,
                        contentDigestHmac:
                          promotedCoverLetterDocument.checksumSha256,
                        safetyAssessmentId: `application-safety-${promotedCoverLetterDocument.promotionId}`,
                        committedAt: input.occurredAt,
                      },
                    ]
                  : []),
              ],
            },
            ...(prepared.coverLetter
              ? {
                  coverLetterText: {
                    create: {
                      textEncrypted: prepared.coverLetter,
                      characterCount: Array.from(prepared.coverLetter).length,
                    },
                  },
                }
              : {}),
            answers: {
              create: prepared.answers.map((answer) => ({
                questionId: answer.questionId,
                questionSnapshot:
                  answer.questionSnapshot as Prisma.InputJsonValue,
                answer: answer.answer as Prisma.InputJsonValue,
              })),
            },
            stageEvents: {
              create: {
                id: submittedStageEventId,
                fromStage: null,
                toStage: "APPLIED",
                actorUserId: input.candidateUserId,
                actorType: "CANDIDATE",
                candidateVisible: true,
                occurredAt: input.occurredAt,
                applicationVersion: 1,
                metadata: { v: 1, source: "application-submission" },
              },
            },
          },
        });
        if (stagedPromotionIds.length) {
          const promoted = await tx.applicationArtifactPromotion.updateMany({
            where: {
              id: { in: stagedPromotionIds },
              state: ApplicationArtifactPromotionState.PROMOTED,
              jobApplicationId: null,
            },
            data: {
              jobApplicationId: created.id,
              state: ApplicationArtifactPromotionState.COMMITTED,
            },
          });
          if (promoted.count !== stagedPromotionIds.length) {
            throw new ApplicationRepositoryError(
              "APPLICATION_ARTIFACT_PROMOTION_CONFLICT",
            );
          }
        }
        if (input.command.aiAnalysisConsent) {
          const scoringOperation = await tx.scoringOperation.create({
            data: {
              kind: "INITIAL",
              jobPostingId: input.jobId,
              jobApplicationId: created.id,
              requestedByUserId: input.candidateUserId,
              requestedAt: input.occurredAt,
              confirmationIntent: true,
              idempotencyKey: `initial-scoring:${created.id}`,
              targetJobDescriptionVersionId: `job-${job.id}-v${job.version}`,
              targetScoringConfigVersionId: "hybrid-60-40-v1",
              totalCount: 1,
            },
          });
          await tx.scoringWorkItem.create({
            data: {
              operationId: scoringOperation.id,
              jobApplicationId: created.id,
            },
          });
          await tx.jobApplication.update({
            where: { id: created.id },
            data: { scoringStatus: "PROCESSING" },
          });
        }
        await tx.applicationIntake.create({
          data: {
            applicationId: created.id,
            state: "RECEIVED",
            progressPercent: 0,
            receivedAt: input.occurredAt,
            version: 1,
          },
        });
        const accountPreferences = await tx.accountPreferences.findUnique({
          where: { userId: input.candidateUserId },
          select: { applicationUpdatesEmail: true },
        });
        await tx.applicationNotificationPreference.create({
          data: {
            applicationId: created.id,
            emailEnabled: accountPreferences?.applicationUpdatesEmail ?? true,
            inAppEnabled: true,
            version: 1,
          },
        });
        await tx.applicationPublicUpdate.create({
          data: {
            applicationId: created.id,
            kind: "SUBMITTED",
            publicStage: "APPLICATION_SUBMITTED",
            title: "Application submitted",
            effectiveAt: input.occurredAt,
            deduplicationKey: `application:${created.id}:public:submitted`,
            sourceEventReference: submittedStageEventId,
          },
        });
        await tx.recruitmentNotificationWork.create({
          data: {
            applicationId: created.id,
            audience: "CANDIDATE",
            kind: "APPLICATION_SUBMITTED",
            targetReference: input.candidateUserId,
            payloadRef: {
              v: 1,
              event: "APPLICATION_SUBMITTED",
              applicationId: created.id,
              jobTitle: job.title,
              companyName: job.company.displayName,
            },
            idempotencyKey: `application:${created.id}:receipt`,
          },
        });
        await createInAppNotification(tx, {
          recipientUserId: input.candidateUserId,
          kind: "APPLICATION_SUBMITTED",
          deduplicationKey: `application:${created.id}:candidate`,
          correlationId: input.correlationId,
          occurredAt: input.occurredAt,
          contextType: "APPLICATION",
          contextId: created.id,
        });
        const companyRecipients = await new NotificationRecipientPolicy(
          tx,
        ).activeCompanyRecipients(job.company.id);
        for (const recipientUserId of companyRecipients) {
          await createInAppNotification(tx, {
            recipientUserId,
            kind: "APPLICATION_RECEIVED",
            deduplicationKey: `application:${created.id}:company:${recipientUserId}`,
            correlationId: input.correlationId,
            occurredAt: input.occurredAt,
            contextType: "APPLICATION",
            contextId: created.id,
            variables: {
              recipientRole: "RECRUITER",
              // Candidate applications use the public JobPosting ID. The
              // recruiter workspace uses the catalogue/review job ID, so
              // persist the latter when this posting has a review mapping.
              jobId: job.reviewAggregate?.jobId ?? input.jobId,
            },
          });
        }
        if (input.directCv) {
          await tx.candidateCv.update({
            where: { id: input.directCv.id },
            data: { archivedAt: input.occurredAt },
          });
        }
        if (input.draftId) {
          await tx.candidateApplicationDraft.deleteMany({
            where: {
              id: input.draftId,
              candidateUserId: input.candidateUserId,
              jobPostingId: input.jobId,
              revision: input.expectedDraftRevision,
            },
          });
        }
        await new PrismaAuditRepository(tx).append({
          occurredAt: input.occurredAt,
          actorType: "user",
          actorUserId: input.candidateUserId,
          actorSessionId: input.sessionId,
          action: "job.application.submitted",
          targetType: "job_application",
          targetId: created.id,
          result: "SUCCESS",
          correlationId: input.correlationId,
          context: {
            stage: "APPLIED",
            notificationWorkCount: companyRecipients.length + 2,
          },
        });
        return { application: outcome(created, true), created: true };
      });
      if (result.created) {
        // Marking the temporary request objects owned before returning also
        // protects against a caller/projection error after the commit.
        this.markArtifactsOwned(input);
      } else if (promotedArtifacts.length) {
        await this.reconcileArtifacts(
          input,
          promotedArtifacts,
          promotedStorage,
          {
            applicationId: result.application.applicationId,
            allowCleanup: true,
          },
        );
      }
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        let existing;
        try {
          existing = await this.db.jobApplication.findFirst({
            where: {
              candidateUserId: input.candidateUserId,
              jobPostingId: input.jobId,
              withdrawalOutcome: null,
              stage: { not: "REJECTED" },
            },
            orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
          });
        } catch {
          this.preserveArtifactsOnUnknown(input);
          throw error;
        }
        if (existing && isActiveApplication(existing)) {
          if (promotedArtifacts.length) {
            await this.reconcileArtifacts(
              input,
              promotedArtifacts,
              promotedStorage,
              { applicationId: existing.id, allowCleanup: true },
            );
          } else {
            this.markArtifactsOwned(input);
          }
          return { application: outcome(existing, false), created: false };
        }
      }
      // No cleanup is allowed merely because the transaction rejected.  A
      // deterministic domain error proves rollback and may reconcile safely;
      // every other outcome remains retained for the worker/reconciliation
      // path.
      if (promotedArtifacts.length) {
        await this.reconcileArtifacts(
          input,
          promotedArtifacts,
          promotedStorage,
          { allowCleanup: error instanceof ApplicationRepositoryError },
        );
      } else if (!(error instanceof ApplicationRepositoryError)) {
        this.preserveArtifactsOnUnknown(input);
      }
      if (error instanceof ApplicationRepositoryError) throw error;
      throw error;
    }
  }
}
