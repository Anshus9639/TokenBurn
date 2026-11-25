import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { redactUrl, startEmbeddedPostgres } from "./pg-embed";

/**
 * End-to-end PostgreSQL verification. Every run starts from a clean cluster, so
 * counts can be compared one-to-one with the PGlite source database:
 *  1. start the embedded cluster (PostgreSQL 18.7, UTF8)
 *  2. copy the PGlite development database and compare counts/costs
 *  3. run the full test suite against PostgreSQL
 *  4. run the production build against PostgreSQL and exercise health, ingest,
 *     dedupe, recommendation mode and export auth
 *  5. stop the cluster, cold-copy its data directory, start the copy and confirm the data
 *
 * usage: npx tsx scripts/pg-verify.ts
 */

const APP_PORT = 3107;
const DEMO_KEY = "tb_live_8f4c2a91d7e5b3604e2c9a11";
const ROOT = process.cwd();
const VERIFY_DIR = path.join(ROOT, ".data", "pg-verify");
const BACKUP_DIR = path.join(ROOT, ".data", "pg-verify-backup");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

function run(command: string, args: string[], env: NodeJS.ProcessEnv, label: string, shell = false): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[verify] ${label}`);
    const child = spawn(command, args, { cwd: ROOT, env, stdio: "inherit", shell });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`health check did not pass: ${lastError instanceof Error ? lastError.message : lastError}`);
}

function summarize(step: string, detail: Record<string, unknown>) {
  console.log(JSON.stringify({ step, ...detail }));
}

async function main() {
  fs.rmSync(VERIFY_DIR, { recursive: true, force: true });
  const started = await startEmbeddedPostgres({ dataDir: VERIFY_DIR });
  const { databaseUrl } = started;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    RUN_MIGRATIONS_ON_BOOT: "true",
  };
  delete childEnv.PGLITE_DATA_DIR;
  delete childEnv.TOKENBURN_SKIP_AUTOSEED;

  console.log(`[verify] PostgreSQL ready at ${redactUrl(databaseUrl)}`);
  summarize("postgres.started", { version: "18.7", port: started.port });

  try {
    await run(process.execPath, ["--import", "tsx", "scripts/migrate-pglite-to-postgres.ts"], childEnv, "copying PGlite data");

    await run("npm", ["test"], childEnv, "running the full test suite against PostgreSQL", true);

    await run(
      process.execPath,
      ["--import", "tsx", "scripts/pg-check-governance.ts"],
      childEnv,
      "verifying budget reservations and advisory locks on PostgreSQL",
    );

    summarize("build.start", {});
    await run("npm", ["run", "build"], childEnv, "building the production bundle", true);

    // Spawn the server directly: `npm start` adds a wrapper process that swallows
    // SIGTERM on Windows, leaving an orphaned server behind.
    const server = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(APP_PORT)], {
      cwd: ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const serverLog: string[] = [];
    server.stdout?.on("data", (chunk: Buffer) => serverLog.push(chunk.toString()));
    server.stderr?.on("data", (chunk: Buffer) => serverLog.push(chunk.toString()));

    try {
      await waitForHealth(`http://localhost:${APP_PORT}/api/v1/health`, 60_000);
      const health = await (await fetch(`http://localhost:${APP_PORT}/api/v1/health`)).json();
      summarize("app.health", health as Record<string, unknown>);

      const marker = `pg-verify-${Date.now()}`;
      const eventBody = {
        events: [
          {
            environment: "production",
            feature: "pg-verification",
            provider: "openai",
            model: "gpt-4.1-mini",
            inputTokens: 1000,
            outputTokens: 200,
            latencyMs: 420,
            statusCode: 200,
            occurredAt: new Date().toISOString(),
            idempotencyKey: marker,
            isSynthetic: false,
          },
        ],
      };
      const ingest = await fetch(`http://localhost:${APP_PORT}/api/v1/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${DEMO_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(eventBody),
      });
      const ingestJson = await ingest.json();
      const replay = await fetch(`http://localhost:${APP_PORT}/api/v1/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${DEMO_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(eventBody),
      });
      const replayJson = await replay.json();

      const usage = await fetch(`http://localhost:${APP_PORT}/api/v1/usage`, {
        headers: { authorization: `Bearer ${DEMO_KEY}` },
      });
      const usageJson = await usage.json();

      const recommendation = await fetch(`http://localhost:${APP_PORT}/api/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${DEMO_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "recommend", messages: [{ role: "user", content: "Summarize a changelog" }] }),
      });

      const exportUnauthenticated = await fetch(`http://localhost:${APP_PORT}/api/export/usage`);

      const sql = postgres(databaseUrl, { max: 2, prepare: false });
      const [recorded] = await sql.unsafe(
        `select idempotency_key, cost_usd::text as cost, input_tokens, output_tokens, pricing_id is not null as priced
           from usage_events where idempotency_key = $1`,
        [marker],
      );
      const [orgSplit] = await sql.unsafe(
        `select count(distinct org_id)::int as orgs,
                sum(cost_usd)::text as total,
                (select sum(cost_usd)::text from usage_events where org_id = (select org_id from usage_events where idempotency_key = $1)) as org_total
           from usage_events`,
        [marker],
      );
      await sql.end({ timeout: 5 });

      const ingestBatch = ingestJson as { duplicates?: number; data?: Array<{ costUsd?: number }> };
      const replayBatch = replayJson as { duplicates?: number };
      summarize("app.checks", {
        healthStatus: health.status,
        ingestStatus: ingest.status,
        ingestDuplicate: ingestBatch.duplicates ?? null,
        replayStatus: replay.status,
        replayDuplicate: replayBatch.duplicates ?? null,
        usageStatus: usage.status,
        usageRequests: (usageJson as { totals?: { requests?: number } }).totals?.requests ?? null,
        recommendationStatus: recommendation.status,
        recommendationMode: recommendation.headers.get("x-tokenburn-mode"),
        exportWithoutSession: exportUnauthenticated.status,
        recorded,
        orgSplit,
      });

      if (recorded?.cost !== "0.000720" || !recorded.priced) {
        throw new Error(`ingested event was priced incorrectly: ${JSON.stringify(recorded)}`);
      }
      if (replayBatch.duplicates !== 1) {
        throw new Error("duplicate replay was not reported as duplicate");
      }
      if (recommendation.headers.get("x-tokenburn-mode") !== "recommendation") {
        throw new Error("recommendation mode header missing");
      }
      if (exportUnauthenticated.status !== 401) {
        throw new Error("export route did not require a session");
      }
      if (!orgSplit || Number(orgSplit.orgs) < 1) {
        throw new Error("organization split query returned no organizations");
      }
    } finally {
      const exited = new Promise<boolean>((resolve) => {
        if (server.exitCode !== null) return resolve(true);
        const timer = setTimeout(() => resolve(false), 10_000);
        server.once("exit", () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      server.kill("SIGTERM");
      const signalExit = await exited;
      if (!signalExit) server.kill("SIGKILL");
      const logText = serverLog.join("");
      const bootLine = logText.split(/\r?\n/).find((line) => line.includes("env.validated")) ?? null;
      summarize("app.shutdown", {
        platform: process.platform,
        bootLog: bootLine,
        signalExit,
        // Windows cannot deliver POSIX signals, so lib/shutdown.ts only runs on
        // POSIX. The graceful log line is therefore only meaningful there.
        shutdownLogged: logText.includes("server.shutdown.begin"),
      });
      if (!signalExit) throw new Error("server did not exit after SIGTERM");
    }
  } finally {
    await started.stop();
  }

  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  fs.cpSync(started.dataDir, BACKUP_DIR, { recursive: true });
  const restored = await startEmbeddedPostgres({ dataDir: BACKUP_DIR, port: started.port + 1 });
  try {
    const sql = postgres(restored.databaseUrl, { max: 1, prepare: false });
    const [counts] = await sql.unsafe(
      `select (select count(*)::int from usage_events) as usage_events,
              (select count(*)::int from organizations) as organizations,
              (select count(*)::int from gateway_requests) as gateway_requests,
              (select count(*)::int from model_pricing) as pricing_rows,
              (select sum(cost_usd)::text from usage_events) as total_cost`,
    );
    await sql.end({ timeout: 5 });
    summarize("backup.restore", { restoredFrom: ".data/pg-verify-backup", counts });
  } finally {
    await restored.stop();
  }

  console.log("[verify] PostgreSQL verification complete");
}

main().catch((error) => {
  console.error("[verify] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
