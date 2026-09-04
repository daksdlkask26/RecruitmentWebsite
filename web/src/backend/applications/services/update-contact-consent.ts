import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";

export type ContactConsentUpdateResult =
  | { kind: "NOT_FOUND" }
  | { kind: "CONFLICT"; currentVersion: number }
  | { kind: "UPDATED"; shared: boolean; version: number };

export class UpdateContactConsentService {
  async execute(input: {
    applicationId: string;
    userId: string;
    sessionId: string;
    shared: boolean;
    expectedVersion?: number;
    now?: Date;
  }): Promise<ContactConsentUpdateResult> {
    const now = input.now ?? new Date();
    return prisma.$transaction(async (tx) => {
      const application = await tx.jobApplication.findFirst({
        where: { id: input.applicationId, candidateUserId: input.userId },
        select: { id: true },
      });
      if (!application) return { kind: "NOT_FOUND" };

      const existing = await tx.jobApplicationContactConsent.findUnique({
        where: { applicationId: input.applicationId },
        select: { version: true },
      });
      if (
        input.expectedVersion !== undefined &&
        existing &&
        existing.version !== input.expectedVersion
      ) {
        return { kind: "CONFLICT", currentVersion: existing.version };
      }

      const consent = await tx.jobApplicationContactConsent.upsert({
        where: { applicationId: input.applicationId },
        create: {
          applicationId: input.applicationId,
          sharedAt: input.shared ? now : null,
          withdrawnAt: input.shared ? null : now,
          version: 1,
        },
        update: {
          sharedAt: input.shared ? now : null,
          withdrawnAt: input.shared ? null : now,
          version: { increment: 1 },
        },
      });
      await new PrismaAuditRepository(tx).append({
        occurredAt: now,
        actorType: "user",
        actorUserId: input.userId,
        actorSessionId: input.sessionId,
        action: input.shared
          ? "application.contact_consent_granted"
          : "application.contact_consent_withdrawn",
        targetType: "application_contact_consent",
        targetId: input.applicationId,
        result: "SUCCESS",
        correlationId: randomUUID(),
        context: {
          targetVersion: consent.version,
          consentPresent: input.shared,
          consentRevoked: !input.shared,
        },
      });
      return {
        kind: "UPDATED",
        shared: Boolean(consent.sharedAt && !consent.withdrawnAt),
        version: consent.version,
      };
    });
  }
}
