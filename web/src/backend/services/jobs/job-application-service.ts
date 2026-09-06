import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ApplicationRepositoryPort } from "@/backend/repositories/jobs/prisma-job-application-repository";
import {
  ApplicationRepositoryError,
  ACTIVE_APPLICATION_CONSENT_VERSION,
} from "./application-policy";
import {
  applicationSubmissionSchema,
  DIRECT_APPLICATION_CV_ID,
  idempotencyKeySchema,
  MAX_APPLICATION_ATTEMPTS,
  MAX_APPLICATION_ATTEMPTS_MESSAGE,
  type ApplicationSubmission,
} from "@/shared/contracts/jobs/actions";
import { JobServiceError, type CandidateActor } from "./job-types";
import { recordApplication } from "./recruiter-job-posting-data";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import type {
  DirectApplicationCvSource,
  PreparedDirectApplicationCv,
} from "./prepare-direct-application-cv";
import { z } from "zod";

function binding(
  command: ApplicationSubmission,
  directCv?: PreparedDirectApplicationCv,
  directCoverLetter?: PreparedDirectApplicationCv,
) {
  const stable = {
    ...command,
    directCv: directCv
      ? {
          fileName: directCv.fileName,
          mimeType: directCv.mimeType,
          byteSize: directCv.byteSize,
          checksumSha256: directCv.checksumSha256,
        }
      : null,
    directCoverLetter: directCoverLetter
      ? {
          fileName: directCoverLetter.fileName,
          mimeType: directCoverLetter.mimeType,
          byteSize: directCoverLetter.byteSize,
          checksumSha256: directCoverLetter.checksumSha256,
        }
      : null,
    answers: [...command.answers].sort((a, b) =>
      a.questionId.localeCompare(b.questionId),
    ),
  };
  return createHash("sha256")
    .update(JSON.stringify(stable), "utf8")
    .digest("hex");
}

function applicationFailureMessage(code: string) {
  switch (code) {
    case "APPLICATION_PROFILE_INCOMPLETE":
      return "Complete your profile name and location before applying.";
    case "APPLICATION_CV_INELIGIBLE":
      return "Select a saved CV or attach a valid PDF, DOC, or DOCX file.";
    case "APPLICATION_ANSWER_REQUIRED":
      return "Answer all required employer questions before applying.";
    case "APPLICATION_ANSWER_INVALID":
    case "APPLICATION_ANSWER_UNKNOWN":
    case "APPLICATION_ANSWER_DUPLICATE":
      return "Review the answers in this application before applying.";
    case "APPLICATION_CONSENT_STALE":
      return "Accept the application consent before applying.";
    case "APPLICATION_TEXT_TOO_LONG":
      return "Shorten the application text before applying.";
    case "APPLICATION_COVER_LETTER_INELIGIBLE":
      return "Use a supported cover letter format before applying.";
    case "APPLICATION_DRAFT_CONFLICT":
      return "This application draft changed. Refresh it and try again.";
    case "APPLICATION_CONFIRMATION_REQUIRED":
      return "Confirm the application details before submitting.";
    case "APPLICATION_MAX_ATTEMPTS":
      return MAX_APPLICATION_ATTEMPTS_MESSAGE;
    default:
      return "Complete the required profile, CV, answers, and consent before applying.";
  }
}

export class JobApplicationService {
  constructor(
    private readonly repository?: ApplicationRepositoryPort,
    private readonly csrfTokenFactory?: (
      sessionId: string,
    ) => string | Promise<string>,
    private readonly audit?: Pick<PrismaAuditRepository, "append">,
  ) {}

  private async repo() {
    return (
      this.repository ??
      new (
        await import("@/backend/repositories/jobs/prisma-job-application-repository")
      ).PrismaJobApplicationRepository()
    );
  }

  private async createCsrfToken(sessionId: string) {
    if (this.csrfTokenFactory) return this.csrfTokenFactory(sessionId);
    return (await import("@/backend/security/csrf/csrf-proof")).csrfProof(
      sessionId,
    );
  }

  async form(actor: CandidateActor, jobId: string, now = new Date()) {
    const result = await (
      await this.repo()
    ).getCandidateForm(actor.userId, jobId, now);
    if (!result)
      throw new JobServiceError(404, {
        code: "JOB_UNAVAILABLE",
        message: "This job is not available.",
      });
    if (result.existingApplication)
      throw new JobServiceError(409, {
        code: "APPLICATION_EXISTS",
        message: "You already applied to this job.",
      });
    const applicationCount = result.applicationCount ?? 0;
    if (applicationCount >= MAX_APPLICATION_ATTEMPTS)
      throw new JobServiceError(409, {
        code: "APPLICATION_MAX_ATTEMPTS",
        message: MAX_APPLICATION_ATTEMPTS_MESSAGE,
      });
    return {
      jobId: result.job.id,
      jobTitle: result.job.title,
      jobLocation: result.job.location,
      companyName: result.job.company.displayName,
      profileReady: result.profileReady,
      missingProfileFields: result.missingProfileFields,
      profileRevision: result.profileRevision,
      profileBasics: result.profileBasics,
      contact: result.contact,
      cvs: result.cvs.map((cv) => ({
        ...cv,
        confirmedAt: cv.confirmedAt.toISOString(),
      })),
      questions: result.questions,
      consentVersion: ACTIVE_APPLICATION_CONSENT_VERSION,
      applicationCount,
      maxApplicationAttempts: MAX_APPLICATION_ATTEMPTS,
      csrfToken: await this.createCsrfToken(actor.sessionId),
    };
  }

  async submit(
    actor: CandidateActor,
    jobId: string,
    idempotencyKey: string,
    raw: unknown,
    now = new Date(),
    directCvSource?: DirectApplicationCvSource,
    directCoverLetterSource?: DirectApplicationCvSource,
    draftBinding?: { draftId: string; expectedRevision: number },
    preparedDirectCoverLetter?: PreparedDirectApplicationCv,
  ) {
    const correlationId = randomUUID();
    let directCv: PreparedDirectApplicationCv | undefined;
    let directCoverLetter: PreparedDirectApplicationCv | undefined =
      preparedDirectCoverLetter;
    let repositoryAttempted = false;
    try {
      const command = applicationSubmissionSchema.parse(raw);
      const key = idempotencyKeySchema.parse(idempotencyKey);
      if (directCvSource) {
        if (command.cvId !== DIRECT_APPLICATION_CV_ID) {
          throw new JobServiceError(400, {
            code: "APPLICATION_CV_INELIGIBLE",
            message: applicationFailureMessage("APPLICATION_CV_INELIGIBLE"),
          });
        }
        try {
          directCv = await (
            await import("./prepare-direct-application-cv")
          ).prepareDirectApplicationCv(directCvSource, {
            deferStorage: true,
          });
        } catch {
          throw new JobServiceError(400, {
            code: "APPLICATION_CV_INELIGIBLE",
            message: applicationFailureMessage("APPLICATION_CV_INELIGIBLE"),
          });
        }
      }
      if (
        directCoverLetterSource &&
        (!command.coverLetter ||
          typeof command.coverLetter === "string" ||
          command.coverLetter.kind !== "FILE")
      ) {
        throw new JobServiceError(400, {
          code: "APPLICATION_COVER_LETTER_INELIGIBLE",
          message: applicationFailureMessage(
            "APPLICATION_COVER_LETTER_INELIGIBLE",
          ),
        });
      }
      if (
        command.coverLetter &&
        typeof command.coverLetter !== "string" &&
        command.coverLetter.kind === "FILE"
      ) {
        if (!directCoverLetterSource && !directCoverLetter) {
          throw new JobServiceError(400, {
            code: "APPLICATION_COVER_LETTER_INELIGIBLE",
            message: applicationFailureMessage(
              "APPLICATION_COVER_LETTER_INELIGIBLE",
            ),
          });
        }
        if (directCoverLetterSource) {
          try {
            directCoverLetter = await (
              await import("./prepare-direct-application-cv")
            ).prepareDirectApplicationCv(directCoverLetterSource, {
              deferStorage: true,
            });
          } catch {
            throw new JobServiceError(400, {
              code: "APPLICATION_COVER_LETTER_INELIGIBLE",
              message: applicationFailureMessage(
                "APPLICATION_COVER_LETTER_INELIGIBLE",
              ),
            });
          }
        }
      }
      repositoryAttempted = true;
      const result = await (
        await this.repo()
      ).submit({
        candidateUserId: actor.userId,
        sessionId: actor.sessionId,
        jobId,
        idempotencyKey: key,
        submissionBindingDigest: binding(command, directCv, directCoverLetter),
        command,
        directCv,
        directCoverLetter,
        activeConsentVersion: ACTIVE_APPLICATION_CONSENT_VERSION,
        occurredAt: now,
        correlationId,
        draftId: draftBinding?.draftId,
        expectedDraftRevision: draftBinding?.expectedRevision,
      });
      if (!result.created) await directCv?.cleanup();
      if (!result.created) await directCoverLetter?.cleanup();
      if (result.created) {
        directCv?.claimOwnership();
        directCoverLetter?.claimOwnership();
        await recordApplication(actor.userId, jobId).catch(() => undefined);
      }
      return { ...result.application, created: result.created };
    } catch (error) {
      // Before the repository call, cleanup is deterministic.  Once a
      // database transaction has been attempted, only a typed domain failure
      // proves rollback; transport/serialization/database failures retain the
      // upload for the durable promotion reconciliation path.
      if (!repositoryAttempted || error instanceof ApplicationRepositoryError) {
        if (directCv) await directCv.cleanup().catch(() => undefined);
        if (directCoverLetter)
          await directCoverLetter.cleanup().catch(() => undefined);
      } else {
        directCv?.preserveOnUnknown();
        directCoverLetter?.preserveOnUnknown();
      }
      await (this.audit ?? new PrismaAuditRepository())
        .append({
          occurredAt: now,
          actorType: "user",
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: "job.application.failed",
          targetType: "job_application",
          targetId: null,
          result: "FAILURE",
          correlationId,
          context: {
            failureCode:
              error instanceof JobServiceError
                ? error.body.code
                : error instanceof ApplicationRepositoryError
                  ? error.code
                  : "APPLICATION_SUBMISSION_FAILED",
          },
        })
        .catch(() => undefined);
      if (error instanceof ApplicationRepositoryError) {
        const conflict = [
          "IDEMPOTENCY_KEY_REUSED",
          "JOB_NO_LONGER_ACCEPTING_APPLICATIONS",
          "APPLICATION_DRAFT_CONFLICT",
          "APPLICATION_MAX_ATTEMPTS",
          "APPLICATION_ATTEMPT_COUNTER_CONFLICT",
        ].includes(error.code);
        const invalidApplication = [
          "APPLICATION_PROFILE_INCOMPLETE",
          "APPLICATION_CV_INELIGIBLE",
          "APPLICATION_ANSWER_REQUIRED",
          "APPLICATION_ANSWER_INVALID",
          "APPLICATION_ANSWER_UNKNOWN",
          "APPLICATION_ANSWER_DUPLICATE",
          "APPLICATION_CONSENT_STALE",
          "APPLICATION_TEXT_TOO_LONG",
          "APPLICATION_COVER_LETTER_INELIGIBLE",
          "APPLICATION_CONFIRMATION_REQUIRED",
        ].includes(error.code);
        throw new JobServiceError(
          conflict ? 409 : invalidApplication ? 400 : 403,
          {
            code: error.code,
            message:
              error.code === "APPLICATION_MAX_ATTEMPTS"
                ? MAX_APPLICATION_ATTEMPTS_MESSAGE
                : conflict
                  ? "The application could not be submitted in its current state."
                  : applicationFailureMessage(error.code),
          },
        );
      }
      if (error instanceof z.ZodError) {
        throw new JobServiceError(400, {
          code: "APPLICATION_SUBMISSION_INVALID",
          message: "Review the application fields and try again.",
        });
      }
      throw error;
    }
  }
}
