import "server-only";

import { prisma } from "@/backend/database/prisma";
import { RecruiterApplicationAuthorization } from "@/backend/applications/authorization/recruiter-application-authorization";
import { ApplicationStageService } from "@/backend/services/jobs/application-stage-service";
import { JobServiceError } from "@/backend/services/jobs/job-types";
import {
  applicationStageSchema,
  applicationViewedOutcomeSchema,
  type ApplicationViewedOutcome,
} from "@/shared/contracts/jobs/applications";

type CurrentApplication = {
  id: string;
  jobPostingId: string;
  stage: string;
  stageVersion: number;
  lastStageChangedAt: Date;
};

function unchangedOutcome(
  application: CurrentApplication,
): ApplicationViewedOutcome {
  return applicationViewedOutcomeSchema.parse({
    applicationId: application.id,
    stage: applicationStageSchema.parse(application.stage),
    stageVersion: application.stageVersion,
    lastStageChangedAt: application.lastStageChangedAt.toISOString(),
    changed: false,
  });
}

export class MarkApplicationViewedService {
  constructor(
    private readonly db: typeof prisma = prisma,
    private readonly authorization = new RecruiterApplicationAuthorization(db),
    private readonly stageService = new ApplicationStageService(db),
  ) {}

  async execute(input: {
    userId: string;
    sessionId: string;
    applicationId: string;
    now?: Date;
  }): Promise<ApplicationViewedOutcome> {
    const application = await this.db.jobApplication.findUnique({
      where: { id: input.applicationId },
      select: {
        id: true,
        jobPostingId: true,
        stage: true,
        stageVersion: true,
        lastStageChangedAt: true,
      },
    });
    if (
      !application ||
      !(
        await this.authorization.authorizeApplication(
          input.userId,
          application.jobPostingId,
          application.id,
        )
      ).authorized
    ) {
      throw new JobServiceError(404, {
        code: "APPLICATION_NOT_FOUND",
        message: "This application is unavailable.",
      });
    }

    const current = application as CurrentApplication;
    if (applicationStageSchema.parse(current.stage) !== "APPLIED") {
      return unchangedOutcome(current);
    }

    try {
      const authority = this.stageService as unknown as {
        attemptStageTransition?: ApplicationStageService["attemptStageTransition"];
        transition: ApplicationStageService["transition"];
      };
      const transitioned =
        typeof authority.attemptStageTransition === "function"
          ? await authority.attemptStageTransition({
              candidateApplicationId: current.id,
              targetStage: "VIEWED",
              actor: {
                kind: "recruiter_manual",
                userId: input.userId,
                sessionId: input.sessionId,
              },
              requestedJobId: current.jobPostingId,
              expectedStageVersion: current.stageVersion,
              source: "STAGE_ROUTE",
              now: input.now,
            })
          : await authority.transition(
              { userId: input.userId, sessionId: input.sessionId },
              current.id,
              {
                targetStage: "VIEWED",
                expectedVersion: current.stageVersion,
              },
              input.now,
            );
      return applicationViewedOutcomeSchema.parse({
        applicationId: transitioned.applicationId,
        stage: transitioned.stage,
        stageVersion: transitioned.stageVersion,
        lastStageChangedAt: transitioned.lastStageChangedAt,
        changed: true,
      });
    } catch (error) {
      // Two tabs or recruiters can open the same application at once. The
      // first transaction wins; the other request becomes an idempotent no-op
      // after re-reading the authoritative row.
      if (!(error instanceof JobServiceError && error.status === 409)) {
        throw error;
      }
      const latest = await this.db.jobApplication.findUnique({
        where: { id: current.id },
        select: {
          id: true,
          jobPostingId: true,
          stage: true,
          stageVersion: true,
          lastStageChangedAt: true,
        },
      });
      if (!latest) throw error;
      const latestApplication = latest as CurrentApplication;
      if (applicationStageSchema.parse(latestApplication.stage) === "APPLIED") {
        throw error;
      }
      return unchangedOutcome(latestApplication);
    }
  }
}
