/**
 * Next.js/standalone composition root. The custom server also calls this
 * setup, while this hook covers route execution in a platform-managed
 * runtime where server.ts is not the entrypoint.
 */
export async function register() {
  // `instrumentation.ts` is also bundled for the Edge runtime. The
  // diagnostics-channel adapter is intentionally Node-only, so never import
  // it while Next is preparing an Edge bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configureSearchObservability } =
    await import("./src/backend/observability/search-observability-composition");
  configureSearchObservability();
}
