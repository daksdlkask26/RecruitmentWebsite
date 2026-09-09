import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import { RecruiterApplicationAuthorization } from "@/backend/applications/authorization/recruiter-application-authorization";
import {
  applicationStageSchema,
  applicationStageTransitionOutcomeSchema,
  applicationStageTransitionSchema,
  rejectionReasonCodeSchema,
  stageTransitionCommandSchema,
  stageTransitionOutcomeSchema,
  type ApplicationStage,
  type ApplicationStageTransition,
  type StageTransitionOutcome,
} from "@/shared/contracts/applications";
import type { CandidateActor } from "./job-types";
import { JobServiceError } from "./job-types";
import {
  canCapacityPromoteApplicationStage,
  canTransitionApplicationStage,
  canRecruiterPipelineTransition,
  ordinaryApplicationTransitions,
} from "./application-stage-policy";
import { createInAppNotification } from "@/backend/notifications/notification-service";
import {
  publicOutcomeForCanonicalStage,
  publicUpdateKindForCanonicalStage,
  publicUpdateTitleForCanonicalStage,
  publicStageForCanonicalStage,
} from "@/shared/contracts/candidate-applications";

const consequentialStages = new Set<ApplicationStage>([
  "REJECTED",
  "OFFER_DECLINED",
  "HIRED",
]);

const allowedRoles = new Set([
  "OWNER",
  "HR_MANAGER",
  "RECRUITER",
  "HIRING_MANAGER",
]);

const rejectionLabels: Record<string, string> = {
  REQUIRED_TECHNICAL_EXPERIENCE_NOT_DEMONSTRATED:
    "Required technical experience not demonstrated",
  INSUFFICIENT_EXPERIENCE: "Insufficient experience",
  REQUIRED_SKILLS_NOT_DEMONSTRATED: "Required skills not demonstrated",
  POSITION_FILLED: "Position filled",
  APPLICATION_WITHDRAWN_BY_CANDIDATE: "Application withdrawn by candidate",
  OTHER_JOB_RELATED_REASON: "Other job-related reason",
};

export type StageTransitionActorKind =
  | "recruiter_manual"
  | "candidate_response"
  | "system_capacity_check";

export type StageTransitionActor = Readonly<{
  kind: StageTransitionActorKind;
  userId?: string;
  sessionId?: string;
}>;

export type StageTransitionSource =
  | "KANBAN"
  | "STAGE_ROUTE"
  | "INTERVIEW_ADAPTER"
  | "REJECTION_ADAPTER"
  | "CANDIDATE_OFFER_RESPONSE"
  | "CAPACITY_CHECK";

export type AttemptStageTransitionInput = Readonly<{
  candidateApplicationId: string;
  targetStage: ApplicationStage;
  actor: StageTransitionActor;
  requestedJobId?: string;
  expectedStageVersion?: number;
  idempotencyKey?: string;
  confirmed?: boolean;
  reasonCode?: string;
  candidateVisibleReason?: string;
  internalNote?: string;
  source?: StageTransitionSource;
  intent?: "button" | "drag";
  now?: Date;
}>;

type PipelineBoundary = Readonly<{
  requestedJobId: string;
  idempotencyKey: string;
  source?: StageTransitionSource;
  intent?: "button" | "drag";
  actorKind?: StageTransitionActorKind;
  retryAttempt?: number;
}>;

type NormalizedCommand = Readonly<{
  targetStage: ApplicationStage;
  expectedStageVersion: number;
  intent?: "button" | "drag";
  confirmed: boolean;
  reasonCode: string | null;
  candidateVisibleReason: string | null;
  internalNote: string | null;
}>;

type LegacyTransitionResult = Readonly<{
  applicationId: string;
  fromStage: ApplicationStage;
  stage: ApplicationStage;
  stageVersion: number;
  lastStageChangedAt: string;
  eventId: string;
}>;

type StageTransitionServiceResult = (
  | StageTransitionOutcome
  | LegacyTransitionResult
) &
  Readonly<{
    auditEventId?: string;
    notificationRequired?: boolean;
    notificationStatus?: string;
  }>;

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/gu, " ") ?? "";
  return normalized || null;
}

function normalizeCommand(
  raw: ApplicationStageTransition | unknown,
): NormalizedCommand {
  const pipeline = stageTransitionCommandSchema.safeParse(raw);
  if (pipeline.success) {
    return {
      targetStage: pipeline.data.targetStage,
      expectedStageVersion: pipeline.data.expectedStageVersion,
      intent: pipeline.data.intent ?? "button",
      confirmed: pipeline.data.confirmed ?? false,
      reasonCode: normalizeText(pipeline.data.reasonCode),
      candidateVisibleReason: normalizeText(
        pipeline.data.candidateVisibleReason,
      ),
      internalNote: normalizeText(pipeline.data.internalNote),
    };
  }
  const legacy = applicationStageTransitionSchema.parse(raw);
  return {
    targetStage: legacy.targetStage,
    expectedStageVersion: legacy.expectedVersion,
    intent: "button",
    confirmed: false,
    reasonCode: normalizeText(legacy.reasonCode),
    candidateVisibleReason: normalizeText(legacy.candidateVisibleReason),
    internalNote: null,
  };
}

function validateConsequential(
  command: NormalizedCommand,
  actorKind: StageTransitionActorKind = "recruiter_manual",
) {
  const recruiterConfirmationRequired = actorKind === "recruiter_manual";
  if (
    recruiterConfirmationRequired &&
    consequentialStages.has(command.targetStage) &&
    !command.confirmed
  ) {
    throw new JobServiceError(400, {
      code: "APPLICATION_STAGE_CONFIRMATION_REQUIRED",
      message: "Confirm this recruitment decision before continuing.",
    });
  }
  if (command.targetStage === "REJECTED") {
    if (!command.reasonCode) {
      throw new JobServiceError(400, {
        code: "APPLICATION_STAGE_REASON_REQUIRED",
        message: "Choose a rejection reason.",
      });
    }
    if (!rejectionReasonCodeSchema.safeParse(command.reasonCode).success) {
      throw new JobServiceError(400, {
        code: "APPLICATION_STAGE_REASON_INVALID",
        message: "Choose a valid rejection reason.",
      });
    }
  }
  if (command.targetStage === "OFFER_DECLINED" && !command.reasonCode) {
    throw new JobServiceError(400, {
      code: "APPLICATION_STAGE_REASON_REQUIRED",
      message: "Record why the offer was declined.",
    });
  }
  if (
    actorKind === "recruiter_manual" &&
    command.targetStage !== "REJECTED" &&
    command.internalNote
  ) {
    throw new JobServiceError(400, {
      code: "VALIDATION_ERROR",
      message: "Private notes are supported only for rejection decisions.",
    });
  }
}

export function applicationStageCommandDigest(input: {
  actorUserId: string;
  requestedJobId: string;
  canonicalJobId: string;
  applicationId: string;
  command: NormalizedCommand;
  source: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify({ v: 1, ...input }))
    .digest("hex");
}

function eventDigest(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  const digest = (metadata as Record<string, unknown>).commandDigest;
  return typeof digest === "string" ? digest : null;
}

function sourceForActorKind(
  actorKind: StageTransitionActorKind,
): StageTransitionSource {
  switch (actorKind) {
    case "candidate_response":
      return "CANDIDATE_OFFER_RESPONSE";
    case "system_capacity_check":
      return "CAPACITY_CHECK";
    default:
      return "KANBAN";
  }
}

function databaseActorType(actorKind: StageTransitionActorKind) {
  return actorKind === "candidate_response"
    ? "CANDIDATE"
    : actorKind.startsWith("system_")
      ? "SYSTEM_MIGRATION"
      : "RECRUITER";
}

function isSystemActor(actorKind: StageTransitionActorKind) {
  return actorKind.startsWith("system_");
}
type CapacityPromotionDb = typeof prisma | Prisma.TransactionClient;

type WaitlistedApplicationForPromotion = Readonly<{
  id: string;
  candidateUserId: string;
  stageVersion: number;
  submittedAt: Date;
  currentScoringResult: {
    state: string;
    finalScore: unknown;
  } | null;
  notificationPreference: {
    inAppEnabled: boolean;
  } | null;
}>;

function numericFinalScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number =
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
      ? Number(value.toNumber())
      : Number(value);
  return Number.isFinite(number) ? number : null;
}

function promotionScore(
  application: Pick<WaitlistedApplicationForPromotion, "currentScoringResult">,
) {
  const result = application.currentScoringResult;
  if (!result || result.state !== "SCORED") return null;
  return numericFinalScore(result.finalScore);
}

function compareWaitlistedApplications(
  left: WaitlistedApplicationForPromotion,
  right: WaitlistedApplicationForPromotion,
) {
  const leftScore = promotionScore(left);
  const rightScore = promotionScore(right);
  if (leftScore === null && rightScore !== null) return 1;
  if (leftScore !== null && rightScore === null) return -1;
  if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  const submittedAtOrder =
    left.submittedAt.getTime() - right.submittedAt.getTime();
  return submittedAtOrder || left.id.localeCompare(right.id);
}

/**
 * Promote the highest-scoring waitlisted applications after a job's capacity
 * increases. The caller must invoke this with the transaction that owns the
 * JobPosting update so capacity changes and stage outcomes commit together.
 */
export async function promoteWaitlistedApplicationsInTransaction(input: {
  db: CapacityPromotionDb;
  jobPostingId: string;
  previousCapacity: number | null;
  newCapacity: number | null;
  correlationId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (
    input.newCapacity === null ||
    input.newCapacity < 1 ||
    (input.previousCapacity !== null &&
      input.newCapacity <= input.previousCapacity)
  ) {
    return [];
  }

  // Offer responses also lock the parent JobPosting before counting Hired
  // rows. Taking the same lock serializes capacity increases with accepts.
  await input.db.$queryRaw`
    SELECT "id" FROM "JobPosting" WHERE "id" = ${input.jobPostingId} FOR UPDATE
  `;
  const job = await input.db.jobPosting.findUnique({
    where: { id: input.jobPostingId },
    select: {
      title: true,
      companyId: true,
      company: { select: { displayName: true } },
    },
  });
  if (!job) return [];

  const hiredCount = await input.db.jobApplication.count({
    where: {
      jobPostingId: input.jobPostingId,
      stage: "HIRED",
      withdrawalOutcome: null,
    },
  });
  const slots = input.newCapacity - hiredCount;
  if (slots <= 0) return [];

  const waitlisted = (await input.db.jobApplication.findMany({
    where: {
      jobPostingId: input.jobPostingId,
      stage: "WAITLISTED",
      withdrawalOutcome: null,
    },
    select: {
      id: true,
      candidateUserId: true,
      stageVersion: true,
      submittedAt: true,
      currentScoringResult: {
        select: { state: true, finalScore: true },
      },
      notificationPreference: {
        select: { inAppEnabled: true },
      },
    },
  })) as unknown as WaitlistedApplicationForPromotion[];

  waitlisted.sort(compareWaitlistedApplications);
  const promoted: Array<{
    applicationId: string;
    finalScore: number | null;
    stageVersion: number;
  }> = [];

  for (const application of waitlisted) {
    if (promoted.length >= slots) break;

    const nextVersion = application.stageVersion + 1;
    const idempotencyKey = `capacity-promotion:${input.correlationId}:${application.id}`;
    const updated = await input.db.jobApplication.updateMany({
      where: {
        id: application.id,
        jobPostingId: input.jobPostingId,
        stage: "WAITLISTED",
        stageVersion: application.stageVersion,
        withdrawalOutcome: null,
      },
      data: {
        stage: "HIRED",
        stageVersion: { increment: 1 },
        lastStageChangedAt: now,
      },
    });
    if (updated.count !== 1) continue;

    const event = await input.db.applicationStageEvent.create({
      data: {
        applicationId: application.id,
        fromStage: "WAITLISTED",
        toStage: "HIRED",
        actorUserId: null,
        actorType: "SYSTEM_MIGRATION",
        reasonCode: "JOB_CAPACITY_INCREASED",
        reasonLabelSnapshot: "Position became available",
        candidateVisibleReason:
          "A position became available and your waitlisted application has been moved to hired.",
        candidateVisible: true,
        occurredAt: now,
        applicationVersion: nextVersion,
        metadata: {
          v: 2,
          source: "CAPACITY_CHECK",
          actor: "system_capacity_check",
          previousStage: "WAITLISTED",
          capacity: input.newCapacity,
          finalScore: promotionScore(application),
        },
        notificationRequired: true,
        notificationStatus: "PENDING",
        idempotencyKey,
        decisionKind: null,
      },
    });
    await input.db.applicationPublicUpdate.create({
      data: {
        applicationId: application.id,
        kind: publicUpdateKindForCanonicalStage("HIRED"),
        publicStage: publicStageForCanonicalStage("HIRED"),
        publicOutcome: publicOutcomeForCanonicalStage("HIRED"),
        title: publicUpdateTitleForCanonicalStage("HIRED"),
        effectiveAt: now,
        deduplicationKey: `application:${application.id}:public:stage:${nextVersion}`,
        sourceEventReference: event.id,
      },
    });
    await input.db.recruitmentNotificationWork.create({
      data: {
        applicationId: application.id,
        audience: "COMPANY",
        kind: "APPLICATION_STAGE_CHANGED",
        targetReference: job.companyId,
        payloadRef: {
          v: 2,
          event: "APPLICATION_WAITLIST_PROMOTED",
          applicationId: application.id,
          previousStage: "WAITLISTED",
          stage: "HIRED",
          finalScore: promotionScore(application),
          jobTitle: job.title,
          companyName: job.company.displayName,
        },
        idempotencyKey: `application:${application.id}:stage:${nextVersion}:company`,
      },
    });
    if (application.notificationPreference?.inAppEnabled ?? true) {
      await createInAppNotification(input.db, {
        recipientUserId: application.candidateUserId,
        kind: "APPLICATION_STAGE_CHANGED",
        deduplicationKey: `application:${application.id}:stage:${nextVersion}:candidate`,
        correlationId: event.id,
        occurredAt: now,
        contextType: "APPLICATION",
        contextId: application.id,
        variables: { stage: "HIRED" },
      });
    }
    // Hired confirmation is mandatory even when ordinary application emails
    // are disabled, matching the candidate offer-acceptance path.
    await input.db.emailOutbox.create({
      data: {
        kind: "APPLICATION_STAGE_CHANGED",
        userId: application.candidateUserId,
        recipientRef: application.candidateUserId,
        templateVersion: "application-stage-changed.v1",
        payloadRef: {
          v: 1,
          applicationId: application.id,
          stage: "HIRED",
          jobTitle: job.title,
          companyName: job.company.displayName,
        },
        idempotencyKey: `application:${application.id}:stage:${nextVersion}:email`,
      },
    });
    await new PrismaAuditRepository(input.db).append({
      occurredAt: now,
      actorType: "system",
      actorUserId: null,
      actorSessionId: null,
      action: "job.application.stage_changed",
      targetType: "job_application",
      targetId: application.id,
      result: "SUCCESS",
      correlationId: event.id,
      context: {
        fromStage: "WAITLISTED",
        toStage: "HIRED",
        applicationVersion: nextVersion,
        reason: "JOB_CAPACITY_INCREASED",
        kind: "system_capacity_check",
        capacity: input.newCapacity,
        finalScore: promotionScore(application) ?? undefined,
      },
    });
    promoted.push({
      applicationId: application.id,
      finalScore: promotionScore(application),
      stageVersion: nextVersion,
    });
  }

  return promoted;
}

export class ApplicationStageService {
  constructor(
    private readonly db: typeof prisma = prisma,
    private readonly authorization = new RecruiterApplicationAuthorization(db),
  ) {}

  /**
   * The single application-stage entry point used by recruiter controls,
   * candidate offer responses and capacity enforcement.
   * Callers describe the actor; only transition() below performs the write.
   */
  async attemptStageTransition(
    input: AttemptStageTransitionInput,
  ): Promise<StageTransitionOutcome> {
    if (
      input.actor.kind !== "recruiter_manual" &&
      input.actor.kind !== "candidate_response"
    ) {
      throw new JobServiceError(403, {
        code: "APPLICATION_STAGE_ACTOR_INVALID",
        message: "This stage command requires an authorized human actor.",
      });
    }
    const application = await this.db.jobApplication.findUnique({
      where: { id: input.candidateApplicationId },
      select: {
        jobPostingId: true,
        stageVersion: true,
      },
    });
    if (!application) {
      throw new JobServiceError(404, {
        code: "APPLICATION_UNAVAILABLE",
        message: "This application is unavailable.",
      });
    }

    const now = input.now ?? new Date();
    const expectedStageVersion =
      input.expectedStageVersion ?? application.stageVersion;
    const actorUserId = input.actor.userId ?? `system:${input.actor.kind}`;
    const actor: CandidateActor = {
      userId: actorUserId,
      sessionId: input.actor.sessionId ?? `system:${input.actor.kind}`,
    };
    const source = input.source ?? sourceForActorKind(input.actor.kind);
    const intent = input.intent ?? "button";
    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      `pipeline:${input.actor.kind}:${input.candidateApplicationId}:${expectedStageVersion}:${input.targetStage}`;

    const result = await this.transition(
      actor,
      input.candidateApplicationId,
      {
        targetStage: input.targetStage,
        expectedStageVersion,
        intent,
        confirmed: input.confirmed,
        reasonCode: input.reasonCode,
        candidateVisibleReason: input.candidateVisibleReason,
        internalNote: input.internalNote,
      },
      now,
      {
        requestedJobId: input.requestedJobId ?? application.jobPostingId,
        idempotencyKey,
        source,
        intent,
        actorKind: input.actor.kind,
      },
    );
    if (!("stageEventId" in result)) {
      throw new JobServiceError(503, {
        code: "JOB_SERVICE_UNAVAILABLE",
        message: "The stage transition could not be completed.",
      });
    }
    return result;
  }

  async transitionLegacy(
    actor: CandidateActor,
    applicationId: string,
    rawCommand: ApplicationStageTransition | unknown,
    idempotencyKey: string,
    now = new Date(),
  ) {
    const application = await this.db.jobApplication.findUnique({
      where: { id: applicationId },
      select: { jobPostingId: true },
    });
    if (!application) {
      throw new JobServiceError(404, {
        code: "APPLICATION_UNAVAILABLE",
        message: "This application is unavailable.",
      });
    }
    return this.transition(actor, applicationId, rawCommand, now, {
      requestedJobId: application.jobPostingId,
      idempotencyKey,
      source: "STAGE_ROUTE",
    });
  }

  async currentAuthorizedState(
    userId: string,
    requestedJobId: string,
    applicationId: string,
  ) {
    const authorization = await this.authorization.authorizeApplication(
      userId,
      requestedJobId,
      applicationId,
    );
    if (!authorization.authorized) return null;
    return this.db.jobApplication.findFirst({
      where: { id: applicationId, jobPostingId: authorization.jobPostingId },
      select: { stage: true, stageVersion: true },
    });
  }

  async transition(
    actor: CandidateActor,
    applicationId: string,
    rawCommand: ApplicationStageTransition | unknown,
    now = new Date(),
    boundary?: PipelineBoundary,
  ): Promise<StageTransitionServiceResult> {
    const command = normalizeCommand(rawCommand);
    const actorKind = boundary?.actorKind ?? "recruiter_manual";
    const intent = boundary?.intent ?? command.intent ?? "button";
    if (boundary) validateConsequential(command, actorKind);
    if (boundary && !boundary.idempotencyKey.trim()) {
      throw new JobServiceError(400, {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "An Idempotency-Key is required.",
      });
    }

    const authorized =
      boundary && actorKind === "recruiter_manual"
        ? await this.authorization.authorizeApplication(
            actor.userId,
            boundary.requestedJobId,
            applicationId,
          )
        : null;
    if (
      authorized &&
      (!authorized.authorized || authorized.canMoveStages === false)
    ) {
      throw new JobServiceError(404, {
        code: "APPLICATION_UNAVAILABLE",
        message: "This application is unavailable.",
      });
    }
    const authorizedJobId = authorized?.authorized
      ? authorized.jobPostingId || boundary?.requestedJobId || null
      : null;

    try {
      return await this.db.$transaction(
        async (tx) => {
          const application = await tx.jobApplication.findUnique({
            where: { id: applicationId },
            select: {
              id: true,
              jobPostingId: true,
              stage: true,
              stageVersion: true,
              withdrawalOutcome: true,
              candidateUserId: true,
              candidate: {
                select: {
                  user: {
                    select: {
                      preferences: {
                        select: { applicationUpdatesEmail: true },
                      },
                    },
                  },
                },
              },
              jobPosting: {
                select: {
                  companyId: true,
                  title: true,
                  numberOfHires: true,
                  company: { select: { displayName: true } },
                },
              },
              notificationPreference: {
                select: { emailEnabled: true, inAppEnabled: true },
              },
            },
          });
          const authorizedApplicationJobId = authorized?.authorized
            ? authorized.jobPostingId || boundary?.requestedJobId || null
            : null;
          if (
            !application ||
            (authorizedApplicationJobId &&
              application.jobPostingId &&
              application.jobPostingId !== authorizedApplicationJobId)
          ) {
            throw new JobServiceError(404, {
              code: "APPLICATION_UNAVAILABLE",
              message: "This application is unavailable.",
            });
          }

          if (
            actorKind === "candidate_response" &&
            application?.candidateUserId !== actor.userId
          ) {
            throw new JobServiceError(404, {
              code: "APPLICATION_UNAVAILABLE",
              message: "This application is unavailable.",
            });
          }

          if (!boundary) {
            const membership = await tx.companyMembership.findUnique({
              where: {
                companyId_userId: {
                  companyId: application.jobPosting.companyId,
                  userId: actor.userId,
                },
              },
              select: { role: true, status: true },
            });
            const hasDatabaseRecruiterMembership =
              membership?.status === "ACTIVE" &&
              allowedRoles.has(membership.role);
            // Legacy catalog-backed jobs are authorized through the same
            // bridge used by recruiter candidate/scoring reads. Keep the
            // canonical stage writer aligned with that authorization path
            // when the migrated CompanyMembership row is not available yet.
            const fallbackAuthorization = hasDatabaseRecruiterMembership
              ? null
              : await this.authorization.authorizeApplication(
                  actor.userId,
                  application.jobPostingId,
                  application.id,
                );
            const hasCompatibleRecruiterAuthorization =
              hasDatabaseRecruiterMembership ||
              Boolean(
                fallbackAuthorization?.authorized &&
                fallbackAuthorization.canMoveStages !== false,
              );
            if (!hasCompatibleRecruiterAuthorization) {
              throw new JobServiceError(404, {
                code: "APPLICATION_UNAVAILABLE",
                message: "This application is unavailable.",
              });
            }
          }

          const fromStage = applicationStageSchema.parse(application.stage);
          const source = boundary?.source ?? "STAGE_ROUTE";
          const requestedJobId =
            boundary?.requestedJobId ?? application.jobPostingId;
          const canonicalJobId = application.jobPostingId || requestedJobId;
          const digest = applicationStageCommandDigest({
            actorUserId: actor.userId,
            requestedJobId,
            canonicalJobId,
            applicationId,
            command,
            source,
          });
          const idempotencyKey = boundary?.idempotencyKey.trim() || null;

          if (idempotencyKey) {
            const replay = await tx.applicationStageEvent.findFirst({
              where: { applicationId, idempotencyKey },
              orderBy: { occurredAt: "desc" },
            });
            if (replay) {
              if (eventDigest(replay.metadata) !== digest) {
                throw new JobServiceError(409, {
                  code: "IDEMPOTENCY_CONFLICT",
                  message:
                    "This Idempotency-Key was used for a different stage decision.",
                });
              }
              const replayMetadata =
                replay.metadata &&
                typeof replay.metadata === "object" &&
                !Array.isArray(replay.metadata)
                  ? (replay.metadata as Record<string, unknown>)
                  : null;
              const replayFromStage =
                replayMetadata?.autoShortlisted === true &&
                typeof replayMetadata.initialFromStage === "string"
                  ? applicationStageSchema.parse(
                      replayMetadata.initialFromStage,
                    )
                  : replay.fromStage;
              return {
                ...stageTransitionOutcomeSchema.parse({
                  applicationId,
                  fromStage: replayFromStage,
                  stage: replay.toStage,
                  stageVersion: replay.applicationVersion,
                  lastStageChangedAt: replay.occurredAt.toISOString(),
                  stageEventId: replay.id,
                  replayed: true,
                  allowedDestinations:
                    ordinaryApplicationTransitions[replay.toStage],
                }),
                auditEventId: replay.id,
                notificationRequired: replay.notificationRequired,
                notificationStatus: replay.notificationStatus,
              };
            }
          }

          if (application.stageVersion !== command.expectedStageVersion) {
            throw new JobServiceError(409, {
              code: "APPLICATION_STAGE_CONFLICT",
              message: "This application changed. Refresh it and try again.",
            });
          }
          if (application.withdrawalOutcome) {
            throw new JobServiceError(409, {
              code: "APPLICATION_WITHDRAWAL_BLOCKED",
              message: "This application has been withdrawn.",
            });
          }
          const capacityPromotion =
            actorKind === "system_capacity_check" &&
            canCapacityPromoteApplicationStage(fromStage, command.targetStage);
          if (
            !capacityPromotion &&
            !canTransitionApplicationStage(fromStage, command.targetStage)
          ) {
            throw new JobServiceError(409, {
              code: "APPLICATION_STAGE_TRANSITION_INVALID",
              message: "This stage change is not allowed.",
            });
          }

          const interviewBridge =
            fromStage === "VIEWED" &&
            command.targetStage === "INTERVIEWING" &&
            intent === "button";
          const strictRecruiterBoundary =
            boundary?.source === "KANBAN" ||
            boundary?.source === "INTERVIEW_ADAPTER" ||
            boundary?.source === "REJECTION_ADAPTER";
          if (
            actorKind === "recruiter_manual" &&
            strictRecruiterBoundary &&
            !interviewBridge &&
            !canRecruiterPipelineTransition(
              fromStage,
              command.targetStage,
              intent,
            )
          ) {
            throw new JobServiceError(409, {
              code: "APPLICATION_STAGE_TRANSITION_INVALID",
              message:
                "This stage change is not allowed from the recruitment pipeline.",
            });
          }
          if (
            actorKind === "candidate_response" &&
            (fromStage !== "OFFERED" ||
              !["HIRED", "OFFER_DECLINED"].includes(command.targetStage))
          ) {
            throw new JobServiceError(409, {
              code: "APPLICATION_STAGE_TRANSITION_INVALID",
              message: "This offer response is no longer available.",
            });
          }
          if (
            actorKind === "system_capacity_check" &&
            command.targetStage !== "WAITLISTED" &&
            !capacityPromotion
          ) {
            throw new JobServiceError(409, {
              code: "APPLICATION_STAGE_TRANSITION_INVALID",
              message: "Capacity checks may only waitlist an application.",
            });
          }

          if (
            actorKind === "recruiter_manual" &&
            ["HIRED", "OFFER_DECLINED"].includes(command.targetStage)
          ) {
            throw new JobServiceError(409, {
              code: "APPLICATION_STAGE_TRANSITION_INVALID",
              message: "Offer outcomes are recorded by the candidate.",
            });
          }

          let targetStage = command.targetStage;
          let transitionActorKind = actorKind;
          let effectiveReasonCode = command.reasonCode;
          let effectiveCandidateVisibleReason = command.candidateVisibleReason;
          let capacityRedirected = false;
          if (capacityPromotion) {
            effectiveReasonCode = "JOB_CAPACITY_INCREASED";
            effectiveCandidateVisibleReason =
              "A position became available and your waitlisted application has been moved to hired.";
          }
          if (command.targetStage === "HIRED") {
            const maxPositions = application.jobPosting.numberOfHires;
            if (typeof maxPositions === "number") {
              // Serialize all offer responses for this job before counting
              // Hired rows. Serializable isolation detects conflicts; the
              // parent-row lock also makes the capacity invariant explicit.
              await tx.$queryRaw`SELECT "id" FROM "JobPosting" WHERE "id" = ${canonicalJobId} FOR UPDATE`;
              const hiredCount = await tx.jobApplication.count({
                where: {
                  jobPostingId: canonicalJobId,
                  stage: "HIRED",
                  withdrawalOutcome: null,
                },
              });
              if (hiredCount >= maxPositions) {
                if (capacityPromotion) {
                  throw new JobServiceError(409, {
                    code: "APPLICATION_CAPACITY_UNAVAILABLE",
                    message:
                      "No hiring capacity is available for this application.",
                  });
                }
                targetStage = "WAITLISTED";
                transitionActorKind = "system_capacity_check";
                effectiveReasonCode = "JOB_CAPACITY_REACHED";
                effectiveCandidateVisibleReason =
                  "This position is full, so your application has been waitlisted.";
                capacityRedirected = true;
              }
            }
          }

          const autoShortlistForInterview =
            actorKind === "recruiter_manual" &&
            fromStage === "VIEWED" &&
            command.targetStage === "INTERVIEWING" &&
            intent === "button" &&
            (boundary?.source === "INTERVIEW_ADAPTER" ||
              boundary?.source === "KANBAN");
          const stageVersionIncrement = autoShortlistForInterview ? 2 : 1;
          const finalAt = autoShortlistForInterview
            ? new Date(now.getTime() + 1)
            : now;
          const nextVersion = application.stageVersion + stageVersionIncrement;
          const updated = await tx.jobApplication.updateMany({
            where: {
              id: application.id,
              jobPostingId: canonicalJobId,
              stage: fromStage,
              stageVersion: command.expectedStageVersion,
              withdrawalOutcome: null,
            },
            data: {
              stage: targetStage,
              stageVersion: { increment: stageVersionIncrement },
              lastStageChangedAt: finalAt,
            },
          });
          if (updated.count !== 1)
            throw new JobServiceError(409, {
              code: "APPLICATION_STAGE_CONFLICT",
              message: "This application changed. Refresh it and try again.",
            });

          let shortlistEvent: { id: string };
          if (autoShortlistForInterview) {
            shortlistEvent = await tx.applicationStageEvent.create({
              data: {
                applicationId: application.id,
                fromStage: "VIEWED",
                toStage: "SHORTLISTED",
                actorUserId: actor.userId,
                actorType: "RECRUITER",
                reasonCode: "RECRUITER_AUTO_SHORTLISTED_FOR_INTERVIEW",
                reasonLabelSnapshot:
                  "Recruiter recorded shortlist before interview",
                internalNoteEncrypted: null,
                candidateVisibleReason:
                  "Your application has been shortlisted.",
                candidateVisible: true,
                occurredAt: now,
                applicationVersion: application.stageVersion + 1,
                metadata: {
                  v: 2,
                  source,
                  autoShortlisted: true,
                  initialFromStage: fromStage,
                },
                decisionKind: null,
                notificationRequired: false,
                notificationStatus: "NOT_REQUIRED",
                idempotencyKey: null,
              },
            });
            await tx.applicationPublicUpdate.create({
              data: {
                applicationId: application.id,
                kind: publicUpdateKindForCanonicalStage("SHORTLISTED"),
                publicStage: publicStageForCanonicalStage("SHORTLISTED"),
                publicOutcome: publicOutcomeForCanonicalStage("SHORTLISTED"),
                title: publicUpdateTitleForCanonicalStage("SHORTLISTED"),
                effectiveAt: now,
                deduplicationKey: `application:${application.id}:public:stage:${application.stageVersion + 1}`,
                sourceEventReference: shortlistEvent.id,
              },
            });
          }

          const inAppUpdatesEnabled =
            application.notificationPreference?.inAppEnabled ?? true;
          const emailUpdatesEnabled =
            application.notificationPreference?.emailEnabled ??
            application.candidate.user.preferences?.applicationUpdatesEmail ??
            true;
          const emailRequired =
            command.targetStage === "HIRED" ||
            emailUpdatesEnabled ||
            targetStage === "OFFERED" ||
            targetStage === "WAITLISTED";
          const notificationRequired =
            autoShortlistForInterview ||
            inAppUpdatesEnabled ||
            emailRequired ||
            actorKind === "candidate_response" ||
            capacityRedirected ||
            capacityPromotion;
          const reasonLabelSnapshot =
            targetStage === "REJECTED" && effectiveReasonCode
              ? (rejectionLabels[effectiveReasonCode] ?? effectiveReasonCode)
              : effectiveReasonCode;
          const event = await tx.applicationStageEvent.create({
            data: {
              applicationId: application.id,
              fromStage: autoShortlistForInterview ? "SHORTLISTED" : fromStage,
              toStage: targetStage,
              actorUserId: isSystemActor(transitionActorKind)
                ? null
                : actor.userId,
              actorType: databaseActorType(transitionActorKind),
              reasonCode: effectiveReasonCode,
              reasonLabelSnapshot,
              internalNoteEncrypted: command.internalNote,
              candidateVisibleReason: effectiveCandidateVisibleReason,
              candidateVisible: true,
              occurredAt: finalAt,
              applicationVersion: nextVersion,
              notificationRequired,
              notificationStatus: notificationRequired
                ? "PENDING"
                : "NOT_REQUIRED",
              idempotencyKey,
              decisionKind:
                targetStage === "REJECTED"
                  ? "REJECT"
                  : targetStage === "INTERVIEWING"
                    ? "MOVE_TO_INTERVIEW"
                    : null,
              metadata: {
                v: 2,
                source,
                commandDigest: digest,
                requestedJobId,
                canonicalJobId,
                confirmed: command.confirmed,
                actor: transitionActorKind,
                requestedTargetStage: command.targetStage,
                capacityRedirected,
                capacityPromotion,
                autoShortlisted: autoShortlistForInterview,
                initialFromStage: autoShortlistForInterview
                  ? fromStage
                  : undefined,
              },
            },
          });

          const publicStage = publicStageForCanonicalStage(targetStage);
          await tx.applicationPublicUpdate.create({
            data: {
              applicationId: application.id,
              kind: publicUpdateKindForCanonicalStage(targetStage),
              publicStage,
              publicOutcome: publicOutcomeForCanonicalStage(targetStage),
              title: publicUpdateTitleForCanonicalStage(targetStage),
              effectiveAt: finalAt,
              deduplicationKey: `application:${application.id}:public:stage:${nextVersion}`,
              sourceEventReference: event.id,
            },
          });

          if (
            actorKind === "candidate_response" ||
            capacityRedirected ||
            capacityPromotion
          ) {
            await tx.recruitmentNotificationWork.create({
              data: {
                applicationId: application.id,
                audience: "COMPANY",
                kind: "APPLICATION_STAGE_CHANGED",
                targetReference: application.jobPosting.companyId,
                payloadRef: {
                  v: 2,
                  event: capacityRedirected
                    ? "APPLICATION_CAPACITY_REDIRECTED"
                    : capacityPromotion
                      ? "APPLICATION_WAITLIST_PROMOTED"
                      : "CANDIDATE_OFFER_RESPONSE",
                  applicationId: application.id,
                  requestedStage: command.targetStage,
                  stage: targetStage,
                  decision:
                    actorKind === "candidate_response"
                      ? effectiveReasonCode
                      : null,
                  jobTitle: application.jobPosting.title,
                  companyName: application.jobPosting.company.displayName,
                },
                idempotencyKey: `application:${application.id}:stage:${nextVersion}:company`,
              },
            });
          }

          if (inAppUpdatesEnabled) {
            await createInAppNotification(tx, {
              recipientUserId: application.candidateUserId,
              kind: "APPLICATION_STAGE_CHANGED",
              deduplicationKey: `application:${application.id}:stage:${nextVersion}:candidate`,
              correlationId: event.id,
              occurredAt: finalAt,
              contextType: "APPLICATION",
              contextId: application.id,
              variables: { stage: targetStage },
            });
          }

          if (emailRequired) {
            await tx.emailOutbox.create({
              data: {
                kind: "APPLICATION_STAGE_CHANGED",
                userId: application.candidateUserId,
                recipientRef: application.candidateUserId,
                templateVersion: "application-stage-changed.v1",
                payloadRef: {
                  v: 1,
                  applicationId: application.id,
                  stage: targetStage,
                  jobTitle: application.jobPosting.title,
                  companyName: application.jobPosting.company.displayName,
                },
                idempotencyKey: `application:${application.id}:stage:${nextVersion}:email`,
              },
            });
          }

          const auditEventId = await new PrismaAuditRepository(tx).append({
            occurredAt: finalAt,
            actorType: isSystemActor(transitionActorKind) ? "system" : "user",
            actorUserId: isSystemActor(transitionActorKind)
              ? null
              : actor.userId,
            actorSessionId: isSystemActor(transitionActorKind)
              ? null
              : actor.sessionId,
            action: "job.application.stage_changed",
            targetType: "job_application",
            targetId: application.id,
            result: "SUCCESS",
            correlationId: event.id,
            context: {
              fromStage,
              toStage: targetStage,
              applicationVersion: nextVersion,
              reason: effectiveReasonCode ?? undefined,
              kind: transitionActorKind,
              notificationWorkCount:
                Number(inAppUpdatesEnabled) + Number(emailRequired),
            },
          });

          const outcome = !boundary
            ? applicationStageTransitionOutcomeSchema.parse({
                applicationId: application.id,
                fromStage,
                stage: targetStage,
                stageVersion: nextVersion,
                lastStageChangedAt: finalAt.toISOString(),
                eventId: event.id,
              })
            : stageTransitionOutcomeSchema.parse({
                applicationId: application.id,
                fromStage,
                stage: targetStage,
                stageVersion: nextVersion,
                lastStageChangedAt: finalAt.toISOString(),
                stageEventId: event.id,
                replayed: false,
                allowedDestinations:
                  ordinaryApplicationTransitions[targetStage],
              });
          return {
            ...outcome,
            auditEventId,
            notificationRequired,
            notificationStatus: notificationRequired
              ? "PENDING"
              : "NOT_REQUIRED",
          };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof JobServiceError) throw error;

      const prismaCode =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : null;
      if (!boundary) {
        if (prismaCode === "P2034") {
          throw new JobServiceError(409, {
            code: "APPLICATION_STAGE_CONFLICT",
            message: "This application changed. Refresh it and try again.",
          });
        }
        throw error;
      }
      if (prismaCode === "P2034" && (boundary.retryAttempt ?? 0) < 4) {
        return this.transition(actor, applicationId, rawCommand, now, {
          ...boundary,
          retryAttempt: (boundary.retryAttempt ?? 0) + 1,
        });
      }
      if (!["P2002", "P2034"].includes(prismaCode ?? "")) {
        throw error;
      }

      const current = await this.db.jobApplication.findFirst({
        where: {
          id: applicationId,
          ...(authorizedJobId ? { jobPostingId: authorizedJobId } : {}),
        },
        select: { jobPostingId: true, stage: true, stageVersion: true },
      });
      if (!current) {
        throw new JobServiceError(404, {
          code: "APPLICATION_UNAVAILABLE",
          message: "This application is unavailable.",
        });
      }

      const idempotencyKey = boundary.idempotencyKey.trim();
      const source = boundary.source ?? "STAGE_ROUTE";
      const digest = applicationStageCommandDigest({
        actorUserId: actor.userId,
        requestedJobId: boundary.requestedJobId,
        canonicalJobId: current.jobPostingId || boundary.requestedJobId,
        applicationId,
        command,
        source,
      });
      const replay = idempotencyKey
        ? await this.db.applicationStageEvent.findFirst({
            where: { applicationId, idempotencyKey },
            orderBy: { occurredAt: "desc" },
          })
        : null;
      if (replay) {
        if (eventDigest(replay.metadata) !== digest) {
          throw new JobServiceError(409, {
            code: "IDEMPOTENCY_CONFLICT",
            message:
              "This Idempotency-Key was used for a different stage decision.",
          });
        }
        const replayMetadata =
          replay.metadata &&
          typeof replay.metadata === "object" &&
          !Array.isArray(replay.metadata)
            ? (replay.metadata as Record<string, unknown>)
            : null;
        const replayFromStage =
          replayMetadata?.autoShortlisted === true &&
          typeof replayMetadata.initialFromStage === "string"
            ? applicationStageSchema.parse(replayMetadata.initialFromStage)
            : replay.fromStage;
        return {
          ...stageTransitionOutcomeSchema.parse({
            applicationId,
            fromStage: replayFromStage,
            stage: replay.toStage,
            stageVersion: replay.applicationVersion,
            lastStageChangedAt: replay.occurredAt.toISOString(),
            stageEventId: replay.id,
            replayed: true,
            allowedDestinations: ordinaryApplicationTransitions[replay.toStage],
          }),
          auditEventId: replay.id,
          notificationRequired: replay.notificationRequired,
          notificationStatus: replay.notificationStatus,
        };
      }

      throw new JobServiceError(409, {
        code: "APPLICATION_STAGE_CONFLICT",
        message: "This application changed. Refresh it and try again.",
      });
    }
  }
}

/** Public functional facade for callers that do not need the service object. */
export async function attemptStageTransition(
  input: AttemptStageTransitionInput,
) {
  return new ApplicationStageService().attemptStageTransition(input);
}
