import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Copies the embedded PGlite development database into a real PostgreSQL instance.
 * Safe to re-run: inserts use ON CONFLICT DO NOTHING and counts are compared afterwards.
 *
 * usage: DATABASE_URL=postgres://... npx tsx scripts/migrate-pglite-to-postgres.ts
 */

const PGLITE_DIR = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pg");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

type Dependency = { child: string; parent: string };

function topoSort(tables: string[], dependencies: Dependency[]): string[] {
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of dependencies) {
    if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child)!.add(parent);
  }
  const ordered: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (table: string) => {
    if (state.get(table) === "done") return;
    if (state.get(table) === "visiting") return; // self-referencing cycle; insert order within table is by row
    state.set(table, "visiting");
    for (const parent of deps.get(table) ?? []) visit(parent);
    state.set(table, "done");
    ordered.push(table);
  };
  for (const table of tables) visit(table);
  return ordered;
}

function serialize(value: unknown): unknown {
  if (value === undefined) return null;
  // drizzle's postgres-js driver replaces the date serializers with an identity
  // function, so a raw Date reaches the protocol buffer and crashes it. Encode
  // Dates as ISO strings ourselves.
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!fs.existsSync(path.join(PGLITE_DIR, "PG_VERSION"))) {
    throw new Error(`No PGlite data directory at ${PGLITE_DIR}`);
  }

  const source = new PGlite(PGLITE_DIR);
  await source.waitReady;

  const target = postgres(databaseUrl, { max: 4, prepare: false, onnotice: () => {} });
  try {
    console.log("[migrate] running drizzle migrations on the target");
    await migrate(drizzle(target), { migrationsFolder: MIGRATIONS_DIR });
    console.log("[migrate] drizzle migrations complete");

    const tableRows = await source.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
          and table_name not like '__drizzle%'`,
    );
    const tables = tableRows.rows.map((row) => row.table_name);
    if (!tables.length) throw new Error("Source database has no tables");

    const depRows = await source.query<{ child: string; parent: string }>(
      `select conrelid::regclass::text as child, confrelid::regclass::text as parent
         from pg_constraint where contype = 'f'`,
    );
    const deps = depRows.rows.map((row) => ({
      child: row.child.replace(/^public\./, "").replace(/"/g, ""),
      parent: row.parent.replace(/^public\./, "").replace(/"/g, ""),
    }));
    const ordered = topoSort(tables, deps);

    const summary: Array<{ table: string; source: number; target: number; ok: boolean }> = [];
    for (const table of ordered) {
      const quoted = `"${table}"`;
      const rows = (await source.query<Record<string, unknown>>(`select * from ${quoted}`)).rows;
      if (!rows.length) {
        const [{ count }] = (await target.unsafe(`select count(*)::int as count from ${quoted}`)) as unknown as Array<
          { count: number }
        >;
        summary.push({ table, source: 0, target: count, ok: count === 0 });
        continue;
      }

      const columns = Object.keys(rows[0]);
      const columnList = columns.map((c) => `"${c}"`).join(", ");
      const batchSize = 400;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const placeholders = batch
          .map(
            (_, rowIndex) =>
              `(${columns.map((__, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(", ")})`,
          )
          .join(", ");
        const params = batch.flatMap((row) => columns.map((column) => serialize(row[column])));
        try {
          await target.unsafe(
            `insert into ${quoted} (${columnList}) values ${placeholders} on conflict do nothing`,
            params as never[],
          );
        } catch (error) {
          console.error(`[migrate] insert failed for table ${quoted} (rows ${i}-${i + batch.length})`);
          console.error(
            "[migrate] param types:",
            params.map((value, index) => `${columns[index % columns.length]}=${value === null ? "null" : (value as object)?.constructor?.name}`).slice(0, 40),
          );
          throw error;
        }
      }

      const [{ count }] = (await target.unsafe(`select count(*)::int as count from ${quoted}`)) as unknown as Array<
        { count: number }
      >;
      summary.push({ table, source: rows.length, target: count, ok: count === rows.length });
    }

    const sourceFinancial = await source.query<{ events: number; cost: string }>(
      `select count(*)::int as events, coalesce(sum(cost_usd), 0)::text as cost from usage_events`,
    );
    const targetFinancial = (await target.unsafe(
      `select count(*)::int as events, coalesce(sum(cost_usd), 0)::text as cost from usage_events`,
    )) as unknown as Array<{ events: number; cost: string }>;

    const sourceOrgs = await source.query<{ org_id: string; events: number; cost: string }>(
      `select org_id, count(*)::int as events, coalesce(sum(cost_usd), 0)::text as cost
         from usage_events group by org_id order by org_id`,
    );
    const targetOrgs = (await target.unsafe(
      `select org_id, count(*)::int as events, coalesce(sum(cost_usd), 0)::text as cost
         from usage_events group by org_id order by org_id`,
    )) as unknown as Array<{ org_id: string; events: number; cost: string }>;

    const mismatched = summary.filter((row) => !row.ok);
    const orgMismatch = sourceOrgs.rows.filter((row, index) => {
      const other = targetOrgs[index];
      return (
        !other ||
        other.org_id !== row.org_id ||
        other.events !== row.events ||
        Math.abs(Number(other.cost) - Number(row.cost)) > 1e-6
      );
    });

    console.log(
      JSON.stringify(
        {
          tables: summary.length,
          rowsCopied: summary.reduce((sum, row) => sum + row.source, 0),
          mismatchedTables: mismatched,
          usageEvents: {
            source: sourceFinancial.rows[0],
            target: targetFinancial[0],
          },
          organizationsCompared: sourceOrgs.rows.length,
          organizationMismatches: orgMismatch,
        },
        null,
        2,
      ),
    );

    if (mismatched.length || orgMismatch.length) {
      process.exitCode = 1;
    }
  } finally {
    await target.end({ timeout: 5 });
    await source.close();
  }
}

main().catch((error) => {
  console.error("[migrate] failed", error);
  process.exit(1);
});
