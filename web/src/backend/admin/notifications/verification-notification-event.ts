import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/backend/generated/prisma/client";
import { verificationBusinessEventKey } from "./notification-events";
import {
  buildVerificationOutbox,
  createVerificationInAppNotification,
} from "./verification-outbox";

export type VerificationDecisionNotificationInput = {
  requestId: string;
  userId: string;
  eventKind: "VERIFICATION_APPROVED" | "VERIFICATION_REJECTED";
  resultingState: "APPROVED" | "REJECTED";
  resultingVersion: number;
  occurredAt: Date;
  nextAction: string;
  category?: string;
  applicantComment?: string;
  companyDisplayName?: string;
  approvedMembershipRole?:
    | "OWNER"
    | "HR_MANAGER"
    | "RECRUITER"
    | "HIRING_MANAGER";
};

type VerificationNotificationInput = {
  requestId: string;
  userId: string;
  eventKind:
    | "VERIFICATION_APPROVED"
    | "VERIFICATION_REJECTED"
    | "VERIFICATION_DELAYED"
    | "VERIFICATION_EXPIRED";
  resultingState: "APPROVED" | "REJECTED" | "PENDING_CHECKS" | "EXPIRED";
  resultingVersion: number;
  occurredAt: Date;
  nextAction: string;
  category?: string;
  applicantComment?: string;
  companyDisplayName?: string;
  approvedMembershipRole?:
    | "OWNER"
    | "HR_MANAGER"
    | "RECRUITER"
    | "HIRING_MANAGER";
};

/**
 * Persists one verification outcome and its two delivery channels in the
 * decision transaction. The event is the outcome authority; the email row and
 * deterministic in-app reference are delivery children, not competing events.
 */
export async function createVerificationDecisionNotification(
  tx: Prisma.TransactionClient,
  input: VerificationDecisionNotificationInput,
) {
  return createVerificationNotificationEvent(tx, input);
}

export async function createVerificationNotificationEvent(
  tx: Prisma.TransactionClient,
  input: VerificationNotificationInput,
) {
  const businessEventKey = verificationBusinessEventKey(
    input.requestId,
    input.eventKind,
    input.resultingVersion,
  );
  const idempotencyKey = `verification-outcome:${businessEventKey}`;
  const payload = {
    eventKind: input.eventKind,
    requestId: input.requestId,
    resultingState: input.resultingState,
    occurredAt: input.occurredAt.toISOString(),
    nextAction: input.nextAction,
    ...(input.category ? { rejectionCategory: input.category } : {}),
    ...(input.applicantComment
      ? { applicantComment: input.applicantComment }
      : {}),
    ...(input.companyDisplayName
      ? { companyDisplayName: input.companyDisplayName }
      : {}),
    ...(input.approvedMembershipRole
      ? { approvedMembershipRole: input.approvedMembershipRole }
      : {}),
  } satisfies Prisma.InputJsonObject;

  const existing = await tx.verificationNotificationEvent.findUnique({
    where: { idempotencyKey },
    select: {
      id: true,
      idempotencyKey: true,
      emailStatus: true,
      inAppStatus: true,
    },
  });
  const inApp = await createVerificationInAppNotification(
    tx,
    input,
    // In-app correlation IDs are bounded at 128 characters. Request IDs are
    // database identifiers and may legitimately be longer than the compact
    // fixture IDs, so retain deterministic traceability without overflowing
    // the notification contract.
    `verification:${businessEventKey}`.length <= 128
      ? `verification:${businessEventKey}`
      : `verification:${createHash("sha256").update(businessEventKey).digest("hex")}`,
  );
  if (existing) return existing;

  const email = await tx.emailOutbox.upsert({
    where: {
      idempotencyKey: `email-delivery:${businessEventKey}`,
    },
    update: {},
    create: {
      ...buildVerificationOutbox({
        requestId: input.requestId,
        userId: input.userId,
        eventKind: input.eventKind,
        resultingState: input.resultingState,
        resultingVersion: input.resultingVersion,
        occurredAt: input.occurredAt,
        nextAction: input.nextAction,
        rejectionCategory: input.category,
        applicantComment: input.applicantComment,
        companyDisplayName: input.companyDisplayName,
        approvedMembershipRole: input.approvedMembershipRole,
      }),
      payloadRef: payload,
    },
  });

  const event = await tx.verificationNotificationEvent.create({
    data: {
      verificationRequestId: input.requestId,
      idempotencyKey,
      eventKind: input.eventKind,
      resultingStatus: input.resultingState,
      eventTime: input.occurredAt,
      payloadRef: payload,
      emailStatus: "QUEUED",
      inAppStatus: "QUEUED",
      emailOutboxId: email.id,
      inAppNotificationRef: inApp.id,
    },
  });

  return {
    id: event.id,
    idempotencyKey: event.idempotencyKey,
    emailStatus: event.emailStatus,
    inAppStatus: event.inAppStatus,
  };
}
