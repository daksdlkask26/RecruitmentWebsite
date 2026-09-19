import "server-only";

import { PrivateCvMatchRepository } from "@/backend/repositories/private-cv-match/prisma-private-cv-match-repository";

export class PrivateMatchRetentionService {
  constructor(private readonly repository = new PrivateCvMatchRepository()) {}

  async expire(now = new Date(), limit = 50): Promise<number> {
    return this.repository.expireDueChecks(now, limit);
  }

  async cleanup(
    workerId: string,
    now = new Date(),
    limit = 50,
  ): Promise<{ claimed: number; deleted: number }> {
    let claimed = 0;
    let deleted = 0;
    for (let index = 0; index < Math.max(1, Math.min(100, limit)); index += 1) {
      const checkId = await this.repository.claimCleanup(workerId, now);
      if (!checkId) break;
      claimed += 1;
      try {
        if (
          await this.repository.physicallyDeleteClaimed(checkId, workerId, now)
        )
          deleted += 1;
      } catch {
        await this.repository
          .recordCleanupFailure(checkId, workerId, now)
          .catch(() => undefined);
      }
    }
    return { claimed, deleted };
  }
}
