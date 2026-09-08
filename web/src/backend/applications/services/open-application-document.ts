import "server-only";

import { PrismaApplicationRepository } from "@/backend/repositories/applications/prisma-application-repository";
import type { ApplicationRepositoryPort } from "@/backend/repositories/applications/application-repository";
import { ApplicationStageService } from "@/backend/services/jobs/application-stage-service";
import { JobServiceError } from "@/backend/services/jobs/job-types";
import { RecruiterApplicationAuthorization } from "../authorization/recruiter-application-authorization";
import { createApplicationDocumentStorage } from "../storage/factory";
import type { ApplicationDocumentStoragePort } from "../storage/application-document-storage";
import { applyAutomaticScoreStageRuleForApplication } from "./automatic-viewed-stage-rules";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";
import { CvSafetyEvidenceService } from "@/backend/services/cv-admission/cv-safety-evidence-service";

export class OpenApplicationDocumentError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "PREVIEW_UNAVAILABLE") {
    super(code);
  }
}

export class OpenApplicationDocumentService {
  constructor(
    private readonly repository: ApplicationRepositoryPort = new PrismaApplicationRepository(),
    private readonly authorization = new RecruiterApplicationAuthorization(),
    private readonly storage?: ApplicationDocumentStoragePort,
    private readonly stageService = new ApplicationStageService(),
  ) {}

  private async markViewed(input: {
    userId: string;
    sessionId?: string;
    applicationId: string;
    document: Awaited<ReturnType<ApplicationRepositoryPort["findDocument"]>>;
    now?: Date;
  }) {
    const document = input.document;
    if (!input.sessionId || !document) {
      return;
    }
    if (this.repository instanceof PrismaApplicationRepository) {
      try {
        const automatic = await applyAutomaticScoreStageRuleForApplication({
          candidateApplicationId: input.applicationId,
          stageService: this.stageService,
          now: input.now,
        });
        if (automatic?.stage === "REJECTED") return;
      } catch {
        // Stage automation is an acknowledgement side effect. A transient
        // automation/database failure must not make an authorized document
        // unavailable to the recruiter.
      }
    }
    try {
      if (document.stage !== "APPLIED" || document.stageVersion === undefined) {
        return;
      }
      const authority = this.stageService as unknown as {
        attemptStageTransition?: ApplicationStageService["attemptStageTransition"];
        transition: ApplicationStageService["transition"];
      };
      if (typeof authority.attemptStageTransition === "function") {
        await authority.attemptStageTransition({
          candidateApplicationId: input.applicationId,
          targetStage: "VIEWED",
          actor: {
            kind: "recruiter_manual",
            userId: input.userId,
            sessionId: input.sessionId,
          },
          requestedJobId: document.jobId,
          expectedStageVersion: document.stageVersion,
          source: "STAGE_ROUTE",
          now: input.now,
        });
      } else {
        // Compatibility seam for legacy test doubles and adapters.
        await authority.transition(
          { userId: input.userId, sessionId: input.sessionId },
          input.applicationId,
          {
            targetStage: "VIEWED",
            expectedVersion: document.stageVersion,
          },
          input.now,
        );
      }
    } catch (error) {
      // A drawer loads CV and cover-letter previews concurrently, and the
      // ranking list also acknowledges the same view. One of those requests
      // may win the APPLIED -> VIEWED transition; the losing request must not
      // make an otherwise authorized document unavailable.
      if (
        error instanceof JobServiceError &&
        [404, 409].includes(error.status)
      ) {
        return;
      }
      // Loading the document is the primary operation. Keep it available if
      // the best-effort VIEWED acknowledgement fails for another reason.
    }
  }

  async execute(input: {
    userId: string;
    sessionId?: string;
    jobId: string;
    applicationId: string;
    kind: "cv" | "cover-letter";
    preview: boolean;
    streamPolicy?: "REQUIRED" | "SKIP_PDF";
    now?: Date;
  }) {
    const auth = await this.authorization.authorizeApplication(
      input.userId,
      input.jobId,
      input.applicationId,
    );
    if (!auth.authorized) throw new OpenApplicationDocumentError("UNAVAILABLE");
    const document = await this.repository.findDocument({
      ...input,
      jobId: auth.jobPostingId,
    });
    if (!document) throw new OpenApplicationDocumentError("UNAVAILABLE");
    if (input.preview && !document.previewSupported) {
      throw new OpenApplicationDocumentError("PREVIEW_UNAVAILABLE");
    }

    // A CV is never readable from a legacy storage key or a materialized text
    // field alone. The caller must have a persisted CLEAN assessment tied to
    // the exact admitted source artifact; the safe-open service rechecks the
    // ownership, expiry, policy and checksum invariants below.
    if (document.kind === "cv") {
      if (
        document.scanStatus !== "CLEAN" ||
        !document.sourceArtifactId ||
        !document.scanAssessmentId ||
        !document.uploadId ||
        !document.candidateUserId
      ) {
        throw new OpenApplicationDocumentError("UNAVAILABLE");
      }
      try {
        await new CvSafetyEvidenceService().assertCvArtifactSafeForUse({
          candidateUserId: document.candidateUserId,
          uploadId: document.uploadId,
          artifactId: document.sourceArtifactId,
          assessmentId: document.scanAssessmentId,
          allowedPurposes: [
            "PROFILE_IMPORT",
            "PROFILE_DIRECT",
            "JOB_APPLICATION_DIRECT",
          ],
        });
      } catch {
        throw new OpenApplicationDocumentError("UNAVAILABLE");
      }
    }

    await this.markViewed({
      userId: input.userId,
      sessionId: input.sessionId,
      applicationId: input.applicationId,
      document,
      now: input.now,
    });
    if (document.text !== null) {
      return Object.freeze({ document, stream: null });
    }
    // The structured-preview endpoint only needs PDF metadata before handing
    // rendering to the browser. Avoid turning an unrelated storage read (or a
    // slow first chunk) into a misleading "parse failed" state.
    if (
      input.streamPolicy === "SKIP_PDF" &&
      document.mediaType === "application/pdf"
    ) {
      return Object.freeze({ document, stream: null });
    }
    if (
      document.kind === "cv" &&
      document.sourceArtifactId &&
      document.scanAssessmentId &&
      document.candidateUserId &&
      document.uploadId
    ) {
      try {
        const safeService = new OpenSafeCvArtifactService();
        const opened = await safeService.open({
          candidateUserId: document.candidateUserId,
          uploadId: document.uploadId,
          artifactId: document.sourceArtifactId,
          assessmentId: document.scanAssessmentId,
          allowedPurposes: [
            "PROFILE_IMPORT",
            "PROFILE_DIRECT",
            "JOB_APPLICATION_DIRECT",
          ],
        });
        if (
          opened.byteLength !== document.byteLength ||
          document.contentVersion?.toLowerCase() !==
            opened.evidence.checksumSha256.toLowerCase()
        ) {
          await opened.dispose();
          throw new OpenApplicationDocumentError("UNAVAILABLE");
        }
        const stream = (async function* () {
          try {
            for await (const chunk of opened.openStream()) {
              yield chunk;
            }
          } finally {
            await opened.dispose();
          }
        })();
        return Object.freeze({ document, stream });
      } catch {
        throw new OpenApplicationDocumentError("UNAVAILABLE");
      }
    }

    if (!document.storageKey) {
      throw new OpenApplicationDocumentError("UNAVAILABLE");
    }
    try {
      const storage = this.storage ?? createApplicationDocumentStorage();
      await storage.assertReady();
      const source = storage.open(document.storageKey, document.byteLength);
      const iterator = source[Symbol.asyncIterator]();
      const first = await iterator.next();
      const stream = (async function* () {
        try {
          if (!first.done) yield first.value;
          while (true) {
            const next = await iterator.next();
            if (next.done) return;
            yield next.value;
          }
        } finally {
          await iterator.return?.();
        }
      })();
      return Object.freeze({ document, stream });
    } catch {
      throw new OpenApplicationDocumentError("UNAVAILABLE");
    }
  }
}
