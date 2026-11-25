import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export type EmbeddedPostgresOptions = {
  dataDir?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
};

export type StartedPostgres = {
  pg: EmbeddedPostgres;
  databaseUrl: string;
  dataDir: string;
  port: number;
  stop: () => Promise<void>;
};

/**
 * Starts the local verification cluster. The data directory persists between runs so
 * migrations and copied rows can be inspected afterwards; pass a fresh directory to
 * measure a cold start.
 */
export async function startEmbeddedPostgres(
  options: EmbeddedPostgresOptions = {},
): Promise<StartedPostgres> {
  const dataDir = path.resolve(options.dataDir ?? path.join(process.cwd(), ".data", "pg-verify"));
  const port = options.port ?? 55432;
  const user = options.user ?? "tokenburn";
  const password = options.password ?? "tokenburn";
  const database = options.database ?? "tokenburn";

  fs.mkdirSync(dataDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user,
    password,
    persistent: true,
    autoRehydrateSymlinks: true,
    // Windows initdb defaults to the active code page (WIN1252), which rejects
    // non-Latin text such as the sigma symbol used in recommendation summaries.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: (message) => {
      const text = typeof message === "string" ? message : String(message);
      if (/ready to accept connections|database system is shut down|starting/i.test(text)) {
        console.log(`[pg] ${text.trim()}`);
      }
    },
    onError: (error) => {
      console.error("[pg] error", error instanceof Error ? error.message : error);
    },
  });

  if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log(`[pg] initialising cluster in ${dataDir}`);
    await pg.initialise();
  }
  await pg.start();

  try {
    await pg.createDatabase(database);
    console.log(`[pg] created database ${database}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
  }

  const databaseUrl = `postgres://${user}:${password}@localhost:${port}/${database}`;
  return {
    pg,
    databaseUrl,
    dataDir,
    port,
    stop: async () => {
      try {
        await pg.stop();
      } catch (error) {
        console.error("[pg] stop failed", error instanceof Error ? error.message : error);
      }
    },
  };
}

export function redactUrl(url: string): string {
  return url.replace(/:\/\/[^@]+@/, "://[redacted]@");
}
