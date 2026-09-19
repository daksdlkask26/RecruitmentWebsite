import "server-only";
import type { AdminAuthority } from "@/backend/security/admin-request-boundary";
import { AuditWriter } from "@/backend/admin/audit/audit-writer";
import { PrivilegedRationaleService } from "@/backend/admin/rationales/privileged-rationale-service";
import { PrismaSecurityNotificationRepository } from "@/backend/repositories/admin/prisma-security-notification-repository";
import { createInAppNotification } from "@/backend/notifications/notification-service";
import {
  companyBusinessEventKey,
  securityNotificationIdempotencyKey,
} from "@/backend/admin/notifications/notification-events";
import { invalidatePublicCompanySafety } from "@/backend/services/discovery/public-discovery-cache";
import {
  AdminCommandConflict,
  PrismaAdminCommandRepository,
} from "@/backend/repositories/admin/prisma-admin-command-repository";
import {
  normalizeAdminPlainText,
  privilegedReasonCategorySchema,
} from "@/shared/contracts/admin/common";

type Command = {
  expectedVersion: number;
  idempotencyKey: string;
  reasonCategory: string;
  explanation: string;
};

function normalize(command: Command) {
  const reasonCategory = privilegedReasonCategorySchema.parse(
    command.reasonCategory,
  );
  const explanation = normalizeAdminPlainText(command.explanation);
  if (
    Array.from(explanation).length < 10 ||
    Array.from(explanation).length > 500
  )
    throw new Error("RATIONALE_LENGTH_INVALID");
  return { ...command, reasonCategory, explanation };
}

export class CompanyModerationService {
  private async run(
    authority: AdminAuthority,
    companyId: string,
    action: "ban" | "unban",
    command: Command,
  ) {
    const normalized = normalize(command);
    const now = new Date();
    const result = await new PrismaAdminCommandRepository().execute(
      {
        actorUserId: authority.userId,
        actorSessionId: authority.sessionId,
        grantId: authority.grantId,
        commandKind: `company.${action}`,
        targetReference: companyId,
        idempotencyKey: normalized.idempotencyKey,
        normalizedBody: normalized,
      },
      async (tx, correlationId) => {
        const company = await tx.company.findUnique({
          where: { id: companyId },
        });
        if (!company) throw new Error("TARGET_UNAVAILABLE");
        if (company.moderationVersion !== normalized.expectedVersion)
          throw new AdminCommandConflict(
            "STALE_CONFLICT",
            company.moderationVersion,
          );
        if (action === "ban" && company.moderationState !== "ACTIVE")
          throw new Error("INVALID_STATE");
        if (action === "unban" && company.moderationState !== "BANNED")
          throw new Error("INVALID_STATE");

        const resultingState = action === "ban" ? "BANNED" : "ACTIVE";
        const verificationState =
          action === "ban"
            ? "INACTIVE"
            : (company.verificationStateBeforeBan ?? company.verificationState);
        const verifiedAt =
          action === "ban" ? company.verifiedAt : company.verifiedAtBeforeBan;
        const nextVersion = company.moderationVersion + 1;
        const claimed = await tx.company.updateMany({
          where: {
            id: companyId,
            moderationVersion: normalized.expectedVersion,
            moderationState: company.moderationState,
          },
          data:
            action === "ban"
              ? {
                  moderationState: "BANNED",
                  moderationVersion: nextVersion,
                  bannedAt: now,
                  verificationState: "INACTIVE",
                  verificationInactiveAt: now,
                  verificationStateBeforeBan: company.verificationState,
                  verifiedAtBeforeBan: company.verifiedAt,
                }
              : {
                  moderationState: "ACTIVE",
                  moderationVersion: nextVersion,
                  bannedAt: null,
                  verificationState,
                  verificationInactiveAt: null,
                  verifiedAt,
                  verificationStateBeforeBan: null,
                  verifiedAtBeforeBan: null,
                },
        });
        if (claimed.count !== 1)
          throw new AdminCommandConflict("STALE_CONFLICT", nextVersion);
        await new AuditWriter(tx).append({
          occurredAt: now,
          actorType: "user",
          actorUserId: authority.userId,
          actorSessionId: authority.sessionId,
          action:
            action === "ban"
              ? "admin.company_banned"
              : "admin.company_unbanned",
          targetType: "company",
          targetId: companyId,
          result: "SUCCESS",
          correlationId,
          context: {
            reasonCategory: normalized.reasonCategory,
            priorState: company.moderationState,
            resultingState,
            targetVersion: nextVersion,
            companyReference: companyId,
          },
        });
        await new PrivilegedRationaleService().create(tx, {
          correlationId,
          explanation: normalized.explanation,
          actionAt: now,
        });
        const recipients = await tx.companyMembership.findMany({
          where: { companyId, status: "ACTIVE", user: { state: "ACTIVE" } },
          select: { id: true, userId: true },
        });
        const eventKind =
          action === "ban" ? "COMPANY_BANNED" : "COMPANY_UNBANNED";
        await Promise.all(
          recipients.map(async (recipient) => {
            const businessEventKey = `${companyBusinessEventKey(companyId, eventKind, nextVersion)}:membership:${recipient.id}`;
            const idempotencyKey =
              securityNotificationIdempotencyKey(businessEventKey);
            await new PrismaSecurityNotificationRepository(tx).enqueue({
              idempotencyKey,
              originatingCorrelationId: correlationId,
              targetUserId: recipient.userId,
              kind: eventKind,
              payloadRef: {
                companyDisplayName: company.displayName,
                occurredAt: now.toISOString(),
              },
              status: "PENDING",
              attemptCount: 0,
              nextAttemptAt: now,
              deliveryDeadline: new Date(now.getTime() + 24 * 60 * 60_000),
            });
            await createInAppNotification(tx, {
              recipientUserId: recipient.userId,
              kind: eventKind,
              deduplicationKey: idempotencyKey,
              correlationId,
              occurredAt: now,
              contextType: "MEMBERSHIP",
              contextId: recipient.id,
              variables: {
                companyName: company.displayName,
                recipientRole: "RECRUITER",
              },
            });
          }),
        );
        return { companyId, state: resultingState, version: nextVersion };
      },
    );
    invalidatePublicCompanySafety(companyId);
    return result;
  }

  ban(authority: AdminAuthority, companyId: string, command: Command) {
    return this.run(authority, companyId, "ban", command);
  }

  unban(authority: AdminAuthority, companyId: string, command: Command) {
    return this.run(authority, companyId, "unban", command);
  }
}
