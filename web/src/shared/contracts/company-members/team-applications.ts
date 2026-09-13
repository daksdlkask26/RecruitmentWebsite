import { z } from "zod";

export const teamRoleSchema = z.enum(["HR_MANAGER", "RECRUITER"]);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const teamApplicationStatusSchema = z.enum([
  "SUBMITTED",
  "VIEWED",
  "REJECTED",
  "INVITATION_SENT",
  "WITHDRAWN",
  "JOINED",
]);
export type TeamApplicationStatus = z.infer<typeof teamApplicationStatusSchema>;

export const teamInvitationStatusSchema = z.enum([
  "PENDING",
  "REVOKED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
]);
export type TeamInvitationStatus = z.infer<typeof teamInvitationStatusSchema>;

export const teamInvitationEmailStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "SENT",
  "RETRYABLE",
  "DEAD",
]);
export type TeamInvitationEmailStatus = z.infer<
  typeof teamInvitationEmailStatusSchema
>;

export const teamApplicationSubmitSchema = z
  .object({
    companyId: z.string().trim().min(1).max(128),
    role: teamRoleSchema,
    uploadId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const teamApplicationFinalizeSchema = z
  .object({
    companyId: z.string().trim().min(1).max(128),
    role: teamRoleSchema,
    uploadId: z.string().trim().min(1).max(128),
  })
  .strict();

export type TeamApplicationFinalize = z.infer<
  typeof teamApplicationFinalizeSchema
>;

export const teamApplicationRejectSchema = z
  .object({
    reason: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const teamApplicationAcceptSchema = z
  .object({ role: teamRoleSchema })
  .strict();

const isoDate = z.string().datetime();

export const candidateTeamApplicationSchema = z
  .object({
    applicationId: z.string().min(1).max(128),
    companyId: z.string().min(1).max(128),
    companyName: z.string().min(1).max(160),
    companySlug: z.string().min(1).max(200),
    appliedRole: teamRoleSchema,
    status: teamApplicationStatusSchema,
    invitationStatus: teamInvitationStatusSchema.nullable(),
    invitationId: z.string().min(1).max(128).nullable(),
    submittedAt: isoDate,
    ownerViewed: z.boolean(),
    ownerFirstViewedAt: isoDate.nullable(),
    decidedAt: isoDate.nullable(),
    joinedAt: isoDate.nullable(),
    invitationExpiresAt: isoDate.nullable(),
  })
  .strict();

export type CandidateTeamApplication = z.infer<
  typeof candidateTeamApplicationSchema
>;

export const candidateTeamApplicationListSchema = z
  .object({
    items: z.array(candidateTeamApplicationSchema).max(100),
    nextCursor: z.string().min(1).max(1024).nullable(),
    hasMore: z.boolean(),
    total: z.number().int().nonnegative(),
    filter: z
      .object({
        status: teamApplicationStatusSchema.nullable(),
        role: teamRoleSchema.nullable(),
      })
      .strict(),
    sort: z.enum(["SUBMITTED_DESC", "SUBMITTED_ASC"]),
  })
  .strict();

export const teamApplicationListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    status: teamApplicationStatusSchema.optional(),
    role: teamRoleSchema.optional(),
    sort: z.enum(["SUBMITTED_DESC", "SUBMITTED_ASC"]).default("SUBMITTED_DESC"),
  })
  .strict();
export type TeamApplicationListQuery = z.infer<
  typeof teamApplicationListQuerySchema
>;

export const ownerTeamApplicationSchema = candidateTeamApplicationSchema
  .extend({
    candidateName: z.string().min(1).max(160),
    applicationEmail: z.string().email().max(320),
    cvFileName: z.string().min(1).max(255),
    cvMimeType: z.string().min(1).max(160),
    cvByteSize: z.number().int().positive().max(5_000_000),
    rejectionReason: z.string().max(2_000).nullable(),
    invitationEmailStatus: teamInvitationEmailStatusSchema.nullable(),
  })
  .strict();

export type OwnerTeamApplication = z.infer<typeof ownerTeamApplicationSchema>;

export const ownerTeamApplicationListSchema = z
  .object({
    items: z.array(ownerTeamApplicationSchema).max(100),
    nextCursor: z.string().min(1).max(1024).nullable(),
    hasMore: z.boolean(),
    total: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    filter: z
      .object({
        status: teamApplicationStatusSchema.nullable(),
        role: teamRoleSchema.nullable(),
      })
      .strict(),
    sort: z.enum(["SUBMITTED_DESC", "SUBMITTED_ASC"]),
  })
  .strict();

export const teamApplicationStatusLabels: Record<
  TeamApplicationStatus,
  string
> = {
  SUBMITTED: "Submitted",
  VIEWED: "Viewed by owner",
  REJECTED: "Not selected",
  INVITATION_SENT: "Invitation sent",
  WITHDRAWN: "Withdrawn",
  JOINED: "Joined company",
};

export const teamRoleLabels: Record<TeamRole, string> = {
  HR_MANAGER: "HR Manager",
  RECRUITER: "Recruiter",
};
