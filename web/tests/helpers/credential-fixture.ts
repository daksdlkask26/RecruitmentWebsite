import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/backend/database/prisma";
import { assertTestDatabaseEnvironment } from "./test-database-guard";

type CredentialFixtureInput = {
  email: string;
  password: string;
  name: string;
  state?: "PENDING_VERIFICATION" | "ACTIVE";
  emailVerified?: boolean;
};

/**
 * Creates test-only Better Auth credential ownership without reopening the
 * provider's public sign-up endpoint. Production registration remains owned by
 * RegisterAccountService and its transactional domain workflow.
 */
export async function createCredentialFixture(input: CredentialFixtureInput) {
  assertTestDatabaseEnvironment();
  const userId = randomUUID();
  const normalizedEmail = input.email.trim().toLowerCase();
  const password = await hashPassword(input.password);

  return prisma.$transaction(async (transaction) => {
    const user = await transaction.userAccount.create({
      data: {
        id: userId,
        name: input.name,
        email: normalizedEmail,
        normalizedEmail,
        state: input.state ?? "ACTIVE",
        emailVerified: input.emailVerified ?? true,
      },
    });
    await transaction.authProviderAccount.create({
      data: {
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password,
      },
    });
    return user;
  });
}
