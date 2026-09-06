import { resolve } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { config as loadEnvironment } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../src/backend/generated/prisma/client.ts";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });
const serverOnlyMarker = pathToFileURL(
  resolve(process.cwd(), "scripts/server-only-marker.mjs"),
).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnlyMarker, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { assertRequestedTestDatabase } = await import(
  "../../../helpers/test-database-guard.ts"
);
assertRequestedTestDatabase();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for admin E2E assertions");

const [query, id] = process.argv.slice(2);
if (!query || !id) throw new Error("Usage: e2e-prisma-query.mjs <query> <id>");

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

try {
  let result;
  if (query === "account") {
    const [account, works, singleSessionAudits, allSessionAudits] =
      await Promise.all([
        prisma.userAccount.findUniqueOrThrow({
          where: { id },
          include: { sessions: true },
        }),
        prisma.securityNotificationWork.findMany({
          where: { targetUserId: id },
          include: { emailOutbox: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.auditEvent.count({
          where: { targetId: id, action: "admin.session_revoked" },
        }),
        prisma.auditEvent.count({
          where: { targetId: id, action: "admin.sessions_revoked_all" },
        }),
      ]);
    result = { account, works, singleSessionAudits, allSessionAudits };
  } else if (query === "verification") {
    const [rows, request] = await Promise.all([
      prisma.emailOutbox.findMany({
        where: { verificationRequestId: id },
        orderBy: { createdAt: "asc" },
      }),
      prisma.recruiterVerificationRequest.findUnique({
        where: { id },
        include: { notifications: true, targetCompany: true },
      }),
    ]);
    const candidateIdentity = request
      ? await prisma.candidateIdentity.findUnique({
          where: { userId: request.applicantUserId },
        })
      : null;
    result = { rows, request, candidateIdentity };
  } else if (query === "membership") {
    const membership = await prisma.companyMembership.findUniqueOrThrow({
      where: { id },
      include: {
        company: true,
        user: { include: { candidateIdentity: true } },
      },
    });
    const [works, unrelated] = await Promise.all([
      prisma.securityNotificationWork.findMany({
        where: {
          idempotencyKey: {
            startsWith: `security-notification:membership:${id}:`,
          },
        },
        include: { emailOutbox: true },
      }),
      prisma.companyMembership.findMany({
        where: { userId: membership.userId, id: { not: membership.id } },
      }),
    ]);
    result = { membership, works, unrelated };
  } else {
    throw new Error(`Unsupported E2E Prisma query: ${query}`);
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
