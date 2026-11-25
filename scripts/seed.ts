import path from "node:path";

async function main() {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env.local"));
  } catch {}

  const { getDb, rawQuery } = await import("../lib/db/client");
  await getDb();
  const stats = await rawQuery<{
    users: string;
    events: string;
    spend: string;
    projects: string;
  }>(
    `select
       (select count(*) from users)::text as users,
       (select count(*) from usage_events)::text as events,
       (select coalesce(sum(cost_usd), 0) from usage_events)::text as spend,
       (select count(*) from projects)::text as projects`,
  );
  console.log("[seed] ready", stats.rows[0]);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
