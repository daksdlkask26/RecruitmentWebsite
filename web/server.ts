import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import next from "next";

const development = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const internalShellHeader = "x-smarthire-internal-shell";
loadEnvConfig(process.cwd(), development);
const requestedDevBundler = process.env.NEXT_DEV_BUNDLER?.trim().toLowerCase();
const useWebpack =
  development &&
  (requestedDevBundler === "webpack" ||
    (requestedDevBundler !== "turbopack" && process.platform === "win32"));
const app = next({
  dev: development,
  port,
  // Turbopack is the default in Next.js 16, but the Windows development
  // runtime currently cannot resolve its internal PostCSS bridge reliably.
  // Keep Webpack as the safe Windows default; NEXT_DEV_BUNDLER=turbopack can
  // still be used explicitly when that toolchain is available.
  ...(useWebpack ? { webpack: true } : {}),
  ...(development && requestedDevBundler === "turbopack"
    ? { turbopack: true }
    : {}),
});
const handle = app.getRequestHandler();

function expectedHost(origin: string | undefined, fallback: string) {
  return new URL(origin ?? fallback).host.toLowerCase();
}

function routeProductShell(request: Parameters<typeof handle>[0]) {
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

export async function start() {
  const { acquireNextOutputLock } =
    await import("./scripts/next-output-lock.mjs");
  const releaseNextOutputLock = await acquireNextOutputLock(
    development ? "next-development-server" : "next-production-server",
  );

  try {
    const { configureSearchObservability } = await import(
      "./src/backend/observability/search-observability-composition"
    );
    configureSearchObservability();
    const { attachSocketIoChatGateway } =
      await import("./src/backend/messaging/realtime/socket-io-chat-gateway");
    await app.prepare();
    const server = createServer((request, response) => {
      routeProductShell(request);
      return handle(request, response);
    });
    const chat = attachSocketIoChatGateway(server);
    const { ScoringWorkerRuntime } =
      await import("./src/backend/scoring/workers/scoring-worker-runtime");
    const { CandidateExportWorkerRuntime } =
      await import("./src/backend/exports/candidate-export-worker-runtime");
    const scoring = new ScoringWorkerRuntime();
    const candidateExports = new CandidateExportWorkerRuntime();
    scoring.start();
    candidateExports.start();
    server.on("error", (error) => {
      console.error("SmartHire HTTP server failed", error);
      process.exitCode = 1;
    });
    server.listen(port, hostname, () => {
      console.info(`SmartHire ready at http://${hostname}:${port}`);
    });

    let closing: Promise<void> | null = null;
    const close = () => {
      if (closing) return closing;
      scoring.stop();
      candidateExports.stop();
      closing = new Promise<void>((resolveClose, rejectClose) =>
        chat.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        }),
      )
        .then(() => app.close())
        .catch((error) => {
          console.error("SmartHire application shutdown failed", error);
          process.exitCode = 1;
        })
        .finally(releaseNextOutputLock);
      return closing;
    };
    const requestClose = () => {
      void close().finally(() => process.exit(process.exitCode ?? 0));
    };
    process.once("SIGINT", requestClose);
    process.once("SIGTERM", requestClose);
    return { close };
  } catch (error) {
    await releaseNextOutputLock();
    throw error;
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entrypoint === import.meta.url) {
  void start().catch((error) => {
    console.error("SmartHire startup failed", error);
    process.exit(1);
  });
}
