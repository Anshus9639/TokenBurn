# Deployment: database, backup and single-instance notes

Status of this document: 2026-11-26. It separates what has been executed and verified
from what is documented but still needs verification on a Linux host.

## Database modes

| Mode | When | Details |
| --- | --- | --- |
| PGlite (default) | local development, single process | Embedded WASM PostgreSQL under `.data/pg`. No server, no backup tooling. One process only. |
| PostgreSQL | any durable or multi-process deployment | Set `DATABASE_URL=postgres://…`. `lib/db/client.ts` switches to `postgres-js` with a pool of 5 connections and runs pending Drizzle migrations at boot unless `RUN_MIGRATIONS_ON_BOOT=false`. |

Both modes share the same Drizzle schema and queries; there are no PGlite-only SQL paths.

## Migrating existing PGlite data

```bash
DATABASE_URL=postgres://user:pass@host:5432/tokenburn \
  npx tsx scripts/migrate-pglite-to-postgres.ts
```

The script:

1. reads `.data/pg` (or `PGLITE_DATA_DIR`),
2. applies Drizzle migrations to the target,
3. copies every `public` table in foreign-key order with `INSERT … ON CONFLICT DO NOTHING`
   (safe to re-run), encoding timestamps as ISO strings and JSON columns as JSON,
4. compares per-table row counts, total `usage_events`, cost and per-organization costs,
   and exits non-zero on any mismatch.

Verified on 2026-11-26 against PostgreSQL 18.7: 26 tables, 18,024 rows, 17,646 usage
events and total cost `871.507329` identical on both sides, 1 organization compared with
no mismatches.

## Verified end-to-end run

```bash
npx tsx scripts/pg-verify.ts
```

This starts a throwaway cluster in `.data/pg-verify` (fresh UTF8 cluster each run), copies
the PGlite data, runs the suite, builds, boots the production server against PostgreSQL,
probes the API, then stops the cluster and restores a cold copy. Last recorded run:

- full test suite against PostgreSQL: 124 tests, 119 passed, 0 failed, 5 skipped
  (live-provider smoke tests require explicit opt-in)
- migrate + copy comparison: exact match (see above)
- server boot with `env.validated`, health `ok`, database reachable
- ingest: 200, new event priced at `0.000720` for 1000 input / 200 output tokens at
  `openai/gpt-4.1-mini`; replay with the same idempotency key reported `duplicates: 1`
- usage API: 200; recommendation mode: 200 with `x-tokenburn-mode: recommendation`;
  unauthenticated CSV export: 401
- budget reservations on PostgreSQL (`scripts/pg-check-governance.ts`), recorded output:
  `{"case":"reservation_headroom","ok":true}` (0.60 of a $1.00 budget passes, a second
  0.60 is denied, 0.30 fits in the held remainder, 0.20 is denied),
  `{"case":"advisory_lock","ok":true,"decisions":[true,false]}` (two concurrent 0.60
  preflights, exactly one wins), and `{"case":"spend_accounting","ok":true,"spentUsd":0.0036}`
  (a recorded $0.0036 event plus a $0.008 estimate is denied on a $0.01 budget, while
  a $0.005 estimate gets a hold); step ends `{"step":"governance.pg","ok":true}`
- cold-copy restore: `usage_events` 18,413, `organizations` 4, `gateway_requests` 251,
  `model_pricing` 20, total cost `902.228049`

The suite's database tests are split: analytics, isolation, credential storage,
recommendations and provider verification run through the shared `DATABASE_URL`
connection, while in-memory suites (`createTestDb`) stay on PGlite by design. The
governance script above closes the reservation/advisory-lock gap on PostgreSQL.

## Schema and migrations

- `drizzle/` contains forward-only SQL migrations; `drizzle-kit generate` produces new
  ones from `lib/db/schema.ts`.
- Boot-time migration is convenient for a single instance. For rolling deploys, set
  `RUN_MIGRATIONS_ON_BOOT=false` and run migrations once as a release step.
- Historical `model_pricing` rows are never updated in place; corrections are new
  versions with `effective_from`/`superseded_at`.
- The target database must use UTF8 server encoding (the standard for managed
  PostgreSQL). Windows `initdb` defaults to WIN1252, which rejects non-Latin text; the
  embedded helper passes `--encoding=UTF8 --locale=C`.

## Backup and restore

**Managed PostgreSQL (recommended for beta):** use the provider's automated backups /
PITR, or `pg_dump -Fc` for logical dumps. This path has **not** been executed in this
environment — validate it against the chosen provider before promising recoverability.

**Embedded cluster (verification use):** the vendored binaries do not include
`pg_dump`/`pg_restore`, so backup is a cold data-directory copy:

1. stop the cluster (SIGTERM to the launcher or `pg_ctl` if available),
2. copy the entire data directory (`.data/pg-verify`) to a backup location,
3. restart the cluster with `dataDir` pointing at the original directory.

Restore is the same operation in reverse: start the cluster with the backup directory
as `dataDir`. `scripts/pg-verify.ts` performs exactly this cold copy and reports row
counts from the restored cluster.

## Runtime behaviour and limits

- **Single instance while Redis is unconfigured.** Rate limits and provider circuit
  breakers are per process; running N instances allows roughly N× the configured
  request rate. PGlite itself must never be shared between processes.
- **Graceful shutdown** is implemented in `lib/shutdown.ts` (SIGTERM/SIGINT, 10 s
  budget). Verified on Windows only in the sense that the process exits when the signal
  is delivered; Windows cannot run POSIX signal handlers, so the `server.shutdown.begin`
  log line requires a POSIX host to observe.
- **Connection pool** is 5 per process (`max: 5`, `prepare: false`).
- **Date parameters:** drizzle's postgres-js driver replaces postgres.js's date
  serializers with an identity function, so a raw `Date` passed through a postgres.js
  call crashes the protocol buffer. Application code relies on Drizzle column encoders
  (which stringify dates); do not pass `Date` objects to `sql` templates or
  `client.unsafe` — convert them to ISO strings first.
- **Health check:** `GET /api/v1/health` reports `database: reachable` and the usage
  event count; use it for readiness probes.

## Container / Linux deployment — deferred

Container packaging was intentionally deferred. No Dockerfile has been built or run, and
no Linux host has executed this build; treat it as unverified. Before shipping:

- build with Node 24 (`npm ci && npm run build`) on Linux and run `npm start`,
- provide `AUTH_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`; production boot refuses weak
  values,
- verify `SIGTERM` reaches the Node process (no `npm start` wrapper in the container) and
  that `server.shutdown.begin/complete` is logged,
- mount external PostgreSQL (never PGlite) and configure Upstash if more than one replica
  runs,
- probe `/api/v1/health`, check structured JSON logs, and repeat backup/restore for the
  chosen managed database.
