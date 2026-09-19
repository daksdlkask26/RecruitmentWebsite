import "server-only";

import type { Prisma } from "@/backend/generated/prisma/client";

/**
 * Company deletion owns only the lifecycle boundary. Candidate-owned private
 * snapshots are cleaned here so employer/job modules never read or project
 * their contents. The caller must invoke this inside the existing deletion
 * transaction, before the Company row is removed.
 */
export async function deleteCompanyScopedCandidatePrivateData(
  transaction: Prisma.TransactionClient,
  jobIds: readonly string[],
) {
  if (!jobIds.length) return;
  await transaction.privateCvMatchCheck.updateMany({
    where: { jobPostingId: { in: [...jobIds] } },
    data: { currentAttemptId: null },
  });
  await transaction.privateCvMatchCheck.deleteMany({
    where: { jobPostingId: { in: [...jobIds] } },
  });
}
