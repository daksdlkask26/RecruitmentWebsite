import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import { prisma } from "../../src/backend/database/prisma.ts";

loadEnvironment({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const command = process.argv[2];
const encodedPayload = process.argv[3];
const payload = encodedPayload
  ? JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
  : null;

try {
  const {
    createCandidatePhase3BrowserFixture,
    deleteCandidatePhase3BrowserFixture,
  } = await import("./candidate-phase3-browser-fixture.ts");
  let result;
  if (command === "create") {
    const fixture = await createCandidatePhase3BrowserFixture(
      payload?.label ?? "browser",
    );
    result = {
      candidateEmail: fixture.candidateEmail,
      employerEmail: fixture.employerEmail,
      company: { id: fixture.company.id },
      userIds: fixture.userIds,
      suffix: fixture.suffix,
      companyIds: fixture.companyIds,
      companyTwoId: fixture.companyTwoId,
      companyThreeId: fixture.companyThreeId,
      applicationId: fixture.applicationId,
      activeJobId: fixture.activeJobId,
      ordinaryApplicationCount: fixture.ordinaryApplicationCount,
      teamApplicationCount: fixture.teamApplicationCount,
    };
  } else if (command === "delete") {
    if (!payload?.fixture) throw new Error("delete requires fixture");
    await deleteCandidatePhase3BrowserFixture(payload.fixture);
    result = { deleted: true };
  } else {
    throw new Error(`Unsupported Phase 3 E2E control command: ${command}`);
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
