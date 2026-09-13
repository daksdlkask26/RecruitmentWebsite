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
  candidateTeamApplicationListSchema,
  candidateTeamApplicationSchema,
  teamApplicationListQuerySchema,
  type TeamRole,
} from "@/shared/contracts/company-members/team-applications";
import {
  decodeApplicationListCursor,
  encodeApplicationListCursor,
} from "@/backend/applications/application-list-cursor";
import type { PreparedDirectApplicationDocument } from "@/backend/services/jobs/prepare-direct-application-document";
import { teamApplicationCvDeleteAfter } from "./team-application-retention-policy";
import { requireActiveCompanyOwner } from "@/backend/company-members/company-team-authorization";
import {
  CvSafetyEvidenceError,
  CvSafetyEvidenceService,
} from "@/backend/services/cv-admission/cv-safety-evidence-service";

const supportedRoles = ["HR_MANAGER", "RECRUITER"] as const;

export class TeamApplicationCommandError extends Error {
  constructor(
    readonly code:
      | "TEAM_COMPANY_UNAVAILABLE"
      | "TEAM_OPPORTUNITY_CLOSED"
      | "TEAM_MEMBER_EXISTS"
      | "TEAM_APPLICATION_DUPLICATE"
      | "TEAM_APPLICATION_UNAVAILABLE"
      | "TEAM_APPLICATION_CONFLICT"
      | "TEAM_APPLICATION_LIST_REQUEST_INVALID"
      | "TEAM_APPLICATION_CURSOR_INVALID",
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
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

  async listCandidate(userId: string, rawInput: unknown = {}) {
    const parsed = teamApplicationListQuerySchema.safeParse(rawInput);
    if (!parsed.success)
      throw new TeamApplicationCommandError(
        "TEAM_APPLICATION_LIST_REQUEST_INVALID",
      );
    const query = parsed.data;
    const cursor = query.cursor
      ? decodeApplicationListCursor(query.cursor, {
          list: "CANDIDATE_TEAM_APPLICATIONS",
          subjectId: userId,
          scopeId: null,
          filter: `${query.status ?? "ALL"}:${query.role ?? "ALL"}`,
          sort: query.sort,
        })
      : null;
    if (query.cursor && !cursor)
      throw new TeamApplicationCommandError("TEAM_APPLICATION_CURSOR_INVALID");
    await this.synchronizeExpiredInvitations(userId);
    const page = await this.repository.listForCandidate({
      ...query,
      userId,
      cursor: cursor
        ? { submittedAt: new Date(cursor.submittedAt), id: cursor.id }
        : null,
    });
    const hasMore = page.rows.length > query.limit;
    const visible = hasMore ? page.rows.slice(0, query.limit) : page.rows;
    const last = visible.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeApplicationListCursor({
            list: "CANDIDATE_TEAM_APPLICATIONS",
            subjectId: userId,
            scopeId: null,
            filter: `${query.status ?? "ALL"}:${query.role ?? "ALL"}`,
            sort: query.sort,
            submittedAt: last.submittedAt.toISOString(),
            id: last.id,
          })
        : null;
    return candidateTeamApplicationListSchema.parse({
      items: visible.map(projectCandidateTeamApplication),
      nextCursor,
      hasMore,
      total: page.total,
      filter: { status: query.status ?? null, role: query.role ?? null },
      sort: query.sort,
    });
  }

  async getCandidate(userId: string, applicationId: string) {
    await this.synchronizeExpiredInvitations(userId);
    const row = await this.repository.findForCandidate(userId, applicationId);
    if (!row)
      throw new TeamApplicationCommandError("TEAM_APPLICATION_UNAVAILABLE");
    return projectCandidateTeamApplication(row);
  }

  async submitWithUploadId(
    candidateUserId: string,
    companyId: string,
    role: TeamRole,
    uploadId: string,
    occurredAt = new Date(),
  ) {
    const account = await prisma.userAccount.findUnique({
      where: { id: candidateUserId },
      select: {
        email: true,
        state: true,
        candidateIdentity: { select: { userId: true } },
      },
    });
    if (!account || account.state !== "ACTIVE" || !account.candidateIdentity) {
      throw new TeamApplicationCommandError("TEAM_APPLICATION_UNAVAILABLE");
    }

    const key = activeKey(candidateUserId, companyId, role);
    const existing = await prisma.teamApplication.findFirst({
      where: { activeKey: key },
      select: { id: true },
    });
    if (existing) {
      const status = await this.getCandidate(candidateUserId, existing.id);
      return { created: false as const, application: status };
    }

    let evidence;
    try {
      evidence = await new CvSafetyEvidenceService().assertCvArtifactSafeForUse(
        {
          candidateUserId,
          uploadId,
          expectedPurpose: "TEAM_APPLICATION_DIRECT",
          now: occurredAt,
        },
      );
    } catch (error) {
      if (error instanceof CvSafetyEvidenceError) {
        throw new TeamApplicationCommandError("TEAM_APPLICATION_UNAVAILABLE");
      }
      throw error;
    }

    const applicationId = randomUUID();
    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
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

        const sourceArtifactInUse = await tx.teamApplication.findFirst({
          where: {
            cvSourceArtifactId: evidence.artifactId,
            cvDeletedAt: null,
          },
          select: { id: true },
        });
        if (sourceArtifactInUse) {
          throw new TeamApplicationCommandError("TEAM_APPLICATION_CONFLICT");
        }

        const application = await tx.teamApplication.create({
          data: {
            id: applicationId,
            candidateUserId,
            companyId,
            teamOpportunityId: opportunity.id,
            appliedRole: role,
            applicationEmail: account.email.trim().toLowerCase(),
            cvDisplayName: evidence.fileName,
            cvFileName: evidence.fileName,
            cvMimeType: evidence.mimeType,
            cvByteSize: evidence.plaintextBytes,
            cvStorageKey: evidence.storageLocator,
            cvChecksumSha256: evidence.checksumSha256,
            cvSourceArtifactId: evidence.artifactId,
            cvScanAssessmentId: evidence.assessmentId,
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
            cvMimeType: evidence.mimeType,
            cvByteSize: evidence.plaintextBytes,
            cvSourceArtifactId: evidence.artifactId,
            cvScanAssessmentId: evidence.assessmentId,
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
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Two finalize requests can pass the read-before-transaction check at
        // the same time. Converge the loser on the committed row so the
        // client does not create a second retry path or duplicate notices.
        const raced = await prisma.teamApplication.findFirst({
          where: { activeKey: key },
          select: { id: true },
        });
        if (raced) {
          const existingApplication = await this.getCandidate(
            candidateUserId,
            raced.id,
          );
          return { created: false as const, application: existingApplication };
        }
        throw new TeamApplicationCommandError("TEAM_APPLICATION_CONFLICT");
      }
      throw error;
    }

    const result = await this.getCandidate(candidateUserId, createdId);
    return { created: true as const, application: result };
  }

  /**
   * Compatibility entry point retained for callers that used submit().
   * Only an upload admitted by the unified quarantine/scan pipeline is
   * accepted. Legacy prepared plaintext objects are rejected and cleaned.
   */
  async submit(
    candidateUserId: string,
    companyId: string,
    role: TeamRole,
    admission: { uploadId: string } | PreparedDirectApplicationDocument,
    occurredAt = new Date(),
  ) {
    if (!("uploadId" in admission) || !admission.uploadId) {
      await (admission as PreparedDirectApplicationDocument).cleanup?.();
      throw new TeamApplicationCommandError("TEAM_APPLICATION_UNAVAILABLE");
    }
    return this.submitWithUploadId(
      candidateUserId,
      companyId,
      role,
      admission.uploadId,
      occurredAt,
    );
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
    companyId?: string,
    occurredAt = new Date(),
  ) {
    let owner;
    try {
      owner = await requireActiveCompanyOwner(ownerUserId, companyId);
    } catch {
      throw new TeamApplicationCommandError("TEAM_APPLICATION_UNAVAILABLE");
    }
    const application = await prisma.teamApplication.findFirst({
      where: { id: applicationId, companyId: owner.companyId },
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
