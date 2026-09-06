import "server-only";

import { prisma } from "@/backend/database/prisma";
import {
  JobServiceError,
  type CandidateActor,
} from "@/backend/services/jobs/job-types";
import { JobApplicationService } from "@/backend/services/jobs/job-application-service";
import type { PreparedDirectApplicationCv } from "@/backend/services/jobs/prepare-direct-application-cv";
import {
  applicationSubmitCommandSchema,
  candidatePersonalInfoSchema,
  coverLetterDraftSchema,
  type ApplicationReceipt,
} from "@/shared/contracts/candidate-applications";
import { applicationReceiptSchema } from "@/shared/contracts/candidate-applications";
import {
  ApplicationDraftService,
  storedCoverLetter,
  validateStoredCoverLetter,
  validCv,
} from "./application-draft-service";
import { CandidateApplicationError } from "./candidate-application-errors";

const activeConsentVersion = "2026-08-01";

function normalizedPhone(value: string) {
  return value.replace(/[^\d+]/gu, "").replace(/(?!^)\+/gu, "");
}

function submissionError(code: string, message: string): never {
  throw new CandidateApplicationError(400, code, message);
}

export class CandidateApplicationSubmissionService {
  constructor(
    private readonly drafts = new ApplicationDraftService(),
    private readonly applications = new JobApplicationService(),
  ) {}

  private async receipt(actor: CandidateActor, applicationId: string) {
    const tracker =
      await import("./candidate-application-tracking-service").then(
        ({ CandidateApplicationTrackingService }) =>
          new CandidateApplicationTrackingService().get(actor, applicationId),
      );
    return applicationReceiptSchema.parse({
      applicationId: tracker.applicationId,
      submittedAt: tracker.submittedAt,
      publicStage: "APPLICATION_SUBMITTED",
      intake: tracker.intake,
      files: tracker.files,
    });
  }

  async submit(
    actor: CandidateActor,
    idempotencyKey: string,
    rawCommand: unknown,
    now = new Date(),
  ): Promise<ApplicationReceipt> {
    const command = applicationSubmitCommandSchema.parse(rawCommand);
    // The draft is consumed by the successful submit transaction. Resolve a
    // replay before loading that draft so a browser retry receives the same
    // receipt instead of a misleading "draft not found" response.
    const replay = await prisma.jobApplication.findUnique({
      where: {
        candidateUserId_idempotencyKey: {
          candidateUserId: actor.userId,
          idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (replay) return this.receipt(actor, replay.id);
    const draft = await this.drafts.getForSubmission(
      actor,
      command.draftId,
      now,
    );
    if (draft.revision !== command.expectedRevision) {
      throw new CandidateApplicationError(
        409,
        "APPLICATION_DRAFT_CONFLICT",
        "This application draft changed. Refresh it and try again.",
      );
    }
    if (!draft.confirmationAccepted) {
      submissionError(
        "APPLICATION_CONFIRMATION_REQUIRED",
        "Confirm the application details before submitting.",
      );
    }

    const personalInfo = candidatePersonalInfoSchema.parse(
      await this.drafts.currentPersonalInfo(actor, draft.personalInfoDraft),
    );
    const phone = normalizedPhone(personalInfo.phone);
    if (!/^(?:0|\+84)(?:3|5|7|8|9)\d{8}$/u.test(phone)) {
      submissionError(
        "APPLICATION_PROFILE_INCOMPLETE",
        "Add a valid phone number before applying.",
      );
    }
    const cv = await validCv(prisma, actor.userId, draft.selectedCvId);
    if (!cv) {
      submissionError(
        "APPLICATION_CV_INELIGIBLE",
        "Select a confirmed CV from your Profile before applying.",
      );
    }

    let preparedCoverLetter: PreparedDirectApplicationCv | undefined;
    let coverLetter: unknown = null;
    const rawCoverLetter = draft.coverLetterDraft;
    const rawCoverKind =
      rawCoverLetter &&
      typeof rawCoverLetter === "object" &&
      !Array.isArray(rawCoverLetter) &&
      (rawCoverLetter as { kind?: unknown }).kind;
    if (rawCoverKind === "FILE") {
      const stored = await validateStoredCoverLetter(rawCoverLetter);
      if (!stored || !storedCoverLetter(rawCoverLetter)) {
        throw new CandidateApplicationError(
          400,
          "APPLICATION_COVER_LETTER_INELIGIBLE",
          "Upload the cover letter again before applying.",
        );
      }
      preparedCoverLetter = {
        id: `draft-cover-letter-${stored.file.versionId}`,
        displayName: stored.file.displayName,
        fileName: stored.file.fileName,
        mimeType: stored.file.mimeType,
        byteSize: stored.file.byteSize,
        storageKey: stored.file.storageKey,
        checksumSha256: stored.file.checksumSha256,
        // The draft file is promoted in-place into the immutable
        // ApplicationDocument. Never delete it on an idempotent/concurrent
        // replay: the winning transaction may already reference this same
        // locator as the submitted cover letter.
        claimOwnership: () => undefined,
        preserveOnUnknown: () => undefined,
        cleanup: async () => undefined,
      };
      coverLetter = {
        kind: "FILE",
        validatedDocumentId: stored.file.versionId,
      };
    } else if (rawCoverLetter !== null) {
      const cover = coverLetterDraftSchema.safeParse(rawCoverLetter);
      if (!cover.success || cover.data.kind !== "TEXT") {
        throw new CandidateApplicationError(
          400,
          "APPLICATION_COVER_LETTER_INELIGIBLE",
          "Choose a valid cover letter or remove it before applying.",
        );
      }
      coverLetter = { kind: "TEXT", text: cover.data.text };
    }

    const result = await this.applications.submit(
      actor,
      draft.jobPostingId,
      idempotencyKey,
      {
        cvId: cv.id,
        cvFileRef: cv.storageKey,
        contactSnapshot: {
          fullName: personalInfo.fullName,
          email: personalInfo.email,
          phone,
          location: personalInfo.currentLocation,
        },
        shareContactWithRecruiter: command.shareContactWithRecruiter,
        answers: [],
        coverLetter,
        message: draft.messageDraft,
        consentVersion: activeConsentVersion,
        consentAccepted: true,
        // Compatibility value for the legacy Application column. This is a
        // platform policy decision, never a candidate opt-in; automated
        // comparison is disclosed and applied uniformly.
        aiAnalysisConsent: true,
      },
      now,
      undefined,
      undefined,
      { draftId: draft.id, expectedRevision: command.expectedRevision },
      preparedCoverLetter,
    );

    if (!result.applicationId) {
      throw new JobServiceError(503, {
        code: "APPLICATION_RECEIPT_UNAVAILABLE",
        message:
          "The application was accepted but its receipt is not available yet.",
      });
    }
    // The tracker projection is the single safe receipt shape. It is loaded by
    // the route after the transaction so stale client data cannot form it.
    return this.receipt(actor, result.applicationId);
  }
}
