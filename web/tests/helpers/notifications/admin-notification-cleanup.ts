import { prisma } from "@/backend/database/prisma";
import { assertTestDatabaseEnvironment } from "../test-database-guard";

export async function cleanupAdministratorNotificationsForContexts(
  contextIds: readonly string[],
) {
  assertTestDatabaseEnvironment();
  const uniqueContextIds = [...new Set(contextIds.filter(Boolean))];
  if (uniqueContextIds.length === 0) return;
  await prisma.inAppNotification.deleteMany({
    where: {
      audience: "ADMIN",
      contextId: { in: uniqueContextIds },
    },
  });
}
