import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createServer } from "node:http";
import { config as loadEnvironment } from "dotenv";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/backend/generated/prisma/client.ts";
import { io as createClient } from "socket.io-client";

const envFile = process.env.PHASE6A_ENV_FILE
  ? resolve(process.cwd(), process.env.PHASE6A_ENV_FILE)
  : resolve(process.cwd(), ".env.local");
loadEnvironment({ path: envFile, quiet: true });

const { assertTestDatabaseEnvironment } =
  await import("../tests/helpers/test-database-guard.ts");
assertTestDatabaseEnvironment();

const widths = [1, 10, 40, 100];
const repetitions = Number.parseInt(
  process.env.PHASE6A_DB_REPETITIONS ?? "3",
  10,
);
const timeoutMs = 15_000;
const databaseName = (() => {
  try {
    return decodeURIComponent(
      new URL(process.env.DATABASE_URL ?? "").pathname.slice(1),
    );
  } catch {
    return "unknown-test-database";
  }
})();
const reportPath = resolve(
  process.cwd(),
  "..",
  process.env.PHASE6A_REPORT_FILE ??
    "docs/audits/candidate-first/phase-6a/evidence/cf602-db.json",
);

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return Number(
    ordered[
      Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)
    ].toFixed(2),
  );
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function eventually(predicate, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function once(socket, event) {
  return new Promise((resolveEvent, rejectEvent) => {
    const timer = setTimeout(() => {
      rejectEvent(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolveEvent(value);
    });
  });
}

function classifyQuery(query) {
  const normalized = String(query).replace(/\s+/gu, " ").toUpperCase();
  if (normalized.includes('"MESSAGINGCONVERSATIONPARTICIPANT"')) {
    return "participant-list";
  }
  if (normalized.includes('"MESSAGINGCONVERSATION"')) {
    return "conversation-access";
  }
  if (normalized.includes('"JOBAPPLICATION"')) return "context-application";
  if (normalized.includes('"COMPANYMEMBERSHIP"')) return "context-membership";
  if (normalized.includes('"USERMESSAGINGBLOCK"')) return "block";
  return "other";
}

function wrapPoolWaitMeasurement(pool, poolWaits) {
  const originalConnect = pool.connect.bind(pool);
  pool.connect = (...args) => {
    const started = performance.now();
    if (typeof args[0] === "function") {
      const callback = args[0];
      return originalConnect((error, client, release) => {
        if (!error) poolWaits.push(performance.now() - started);
        callback(error, client, release);
      });
    }
    return originalConnect(...args).then((client) => {
      poolWaits.push(performance.now() - started);
      return client;
    });
  };
}

async function seedConversations(db, fixture, count, now) {
  const prefix = `${fixture.prefix}-phase6a`;
  const participantLowId = [fixture.candidateId, fixture.recruiterId].sort()[0];
  const participantHighId = [
    fixture.candidateId,
    fixture.recruiterId,
  ].sort()[1];
  const jobs = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-job-${index + 1}`,
    companyId: fixture.companyId,
    slug: `${prefix}-job-${index + 1}`,
    title: `Phase 6A probe job ${index + 1}`,
    normalizedTitle: `phase 6a probe job ${index + 1}`,
    summary: "Task-owned performance fixture.",
    description: "Task-owned performance fixture.",
    responsibilities: "Task-owned performance fixture.",
    requirements: "Task-owned performance fixture.",
    location: "Ho Chi Minh City",
    normalizedLocation: "ho chi minh city",
    employmentType: "FULL_TIME",
    experienceLevel: "ENTRY",
    workArrangement: "HYBRID",
    searchDocumentNormalized: `phase 6a probe job ${index + 1}`,
    status: "ACTIVE",
    approvedAt: now,
    publishedAt: now,
  }));
  const cvs = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-cv-${index + 1}`,
    candidateUserId: fixture.candidateId,
    displayName: `Phase 6A probe CV ${index + 1}`,
    fileName: `phase-6a-${index + 1}.pdf`,
    mimeType: "application/pdf",
    byteSize: 128,
    storageKey: `${prefix}/phase-6a-${index + 1}.pdf`,
    checksumSha256: index.toString(16).padStart(64, "0"),
    confirmedAt: now,
  }));
  const applications = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-application-${index + 1}`,
    candidateUserId: fixture.candidateId,
    jobPostingId: jobs[index].id,
    selectedCvId: cvs[index].id,
    profileSnapshot: {},
    cvSnapshot: {},
    jobSnapshot: {},
    consentVersion: "phase6a-v1",
    consentedAt: now,
    idempotencyKey: `${prefix}-idempotency-${index + 1}`,
    submissionBindingDigest: index.toString(16).padStart(64, "0"),
    submittedAt: now,
  }));
  const conversations = applications.map((application, index) => ({
    id: `${prefix}-conversation-${index + 1}`,
    participantLowId,
    participantHighId,
    contextType: "APPLICATION",
    contextReference: application.id,
    applicationId: application.id,
    companyId: fixture.companyId,
    createdAt: now,
  }));
  const participants = conversations.flatMap((conversation) => [
    {
      conversationId: conversation.id,
      userId: participantLowId,
      createdAt: now,
    },
    {
      conversationId: conversation.id,
      userId: participantHighId,
      createdAt: now,
    },
  ]);
  await db.$transaction([
    db.jobPosting.createMany({ data: jobs }),
    db.candidateCv.createMany({ data: cvs }),
    db.jobApplication.createMany({ data: applications }),
    db.messagingConversation.createMany({ data: conversations }),
    db.messagingConversationParticipant.createMany({ data: participants }),
  ]);
  return { prefix, conversationIds: conversations.map(({ id }) => id) };
}

async function runMeasurement({
  deps,
  width,
  repetition,
  queryEvents,
  poolWaits,
}) {
  queryEvents.length = 0;
  poolWaits.length = 0;
  const registry = new deps.MessagingSocketRegistry();
  const presence = new deps.MessagingPresenceRegistry(0, () => undefined);
  const server = createServer();
  const gateway = deps.attachSocketIoChatGateway(server, {
    authenticate: async (headers) => {
      const userId = headers.get("x-test-user");
      return userId &&
        [deps.fixture.candidateId, deps.fixture.recruiterId].includes(userId)
        ? { userId, sessionId: `${deps.runId}-session-${userId}` }
        : null;
    },
    conversations: deps.conversations,
    eligibility: deps.eligibility,
    blocks: deps.blocks,
    messages: deps.messages,
    registry,
    presence,
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  const url = `http://127.0.0.1:${address.port}/chat`;
  const client = (userId) =>
    createClient(url, {
      path: "/chat",
      transports: ["websocket"],
      extraHeaders: { "x-test-user": userId },
      reconnection: false,
    });
  const readyFor = (socket, userId) => presence.isOnline(userId);
  const connectOne = async (userId) => {
    const started = nowMs();
    const socket = client(userId);
    await once(socket, "connect");
    await eventually(
      () => readyFor(socket, userId),
      `lazy socket ready for ${width}`,
    );
    return { socket, readyMs: nowMs() - started };
  };
  let candidate;
  let recruiter;
  const started = nowMs();
  try {
    [candidate, recruiter] = await Promise.all([
      connectOne(deps.fixture.candidateId),
      connectOne(deps.fixture.recruiterId),
    ]);
    const roomsBeforeReconnect = {
      candidate: registry.conversationIdsForSocket(candidate.socket.id).size,
      recruiter: registry.conversationIdsForSocket(recruiter.socket.id).size,
    };
    candidate.socket.disconnect();
    recruiter.socket.disconnect();
    await sleep(50);
    const reconnectStarted = nowMs();
    const reconnected = await Promise.all([
      connectOne(deps.fixture.candidateId),
      connectOne(deps.fixture.recruiterId),
    ]);
    const reconnectMs = nowMs() - reconnectStarted;
    const roomsAfterReconnect = {
      candidate: registry.conversationIdsForSocket(reconnected[0].socket.id)
        .size,
      recruiter: registry.conversationIdsForSocket(reconnected[1].socket.id)
        .size,
    };
    reconnected[0].socket.disconnect();
    reconnected[1].socket.disconnect();
    await sleep(50);
    const sqlGroups = Object.fromEntries(
      [
        "participant-list",
        "conversation-access",
        "context-application",
        "context-membership",
        "block",
        "other",
      ].map((classification) => [
        classification,
        queryEvents.filter((event) => event.classification === classification)
          .length,
      ]),
    );
    const readyLatencies = [candidate.readyMs, recruiter.readyMs];
    return {
      width,
      repetition,
      status: "PASS",
      durationMs: Number((nowMs() - started).toFixed(2)),
      socketReadyMs: readyLatencies.map((value) => Number(value.toFixed(2))),
      reconnectMs: Number(reconnectMs.toFixed(2)),
      roomsBeforeReconnect,
      roomsAfterReconnect,
      sqlQueryCount: queryEvents.length,
      sqlQueryGroups: sqlGroups,
      sqlQueryDurationMsP95: percentile(
        queryEvents.map((event) => event.durationMs),
        0.95,
      ),
      poolWaitMsP95: percentile(poolWaits, 0.95),
    };
  } finally {
    candidate?.socket.disconnect();
    recruiter?.socket.disconnect();
    await new Promise((resolveClose) => gateway.close(() => resolveClose()));
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  }
}

const poolWaits = [];
const queryEvents = [];
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  application_name: "candidate-first-phase6a-lazy",
});
wrapPoolWaitMeasurement(pool, poolWaits);
const db = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: [{ emit: "event", level: "query" }],
  transactionOptions: { maxWait: 5_000, timeout: 15_000 },
});
db.$on("query", (event) => {
  queryEvents.push({
    durationMs: Number(event.duration),
    classification: classifyQuery(event.query),
  });
});
globalThis.prisma = db;

const [
  gatewayModule,
  registryModule,
  presenceModule,
  conversationModule,
  blockModule,
  eligibilityModule,
  applicationEligibilityModule,
  connectionEligibilityModule,
  messageModule,
  fixtureModule,
] = await Promise.all([
  import("../src/backend/messaging/realtime/socket-io-chat-gateway.ts"),
  import("../src/backend/messaging/realtime/messaging-socket-registry.ts"),
  import("../src/backend/messaging/realtime/messaging-presence-registry.ts"),
  import("../src/backend/repositories/messaging/prisma-messaging-conversation-repository.ts"),
  import("../src/backend/repositories/messaging/prisma-user-messaging-block-repository.ts"),
  import("../src/backend/messaging/authorization/messaging-eligibility-service.ts"),
  import("../src/backend/messaging/authorization/application-messaging-eligibility.ts"),
  import("../src/backend/messaging/authorization/professional-connection-eligibility.ts"),
  import("../src/backend/repositories/messaging/prisma-messaging-message-repository.ts"),
  import("../tests/backend/integration/messaging/fixtures.ts"),
]);

const fixture = await fixtureModule.seedMessagingFixture();
await seedConversations(db, fixture, 100, new Date());
const conversations =
  new conversationModule.PrismaMessagingConversationRepository(db);
const blocks = new blockModule.PrismaUserMessagingBlockRepository(db);
const eligibility = new eligibilityModule.MessagingEligibilityService(
  new applicationEligibilityModule.ApplicationMessagingEligibility(db),
  new connectionEligibilityModule.ProfessionalConnectionEligibility(db),
);
const messages = new messageModule.PrismaMessagingMessageRepository(db);
const runId = `phase6a-${randomUUID()}`;
const deps = {
  attachSocketIoChatGateway: gatewayModule.attachSocketIoChatGateway,
  MessagingSocketRegistry: registryModule.MessagingSocketRegistry,
  MessagingPresenceRegistry: presenceModule.MessagingPresenceRegistry,
  conversations,
  blocks,
  eligibility,
  messages,
  fixture,
  runId,
};

const startedAt = new Date().toISOString();
const results = [];
const errors = [];
try {
  for (const width of widths) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      try {
        results.push(
          await runMeasurement({
            db,
            deps,
            width,
            repetition,
            queryEvents,
            poolWaits,
          }),
        );
      } catch (error) {
        errors.push({
          width,
          repetition,
          status: "FAIL",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const byWidth = widths.map((width) => {
    const rows = results.filter((row) => row.width === width);
    const ready = rows.flatMap((row) => row.socketReadyMs);
    const reconnect = rows.map((row) => row.reconnectMs);
    return {
      width,
      repetitions: rows.length,
      status:
        rows.length === repetitions &&
        rows.every((row) => row.status === "PASS")
          ? "PASS"
          : "FAIL",
      sqlQueryCount: rows.map((row) => row.sqlQueryCount),
      sqlQueryCountP95: percentile(
        rows.map((row) => row.sqlQueryCount),
        0.95,
      ),
      sqlQueryGroups: rows.map((row) => row.sqlQueryGroups),
      socketReadyP50Ms: percentile(ready, 0.5),
      socketReadyP95Ms: percentile(ready, 0.95),
      reconnectP50Ms: percentile(reconnect, 0.5),
      reconnectP95Ms: percentile(reconnect, 0.95),
      roomsPerSocket: rows.map((row) => row.roomsBeforeReconnect.candidate),
      errorRate: (repetitions - rows.length) / repetitions,
    };
  });
  const report = {
    schema: "candidate-first-phase6a-db-realtime-v1",
    startedAt,
    completedAt: new Date().toISOString(),
    source: {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirtyWorktree: true,
      strategy: "lazy",
    },
    environment: {
      cwd: process.cwd(),
      node: process.version,
      database: databaseName,
      databaseGuard: "isolated-test-database",
      transport: "websocket",
      socketPath: "/chat",
      repetitions,
      datasetConversations: 100,
      fixtureNamespace: "task-owned-redacted",
    },
    fixedThresholds: {
      socketReadyP95MsAt100: 2_000,
      errorRate: 0,
      roomsPerSocket: 0,
    },
    summary: {
      status:
        errors.length === 0 && byWidth.every((row) => row.status === "PASS")
          ? "PASS"
          : "FAIL",
      failedMeasurements: errors.length,
      widths,
    },
    byWidth,
    raw: results,
    errors,
    limitations: [
      "This probe measures the real PostgreSQL-backed repositories and production Socket.IO gateway in one process; it does not claim multi-instance behavior.",
      "The historical pre-change report was captured before the eager initialization compatibility path was removed; this script intentionally measures only the selected lazy strategy.",
    ],
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.status !== "PASS") process.exitCode = 1;
} finally {
  await fixtureModule.cleanupMessagingFixture(fixture.prefix);
  await db.$disconnect();
  await pool.end();
}
