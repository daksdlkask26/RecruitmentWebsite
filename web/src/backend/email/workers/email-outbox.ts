import "server-only";
import { randomUUID } from "node:crypto";
import { render } from "react-email";
import { createElement } from "react";
import { prisma } from "@/backend/database/prisma";
import { serverEnvironment } from "@/backend/env/runtime";
import { safeErrorCode } from "@/backend/security/redaction";
import { TokenProtector } from "@/backend/security/security-token/security-tokens";
import { EmailChangeProofProtector } from "@/backend/security/email-change-proof";
import {
  ProtectedOutboxRecipient,
  protectedRecipientPurposes,
  type ProtectedRecipientPurpose,
} from "@/backend/security/protected-recipient/protected-outbox-recipient";
import {
  PrismaOutboxRepository,
  type ClaimedOutbox,
} from "@/backend/repositories/email/outbox-repository";
import { CaptureEmailAdapter } from "../capture-adapter";
import { ResendEmailAdapter } from "../resend-adapter";
import { SmtpEmailAdapter } from "../smtp-adapter";
import {
  VerifyEmailTemplate,
  verificationEmailText,
} from "../templates/verify-email";
import {
  ResetPasswordTemplate,
  resetPasswordEmailText,
} from "../templates/reset-password";
import {
  PasswordChangedTemplate,
  passwordChangedEmailText,
} from "../templates/password-changed";
import {
  EmailChangeVerificationTemplate,
  emailChangeVerificationText,
} from "../templates/email-change-verification";
import {
  EmailChangeAlertTemplate,
  emailChangeAlertText,
} from "../templates/email-change-alert";
import {
  CompanyEmailVerificationTemplate,
  companyEmailVerificationText,
} from "../templates/company-email-verification";
import {
  ApplicationStageChangedTemplate,
  applicationStageChangedEmailText,
} from "../templates/application-stage-changed";
import {
  RecruitmentNotificationTemplate,
  recruitmentNotificationEmailText,
  recruitmentNotificationEmailPayloadSchema,
  type RecruitmentNotificationEmailPayload,
} from "../templates/recruitment-notification";
import {
  CompanyInvitationTemplate,
  companyInvitationEmailText,
} from "../templates/company-invitation";
import {
  CompanyInvitationResponseTemplate,
  companyInvitationResponseEmailText,
} from "../templates/company-invitation-response";
import {
  TeamApplicationRejectedTemplate,
  teamApplicationRejectedEmailText,
} from "../templates/team-application-rejected";
import {
  applicationStageLabel,
  applicationStageSchema,
} from "@/shared/contracts/jobs/applications";
import { EmailDeliveryError, type EmailService } from "../email-service";
import { renderFeature006Email } from "@/backend/admin/notifications/renderer-registry";
import {
  alertSecurityNotificationDead,
  selectedSecurityNotificationOpsAlertAdapter,
  type SecurityNotificationOpsAlertAdapter,
} from "@/backend/admin/notifications/security-notification-ops-alert";
const protector = new TokenProtector();
const emailChangeProofs = new EmailChangeProofProtector();
const recipientProtector = new ProtectedOutboxRecipient();

function deliveryRecipient(row: ClaimedOutbox): string {
  if (row.recipientCiphertext || row.recipientPurpose) {
    if (
      !row.recipientCiphertext ||
      !row.recipientPurpose ||
      !(protectedRecipientPurposes as readonly string[]).includes(
        row.recipientPurpose,
      )
    ) {
      throw new Error("PROTECTED_RECIPIENT_INVALID");
    }
    return recipientProtector.unseal(
      row.recipientCiphertext,
      row.recipientPurpose as ProtectedRecipientPurpose,
    );
  }
  if (!row.user) throw new Error("MISSING_RECIPIENT");
  return row.user.email;
}

const recruitmentNotificationCompanyRoles = [
  "OWNER",
  "HR_MANAGER",
  "RECRUITER",
  "HIRING_MANAGER",
] as const;

function ineligibleRecruitmentRecipient(): EmailDeliveryError {
  return new EmailDeliveryError(
    "RECRUITMENT_NOTIFICATION_RECIPIENT_NOT_ELIGIBLE",
    false,
  );
}

async function recruitmentNotificationRecipient(
  row: ClaimedOutbox,
  payload: RecruitmentNotificationEmailPayload,
): Promise<string> {
  if (row.userId !== row.recipientRef) throw ineligibleRecruitmentRecipient();

  const keySeparator = row.idempotencyKey.lastIndexOf(":");
  const keyPrefix = "recruitment:";
  const workId =
    row.idempotencyKey.startsWith(keyPrefix) && keySeparator > keyPrefix.length
      ? row.idempotencyKey.slice(keyPrefix.length, keySeparator)
      : null;
  const keyRecipient =
    workId === null ? null : row.idempotencyKey.slice(keySeparator + 1);
  if (!workId || keyRecipient !== row.recipientRef)
    throw ineligibleRecruitmentRecipient();

  const work = await prisma.recruitmentNotificationWork.findUnique({
    where: { id: workId },
    select: {
      applicationId: true,
      audience: true,
      kind: true,
      targetReference: true,
      status: true,
    },
  });
  if (
    !work ||
    work.status !== "SENT" ||
    work.applicationId !== payload.applicationId ||
    work.audience !== payload.audience ||
    work.kind !== payload.notificationKind
  )
    throw ineligibleRecruitmentRecipient();

  const application = await prisma.jobApplication.findUnique({
    where: { id: payload.applicationId },
    select: {
      candidateUserId: true,
      jobPosting: { select: { companyId: true } },
    },
  });
  if (!application) throw ineligibleRecruitmentRecipient();

  if (payload.audience === "CANDIDATE") {
    if (
      work.targetReference !== application.candidateUserId ||
      application.candidateUserId !== row.recipientRef
    )
      throw ineligibleRecruitmentRecipient();
    const [user, preference] = await Promise.all([
      prisma.userAccount.findFirst({
        where: { id: row.recipientRef, state: "ACTIVE", deletedAt: null },
        select: {
          email: true,
          preferences: { select: { applicationUpdatesEmail: true } },
        },
      }),
      prisma.applicationNotificationPreference.findUnique({
        where: { applicationId: payload.applicationId },
        select: { emailEnabled: true },
      }),
    ]);
    if (
      !user ||
      !(preference?.emailEnabled ?? true) ||
      !(user.preferences?.applicationUpdatesEmail ?? true)
    )
      throw ineligibleRecruitmentRecipient();
    return user.email;
  }

  if (work.targetReference !== application.jobPosting.companyId)
    throw ineligibleRecruitmentRecipient();

  const membership = await prisma.companyMembership.findFirst({
    where: {
      companyId: application.jobPosting.companyId,
      userId: row.recipientRef,
      status: "ACTIVE",
      role: { in: [...recruitmentNotificationCompanyRoles] },
      user: { state: "ACTIVE", deletedAt: null },
    },
    select: {
      user: {
        select: {
          email: true,
          preferences: { select: { applicationUpdatesEmail: true } },
        },
      },
    },
  });
  if (
    !membership ||
    !(membership.user.preferences?.applicationUpdatesEmail ?? true)
  )
    throw ineligibleRecruitmentRecipient();
  return membership.user.email;
}

export function selectedEmailAdapter(): EmailService {
  if (serverEnvironment.EMAIL_ADAPTER === "capture")
    return new CaptureEmailAdapter();
  if (serverEnvironment.EMAIL_ADAPTER === "smtp") return new SmtpEmailAdapter();
  return new ResendEmailAdapter();
}
export function retryAt(attempts: number, now: Date, random = Math.random) {
  const baseSeconds = Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
  return new Date(
    now.getTime() + Math.round(baseSeconds * (0.9 + random() * 0.2)) * 1000,
  );
}
const FEATURE_006_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
] as const;
export function feature006RetryAt(attempts: number, now: Date) {
  const delay = FEATURE_006_RETRY_DELAYS_MS[Math.max(0, attempts - 1)];
  return new Date(now.getTime() + (delay ?? 0));
}
export async function deliverClaimedOutbox(
  row: ClaimedOutbox,
  owner: string,
  adapter: EmailService = selectedEmailAdapter(),
  repository = new PrismaOutboxRepository(),
  now = new Date(),
  random = Math.random,
  opsAlertAdapter: SecurityNotificationOpsAlertAdapter = selectedSecurityNotificationOpsAlertAdapter(),
): Promise<boolean> {
  const feature006Delivery =
    row.templateVersion === "admin-security-v1" ||
    row.templateVersion === "verification-v1" ||
    row.templateVersion === "support-case-v1" ||
    row.templateVersion === "professional-connection-v1" ||
    /^email-delivery:(account|membership|verification):/u.test(
      row.idempotencyKey,
    );
  const deliveryDeadline = feature006Delivery
    ? new Date(row.createdAt.getTime() + 24 * 60 * 60_000)
    : undefined;
  if (deliveryDeadline && now >= deliveryDeadline) {
    const failure = await repository.markFailure({
      id: row.id,
      owner,
      attempts: 5,
      code: "DELIVERY_DEADLINE_EXCEEDED",
      retryable: false,
      nextAttemptAt: now,
      kind: row.kind,
      now,
      deliveryDeadline,
    });
    if (failure.dead)
      await alertSecurityNotificationDead(
        row.id,
        opsAlertAdapter,
        undefined,
        now,
      ).catch(() => false);
    return false;
  }
  try {
    const payload = row.payloadRef as { protectedToken?: string };
    let subject: string;
    let html: string;
    let text: string;
    let recruitmentPayload: RecruitmentNotificationEmailPayload | undefined;
    const recoveryPayload = row.payloadRef as {
      event?: string;
      protectedProof?: string;
      protectedCompletionProof?: string;
      protectedCancellationProof?: string;
      holdEndsAt?: string;
    };
    if (
      row.templateVersion === "admin-security-v1" ||
      row.templateVersion === "verification-v1" ||
      row.templateVersion === "support-case-v1" ||
      row.templateVersion === "professional-connection-v1"
    ) {
      const rendered = await renderFeature006Email({
        templateVersion: row.templateVersion,
        payloadRef: row.payloadRef,
        appUrl: serverEnvironment.NEXT_PUBLIC_APP_URL,
      });
      subject = rendered.subject;
      html = rendered.html;
      text = rendered.text;
    } else if (row.templateVersion === "application-stage-changed.v1") {
      const stagePayload = row.payloadRef as {
        applicationId?: string;
        stage?: string;
        jobTitle?: string;
        companyName?: string;
      };
      const stage = applicationStageSchema.safeParse(stagePayload.stage);
      if (
        !stage.success ||
        !stagePayload.applicationId ||
        !stagePayload.jobTitle ||
        !stagePayload.companyName
      ) {
        throw new Error("APPLICATION_STAGE_EMAIL_PAYLOAD_INVALID");
      }
      const applicationUrl = new URL(
        `/jobs/applied/${encodeURIComponent(stagePayload.applicationId)}`,
        serverEnvironment.NEXT_PUBLIC_APP_URL,
      ).toString();
      const templateProps = {
        stageLabel: applicationStageLabel[stage.data],
        jobTitle: stagePayload.jobTitle,
        companyName: stagePayload.companyName,
        applicationUrl,
      };
      subject = `Application update: ${templateProps.stageLabel}`;
      html = await render(
        createElement(ApplicationStageChangedTemplate, templateProps),
      );
      text = applicationStageChangedEmailText(templateProps);
    } else if (row.templateVersion === "recruitment-notification.v1") {
      if (row.kind !== "RECRUITMENT_NOTIFICATION")
        throw new Error("RECRUITMENT_NOTIFICATION_KIND_INVALID");
      const parsed = recruitmentNotificationEmailPayloadSchema.safeParse(
        row.payloadRef,
      );
      if (!parsed.success)
        throw new Error("RECRUITMENT_NOTIFICATION_EMAIL_PAYLOAD_INVALID");
      recruitmentPayload = parsed.data;
      subject =
        parsed.data.notificationKind === "APPLICATION_SUBMITTED"
          ? "Application submitted"
          : parsed.data.notificationKind === "APPLICATION_RECEIVED"
            ? "New application received"
            : "Application stage updated";
      html = await render(
        createElement(RecruitmentNotificationTemplate, parsed.data),
      );
      text = recruitmentNotificationEmailText(parsed.data);
    } else if (row.templateVersion === "company-email-verification.v1") {
      if (!payload.protectedToken) throw new Error("MISSING_PROTECTED_TOKEN");
      const token = protector.unseal(payload.protectedToken);
      const verificationUrl = new URL(
        "/verify-company-email",
        serverEnvironment.NEXT_PUBLIC_APP_URL,
      );
      verificationUrl.hash = `company-email-token=${encodeURIComponent(token)}`;
      subject = "Verify your SmartHire company email";
      html = await render(
        createElement(CompanyEmailVerificationTemplate, {
          verificationUrl: verificationUrl.toString(),
        }),
      );
      text = companyEmailVerificationText(verificationUrl.toString());
    } else if (row.templateVersion === "company-invitation.v1") {
      const invitationPayload = row.payloadRef as {
        companyName?: string;
        role?: "HR_MANAGER" | "RECRUITER";
        protectedToken?: string;
      };
      if (
        !invitationPayload.protectedToken ||
        !invitationPayload.companyName ||
        (invitationPayload.role !== "HR_MANAGER" &&
          invitationPayload.role !== "RECRUITER")
      ) {
        throw new Error("COMPANY_INVITATION_EMAIL_PAYLOAD_INVALID");
      }
      const invitationUrl = new URL(
        "/recruiter/company-invitation",
        serverEnvironment.NEXT_PUBLIC_APP_URL,
      );
      invitationUrl.searchParams.set(
        "token",
        protector.unseal(invitationPayload.protectedToken),
      );
      const templateProps = {
        companyName: invitationPayload.companyName,
        role:
          invitationPayload.role === "HR_MANAGER" ? "HR Manager" : "Recruiter",
        invitationUrl: invitationUrl.toString(),
      };
      subject = `You're invited to join ${templateProps.companyName} on SmartHire`;
      html = await render(
        createElement(CompanyInvitationTemplate, templateProps),
      );
      text = companyInvitationEmailText(templateProps);
    } else if (row.templateVersion === "company-invitation-response.v1") {
      const responsePayload = row.payloadRef as {
        companyName?: string;
        recipientEmail?: string;
        outcome?: "ACCEPTED" | "DECLINED";
        role?: string;
      };
      if (
        !responsePayload.companyName ||
        !responsePayload.recipientEmail ||
        !responsePayload.role ||
        (responsePayload.outcome !== "ACCEPTED" &&
          responsePayload.outcome !== "DECLINED")
      ) {
        throw new Error("COMPANY_INVITATION_RESPONSE_EMAIL_PAYLOAD_INVALID");
      }
      const templateProps = {
        companyName: responsePayload.companyName,
        recipientEmail: responsePayload.recipientEmail,
        outcome: responsePayload.outcome,
        role: responsePayload.role,
      };
      subject = `${templateProps.recipientEmail} ${templateProps.outcome === "ACCEPTED" ? "accepted" : "declined"} your invitation`;
      html = await render(
        createElement(CompanyInvitationResponseTemplate, templateProps),
      );
      text = companyInvitationResponseEmailText(templateProps);
    } else if (row.templateVersion === "team-application-rejected.v1") {
      const rejectionPayload = row.payloadRef as {
        companyName?: string;
        role?: "HR_MANAGER" | "RECRUITER";
        reason?: string;
      };
      if (
        !rejectionPayload.companyName ||
        (rejectionPayload.role !== "HR_MANAGER" &&
          rejectionPayload.role !== "RECRUITER") ||
        (rejectionPayload.reason !== undefined &&
          typeof rejectionPayload.reason !== "string")
      ) {
        throw new Error("TEAM_APPLICATION_REJECTION_EMAIL_PAYLOAD_INVALID");
      }
      const templateProps = {
        companyName: rejectionPayload.companyName,
        role: rejectionPayload.role,
        ...(rejectionPayload.reason ? { reason: rejectionPayload.reason } : {}),
        applicationUrl: new URL(
          "/jobs/applied/team",
          serverEnvironment.NEXT_PUBLIC_APP_URL,
        ).toString(),
      };
      subject = `Update on your team application to ${templateProps.companyName}`;
      html = await render(
        createElement(TeamApplicationRejectedTemplate, templateProps),
      );
      text = teamApplicationRejectedEmailText(templateProps);
    } else if (row.templateVersion === "email-change-verification.v1") {
      const emailChangePayload = row.payloadRef as {
        protectedProof?: string;
      };
      if (!emailChangePayload.protectedProof) {
        throw new Error("MISSING_PROTECTED_TOKEN");
      }
      const proof = emailChangeProofs.unseal(emailChangePayload.protectedProof);
      const verificationUrl = emailChangeProofs.fragmentUrl(proof);
      subject = "Verify your new SmartHire email";
      html = await render(
        createElement(EmailChangeVerificationTemplate, { verificationUrl }),
      );
      text = emailChangeVerificationText(verificationUrl);
    } else if (row.templateVersion === "email-change-alert.v1") {
      subject = "A SmartHire email change was requested";
      html = await render(createElement(EmailChangeAlertTemplate));
      text = emailChangeAlertText();
    } else if (row.templateVersion === "account-recovery-confirmation.v1") {
      if (!recoveryPayload.protectedProof)
        throw new Error("MISSING_PROTECTED_TOKEN");
      const proof = protector.unseal(recoveryPayload.protectedProof);
      const url = new URL(
        "/account-recovery/confirm",
        serverEnvironment.NEXT_PUBLIC_APP_URL,
      );
      url.hash = `proof=${encodeURIComponent(proof)}`;
      subject = "Confirm your SmartHire account recovery";
      html = `<p>Confirm this SmartHire account-recovery request:</p><p><a href="${url.toString()}">Confirm account recovery</a></p><p>Email-only recovery is lower assurance than using your password and second factor.</p>`;
      text = `Confirm your SmartHire account recovery: ${url.toString()}\n\nEmail-only recovery is lower assurance than using your password and second factor.`;
    } else if (row.templateVersion === "account-recovery-pending.v1") {
      if (
        !recoveryPayload.protectedCompletionProof ||
        !recoveryPayload.protectedCancellationProof
      )
        throw new Error("MISSING_PROTECTED_TOKEN");
      const completionProof = protector.unseal(
        recoveryPayload.protectedCompletionProof,
      );
      const cancellationProof = protector.unseal(
        recoveryPayload.protectedCancellationProof,
      );
      const completionUrl = new URL(
        "/account-recovery/complete",
        serverEnvironment.NEXT_PUBLIC_APP_URL,
      );
      completionUrl.hash = `proof=${encodeURIComponent(completionProof)}`;
      const cancellationUrl = new URL(
        "/account-recovery/cancel",
        serverEnvironment.NEXT_PUBLIC_APP_URL,
      );
      cancellationUrl.hash = `proof=${encodeURIComponent(cancellationProof)}`;
      subject = "Your SmartHire account recovery is on hold";
      html = `<p>Your SmartHire account recovery has a 24-hour security hold.</p><p><a href="${cancellationUrl.toString()}">Cancel recovery</a></p><p>After the hold ends, <a href="${completionUrl.toString()}">complete recovery</a>.</p><p>Email-only recovery is lower assurance than using your password and second factor.</p>`;
      text = `Your SmartHire account recovery has a 24-hour security hold.\nCancel recovery: ${cancellationUrl.toString()}\nComplete recovery after the hold: ${completionUrl.toString()}\n\nEmail-only recovery is lower assurance than using your password and second factor.`;
    } else if (row.templateVersion === "account-recovery-cancelled.v1") {
      subject = "Your SmartHire account recovery was cancelled";
      html =
        "<p>Your SmartHire account recovery was cancelled. Your existing password and second factor remain authoritative.</p>";
      text =
        "Your SmartHire account recovery was cancelled. Your existing password and second factor remain authoritative.";
    } else if (row.templateVersion === "account-recovery-completed.v1") {
      subject = "Your SmartHire account recovery is complete";
      html =
        "<p>Your SmartHire account recovery is complete. Sign in with your new password, then re-enroll two-factor authentication.</p>";
      text =
        "Your SmartHire account recovery is complete. Sign in with your new password, then re-enroll two-factor authentication.";
    } else if (row.kind === "PASSWORD_CHANGED") {
      subject = "Your SmartHire password was changed";
      html = await render(createElement(PasswordChangedTemplate));
      text = passwordChangedEmailText();
    } else {
      if (!payload.protectedToken) throw new Error("MISSING_PROTECTED_TOKEN");
      const token = protector.unseal(payload.protectedToken);
      if (row.kind === "RESET_PASSWORD") {
        const url = new URL(
          "/reset-password",
          serverEnvironment.NEXT_PUBLIC_APP_URL,
        );
        url.hash = `token=${encodeURIComponent(token)}`;
        subject = "Reset your SmartHire password";
        html = await render(
          createElement(ResetPasswordTemplate, { resetUrl: url.toString() }),
        );
        text = resetPasswordEmailText(url.toString());
      } else {
        const url = new URL(
          "/verify-email",
          serverEnvironment.NEXT_PUBLIC_APP_URL,
        );
        url.searchParams.set("token", token);
        subject = "Verify your SmartHire email";
        html = await render(
          createElement(VerifyEmailTemplate, {
            verificationUrl: url.toString(),
          }),
        );
        text = verificationEmailText(url.toString());
      }
    }
    // Keep plaintext recipient material in process memory for the shortest
    // possible interval: unseal only after rendering and immediately before
    // invoking the selected provider adapter.
    // Recruitment notifications are re-authorized against current server
    // state after rendering and immediately before the provider call. The
    // claim-time recipient snapshot is not sufficient after a membership,
    // account, or preference revocation.
    const recipient = recruitmentPayload
      ? await recruitmentNotificationRecipient(row, recruitmentPayload)
      : deliveryRecipient(row);
    const delivery = await adapter.send({
      kind: row.kind,
      recipient,
      subject,
      html,
      text,
      idempotencyKey: row.idempotencyKey,
    });
    return (
      (await repository.markSent(row.id, owner, delivery.providerMessageId))
        .count === 1
    );
  } catch (error) {
    const retryable = !(error instanceof EmailDeliveryError) || error.retryable;
    const failure = await repository.markFailure({
      id: row.id,
      owner,
      attempts: row.attempts,
      code: safeErrorCode(error),
      retryable,
      nextAttemptAt: feature006Delivery
        ? feature006RetryAt(row.attempts, now)
        : retryAt(row.attempts, now, random),
      kind: row.kind,
      now,
      deliveryDeadline,
    });
    if (failure.dead)
      await alertSecurityNotificationDead(
        row.id,
        opsAlertAdapter,
        undefined,
        now,
      ).catch(() => false);
    return false;
  }
}
export async function deliverOutboxMessage(
  outboxId: string,
  adapterOverride?: EmailService,
): Promise<boolean> {
  const owner = `direct:${randomUUID()}`;
  const repository = new PrismaOutboxRepository();
  const now = new Date();
  const row = await repository.claimOne(outboxId, owner, now);
  if (!row) return false;
  return deliverClaimedOutbox(
    row,
    owner,
    adapterOverride ?? selectedEmailAdapter(),
    repository,
    now,
  );
}
