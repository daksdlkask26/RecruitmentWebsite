import "server-only";

import { prisma } from "@/backend/database/prisma";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/backend/generated/prisma/client";
import { createInAppNotification } from "@/backend/notifications/notification-service";
import {
  PrismaTeamApplicationRepository,
  type CandidateTeamApplicationRow,
} from "@/backend/repositories/company-members/prisma-team-application-repository";
import {
  candidateTeamApplicationSchema,
  type TeamRole,
} from "@/shared/contracts/company-members/team-applications";
import type { PreparedDirectApplicationCv } from "@/backend/services/jobs/prepare-direct-application-cv";
import { teamApplicationCvDeleteAfter } from "./team-application-retention-policy";
import {
  CANDIDATE_CV_ARTIFACT_SCOPE,
  markCandidateCvArtifactCommitted,
  markCandidateCvArtifactDeleted,
  markCandidateCvArtifactFailure,
  stageCandidateCvArtifact,
} from "@/backend/cv/candidate-cv-artifact-promotion";

const supportedRoles = ["HR_MANAGER", "RECRUITER"] as const;

export class TeamApplicationCommandError extends Error {
  constructor(
    readonly code:
      | "TEAM_COMPANY_UNAVAILABLE"
      | "TEAM_OPPORTUNITY_CLOSED"
      | "TEAM_MEMBER_EXISTS"
      | "TEAM_APPLICATION_DUPLICATE"
      | "TEAM_APPLICATION_UNAVAILABLE"
      | "TEAM_APPLICATION_CONFLICT",
  ) {
    super(code);
  }
}

function invitationState(row: CandidateTeamApplicationRow) {
  return row?.invitation?.state ?? null;
}

export function projectCandidateTeamApplication(
  row: NonNullable<CandidateTeamApplicationRow>,
) {
  return candidateTeamApplicationSchema.parse({
    applicationId: row.id,
    companyId: row.companyId,
    companyName: row.company.displayName,
    companySlug: row.company.slug,
    appliedRole: row.appliedRole,
    status: row.status,
    invitationStatus: invitationState(row),
    invitationId: row.invitation?.id ?? null,
    submittedAt: row.submittedAt.toISOString(),
    ownerViewed: Boolean(row.ownerFirstViewedAt),
    ownerFirstViewedAt: row.ownerFirstViewedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    invitationExpiresAt: row.invitation?.expiresAt.toISOString() ?? null,
  });
}

function activeKey(candidateUserId: string, companyId: string, role: TeamRole) {
  return `${candidateUserId}:${companyId}:${role}`;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: {
    action: string;
    actorUserId: string;
    targetId: string;
    result?: "SUCCESS" | "FAILURE" | "DENIED";
    context?: Record<string, unknown>;
    occurredAt: Date;
  },
) {
  await tx.auditEvent.create({
    data: {
      actorType: "user",
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "team_application",
      targetId: input.targetId,
      result: input.result ?? "SUCCESS",
      correlationId: input.targetId,
      occurredAt: input.occurredAt,
      context: (input.context ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export class TeamApplicationService {
  constructor(
    private readonly repository = new PrismaTeamApplicationRepository(),
  ) {}

  private async synchronizeExpiredInvitations(
    userId: string,
    now = new Date(),
  ) {
    const expired = await prisma.companyInvitation.updateMany({
      where: {
        state: "PENDING",
        expiresAt: { lte: now },
        teamApplication: {
          is: { candidateUserId: userId, status: "INVITATION_SENT" },
        },
      },
      data: { state: "EXPIRED", version: { increment: 1 } },
    });
    if (expired.count) {
      await prisma.teamApplication.updateMany({
        where: {
          candidateUserId: userId,
          status: "INVITATION_SENT",
          cvDeleteAfter: null,
          invitation: {
            is: { state: "EXPIRED" },
          },
        },
        data: { cvDeleteAfter: teamApplicationCvDeleteAfter(now) },
      });
    }
  }

  async listCandidate(userId: string) {
    await this.synchronizeExpiredInvitations(userId);
    const rows = await this.repository.listForCandidate(userId);
    return { items: rows.map(projectCandidateTeamApplication) };
  }

  async getCandidate(userId: string, applicationId: string) {
    await this.synchronizeExpiredInvitations(userId);
    const row = await this.repository.findForCandidate(userId, applicationId);
    if (!row)
      throw new TeamApplicationCommandError("TEAM_APPLICATION_UNAVAILABLE");
    return projectCandidateTeamApplication(row);
  }

  async submit(
    candidateUserId: string,
    companyId: string,
    role: TeamRole,
    prepared: PreparedDirectApplicationCv,
    occurredAt = new Date(),
  ) {
    let cleaned = false;
    let transactionAttempted = false;
    let promotionId: string | null = null;
    let stageFailed = false;
    let storageOutcomeUnknown = false;
    const cleanup = async () => {
      if (cleaned) return;
      await prepared.cleanup();
      cleaned = true;
    };
    const cleanupStagedArtifact = async () => {
      try {
        await cleanup();
        if (promotionId)
          await markCandidateCvArtifactDeleted(promotionId, occurredAt);
      } catch {
        prepared.preserveOnUnknown?.();
        if (promotionId) {
          await markCandidateCvArtifactFailure(
            promotionId,
            "CANDIDATE_CV_ARTIFACT_CLEANUP_FAILED",
          );
        }
      }
    };
    try {
      const account = await prisma.userAccount.findUnique({
        where: { id: candidateUserId },
        select: {
          email: true,
          state: true,
          candidateIdentity: { select: { userId: true } },
        },
      });
      if (
        !account ||
        account.state !== "ACTIVE" ||
        !account.candidateIdentity
      ) {
        throw new TeamApplicationCommandError("TEAM_APPLICATION_UNAVAILABLE");
      }

      const key = activeKey(candidateUserId, companyId, role);
      const existing = await prisma.teamApplication.findFirst({
        where: { activeKey: key },
        select: { id: true },
      });
      if (existing) {
        await cleanup();
        const status = await this.getCandidate(candidateUserId, existing.id);
        return { created: false as const, application: status };
      }

      const applicationId = randomUUID();
      promotionId = await stageCandidateCvArtifact({
        candidateUserId,
        scope: CANDIDATE_CV_ARTIFACT_SCOPE.TEAM_APPLICATION,
        targetId: applicationId,
        storageKey: prepared.storageKey,
        contentDigestSha256: prepared.checksumSha256,
        byteSize: prepared.byteSize,
        occurredAt,
      }).catch((error) => {
        stageFailed = true;
        throw error;
      });
      // The durable Team Application promotion is staged before the object is
      // materialized. A storage response lost after this point is therefore
      // recoverable by the reconciliation worker instead of becoming an
      // untracked upload.
      try {
        await prepared.ensureStored?.();
      } catch (error) {
        // cleanup() intentionally does nothing for an UNKNOWN object. Its
        // resolution is not proof of deletion: leave the staged ledger for
        // reconciliation even if recording this failure also loses its reply.
        storageOutcomeUnknown = true;
        prepared.preserveOnUnknown?.();
        await markCandidateCvArtifactFailure(
          promotionId,
          "CANDIDATE_CV_ARTIFACT_STORAGE_WRITE_UNKNOWN",
        );
        throw error;
      }
      transactionAttempted = true;
      const createdId = await prisma.$transaction(async (tx) => {
        const company = await tx.company.findFirst({
          where: {
            id: companyId,
            verifiedAt: { not: null },
            verificationState: "ACTIVE",
            verificationInactiveAt: null,
            moderationState: "ACTIVE",
          },
          select: { id: true, displayName: true },
        });
        if (!company) {
          throw new TeamApplicationCommandError("TEAM_COMPANY_UNAVAILABLE");
        }

        const owners = await tx.companyMembership.findMany({
          where: {
            companyId: company.id,
            role: "OWNER",
            status: "ACTIVE",
            removedAt: null,
          },
          select: { userId: true },
        });
        if (!owners.length) {
          throw new TeamApplicationCommandError("TEAM_COMPANY_UNAVAILABLE");
        }

        const membership = await tx.companyMembership.findUnique({
          where: { companyId_userId: { companyId, userId: candidateUserId } },
          select: { status: true },
        });
        if (membership && membership.status !== "REMOVED") {
          throw new TeamApplicationCommandError("TEAM_MEMBER_EXISTS");
        }

        const opportunity = await tx.teamOpportunity.upsert({
          where: { companyId_role: { companyId, role } },
          update: {},
          create: { companyId, role, state: "OPEN" },
          select: { id: true, state: true },
        });
        if (opportunity.state !== "OPEN") {
          throw new TeamApplicationCommandError("TEAM_OPPORTUNITY_CLOSED");
        }

        const duplicate = await tx.teamApplication.findFirst({
          where: { activeKey: key },
          select: { id: true },
        });
        if (duplicate) {
          throw new TeamApplicationCommandError("TEAM_APPLICATION_DUPLICATE");
        }

        const application = await tx.teamApplication.create({
          data: {
            id: applicationId,
            candidateUserId,
            companyId,
            teamOpportunityId: opportunity.id,
            appliedRole: role,
            applicationEmail: account.email.trim().toLowerCase(),
            cvDisplayName: prepared.displayName,
            cvFileName: prepared.fileName,
            cvMimeType: prepared.mimeType,
            cvByteSize: prepared.byteSize,
            cvStorageKey: prepared.storageKey,
            cvChecksumSha256: prepared.checksumSha256,
            activeKey: key,
            status: "SUBMITTED",
            submittedAt: occurredAt,
          },
          select: { id: true },
        });
        await writeAudit(tx, {
          action: "team_application.submitted",
          actorUserId: candidateUserId,
          targetId: application.id,
          occurredAt,
          context: {
            companyId,
            role,
            cvMimeType: prepared.mimeType,
            cvByteSize: prepared.byteSize,
          },
        });
        for (const owner of owners) {
          await createInAppNotification(tx, {
            recipientUserId: owner.userId,
            kind: "TEAM_APPLICATION_RECEIVED",
            deduplicationKey: `team-application-received:${application.id}:${owner.userId}`,
            correlationId: application.id,
            occurredAt,
            contextType: "MEMBERSHIP",
            contextId: company.id,
            variables: {
              companyName: company.displayName,
              recipientRole: "RECRUITER",
              state: role,
            },
          });
        }
        return application.id;
      });

      // The transaction has committed the application row and its CV locator.
      // From this point onward route/projection failures must not delete the
      // artifact; retention/reconciliation owns it instead.
      prepared.claimOwnership();
      if (promotionId) await markCandidateCvArtifactCommitted(promotionId);

      const result = await this.getCandidate(candidateUserId, createdId);
      return { created: true as const, application: result };
    } catch (error) {
      if (storageOutcomeUnknown) throw error;
      if (
        (error instanceof TeamApplicationCommandError &&
          error.code === "TEAM_APPLICATION_DUPLICATE") ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002")
      ) {
        let existing: { id: string } | null;
        try {
          existing = await prisma.teamApplication.findFirst({
            where: { activeKey: activeKey(candidateUserId, companyId, role) },
            select: { id: true },
          });
        } catch {
          prepared.preserveOnUnknown?.();
          throw error;
        }
        if (existing) {
          await cleanupStagedArtifact();
          return {
            created: false as const,
            application: await this.getCandidate(candidateUserId, existing.id),
          };
        }
        prepared.preserveOnUnknown?.();
        throw error;
      }
      if (stageFailed) {
        prepared.preserveOnUnknown?.();
      } else if (
        !transactionAttempted ||
        error instanceof TeamApplicationCommandError
      ) {
        await cleanupStagedArtifact();
      } else {
        prepared.preserveOnUnknown?.();
      }
      throw error;
    }
  }

  async withdraw(
    candidateUserId: string,
    applicationId: string,
    occurredAt = new Date(),
  ) {
    const result = await prisma.$transaction(async (tx) => {
      const application = await tx.teamApplication.findFirst({
        where: {
          id: applicationId,
          candidateUserId,
          status: { in: ["SUBMITTED", "VIEWED"] },
        },
        select: { id: true, version: true, companyId: true, appliedRole: true },
      });
      if (!application) {
        throw new TeamApplicationCommandError("TEAM_APPLICATION_CONFLICT");
      }
      const changed = await tx.teamApplication.updateMany({
        where: {
          id: application.id,
          candidateUserId,
          version: application.version,
          status: { in: ["SUBMITTED", "VIEWED"] },
        },
        data: {
          status: "WITHDRAWN",
          withdrawnAt: occurredAt,
          cvDeleteAfter: teamApplicationCvDeleteAfter(occurredAt),
          activeKey: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new TeamApplicationCommandError("TEAM_APPLICATION_CONFLICT");
      }
      await writeAudit(tx, {
        action: "team_application.withdrawn",
        actorUserId: candidateUserId,
        targetId: application.id,
        occurredAt,
        context: {
          companyId: application.companyId,
          role: application.appliedRole,
        },
      });
      return application.id;
    });
    return this.getCandidate(candidateUserId, result);
  }

  async markOwnerViewed(
    ownerUserId: string,
    applicationId: string,
    occurredAt = new Date(),
  ) {
    const application = await prisma.teamApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, companyId: true, status: true, version: true },
    });
    if (!application) {
      throw new TeamApplicationCommandError("TEAM_APPLICATION_UNAVAILABLE");
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (application.status === "SUBMITTED") {
        const changed = await tx.teamApplication.updateMany({
          where: {
            id: application.id,
            companyId: application.companyId,
            status: "SUBMITTED",
            version: application.version,
          },
          data: {
            status: "VIEWED",
            ownerFirstViewedAt: occurredAt,
            version: { increment: 1 },
          },
        });
        if (changed.count === 1) {
          await writeAudit(tx, {
            action: "team_application.owner_viewed",
            actorUserId: ownerUserId,
            targetId: application.id,
            occurredAt,
            context: { companyId: application.companyId, firstView: true },
          });
        }
      } else {
        await writeAudit(tx, {
          action: "team_application.cv_accessed",
          actorUserId: ownerUserId,
          targetId: application.id,
          occurredAt,
          context: { companyId: application.companyId, firstView: false },
        });
      }
      return true;
    });
    return updated;
  }
}

export { supportedRoles };
