import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/backend/database/prisma";
import { TokenProtector } from "@/backend/security/security-token/security-tokens";
import { BetterAuthGateway } from "@/backend/auth/better-auth/better-auth-gateway";
import { PrismaRegistrationRepository } from "@/backend/repositories/identity/prisma-registration-repository";
import {
  LoginWithPasswordService,
  GENERIC_LOGIN_ERROR,
} from "@/backend/services/identity/login-with-password";
async function account(
  state: "ACTIVE" | "PENDING_VERIFICATION" | "SUSPENDED" | "DELETED",
) {
  const id = randomUUID(),
    email = `login-${id}@example.test`,
    password = "correct horse 2026",
    protector = new TokenProtector();
  await new PrismaRegistrationRepository().create({
    name: "Login User",
    email,
    normalizedEmail: email,
    credentialPassword:
      await new BetterAuthGateway().preparePasswordForCredential(password),
    tokenDigest: protector.digest(protector.generate()),
    protectedToken: protector.seal(protector.generate()),
    expiresAt: new Date(Date.now() + 86400000),
    correlationId: id,
  });
  await prisma.userAccount.update({
    where: { normalizedEmail: email },
    data: {
      state,
      emailVerified: state === "ACTIVE",
      deletedAt: state === "DELETED" ? new Date() : null,
    },
  });
  return { email, password };
}
const headers = () =>
  new Headers({
    origin: "http://localhost:3001",
    "sec-fetch-site": "same-origin",
    "user-agent": "vitest",
  });
describe("password login state enforcement", () => {
  it("creates the sole Better Auth session only for Active credentials", async () => {
    const fixture = await account("ACTIVE");
    const response = await new LoginWithPasswordService().execute(fixture, {
      headers: headers(),
      subject: randomUUID(),
    });
    expect(response.status).toBe(200);
    expect(
      response.headers
        .getSetCookie()
        .filter((v) => v.startsWith("smarthire.session=")),
    ).toHaveLength(1);
  });
  it.each(["PENDING_VERIFICATION", "SUSPENDED", "DELETED"] as const)(
    "rejects %s without a session",
    async (state) => {
      const fixture = await account(state);
      const response = await new LoginWithPasswordService().execute(fixture, {
        headers: headers(),
        subject: randomUUID(),
      });
      expect(response.status).toBe(state === "SUSPENDED" ? 423 : 401);
      expect(
        response.headers.getSetCookie().filter((v) => v.includes("session=")),
      ).toHaveLength(0);
      expect((await response.json()).message).toBe(
        state === "SUSPENDED"
          ? "This account is suspended."
          : GENERIC_LOGIN_ERROR,
      );
    },
  );
  it("returns the same generic message for an unknown email and an incorrect password", async () => {
    const fixture = await account("ACTIVE");
    const service = new LoginWithPasswordService();
    const wrong = await service.execute(
      { ...fixture, password: "wrong password" },
      { headers: headers(), subject: randomUUID() },
    );
    const unknown = await service.execute(
      {
        email: `missing-${randomUUID()}@example.test`,
        password: "wrong password",
      },
      { headers: headers(), subject: randomUUID() },
    );
    const wrongMessage = (await wrong.json()).message;
    const unknownMessage = (await unknown.json()).message;
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongMessage).toBe(GENERIC_LOGIN_ERROR);
    expect(unknownMessage).toBe(GENERIC_LOGIN_ERROR);
  });
});
