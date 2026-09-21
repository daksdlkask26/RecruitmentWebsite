import "server-only";

import { prisma } from "@/backend/database/prisma";
import { PrismaMessagingEligibilityRepository } from "@/backend/repositories/messaging/prisma-messaging-eligibility-repository";
import { PrismaProfileQueryRepository } from "@/backend/repositories/profile/prisma-profile-query-repository";
import { GetProfileAggregateService } from "./get-profile-aggregate";
import { projectVisibleProfile } from "./profile-visibility-projection";

export class PublicProfessionalProfileService {
  constructor(
    private readonly eligibility = new PrismaMessagingEligibilityRepository(),
    private readonly profiles = new PrismaProfileQueryRepository(),
    private readonly aggregate = new GetProfileAggregateService(),
    private readonly db: typeof prisma = prisma,
  ) {}

  async get(actorUserId: string, targetUserId: string) {
    const eligible = await this.eligibility.findEligibleProfile(
      actorUserId,
      targetUserId,
    );
    if (!eligible) {
      if (targetUserId === actorUserId) return null;
      const row = await this.profiles.findDiscoverable(targetUserId);
      if (!row) return null;
      const visible = projectVisibleProfile({
        userId: targetUserId,
        displayName: row.candidate.user.name,
        image: row.candidate.user.image,
        profile: await this.aggregate.execute(targetUserId),
        audience: "candidate",
      });
      return {
        participant: {
          id: targetUserId,
          name: visible.displayName,
          image: visible.image,
        },
        contexts: [],
        profile: {
          headline: visible.sections.headline ?? null,
          summary: visible.sections.summary ?? null,
          location: visible.sections.location ?? null,
        },
        visibleSections: visible.sections,
        canMessage: false,
      };
    }
    const account = await this.db.userAccount.findFirst({
      where: { id: targetUserId, state: "ACTIVE" },
      select: {
        candidateIdentity: {
          select: {
            profile: {
              select: { headline: true, summary: true, location: true },
            },
          },
        },
      },
    });
    if (!account) return null;
    return {
      participant: eligible.participant,
      contexts: eligible.contexts,
      profile: account.candidateIdentity?.profile ?? null,
      visibleSections: undefined,
      canMessage: true,
    };
  }
}
