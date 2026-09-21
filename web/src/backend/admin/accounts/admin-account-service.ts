import "server-only";
import { Prisma } from "@/backend/generated/prisma/client";
import type { AdminAuthority } from "@/backend/security/admin-request-boundary";
import { AuditWriter } from "@/backend/admin/audit/audit-writer";
import {
  PrismaAdminCommandRepository,
  AdminCommandConflict,
  AdminCommandDenied,
} from "@/backend/repositories/admin/prisma-admin-command-repository";
import { PrismaAdminAccountRepository } from "@/backend/repositories/admin/prisma-admin-account-repository";
import { enforceMessagingUserRevocation } from "@/backend/messaging/realtime/messaging-authority-enforcement";
import { recordAccountCommand } from "./admin-account-command-transaction";
import {
  normalizeAdminPlainText,
  privilegedReasonCategorySchema,
} from "@/shared/contracts/admin/common";

type Command = {
  expectedVersion: number;
  idempotencyKey: string;
  reasonCategory?: string;
  explanation?: string;
  category?: string;
  reason?: string;
};

function normalizeCommand(command: Command) {
  const reasonCategory = privilegedReasonCategorySchema.parse(
    command.reasonCategory ?? command.category,
  );
  const explanation = normalizeAdminPlainText(
    command.explanation ?? command.reason ?? "",
  );
  if (
    Array.from(explanation).length < 10 ||
    Array.from(explanation).length > 500
  )
    throw new Error("RATIONALE_LENGTH_INVALID");
  return { ...command, reasonCategory, explanation };
}
export class AdminAccountService {
  security(accountId: string) {
    return new PrismaAdminAccountRepository().security(accountId);
  }
  private async run(
    authority: AdminAuthority,
    targetUserId: string,
    kind: "suspend" | "restore" | "reinstate" | "revoke-all" | "revoke-one",
    command: Command,
    sessionReference?: string,
  ) {
    if (
      authority.userId === targetUserId &&
      kind !== "suspend" &&
      kind !== "restore" &&
      kind !== "reinstate"
    )
      throw new Error("PROTECTED_ADMIN_ACTION");
    const normalizedCommand = normalizeCommand(command);
    const now = new Date();
    let revokedSessionId: string | undefined;
    const outcome = await new PrismaAdminCommandRepository().execute(
      {
        actorUserId: authority.userId,
        actorSessionId: authority.sessionId,
        grantId: authority.grantId,
        commandKind: `account.${kind}`,
        targetReference: sessionReference
          ? `${targetUserId}:${sessionReference}`
          : targetUserId,
        idempotencyKey: command.idempotencyKey,
        normalizedBody: normalizedCommand,
      },
      async (tx, correlationId) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('feature006:usable-administrators'))`;
        if (kind === "suspend" || kind === "restore" || kind === "reinstate") {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${targetUserId} FOR UPDATE`,
          );
        }
        const account = await tx.userAccount.findUnique({
          where: { id: targetUserId },
          include: {
            platformAdministratorGrants: {
              where: {
                state: "ACTIVE",
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
            },
          },
        });
        if (!account) throw new Error("TARGET_UNAVAILABLE");
        if (
          (kind === "suspend" || kind === "restore" || kind === "reinstate") &&
          account.platformAdministratorGrants.length > 0
        ) {
          await new AuditWriter(tx).append({
            occurredAt: now,
            actorType: "user",
            actorUserId: authority.userId,
            actorSessionId: authority.sessionId,
            action:
              kind === "suspend"
                ? "admin.account_suspended"
                : "admin.account_restored",
            targetType: "user_account",
            targetId: targetUserId,
            result: "DENIED",
            correlationId,
            context: {
              reasonCategory: normalizedCommand.reasonCategory,
              priorState: account.state,
              resultingState: account.state,
            },
          });
          throw new AdminCommandDenied({
            accountId: targetUserId,
            status: "ACTION_BLOCKED",
            version: account.version,
          });
        }
        if (account.version !== command.expectedVersion)
          throw new AdminCommandConflict("STALE_CONFLICT", account.version);
        if (
          account.platformAdministratorGrants.length > 0 &&
          kind === "revoke-all"
        ) {
          const alternatives = await tx.platformAdministratorGrant.count({
            where: {
              userId: { not: targetUserId },
              state: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              user: { state: "ACTIVE" },
            },
          });
          if (alternatives === 0) throw new Error("LAST_USABLE_ADMIN");
        }
        let action:
          | "admin.account_suspended"
          | "admin.account_reinstated"
          | "admin.account_restored"
          | "admin.session_revoked"
          | "admin.sessions_revoked_all";
        const priorState = account.state;
        let resultingState = account.state;
        let notify = false;
        if (kind === "suspend") {
          if (account.state !== "ACTIVE") throw new Error("INVALID_STATE");
          const claimed = await tx.userAccount.updateMany({
            where: {
              id: targetUserId,
              version: command.expectedVersion,
              state: "ACTIVE",
            },
            data: {
              state: "SUSPENDED",
              stateChangedAt: now,
              version: { increment: 1 },
            },
          });
          if (claimed.count !== 1)
            throw new AdminCommandConflict(
              "STALE_CONFLICT",
              command.expectedVersion + 1,
            );
          await Promise.all([
            tx.session.updateMany({
              where: { userId: targetUserId, revokedAt: null },
              data: {
                revokedAt: now,
                revocationReason: "administrator_account_suspension",
              },
            }),
            tx.authenticationChallenge.updateMany({
              where: { userId: targetUserId, consumedAt: null },
              data: { consumedAt: now },
            }),
          ]);
          action = "admin.account_suspended";
          resultingState = "SUSPENDED";
          notify = true;
        } else if (kind === "restore" || kind === "reinstate") {
          if (account.state !== "SUSPENDED") throw new Error("INVALID_STATE");
          const claimed = await tx.userAccount.updateMany({
            where: {
              id: targetUserId,
              version: command.expectedVersion,
              state: "SUSPENDED",
            },
            data: {
              state: "ACTIVE",
              stateChangedAt: now,
              version: { increment: 1 },
            },
          });
          if (claimed.count !== 1)
            throw new AdminCommandConflict(
              "STALE_CONFLICT",
              command.expectedVersion + 1,
            );
          action =
            kind === "restore"
              ? "admin.account_restored"
              : "admin.account_reinstated";
          resultingState = "ACTIVE";
          notify = true;
        } else if (kind === "revoke-all") {
          const claimed = await tx.userAccount.updateMany({
            where: { id: targetUserId, version: command.expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (claimed.count !== 1)
            throw new AdminCommandConflict(
              "STALE_CONFLICT",
              command.expectedVersion + 1,
            );
          await tx.session.updateMany({
            where: { userId: targetUserId, revokedAt: null },
            data: {
              revokedAt: now,
              revocationReason: "administrator_revoked_all",
            },
          });
          await tx.authenticationChallenge.updateMany({
            where: { userId: targetUserId, consumedAt: null },
            data: { consumedAt: now },
          });
          action = "admin.sessions_revoked_all";
          notify = true;
        } else {
          if (!sessionReference) throw new Error("TARGET_UNAVAILABLE");
          const sessionId = await new PrismaAdminAccountRepository(
            tx,
          ).resolveSession(targetUserId, sessionReference, now);
          if (!sessionId) throw new Error("TARGET_UNAVAILABLE");
          revokedSessionId = sessionId;
          const claimed = await tx.userAccount.updateMany({
            where: { id: targetUserId, version: command.expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (claimed.count !== 1)
            throw new AdminCommandConflict(
              "STALE_CONFLICT",
              command.expectedVersion + 1,
            );
          const changed = await tx.session.updateMany({
            where: { id: sessionId, userId: targetUserId, revokedAt: null },
            data: {
              revokedAt: now,
              revocationReason: "administrator_revoked_one",
            },
          });
          if (changed.count !== 1) throw new Error("STALE_CONFLICT");
          action = "admin.session_revoked";
        }
        await recordAccountCommand(tx, {
          correlationId,
          actorUserId: authority.userId,
          actorSessionId: authority.sessionId,
          targetUserId,
          action,
          reasonCategory: normalizedCommand.reasonCategory,
          explanation: normalizedCommand.explanation,
          recipientName: account.name,
          priorState,
          resultingState,
          resultingVersion: account.version + 1,
          occurredAt: now,
          notify,
        });
        return {
          accountId: targetUserId,
          status: resultingState,
          version: account.version + 1,
          emailStatus: notify ? ("QUEUED" as const) : ("NONE" as const),
        };
      },
    );
    if ((outcome as { status?: string }).status === "ACTION_BLOCKED")
      throw new Error("ACTION_BLOCKED");
    if (kind === "suspend" || kind === "revoke-all") {
      await enforceMessagingUserRevocation({
        userId: targetUserId,
        cause:
          kind === "suspend" &&
          normalizedCommand.reasonCategory === "POLICY_VIOLATION"
            ? "MODERATION"
            : "ACCOUNT",
      }).catch(() => undefined);
    } else if (kind === "revoke-one" && revokedSessionId) {
      await enforceMessagingUserRevocation({
        userId: targetUserId,
        sessionIds: [revokedSessionId],
        cause: "SESSION",
      }).catch(() => undefined);
    }
    return outcome;
  }
  suspend(a: AdminAuthority, id: string, c: Command) {
    return this.run(a, id, "suspend", c);
  }
  reinstate(a: AdminAuthority, id: string, c: Command) {
    return this.run(a, id, "reinstate", c);
  }
  restore(a: AdminAuthority, id: string, c: Command) {
    return this.run(a, id, "restore", c);
  }
  revokeAll(a: AdminAuthority, id: string, c: Command) {
    return this.run(a, id, "revoke-all", c);
  }
  revokeOne(a: AdminAuthority, id: string, reference: string, c: Command) {
    return this.run(a, id, "revoke-one", c, reference);
  }
}
