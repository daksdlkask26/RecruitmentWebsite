import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import { assertTestDatabaseEnvironment } from "./test-database-guard";

export async function createProfileDatabaseAccount(
  label: string,
  options: { state?: "ACTIVE" | "SUSPENDED"; withSession?: boolean } = {},
) {
  assertTestDatabaseEnvironment();
  const suffix = randomUUID();
  const userId = `profile-${label}-${suffix}`;
  const email = `profile-${label}-${suffix}@example.test`;
  const user = await prisma.userAccount.create({
    data: {
      id: userId,
      name: `Profile ${label}`,
      email,
      normalizedEmail: email,
      emailVerified: true,
      state: options.state ?? "ACTIVE",
      candidateIdentity: {
        create: { profile: { create: {} } },
      },
      ...(options.withSession
        ? {
            sessions: {
              create: {
                id: `session-${suffix}`,
                token: `token-${suffix}`,
                expiresAt: new Date(Date.now() + 30 * 60_000),
                absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
              },
            },
          }
        : {}),
    },
    include: {
      candidateIdentity: { include: { profile: true } },
      sessions: true,
    },
  });
  return {
    userId,
    email,
    profileId: user.candidateIdentity?.profile?.id ?? "",
    sessionId: user.sessions[0]?.id,
  };
}

export async function deleteProfileDatabaseAccounts(userIds: string[]) {
  assertTestDatabaseEnvironment();
  await prisma.emailOutbox.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.candidateIdentity.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.userAccount.deleteMany({ where: { id: { in: userIds } } });
}
