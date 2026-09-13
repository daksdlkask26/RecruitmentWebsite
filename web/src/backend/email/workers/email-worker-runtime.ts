import "server-only";
import { prisma } from "@/backend/database/prisma";
import { DueOutboxProcessor } from "./due-outbox-processor";
import { RecruitmentNotificationWorkProcessor } from "./recruitment-notification-work";
const emailProcessor = new DueOutboxProcessor();
const recruitmentProcessor = new RecruitmentNotificationWorkProcessor();
let shutdownPromise: Promise<void> | null = null;
function shutdown(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    emailProcessor.stop();
    recruitmentProcessor.stop();
    try {
      await prisma.$disconnect();
    } finally {
      process.exitCode = exitCode;
    }
  })();
  return shutdownPromise;
}

function requestShutdown(exitCode: number) {
  void shutdown(exitCode).then(
    () => process.exit(process.exitCode ?? exitCode),
    () => process.exit(1),
  );
}

process.once("SIGINT", () => requestShutdown(0));
process.once("SIGTERM", () => requestShutdown(0));
if (process.platform === "win32") {
  process.once("SIGBREAK", () => requestShutdown(0));
}

Promise.all([emailProcessor.run(), recruitmentProcessor.run()])
  .then(() => shutdown())
  .catch(async () => {
    await shutdown(1);
    process.exit(1);
  });
