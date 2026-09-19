import "server-only";
import type { AdminAuthority } from "@/backend/security/admin-request-boundary";
import {
  PrismaAdminCommandRepository,
  AdminCommandConflict,
} from "@/backend/repositories/admin/prisma-admin-command-repository";
import { AuditWriter } from "@/backend/admin/audit/audit-writer";
import { createVerificationDecisionNotification } from "@/backend/admin/notifications/verification-notification-event";
import { splitCompanyIdentity } from "@/shared/contracts/employer-verification/business-verification";
import { assertActiveOwnedCompanyCapacity } from "@/backend/company-members/company-ownership-limit";
import { loadVerificationDecisionEligibility } from "./verification-decision-eligibility";
import { invalidatePublicCompanySafety } from "@/backend/services/discovery/public-discovery-cache";

export type ApprovalCommand = {
  expectedVersion: number;
  idempotencyKey: string;
  role?: "OWNER" | "HR_MANAGER" | "RECRUITER" | "HIRING_MANAGER";
  privateNote?: string;
};

function slug(name: string, suffix: string) {
  const base = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase()
    .slice(0, 48)
    .replace(/^-|-$/gu, "");
  return `${base || "company"}-${suffix.slice(0, 8)}`;
}

export class VerificationApprovalTransaction {
  async execute(
    authority: AdminAuthority,
    requestId: string,
    command: ApprovalCommand,
  ) {
    const now = new Date();
    const result = await new PrismaAdminCommandRepository().execute(
      {
        actorUserId: authority.userId,
        actorSessionId: authority.sessionId,
        grantId: authority.grantId,
        commandKind: "verification.approve",
        targetReference: requestId,
        idempotencyKey: command.idempotencyKey,
        normalizedBody: command,
      },
      async (tx, correlationId) => {
        const eligible = await loadVerificationDecisionEligibility(tx, {
          authority,
          requestId,
          expectedVersion: command.expectedVersion,
          decision: "APPROVE",
          now,
        });
        const row = eligible.request;
        const version = row.version + 1;
        const claimed = await tx.recruiterVerificationRequest.updateMany({
          where: {
            id: row.id,
            version: command.expectedVersion,
            state: "PENDING_REVIEW",
          },
          data: { version },
        });
        if (claimed.count !== 1)
          throw new AdminCommandConflict("STALE_CONFLICT", version);

        let companyId = row.targetCompanyId;
        let companyDisplayName = row.targetCompany?.displayName;
        let role = command.role ?? row.requestedRole;
        if (companyId) {
          if (!eligible.prerequisite) throw new Error("RELATIONSHIP_REQUIRED");
        } else {
          role = "OWNER";
        }

        await assertActiveOwnedCompanyCapacity(tx, row.applicantUserId, role);

        if (!companyId) {
          const identity = splitCompanyIdentity(
            row.acceptedRegistrySnapshot?.registryLegalName ??
              row.submittedCompanyName,
            row.acceptedRegistrySnapshot?.registryEntityType,
          );
          const company = await tx.company.create({
            data: {
              slug: slug(identity.name, row.id),
              legalName: identity.name,
              displayName: identity.name,
              entityType: identity.entityType,
              normalizedTaxIdentifier: row.normalizedTaxIdentifier,
              verificationState: "ACTIVE",
              verifiedAt: now,
            },
          });
          companyId = company.id;
          companyDisplayName = company.displayName;
        }

        if (!companyId) throw new Error("TARGET_UNAVAILABLE");
        const existingMembership = await tx.companyMembership.findUnique({
          where: {
            companyId_userId: { companyId, userId: row.applicantUserId },
          },
          select: { id: true, status: true },
        });
        if (existingMembership?.status === "ACTIVE")
          throw new Error("DUPLICATE_AUTHORITY");
        await tx.companyMembership.upsert({
          where: {
            companyId_userId: { companyId, userId: row.applicantUserId },
          },
          create: {
            companyId,
            userId: row.applicantUserId,
            role,
            priorApprovedRole: role,
            status: "ACTIVE",
            stateChangedAt: now,
          },
          update: {
            role,
            priorApprovedRole: role,
            status: "ACTIVE",
            removedAt: null,
            stateChangedAt: now,
            version: { increment: 1 },
          },
        });
        if (eligible.prerequisite) {
          const consumed = await tx.companyAccessPrerequisite.updateMany({
            where: {
              id: eligible.prerequisite.id,
              state: "AVAILABLE",
              applicantUserId: row.applicantUserId,
              companyId,
            },
            data: {
              state: "USED",
              usedAt: now,
              usedByRequestId: row.id,
              version: { increment: 1 },
            },
          });
          if (consumed.count !== 1) throw new Error("RELATIONSHIP_REQUIRED");
        }
        await tx.recruiterVerificationRequest.update({
          where: { id: row.id },
          data: {
            state: "APPROVED",
            targetCompanyId: companyId,
            decidedAt: now,
          },
        });
        await tx.verificationDecisionHistory.create({
          data: {
            requestId: row.id,
            submissionVersion: row.currentSubmissionVersion,
            actorAdminUserId: authority.userId,
            priorState: row.state,
            resultingState: "APPROVED",
            decisionKind: "APPROVE",
            approvedRole: role,
            result: "SUCCESS",
            correlationId,
            decidedAt: now,
          },
        });
        if (command.privateNote)
          await tx.verificationPrivateNote.create({
            data: {
              requestId: row.id,
              authorAdminUserId: authority.userId,
              normalizedText: command.privateNote,
            },
          });
        await new AuditWriter(tx).append({
          occurredAt: now,
          actorType: "user",
          actorUserId: authority.userId,
          actorSessionId: authority.sessionId,
          action: "admin.verification_approved",
          targetType: "recruiter_verification",
          targetId: row.id,
          result: "SUCCESS",
          correlationId,
          context: {
            priorState: row.state,
            resultingState: "APPROVED",
            targetVersion: version,
            companyReference: companyId,
          },
        });
        const notification = await createVerificationDecisionNotification(tx, {
          requestId: row.id,
          userId: row.applicantUserId,
          eventKind: "VERIFICATION_APPROVED",
          resultingState: "APPROVED",
          resultingVersion: version,
          occurredAt: now,
          nextAction: "OPEN_RECRUITER_WORKSPACE",
          companyDisplayName: companyDisplayName ?? row.submittedCompanyName,
          approvedMembershipRole: role,
        });
        return {
          requestId: row.id,
          version,
          state: "APPROVED" as const,
          companyId,
          role,
          notification: {
            email: notification.emailStatus,
            inApp: notification.inAppStatus,
          },
        };
      },
    );
    invalidatePublicCompanySafety(result.companyId);
    return result;
  }
}
