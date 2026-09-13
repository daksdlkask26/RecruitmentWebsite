import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import { PrismaTeamApplicationRepository } from "@/backend/repositories/company-members/prisma-team-application-repository";
import { PrismaOutboxRepository } from "@/backend/repositories/email/outbox-repository";
import { createInAppNotification } from "@/backend/notifications/notification-service";
import { TokenProtector } from "@/backend/security/security-token/security-tokens";
import {
  ownerTeamApplicationListSchema,
  ownerTeamApplicationSchema,
  teamApplicationAcceptSchema,
  teamApplicationRejectSchema,
  teamApplicationListQuerySchema,
  type TeamRole,
} from "@/shared/contracts/company-members/team-applications";
import {
  decodeApplicationListCursor,
  encodeApplicationListCursor,
} from "@/backend/applications/application-list-cursor";
import { requireActiveCompanyOwner } from "@/backend/company-members/company-team-authorization";
import { requireTeamApplicationOwner } from "./team-application-authorization";
import {
  TeamApplicationCommandError,
  TeamApplicationService,
} from "./team-application-service";
import { teamApplicationCvDeleteAfter } from "./team-application-retention-policy";

const tokenProtector = new TokenProtector();
const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class TeamApplicationOwnerError extends Error {
  constructor(
    readonly code:
      | "TEAM_OWNER_FORBIDDEN"
      | "TEAM_APPLICATION_UNAVAILABLE"
      | "TEAM_APPLICATION_CONFLICT"
      | "TEAM_MEMBER_EXISTS"
      | "TEAM_ROLE_INVALID"
      | "TEAM_APPLICATION_LIST_REQUEST_INVALID"
      | "TEAM_APPLICATION_CURSOR_INVALID",
  ) {
    super(code);
  }
}

function mapError(error: unknown): never {
  if (error instanceof TeamApplicationOwnerError) throw error;
  if (error instanceof TeamApplicationCommandError) {
    if (error.code === "TEAM_MEMBER_EXISTS")
      throw new TeamApplicationOwnerError("TEAM_MEMBER_EXISTS");
    if (
      error.code === "TEAM_APPLICATION_UNAVAILABLE" ||
      error.code === "TEAM_APPLICATION_CONFLICT"
    ) {
      throw new TeamApplicationOwnerError(error.code);
    }
  }
  throw error;
}

function ownerProjection(
  row: {
    id: string;
    companyId: string;
    appliedRole: string;
    status: string;
    applicationEmail: string;
    submittedAt: Date;
    ownerFirstViewedAt: Date | null;
    decidedAt: Date | null;
    joinedAt: Date | null;
    company: { displayName: string; slug: string };
    invitation: { id: string; state: string; expiresAt: Date } | null;
    candidate: { user: { name: string } };
    cvFileName: string;
    cvMimeType: string;
    cvByteSize: number;
    rejectionReason: string | null;
  },
  invitationEmailStatus: string | null = null,
) {
  return ownerTeamApplicationSchema.parse({
    applicationId: row.id,
    companyId: row.companyId,
    companyName: row.company.displayName,
    companySlug: row.company.slug,
    appliedRole: row.appliedRole,
    status: row.status,
    invitationStatus: row.invitation?.state ?? null,
    invitationId: row.invitation?.id ?? null,
    submittedAt: row.submittedAt.toISOString(),
    ownerViewed: Boolean(row.ownerFirstViewedAt),
    ownerFirstViewedAt: row.ownerFirstViewedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    invitationExpiresAt: row.invitation?.expiresAt.toISOString() ?? null,
    candidateName: row.candidate.user.name,
    applicationEmail: row.applicationEmail,
    cvFileName: row.cvFileName,
    cvMimeType: row.cvMimeType,
    cvByteSize: row.cvByteSize,
    rejectionReason: row.rejectionReason,
    invitationEmailStatus,
  });
}

async function invitationEmailStatuses(
  rows: ReadonlyArray<{ invitation: { id: string } | null }>,
) {
  const keys = rows.flatMap((row) =>
    row.invitation ? [`company-invitation-email:${row.invitation.id}`] : [],
  );
  if (!keys.length) return new Map<string, string>();
  const outbox = await prisma.emailOutbox.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { idempotencyKey: true, status: true },
  });
  return new Map(outbox.map((row) => [row.idempotencyKey, row.status]));
}

async function ownerCompany(userId: string, companyId?: string) {
  try {
    return await requireActiveCompanyOwner(userId, companyId);
  } catch {
    throw new TeamApplicationOwnerError("TEAM_OWNER_FORBIDDEN");
  }
}

export class TeamApplicationOwnerService {
  constructor(
    private readonly repository = new PrismaTeamApplicationRepository(),
    private readonly applications = new TeamApplicationService(),
  ) {}

  async listEligibleCompanies(ownerUserId: string) {
    const memberships = await prisma.companyMembership.findMany({
      where: {
        userId: ownerUserId,
        role: "OWNER",
        status: "ACTIVE",
        removedAt: null,
        company: {
          verificationState: "ACTIVE",
          verificationInactiveAt: null,
          moderationState: "ACTIVE",
        },
      },
      select: { companyId: true, company: { select: { displayName: true } } },
    });
    return memberships
      .map((membership) => ({
        id: membership.companyId,
        name: membership.company.displayName,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async list(ownerUserId: string, companyId?: string, rawInput: unknown = {}) {
    const parsed = teamApplicationListQuerySchema.safeParse(rawInput);
    if (!parsed.success)
      throw new TeamApplicationOwnerError(
        "TEAM_APPLICATION_LIST_REQUEST_INVALID",
      );
    const query = parsed.data;
    const owner = await ownerCompany(ownerUserId, companyId);
    const filter = `${query.status ?? "ALL"}:${query.role ?? "ALL"}`;
    const cursor = query.cursor
      ? decodeApplicationListCursor(query.cursor, {
          list: "OWNER_TEAM_APPLICATIONS",
          subjectId: ownerUserId,
          scopeId: owner.companyId,
          filter,
          sort: query.sort,
        })
      : null;
    if (query.cursor && !cursor)
      throw new TeamApplicationOwnerError("TEAM_APPLICATION_CURSOR_INVALID");
    const now = new Date();
    await prisma.companyInvitation.updateMany({
      where: {
        companyId: owner.companyId,
        state: "PENDING",
        expiresAt: { lte: now },
        teamApplication: { is: { status: "INVITATION_SENT" } },
      },
      data: { state: "EXPIRED", version: { increment: 1 } },
    });
    await prisma.teamApplication.updateMany({
      where: {
        companyId: owner.companyId,
        status: "INVITATION_SENT",
        cvDeleteAfter: null,
        invitation: {
          is: { state: { in: ["REVOKED", "DECLINED", "EXPIRED"] } },
        },
      },
      data: { cvDeleteAfter: teamApplicationCvDeleteAfter(now) },
    });
    const page = await this.repository.listForOwner({
      ...query,
      companyId: owner.companyId,
      cursor: cursor
        ? { submittedAt: new Date(cursor.submittedAt), id: cursor.id }
        : null,
    });
    // This metric is scoped to the authorized company and active list filters.
    // It is an authoritative actionable-queue count rather than a loaded-page
    // count. A terminal status filter therefore truthfully reports zero.
    const pendingCount = await this.repository.countActionableForOwner(
      owner.companyId,
      query.role,
      query.status,
    );
    const hasMore = page.rows.length > query.limit;
    const visible = hasMore ? page.rows.slice(0, query.limit) : page.rows;
    const statuses = await invitationEmailStatuses(visible);
    const last = visible.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeApplicationListCursor({
            list: "OWNER_TEAM_APPLICATIONS",
            subjectId: ownerUserId,
            scopeId: owner.companyId,
            filter,
            sort: query.sort,
            submittedAt: last.submittedAt.toISOString(),
            id: last.id,
          })
        : null;
    return ownerTeamApplicationListSchema.parse({
      items: visible.map((row) =>
        ownerProjection(
          row,
          row.invitation
            ? (statuses.get(`company-invitation-email:${row.invitation.id}`) ??
                null)
            : null,
        ),
      ),
      nextCursor,
      hasMore,
      total: page.total,
      pendingCount,
      filter: { status: query.status ?? null, role: query.role ?? null },
      sort: query.sort,
    });
  }

  async get(ownerUserId: string, applicationId: string, companyId?: string) {
    let authorization;
    try {
      authorization = await requireTeamApplicationOwner(
        ownerUserId,
        applicationId,
        companyId,
      );
    } catch {
      throw new TeamApplicationOwnerError("TEAM_OWNER_FORBIDDEN");
    }
    try {
      await this.applications.markOwnerViewed(
        ownerUserId,
        applicationId,
        authorization.owner.companyId,
      );
      const row = await this.repository.findForOwner(
        authorization.owner.companyId,
        applicationId,
      );
      if (!row)
        throw new TeamApplicationOwnerError("TEAM_APPLICATION_UNAVAILABLE");
      const statuses = await invitationEmailStatuses([row]);
      return ownerProjection(
        row,
        row.invitation
          ? (statuses.get(`company-invitation-email:${row.invitation.id}`) ??
              null)
          : null,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async accept(
    ownerUserId: string,
    applicationId: string,
    rawRole: unknown,
    companyId?: string,
  ) {
    const parsed = teamApplicationAcceptSchema.safeParse({ role: rawRole });
    if (!parsed.success)
      throw new TeamApplicationOwnerError("TEAM_ROLE_INVALID");
    let authorization;
    try {
      authorization = await requireTeamApplicationOwner(
        ownerUserId,
        applicationId,
        companyId,
      );
    } catch {
      throw new TeamApplicationOwnerError("TEAM_OWNER_FORBIDDEN");
    }
    const role: TeamRole = parsed.data.role;
    const now = new Date();
    try {
      return await prisma.$transaction(async (tx) => {
        const application = await tx.teamApplication.findFirst({
          where: {
            id: applicationId,
            companyId: authorization.owner.companyId,
            appliedRole: { in: ["HR_MANAGER", "RECRUITER"] },
          },
          include: {
            company: { select: { displayName: true } },
            invitation: true,
          },
        });
        if (!application)
          throw new TeamApplicationOwnerError("TEAM_APPLICATION_UNAVAILABLE");

        if (
          (application.status === "INVITATION_SENT" ||
            application.status === "JOINED") &&
          application.invitation
        ) {
          if (application.invitation.state === "PENDING") {
            await this.retryInvitationEmail(tx, application.invitation.id, now);
          }
          return {
            applicationId: application.id,
            invitationId: application.invitation.id,
            role: application.invitation.role,
            status: application.status,
            idempotent: true,
          };
        }

        if (
          application.status !== "SUBMITTED" &&
          application.status !== "VIEWED"
        ) {
          throw new TeamApplicationOwnerError("TEAM_APPLICATION_CONFLICT");
        }
        const member = await tx.companyMembership.findUnique({
          where: {
            companyId_userId: {
              companyId: application.companyId,
              userId: application.candidateUserId,
            },
          },
          select: { status: true },
        });
        if (member && member.status !== "REMOVED") {
          throw new TeamApplicationOwnerError("TEAM_MEMBER_EXISTS");
        }

        const token = randomBytes(32).toString("base64url");
        const invitation = application.invitation
          ? await tx.companyInvitation.update({
              where: { id: application.invitation.id },
              data: {
                normalizedEmail: application.applicationEmail,
                role,
                state: "PENDING",
                tokenDigest: digest(token),
                invitedByUserId: ownerUserId,
                acceptedByUserId: null,
                acceptedAt: null,
                declinedByUserId: null,
                declinedAt: null,
                revokedAt: null,
                expiresAt: new Date(now.getTime() + invitationLifetimeMs),
                version: { increment: 1 },
              },
            })
          : await tx.companyInvitation.create({
              data: {
                companyId: application.companyId,
                normalizedEmail: application.applicationEmail,
                role,
                tokenDigest: digest(token),
                invitedByUserId: ownerUserId,
                teamApplicationId: application.id,
                expiresAt: new Date(now.getTime() + invitationLifetimeMs),
              },
            });

        const changed = await tx.teamApplication.updateMany({
          where: {
            id: application.id,
            version: application.version,
            status: { in: ["SUBMITTED", "VIEWED"] },
          },
          data: {
            status: "INVITATION_SENT",
            decidedAt: now,
            decidedByUserId: ownerUserId,
            cvDeleteAfter: teamApplicationCvDeleteAfter(now),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new TeamApplicationOwnerError("TEAM_APPLICATION_CONFLICT");

        await new PrismaOutboxRepository(tx).enqueueIdempotent({
          kind: "COMPANY_INVITATION",
          userId: application.candidateUserId,
          recipientRef: application.candidateUserId,
          templateVersion: "company-invitation.v1",
          payloadRef: {
            companyName: application.company.displayName,
            role,
            protectedToken: tokenProtector.seal(token),
          },
          idempotencyKey: `company-invitation-email:${invitation.id}`,
        });
        await createInAppNotification(tx, {
          recipientUserId: application.candidateUserId,
          kind: "COMPANY_INVITATION_RECEIVED",
          deduplicationKey: `company-invitation-notification:${invitation.id}:${application.candidateUserId}`,
          correlationId: invitation.id,
          occurredAt: now,
          contextType: "COMPANY_INVITATION",
          contextId: invitation.id,
          variables: { companyName: application.company.displayName },
        });
        await tx.companyTeamActivity.create({
          data: {
            companyId: application.companyId,
            kind: "INVITED",
            actorUserId: ownerUserId,
            targetEmail: application.applicationEmail,
            role,
            occurredAt: now,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorType: "user",
            actorUserId: ownerUserId,
            action: "team_application.accepted",
            targetType: "team_application",
            targetId: application.id,
            result: "SUCCESS",
            correlationId: invitation.id,
            occurredAt: now,
            context: {
              companyId: application.companyId,
              role,
              invitationId: invitation.id,
            },
          },
        });
        return {
          applicationId: application.id,
          invitationId: invitation.id,
          role,
          status: "INVITATION_SENT" as const,
          idempotent: false,
        };
      });
    } catch (error) {
      return mapError(error);
    }
  }

  async reject(
    ownerUserId: string,
    applicationId: string,
    rawReason: unknown,
    companyId?: string,
  ) {
    const parsed = teamApplicationRejectSchema.safeParse({
      reason: rawReason,
    });
    if (!parsed.success)
      throw new TeamApplicationOwnerError("TEAM_APPLICATION_CONFLICT");
    let authorization;
    try {
      authorization = await requireTeamApplicationOwner(
        ownerUserId,
        applicationId,
        companyId,
      );
    } catch {
      throw new TeamApplicationOwnerError("TEAM_OWNER_FORBIDDEN");
    }
    const reason = parsed.data.reason?.trim() || null;
    const now = new Date();
    try {
      return await prisma.$transaction(async (tx) => {
        const application = await tx.teamApplication.findFirst({
          where: {
            id: applicationId,
            companyId: authorization.owner.companyId,
            appliedRole: { in: ["HR_MANAGER", "RECRUITER"] },
          },
          include: { company: { select: { displayName: true } } },
        });
        if (!application)
          throw new TeamApplicationOwnerError("TEAM_APPLICATION_UNAVAILABLE");
        if (application.status === "REJECTED") {
          return {
            applicationId,
            status: "REJECTED" as const,
            idempotent: true,
          };
        }
        if (
          application.status !== "SUBMITTED" &&
          application.status !== "VIEWED"
        ) {
          throw new TeamApplicationOwnerError("TEAM_APPLICATION_CONFLICT");
        }
        const changed = await tx.teamApplication.updateMany({
          where: {
            id: application.id,
            version: application.version,
            status: { in: ["SUBMITTED", "VIEWED"] },
          },
          data: {
            status: "REJECTED",
            rejectionReason: reason,
            decidedAt: now,
            decidedByUserId: ownerUserId,
            activeKey: null,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new TeamApplicationOwnerError("TEAM_APPLICATION_CONFLICT");
        await new PrismaOutboxRepository(tx).enqueueIdempotent({
          kind: "TEAM_APPLICATION_REJECTED",
          userId: application.candidateUserId,
          recipientRef: application.candidateUserId,
          templateVersion: "team-application-rejected.v1",
          payloadRef: {
            companyName: application.company.displayName,
            role: application.appliedRole,
            ...(reason ? { reason } : {}),
          },
          idempotencyKey: `team-application-rejected-email:${application.id}`,
        });
        await tx.auditEvent.create({
          data: {
            actorType: "user",
            actorUserId: ownerUserId,
            action: "team_application.rejected",
            targetType: "team_application",
            targetId: application.id,
            result: "SUCCESS",
            correlationId: application.id,
            occurredAt: now,
            context: {
              companyId: application.companyId,
              role: application.appliedRole,
              reasonProvided: Boolean(reason),
            },
          },
        });
        return {
          applicationId,
          status: "REJECTED" as const,
          idempotent: false,
        };
      });
    } catch (error) {
      return mapError(error);
    }
  }

  private async retryInvitationEmail(
    tx: Prisma.TransactionClient,
    invitationId: string,
    now: Date,
  ) {
    const key = `company-invitation-email:${invitationId}`;
    const outbox = await tx.emailOutbox.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, status: true },
    });
    if (outbox && (outbox.status === "DEAD" || outbox.status === "RETRYABLE")) {
      await tx.emailOutbox.update({
        where: { id: outbox.id },
        data: {
          status: "PENDING",
          nextAttemptAt: now,
          safeErrorCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    }
  }
}

export { ownerProjection };
