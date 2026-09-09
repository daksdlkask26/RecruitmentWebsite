import "server-only";

import { prisma } from "@/backend/database/prisma";
import { RecruiterApplicationAuthorization } from "@/backend/applications/authorization/recruiter-application-authorization";
import { ApplicationStageService } from "@/backend/services/jobs/application-stage-service";
import { JobServiceError } from "@/backend/services/jobs/job-types";
import { PrismaScoringRepository } from "../repositories/prisma-scoring-repository";
import {
  scoringDetailSchema,
  type ScoringState,
} from "@/shared/contracts/scoring";

export class ScoringDetailService {
  constructor(
    private readonly db: typeof prisma = prisma,
    private readonly authorization = new RecruiterApplicationAuthorization(),
    private readonly scoring = new PrismaScoringRepository(db),
    private readonly stageService = new ApplicationStageService(db),
  ) {}

  async get(userId: string, applicationId: string, sessionId?: string) {
    const application = await this.db.jobApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        jobPostingId: true,
        stage: true,
        stageVersion: true,
        scoringStatus: true,
        scoringWorkItems: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { lastSafeFailureCode: true },
        },
        scoringOperations: {
          where: {
            state: { in: ["QUEUED", "RUNNING"] },
            kind: { in: ["INITIAL", "AI_RETRY", "JOB_RESCORE"] },
          },
          orderBy: { requestedAt: "desc" },
          take: 3,
          select: { id: true, kind: true },
        },
        jobPosting: {
          select: {
            scoringOperations: {
              where: {
                state: { in: ["QUEUED", "RUNNING"] },
                kind: "JOB_RESCORE",
              },
              orderBy: { requestedAt: "desc" },
              take: 1,
              select: { id: true, kind: true },
            },
          },
        },
      },
    });
    if (
      !application ||
      !(
        await this.authorization.authorizeApplication(
          userId,
          application.jobPostingId,
          application.id,
        )
      ).authorized
    )
      throw new Error("APPLICATION_UNAVAILABLE");

    if (sessionId && application.stage === "APPLIED") {
      try {
        const authority = this.stageService as unknown as {
          attemptStageTransition?: ApplicationStageService["attemptStageTransition"];
          transition: ApplicationStageService["transition"];
        };
        if (typeof authority.attemptStageTransition === "function") {
          await authority.attemptStageTransition({
            candidateApplicationId: application.id,
            targetStage: "VIEWED",
            actor: { kind: "recruiter_manual", userId, sessionId },
            requestedJobId: application.jobPostingId,
            expectedStageVersion: application.stageVersion,
            source: "STAGE_ROUTE",
          });
        } else {
          // Compatibility seam for legacy test doubles and adapters.
          await authority.transition({ userId, sessionId }, application.id, {
            targetStage: "VIEWED",
            expectedVersion: application.stageVersion,
          });
        }
      } catch (error) {
        // Opening the score drawer and the document previews can issue
        // concurrent requests. One request may win APPLIED -> VIEWED; the
        // losing request must still be allowed to show the authorized score.
        if (
          !(
            error instanceof JobServiceError &&
            [404, 409].includes(error.status)
          )
        ) {
          throw error;
        }
      }
    }

    const current = await this.scoring.findCurrent(application.id);
    const activeOperation =
      application.scoringOperations[0] ??
      application.jobPosting.scoringOperations[0];
    const retry = activeOperation?.kind === "AI_RETRY" ? activeOperation : null;
    const activeRescore =
      application.scoringOperations.some(
        (operation) => operation.kind === "JOB_RESCORE",
      ) || application.jobPosting.scoringOperations.length > 0;
    let scoring: ScoringState;
    if (retry && current?.automatic) {
      scoring = {
        kind: "PENDING",
        label: "Pending",
        operationId: retry.id,
        automaticMatch: current.automatic,
      };
    } else if (
      current?.state === "SCORED" &&
      current.ai &&
      current.finalScore
    ) {
      scoring = {
        kind: "SCORED",
        label: "Scored",
        automaticMatch: current.automatic,
        aiAssessment: current.ai,
        finalScore: current.finalScore,
      };
    } else if (current?.automatic) {
      scoring = {
        kind: "UNAVAILABLE",
        label: "Unavailable",
        automaticMatch: current.automatic,
        aiAssessment: {
          kind: "UNAVAILABLE",
          label: "Unavailable",
          safeFailureCode: current.safeFailureCode ?? "AI_PROVIDER_UNAVAILABLE",
          supportGuidance:
            current.consecutiveFailures >= 3
              ? "Repeated AI failure - try later or contact support."
              : null,
        },
        finalScore: { kind: "NOT_CALCULATED", label: "Not calculated" },
        retryAllowed: true,
        consecutiveFailures: Math.max(1, current.consecutiveFailures),
      };
    } else if (activeOperation) {
      scoring = {
        kind: "PROCESSING",
        label: "Processing",
        operationId: activeOperation.id,
      };
    } else if (application.scoringStatus === "PENDING") {
      scoring = {
        kind: "PENDING",
        label: "Pending",
        operationId: "pending-" + application.id,
        automaticMatch: null,
      };
    } else if (application.scoringStatus === "PROCESSING") {
      scoring = {
        kind: "PROCESSING",
        label: "Processing",
        operationId: "initial-" + application.id,
      };
    } else if (application.scoringStatus === "FAILED") {
      scoring = {
        kind: "FAILED",
        label: "Scoring failed",
        safeFailureCode:
          application.scoringWorkItems[0]?.lastSafeFailureCode ?? null,
        retryAllowed: true,
      };
    } else {
      scoring = { kind: "NOT_CALCULATED", label: "Not calculated" };
    }
    return scoringDetailSchema.parse({
      applicationId: application.id,
      humanDecisionNotice:
        "Scores support decision-making only. The recruiter makes the final decision.",
      scoring,
      rescoreInProgress: activeRescore || Boolean(current?.rescoreInProgress),
      documentAccess: {
        cvViewerPath:
          "/api/recruiter/jobs/" +
          encodeURIComponent(application.jobPostingId) +
          "/applications/" +
          encodeURIComponent(application.id) +
          "/documents/cv",
        coverLetterViewerPath:
          "/api/recruiter/jobs/" +
          encodeURIComponent(application.jobPostingId) +
          "/applications/" +
          encodeURIComponent(application.id) +
          "/documents/cover-letter",
      },
    });
  }
}
