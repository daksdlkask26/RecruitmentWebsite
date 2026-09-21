import { createServer } from "node:http";
import nextEnv from "@next/env";
import next from "next";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), false);

const hostname = process.env.HOSTNAME ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const internalShellHeader = "x-smarthire-internal-shell";
const app = next({
  dev: false,
  hostname,
  port,
  distDir: process.env.PHASE5_NEXT_DIST_DIR ?? ".next",
});
const handle = app.getRequestHandler();

function expectedHost(origin, fallback) {
  return new URL(origin ?? fallback).host.toLowerCase();
}

function routeProductShell(request) {
  delete request.headers[internalShellHeader];
  const host = request.headers.host?.toLowerCase() ?? "";
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${host || "localhost"}`,
  );
  const pathname = requestUrl.pathname;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/admin-console" ||
    pathname.startsWith("/admin-console/") ||
    pathname === "/recruiter-entitlement" ||
    pathname.startsWith("/recruiter-entitlement/")
  )
    return;
  const adminHost = expectedHost(
    process.env.ADMIN_ORIGIN,
    "http://console.admin.localhost:3001",
  );
  const recruiterHost = expectedHost(
    process.env.RECRUITER_ORIGIN,
    "http://console.recruiter.localhost:3001",
  );
  const shell =
    host === adminHost
      ? { name: "admin", route: "/admin-console" }
      : host === recruiterHost
        ? { name: "recruiter", route: "/recruiter-entitlement" }
        : null;
  if (!shell) return;
  request.headers[internalShellHeader] = shell.name;
  request.url = `${shell.route}${pathname === "/" ? "" : pathname}${requestUrl.search}`;
}

await app.prepare();
const { attachSocketIoChatGateway } =
  await import("../src/backend/messaging/realtime/socket-io-chat-gateway.ts");
const server = createServer((request, response) => {
  routeProductShell(request);
  return handle(request, response);
});
const chat = attachSocketIoChatGateway(server);
let closing;
const close = () => {
  if (closing) return closing;
  closing = new Promise((resolveClose) => chat.close(() => resolveClose()))
    .then(() => app.close())
    .then(() => process.exit(0));
  return closing;
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
server.on("error", (error) => {
  console.error("Phase 6A production-like server failed", error);
  process.exitCode = 1;
});
server.listen(port, hostname, () => {
  console.info(`SmartHire ready at http://${hostname}:${port}`);
});
