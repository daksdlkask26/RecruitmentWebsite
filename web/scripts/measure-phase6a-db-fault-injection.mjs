import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
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

const timeoutMs = 10_000;
const reportPath = resolve(
  process.cwd(),
  "..",
  process.env.PHASE6A_REPORT_FILE ??
    "docs/audits/candidate-first/phase-6a/evidence/cf604-db-fault-injection.json",
);
const databaseName = (() => {
  try {
    return decodeURIComponent(
      new URL(process.env.DATABASE_URL ?? "").pathname.slice(1),
    );
  } catch {
    return "unknown-test-database";
  }
})();

const sleep = (ms) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function eventually(predicate, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function connectResult(socket) {
  return new Promise((resolveResult, rejectResult) => {
    const timer = setTimeout(
      () => rejectResult(new Error("Timed out waiting for connect result")),
      timeoutMs,
    );
    socket.once("connect", () => {
      clearTimeout(timer);
      resolveResult({ ok: true, error: null });
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      resolveResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolveAck, rejectAck) => {
    const timer = setTimeout(
      () =>
        rejectAck(new Error(`Timed out waiting for ${event} acknowledgement`)),
      timeoutMs,
    );
    socket.emit(event, payload, (value) => {
      clearTimeout(timer);
      resolveAck(value);
    });
  });
}

async function closeIo(io) {
  await new Promise((resolveClose) => io.close(() => resolveClose()));
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

function errorMessage(value) {
  return typeof value === "string"
    ? value
    : value instanceof Error
      ? value.message
      : String(value);
}

function safeClientResponse(value) {
  if (value === undefined) return true;
  const serialized = JSON.stringify(value);
  return (
    !serialized.includes("PHASE6A_DB_FAULT") &&
    !serialized.includes("DATABASE_URL") &&
    !serialized.includes("postgres")
  );
}

function residue({
  registry,
  presence,
  gateway,
  fixture,
  runId,
  conversationId,
}) {
  const candidateSession = `${runId}-session-candidate`;
  const namespace = gateway.of("/chat");
  return {
    socketIdentityCount: registry.socketIdsForUser(fixture.candidateId).size,
    sessionMembershipCount: registry.socketIdsForSession(candidateSession).size,
    conversationMembershipCount:
      registry.socketIdsForConversation(conversationId).size,
    conversationRoomCount:
      namespace.adapter.rooms.get(`conversation:${conversationId}`)?.size ?? 0,
    candidateOnline: presence.isOnline(fixture.candidateId),
  };
}

function noResidue(value) {
  return (
    value.socketIdentityCount === 0 &&
    value.sessionMembershipCount === 0 &&
    value.conversationMembershipCount === 0 &&
    value.conversationRoomCount === 0 &&
    value.candidateOnline === false
  );
}

async function runCase({
  mode,
  operation,
  db,
  fixture,
  realConversations,
  realEligibility,
  realBlocks,
  messages,
  gatewayModule,
  registryModule,
  presenceModule,
  runId,
  conversationId,
}) {
  const control = { mode, injected: false, realPathCompleted: false };
  const registry = new registryModule.MessagingSocketRegistry();
  const presenceTransitions = [];
  const presence = new presenceModule.MessagingPresenceRegistry(0, (event) =>
    presenceTransitions.push(event),
  );
  const unhandled = [];
  const onUnhandledRejection = (reason) => unhandled.push(errorMessage(reason));
  process.on("unhandledRejection", onUnhandledRejection);
  const server = createServer();
  const wrapReal = async (kind, action) => {
    const result = await action();
    control.realPathCompleted = true;
    if (control.mode === kind && !control.injected) {
      control.injected = true;
      throw new Error("PHASE6A_DB_FAULT");
    }
    return result;
  };
  const conversations = {
    ...realConversations,
    findAccess: (id, userId) =>
      wrapReal("conversation-access-lookup", () =>
        realConversations.findAccess(id, userId),
      ),
  };
  const eligibility = {
    ...realEligibility,
    authorizeContext: (input) =>
      wrapReal("context-authorization", () =>
        realEligibility.authorizeContext(input),
      ),
  };
  const blocks = {
    ...realBlocks,
    isEitherDirectionBlocked: (userA, userB) =>
      wrapReal("block-state-lookup", () =>
        realBlocks.isEitherDirectionBlocked(userA, userB),
      ),
  };
  const authenticate = async (headers) => {
    await db.$queryRaw`SELECT 1`;
    if (control.mode === "initial-socket-authorization" && !control.injected) {
      control.injected = true;
      control.realPathCompleted = true;
      throw new Error("PHASE6A_DB_FAULT");
    }
    const userId = headers.get("x-phase6a-user");
    if (![fixture.candidateId, fixture.recruiterId].includes(userId))
      return null;
    return {
      userId,
      sessionId: `${runId}-session-${userId === fixture.candidateId ? "candidate" : "recruiter"}`,
    };
  };
  const io = gatewayModule.attachSocketIoChatGateway(server, {
    authenticate,
    conversations,
    eligibility,
    blocks,
    messages,
    registry,
    presence,
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fault harness address");
  const url = `http://127.0.0.1:${address.port}/chat`;
  const events = [];
  let socket;
  let retryResult;
  let failedJoin;
  let successfulJoin;
  let initialConnect;
  let residueAfterFailure;
  let residueAfterCleanup;
  try {
    const createSocket = () => {
      const next = createClient(url, {
        path: "/chat",
        transports: ["websocket"],
        extraHeaders: { "x-phase6a-user": fixture.candidateId },
        reconnection: false,
      });
      for (const event of [
        "presence:changed",
        "messaging:changed",
        "message:new",
        "notification:new",
        "notification:changed",
        "conversation:access_revoked",
      ]) {
        next.on(event, (payload) => events.push({ event, payload }));
      }
      return next;
    };
    socket = createSocket();
    initialConnect = await connectResult(socket);
    if (mode === "initial-socket-authorization") {
      if (initialConnect.ok)
        throw new Error("Initial fault did not reject socket");
      if (initialConnect.error !== "AUTH_REQUIRED") {
        throw new Error(`Unsafe initial error: ${initialConnect.error}`);
      }
      residueAfterFailure = residue({
        registry,
        presence,
        gateway: io,
        fixture,
        runId,
        conversationId,
      });
      socket.close();
      control.mode = null;
      socket = createSocket();
      retryResult = await connectResult(socket);
      if (!retryResult.ok) throw new Error("Recovered reconnect was rejected");
      await eventually(
        () => presence.isOnline(fixture.candidateId),
        "recovered candidate presence",
      );
      socket.disconnect();
    } else {
      if (!initialConnect.ok) {
        throw new Error(
          `Unexpected initial connect error: ${initialConnect.error}`,
        );
      }
      await eventually(
        () => presence.isOnline(fixture.candidateId),
        "candidate presence",
      );
      failedJoin = await emitAck(socket, "conversation:join", {
        conversationId,
      });
      if (!failedJoin || failedJoin.ok !== false) {
        throw new Error("Injected join fault did not fail closed");
      }
      if (!safeClientResponse(failedJoin)) {
        throw new Error("Private database detail reached the client");
      }
      residueAfterFailure = residue({
        registry,
        presence,
        gateway: io,
        fixture,
        runId,
        conversationId,
      });
      control.mode = null;
      successfulJoin = await emitAck(socket, "conversation:join", {
        conversationId,
      });
      if (!successfulJoin || successfulJoin.ok !== true) {
        throw new Error("Recovered explicit join was rejected");
      }
      retryResult = { ok: true };
      socket.disconnect();
    }
    await eventually(
      () =>
        noResidue(
          residue({
            registry,
            presence,
            gateway: io,
            fixture,
            runId,
            conversationId,
          }),
        ),
      "fault cleanup residue",
    );
    residueAfterCleanup = residue({
      registry,
      presence,
      gateway: io,
      fixture,
      runId,
      conversationId,
    });
    const expectedPresence =
      mode === "initial-socket-authorization"
        ? presenceTransitions.some(
            (event) =>
              event.userId === fixture.candidateId &&
              event.presence === "ONLINE",
          )
        : true;
    const status =
      control.injected &&
      control.realPathCompleted &&
      retryResult?.ok === true &&
      noResidue(residueAfterCleanup) &&
      unhandled.length === 0 &&
      expectedPresence &&
      events.length === 0
        ? "PASS"
        : "FAIL";
    return {
      faultPoint: mode,
      operation,
      status,
      injected: control.injected,
      realPostgresPathCompleted: control.realPathCompleted,
      initialConnect,
      failedJoin,
      retryResult,
      residueAfterFailure,
      residueAfterCleanup,
      presenceTransitions: presenceTransitions.map((event) => ({
        label: event.presence,
      })),
      unexpectedServerEvents: events.length,
      unhandledRejectionCount: unhandled.length,
      unhandledRejections: unhandled,
      safeClientErrors:
        safeClientResponse(initialConnect) &&
        safeClientResponse(failedJoin) &&
        safeClientResponse(retryResult),
    };
  } finally {
    socket?.disconnect();
    process.off("unhandledRejection", onUnhandledRejection);
    await closeIo(io);
    await closeServer(server);
  }
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  application_name: "candidate-first-phase6a-db-faults",
});
const db = new PrismaClient({
  adapter: new PrismaPg(pool),
  transactionOptions: { maxWait: 5_000, timeout: 15_000 },
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
const realConversations =
  new conversationModule.PrismaMessagingConversationRepository(db);
const realBlocks = new blockModule.PrismaUserMessagingBlockRepository(db);
const realEligibility = new eligibilityModule.MessagingEligibilityService(
  new applicationEligibilityModule.ApplicationMessagingEligibility(db),
  new connectionEligibilityModule.ProfessionalConnectionEligibility(db),
);
const messages = new messageModule.PrismaMessagingMessageRepository(db);
const opened = await realConversations.open({
  actorUserId: fixture.candidateId,
  targetUserId: fixture.recruiterId,
  context: {
    type: "PROFESSIONAL_CONNECTION",
    reference: fixture.connectionId,
    professionalConnectionId: fixture.connectionId,
    label: "Professional connection",
    companyName: null,
    jobTitle: null,
  },
  now: new Date(),
});
const runId = `phase6a-fault-${Math.random().toString(36).slice(2, 10)}`;
const cases = [
  {
    mode: "initial-socket-authorization",
    operation: "socket connect handshake",
  },
  {
    mode: "conversation-access-lookup",
    operation: "explicit conversation join",
  },
  {
    mode: "context-authorization",
    operation: "explicit conversation join",
  },
  {
    mode: "block-state-lookup",
    operation: "explicit conversation join",
  },
];
const startedAt = new Date().toISOString();
const rows = [];
try {
  for (const testCase of cases) {
    rows.push(
      await runCase({
        ...testCase,
        db,
        fixture,
        realConversations,
        realEligibility,
        realBlocks,
        messages,
        gatewayModule,
        registryModule,
        presenceModule,
        runId: `${runId}-${testCase.mode}`,
        conversationId: opened.conversationId,
      }),
    );
  }
} finally {
  await fixtureModule.cleanupMessagingFixture(fixture.prefix);
  await db.$disconnect();
  await pool.end();
}

const report = {
  schema: "candidate-first-phase6a-db-fault-injection-v1",
  startedAt,
  completedAt: new Date().toISOString(),
  source: {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirtyWorktree: true,
  },
  environment: {
    cwd: process.cwd(),
    node: process.version,
    database: databaseName,
    databaseGuard: "isolated-test-database",
    transport: "websocket",
    socketPath: "/chat",
    repositoryPath:
      "real Prisma PostgreSQL repositories; deterministic post-read fault controls",
    fixtureNamespace: "task-owned-redacted",
  },
  fixedAssertions: {
    failClosed: true,
    noStalePresenceOrRegistryResidue: true,
    cleanupIdempotent: true,
    safeRetryAfterRecovery: true,
    noUnhandledRejections: true,
    noUnauthorizedServerEvents: true,
    noPrivateClientErrorDetails: true,
  },
  summary: {
    status:
      rows.length === cases.length && rows.every((row) => row.status === "PASS")
        ? "PASS"
        : "FAIL",
    passed: rows.filter((row) => row.status === "PASS").length,
    failed: rows.filter((row) => row.status === "FAIL").length,
    total: rows.length,
  },
  rows,
  limitations: [
    "The deterministic fault is injected after the corresponding real PostgreSQL repository read (or real DB health query for handshake authentication); this preserves the production gateway and repository path while avoiding destructive database termination.",
    "The harness is single-process and does not claim multi-instance behavior.",
  ],
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.summary.status !== "PASS") process.exitCode = 1;
