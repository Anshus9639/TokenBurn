import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";
import { ensureCatalogRows } from "../pricing-db";

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;

type GlobalCache = {
  promise?: Promise<AppDb>;
  pglite?: PGlite;
  sql?: ReturnType<typeof postgres>;
  raw?: RawExecutor;
};

type RawExecutor = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;

const globalForDb = globalThis as unknown as { __tokenburnDb?: GlobalCache };
const cache: GlobalCache = (globalForDb.__tokenburnDb ??= {});

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

async function createDb(): Promise<AppDb> {
  const databaseUrl = process.env.DATABASE_URL;
  let db: AppDb;
  let raw: RawExecutor;

  if (databaseUrl) {
    const client = postgres(databaseUrl, { max: 5, prepare: false });
    cache.sql = client;
    db = drizzlePostgres(client, { schema }) as unknown as AppDb;
    raw = async <T>(text: string, params: unknown[] = []) =>
      ({ rows: (await client.unsafe(text, params as never[])) as T[] });
    if (process.env.RUN_MIGRATIONS_ON_BOOT !== "false") {
      await migratePostgres(db as unknown as Parameters<typeof migratePostgres>[0], {
        migrationsFolder: MIGRATIONS_DIR,
      });
    }
  } else {
    const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pg");
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    const pglite = new PGlite({ dataDir });
    cache.pglite = pglite;
    await pglite.waitReady;
    db = drizzlePglite(pglite, { schema }) as unknown as AppDb;
    raw = async <T>(text: string, params: unknown[] = []) => {
      const result = await pglite.query<T>(text, params as never[]);
      return { rows: result.rows };
    };
    if (fs.existsSync(MIGRATIONS_DIR)) {
      await migratePglite(db as unknown as Parameters<typeof migratePglite>[0], {
        migrationsFolder: MIGRATIONS_DIR,
      });
    }
  }

  cache.raw = raw;
  await bootstrapSeed(db, raw);
  await ensureCatalogRows(db);
  return db;
}

async function bootstrapSeed(db: AppDb, raw: RawExecutor) {
  if (process.env.TOKENBURN_SKIP_AUTOSEED === "1") return;
  try {
    const rows = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    if (rows.length > 0) return;

    const lock = await db
      .insert(schema.appMeta)
      .values({ key: "seed_owner", value: String(Date.now()) })
      .onConflictDoNothing()
      .returning({ key: schema.appMeta.key });

    if (lock.length === 0) {
      for (let i = 0; i < 120; i++) {
        const seeded = await raw<{ value: string }>(
          `select value from app_meta where key = 'seeded' limit 1`,
        );
        if (seeded.rows.length > 0) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      return;
    }

    const { seedDatabase } = await import("./seed");
    await seedDatabase(db);
    await db
      .insert(schema.appMeta)
      .values({ key: "seeded", value: new Date().toISOString() })
      .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: new Date().toISOString() } });
  } catch (error) {
    console.error("[tokenburn] bootstrap seed failed", error);
  }
}

export function getDb(): Promise<AppDb> {
  if (!cache.promise) {
    cache.promise = createDb().catch((error) => {
      cache.promise = undefined;
      throw error;
    });
  }
  return cache.promise;
}

/** Releases the database connection during graceful shutdown. Safe to call when never initialised. */
export async function closeDb(): Promise<void> {
  const { pglite, sql } = cache;
  cache.promise = undefined;
  cache.raw = undefined;
  cache.pglite = undefined;
  cache.sql = undefined;
  if (pglite) await pglite.close();
  if (sql) await sql.end({ timeout: 5 });
}

export async function rawQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[] }> {
  if (!cache.raw) await getDb();
  if (!cache.raw) throw new Error("Database not initialised");
  const converted = params.map((p) => (p instanceof Date ? p.toISOString() : p));
  return cache.raw<T>(text, converted);
}

export { schema };
