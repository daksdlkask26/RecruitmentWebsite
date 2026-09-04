import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { PrismaAuditRepository } from "@/backend/repositories/audit/prisma-audit-repository";
import { PrismaProfileQueryRepository } from "@/backend/repositories/profile/prisma-profile-query-repository";
import { RecruiterApplicationAuthorization } from "@/backend/applications/authorization/recruiter-application-authorization";
import { GetProfileAggregateService } from "@/backend/services/profile/get-profile-aggregate";
import { projectVisibleProfile } from "@/backend/services/profile/profile-visibility-projection";
import { recruiterCandidateProfileSchema } from "@/shared/contracts/recruiter-candidate-profile";

export class GetRecruiterApplicationProfileService {
  constructor(
    private readonly authorization = new RecruiterApplicationAuthorization(),
  ) {}

  async execute(input: {
    userId: string;
    sessionId: string;
    jobId: string;
    applicationId: string;
  }) {
    const authorization = await this.authorization.authorizeApplication(
      input.userId,
      input.jobId,
      input.applicationId,
    );
    if (!authorization.authorized || !authorization.canView) return null;

    const application = await prisma.jobApplication.findFirst({
      where: {
        id: input.applicationId,
        jobPostingId: authorization.jobPostingId,
      },
      select: {
        candidateUserId: true,
        profileSnapshot: true,
        profileSnapshotAccessDeniedAt: true,
        contactConsent: { select: { sharedAt: true, withdrawnAt: true } },
      },
    });
    if (!application) return null;

    const snapshot = application.profileSnapshotAccessDeniedAt
      ? null
      : (recruiterCandidateProfileSchema.shape.submittedProfile
          .unwrap()
          .safeParse(application.profileSnapshot).data ?? null);
    const row = await new PrismaProfileQueryRepository().findOwned(
      application.candidateUserId,
    );
    const liveProfile = row
      ? projectVisibleProfile({
          userId: application.candidateUserId,
          displayName: row.candidate.user.name,
          image: row.candidate.user.image,
          profile: await new GetProfileAggregateService().execute(
            application.candidateUserId,
          ),
          audience: "recruiter",
        })
      : null;
    await new PrismaAuditRepository().append({
      occurredAt: new Date(),
      actorType: "user",
      actorUserId: input.userId,
      actorSessionId: input.sessionId,
      action: "recruiter.application_profile_viewed",
      targetType: "job_application",
      targetId: input.applicationId,
      result: "SUCCESS",
      correlationId: randomUUID(),
      context: { applicationState: "PROFILE_REVIEW" },
    });
    return recruiterCandidateProfileSchema.parse({
      submittedProfile: snapshot,
      liveProfile,
      contactShared: Boolean(
        application.contactConsent?.sharedAt &&
        !application.contactConsent.withdrawnAt,
      ),
      submittedProfileAvailable: Boolean(snapshot),
    });
  }
}
