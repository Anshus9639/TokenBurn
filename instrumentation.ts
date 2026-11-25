/**
 * Next.js boot hook: validates required production configuration before serving traffic
 * and installs graceful shutdown handlers for the Node server.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { assertEnv } = await import("./lib/env");
  assertEnv();

  const { registerShutdownHandlers } = await import("./lib/shutdown");
  registerShutdownHandlers();
}
