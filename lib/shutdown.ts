import { closeDb } from "./db/client";
import { logEvent } from "./log";

const globalShutdown = globalThis as unknown as { __tokenburnShutdownRegistered?: boolean };

const CLOSE_TIMEOUT_MS = 10_000;

export function registerShutdownHandlers() {
  if (globalShutdown.__tokenburnShutdownRegistered) return;
  globalShutdown.__tokenburnShutdownRegistered = true;

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logEvent("info", "server.shutdown.begin", { signal });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS));
    try {
      await Promise.race([closeDb(), timeout]);
      logEvent("info", "server.shutdown.complete", { signal });
    } catch (error) {
      logEvent("error", "server.shutdown.failed", { signal, error });
    }
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
