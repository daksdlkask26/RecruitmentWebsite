import "server-only";

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { io as createClient } from "socket.io-client";

const envFile = process.env.CF004_ENV_FILE
  ? resolve(process.env.CF004_ENV_FILE)
  : resolve(process.cwd(), "../candidate-first-live.env");
if (existsSync(envFile)) {
  Object.assign(process.env, parse(readFileSync(envFile, "utf8")));
}

process.env.MESSAGING_REALTIME_ENABLED = "true";
process.env.MESSAGING_SOCKET_PATH = "/chat";

const { attachSocketIoChatGateway } =
  await import("@/backend/messaging/realtime/socket-io-chat-gateway");
const { MessagingPresenceRegistry } =
  await import("@/backend/messaging/realtime/messaging-presence-registry");
const { MessagingSocketRegistry } =
  await import("@/backend/messaging/realtime/messaging-socket-registry");

const widths = [1, 10, 40, 100];
const repetitions = Number.parseInt(
  process.env.CF004_REALTIME_REPETITIONS ?? "3",
  10,
);
const timeoutMs = 10_000;

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return Number(sorted[index].toFixed(2));
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function eventually(predicate, label, limitMs = timeoutMs) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function once(socket, event, limitMs = timeoutMs) {
  return new Promise((resolveEvent, rejectEvent) => {
    const timer = setTimeout(() => {
      rejectEvent(new Error(`Timed out waiting for ${event}`));
    }, limitMs);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolveEvent(value);
    });
  });
}

function createRepositories(width, runId, counters) {
  const candidateId = `${runId}-candidate`;
  const recruiterId = `${runId}-recruiter`;
  const conversationIds = Array.from(
    { length: width },
    (_, index) => `${runId}-conversation-${index + 1}`,
  );
  const accessFor = (conversationId, userId) => {
    if (!conversationIds.includes(conversationId)) return null;
    if (userId !== candidateId && userId !== recruiterId) return null;
    return {
      id: conversationId,
      participantLowId: [candidateId, recruiterId].sort()[0],
      participantHighId: [candidateId, recruiterId].sort()[1],
      contextType: "PROFESSIONAL_CONNECTION",
      contextReference: `${runId}-connection-${conversationId}`,
      applicationId: null,
      companyId: null,
      professionalConnectionId: `${runId}-connection-${conversationId}`,
      lastMessageSequence: null,
      archivedAt: null,
    };
  };
  const conversations = {
    findAccess: async (conversationId, userId) => {
      counters.findAccess += 1;
      return accessFor(conversationId, userId);
    },
    listAuthorizedConversationIds: async (userId) => {
      counters.listAuthorized += 1;
      return userId === candidateId || userId === recruiterId
        ? conversationIds
        : [];
    },
    open: async () => ({ conversationId: conversationIds[0], created: false }),
  };
  const eligibility = {
    canMessage: async () => {
      counters.canMessage += 1;
      return true;
    },
    authorizeContext: async (input) => {
      counters.authorizeContext += 1;
      return {
        type: input.type,
        reference: input.reference,
        professionalConnectionId: input.reference,
        label: "Realtime load-test conversation",
        companyName: null,
        jobTitle: null,
      };
    },
  };
  const blocks = {
    isEitherDirectionBlocked: async () => {
      counters.blockChecks += 1;
      return false;
    },
  };
  const messages = {
    accept: async (input) => {
      counters.accept += 1;
      return {
        deduplicated: false,
        message: {
          id: `${runId}-message-${counters.accept}`,
          conversationId: input.conversationId,
          sequence: counters.accept,
          senderId: input.senderId,
          content: input.content,
          createdAt: input.now,
        },
      };
    },
  };
  return {
    candidateId,
    recruiterId,
    conversationIds,
    conversations,
    eligibility,
    blocks,
    messages,
  };
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function runMeasurement(width, repetition) {
  const runId = `cf004-realtime-${width}-${repetition}-${Date.now()}`;
  const counters = {
    listAuthorized: 0,
    findAccess: 0,
    authorizeContext: 0,
    blockChecks: 0,
    canMessage: 0,
    accept: 0,
  };
  const transitions = [];
  const deps = createRepositories(width, runId, counters);
  const registry = new MessagingSocketRegistry();
  const presence = new MessagingPresenceRegistry(25, (event) => {
    transitions.push(event);
  });
  const server = createServer();
  const gateway = attachSocketIoChatGateway(server, {
    authenticate: async (headers) => {
      const userId = headers.get("x-test-user");
      return userId && [deps.candidateId, deps.recruiterId].includes(userId)
        ? { userId, sessionId: `${runId}-session-${userId}` }
        : null;
    },
    ...deps,
    registry,
    presence,
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing realtime test address");
  const url = `http://127.0.0.1:${address.port}/chat`;
  const client = (userId) =>
    createClient(url, {
      path: "/chat",
      transports: ["websocket"],
      extraHeaders: { "x-test-user": userId },
      reconnection: false,
    });
  const connectOne = async (userId) => {
    const started = nowMs();
    const socket = client(userId);
    await once(socket, "connect");
    return { socket, latencyMs: nowMs() - started };
  };
  let candidate;
  let recruiter;
  const beforeHeap = process.memoryUsage().heapUsed;
  try {
    const connected = await Promise.all([
      connectOne(deps.candidateId),
      connectOne(deps.recruiterId),
    ]);
    [candidate, recruiter] = connected;
    await eventually(
      () =>
        registry.conversationIdsForSocket(candidate.socket.id).size === width &&
        registry.conversationIdsForSocket(recruiter.socket.id).size === width,
      `${width} authorized conversation rooms`,
    );
    const joinedAt = nowMs();
    const delivered = once(recruiter.socket, "message:new");
    const acknowledged = await candidate.socket.emitWithAck("message:send", {
      conversationId: deps.conversationIds[0],
      clientOperationId: crypto.randomUUID(),
      content: `realtime probe ${width}`,
    });
    let event;
    try {
      event = await delivered;
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ack=${JSON.stringify(acknowledged)}; rooms=${JSON.stringify(
          {
            candidate: registry.conversationIdsForSocket(candidate.socket.id)
              .size,
            recruiter: registry.conversationIdsForSocket(recruiter.socket.id)
              .size,
          },
        )}; repositoryCalls=${JSON.stringify(counters)}`,
        { cause: error },
      );
    }
    const deliveryMs = nowMs() - joinedAt;
    if (
      !acknowledged?.ok ||
      event?.message?.content !== `realtime probe ${width}`
    ) {
      throw new Error("Realtime message delivery assertion failed");
    }
    candidate.socket.disconnect();
    recruiter.socket.disconnect();
    await sleep(60);
    const offlineTransitions = transitions.filter(
      (item) => item.presence === "OFFLINE",
    ).length;
    const reconnectStarted = nowMs();
    const reconnected = await Promise.all([
      connectOne(deps.candidateId),
      connectOne(deps.recruiterId),
    ]);
    const reconnectMs = nowMs() - reconnectStarted;
    await eventually(
      () =>
        registry.conversationIdsForSocket(reconnected[0].socket.id).size ===
          width &&
        registry.conversationIdsForSocket(reconnected[1].socket.id).size ===
          width,
      `${width} rooms after reconnect`,
    );
    reconnected[0].socket.disconnect();
    reconnected[1].socket.disconnect();
    await sleep(60);
    return {
      width,
      repetition,
      expectedSockets: 2,
      connectedSockets: 2,
      expectedRoomsPerSocket: width,
      roomsPerSocket: width,
      connectLatencyMs: {
        candidate: Number(connected[0].latencyMs.toFixed(2)),
        recruiter: Number(connected[1].latencyMs.toFixed(2)),
      },
      reconnectLatencyMs: Number(reconnectMs.toFixed(2)),
      messageDeliveryMs: Number(deliveryMs.toFixed(2)),
      presenceOnlineTransitions: transitions.filter(
        (item) => item.presence === "ONLINE",
      ).length,
      presenceOfflineTransitions: offlineTransitions,
      repositoryCalls: counters,
      heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap,
      status: offlineTransitions >= 2 ? "PASS" : "WARN",
    };
  } finally {
    candidate?.socket.disconnect();
    recruiter?.socket.disconnect();
    await new Promise((resolveClose) => gateway.close(() => resolveClose()));
    await closeServer(server);
  }
}

const startedAt = new Date().toISOString();
const results = [];
const errors = [];
for (const width of widths) {
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    try {
      results.push(await runMeasurement(width, repetition));
    } catch (error) {
      errors.push({
        width,
        repetition,
        error: error instanceof Error ? error.message : String(error),
        status: "FAIL",
      });
    }
  }
}

const byWidth = widths.map((width) => {
  const rows = results.filter((row) => row.width === width);
  const status =
    rows.length === repetitions && rows.every((row) => row.status === "PASS")
      ? "PASS"
      : "FAIL";
  return {
    width,
    repetitions: rows.length,
    status,
    connectLatencyMsP50: percentile(
      rows.flatMap((row) => [
        row.connectLatencyMs.candidate,
        row.connectLatencyMs.recruiter,
      ]),
      0.5,
    ),
    connectLatencyMsP95: percentile(
      rows.flatMap((row) => [
        row.connectLatencyMs.candidate,
        row.connectLatencyMs.recruiter,
      ]),
      0.95,
    ),
    reconnectLatencyMsP50: percentile(
      rows.map((row) => row.reconnectLatencyMs),
      0.5,
    ),
    reconnectLatencyMsP95: percentile(
      rows.map((row) => row.reconnectLatencyMs),
      0.95,
    ),
    messageDeliveryMsP50: percentile(
      rows.map((row) => row.messageDeliveryMs),
      0.5,
    ),
    messageDeliveryMsP95: percentile(
      rows.map((row) => row.messageDeliveryMs),
      0.95,
    ),
    maxRoomsPerSocket: Math.max(0, ...rows.map((row) => row.roomsPerSocket)),
    maxHeapDeltaBytes: Math.max(0, ...rows.map((row) => row.heapDeltaBytes)),
    maxRepositoryCalls: rows.length
      ? Math.max(...rows.map((row) => row.repositoryCalls.findAccess))
      : null,
  };
});

const report = {
  schema: "candidate-first-realtime-v1",
  startedAt,
  completedAt: new Date().toISOString(),
  environment: {
    transport: "websocket",
    socketPath: "/chat",
    realSocketIoGateway: true,
    repositoryMode: "in-memory-contract-double",
    databaseMutations: false,
    repetitions,
  },
  acceptance: {
    widths,
    eachWidthRequires: [
      "two authenticated sockets connect",
      "each socket is auto-joined to every authorized conversation room",
      "message acknowledgement and recipient delivery succeed",
      "disconnect/reconnect restores all rooms",
      "presence transitions include online and offline",
    ],
  },
  summary: {
    totalMeasurements: results.length,
    failedMeasurements: errors.length,
    passedWidths: byWidth.filter((row) => row.status === "PASS").length,
    status:
      errors.length === 0 && byWidth.every((row) => row.status === "PASS")
        ? "PASS"
        : "FAIL",
  },
  byWidth,
  raw: results,
  errors,
  limitations: [
    "This stress probe uses the production Socket.IO gateway and the repository interfaces with an in-memory contract double, so it isolates transport, authorization and room fan-out overhead without writing application data.",
    "Database-backed query latency and cross-process adapter behavior require a separate production-like load test; this report does not claim those properties.",
  ],
};

const reportFile = process.env.CF004_REPORT_FILE
  ? resolve(process.env.CF004_REPORT_FILE)
  : resolve(
      process.cwd(),
      "../docs/audits/candidate-first/pre-phase/evidence/cf004-realtime.json",
    );
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.summary.status !== "PASS") process.exitCode = 1;
