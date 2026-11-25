# TokenBurn — AI Cost Intelligence

> **Project status: under active development (2.3.1).**
> TokenBurn is **not production-ready**. APIs, database schema, pricing data and UI may change without notice, and no uptime, correctness or billing guarantee is offered.
> Current live-provider coverage is partial: Gemini and Groq completed real requests on 2026-11-26; OpenAI, Anthropic and Mistral were rejected by the providers for billing/subscription reasons and remain unverified. Neither verified model is priced in the catalog yet, so live gateway cost and end-to-end analytics are still blocked. Rate limits and circuit state are in-memory unless Upstash Redis is configured (single-instance only), and PGlite is for local development only. Do not use this repository for production traffic or billing decisions yet.

Multi-tenant cost intelligence and an intelligent LLM routing gateway. TokenBurn ingests per-request usage, prices it server-side against a versioned catalog, attributes spend to projects/features/environments, and turns that data into budgets, anomaly alerts, optimization simulations, approval-gated model routing, shadow/canary rollouts and model evaluations.

TokenBurn 2.0 adds a unified OpenAI-compatible gateway (`/api/v1/chat/completions`) that classifies each task, prices the candidate models, applies organization restrictions and budgets, and serves the request through the selected provider — with realized savings measured from provider-reported usage.

TokenBurn 2.1 is a design pass over the same 2.0 product: every surface keeps its behavior, queries, actions and API contracts, but adopts a professional monochrome language — black/graphite/silver surfaces, provider-authentic logos and brand colors, semantic chart colors, and explicit measured/estimated/projected provenance badges. Color is reserved for data; the chrome stays neutral.

TokenBurn 2.1.1 keeps that monochrome foundation and pushes color into the data layer: every chart uses multi-hue series resolved from a shared semantic palette, provider marks and brand colors appear consistently from the API Explorer to model selectors, and the Router gained a real cost-vs-quality model scatter built from gateway request data.

Ten functional surfaces, one monochrome design system.

## Design system (2.1)

Monochrome foundation, selective chromatic accents: the product surface stays black, graphite and silver, and color is reserved for data and meaning.

- **Surfaces** — page `#080808`, sidebar `#0A0A0A`, card `#141414`, elevated/popover `#1B1B1B`, hover `#222222`, secondary `#0D0D0D`, hairline `#303030` (`#3D3D3D` strong). Navigation, headers, general cards, tables, dropdowns, modals and form controls are all neutral graphite — no navy-tinted surfaces.
- **Text** — primary `#F5F5F5` (white `#FFFFFF` for emphasis), secondary `#A1A1AA`, micro-labels `#8A8A8A`, silver `#D4D4D8` for chrome and active indicators. Micro-labels are nudged from the spec's `#737373` so 10 px labels clear WCAG AA on card surfaces (`#737373` on `#141414` measures 3.89:1; `#8A8A8A` measures 5.34:1). UI text is Inter/Geist; token counts, model IDs, costs and metadata use JetBrains Mono.
- **Buttons** — primary is a white→silver gradient with near-black text, secondary is charcoal with a graphite border. No large blue primary CTAs.
- **Color is data** — the only chromatic surfaces are chart series, KPI accent chips, provider marks, usage/cost distribution bars, status indicators, alerts, recommendation categories and budget utilization. Each hue is semantic: blue `#3B82F6` (spend), cyan `#06B6D4` (cached), violet `#8B5CF6` (output/projected), purple `#A855F7`, emerald `#10B981` (savings/healthy), amber `#F59E0B` (risk), orange `#F97316`, rose `#F43F5E` (errors), teal `#14B8A6`.
- **Providers** always render their authentic mark and brand color (`components/brand/provider-logo.tsx`, `lib/brand/providers.ts`): OpenAI, Anthropic, Google Gemini (brand gradient), Groq and Mistral are never recolored. The same brand color is reused for that provider's chart series everywhere.
- **Charts** resolve colors from serializable `colorMode` props (`palette`, `provider`, `model`, `accent`) inside the client chart layer, never by passing functions across the server/client boundary. Subtle `#2A2A2A` grids, neutral axes, compact legends, dark `#1B1B1B` tooltips. Series are multi-hue by purpose: spend/input blue, cached cyan, output violet, latency teal, errors rose, savings emerald, quality amber; provider-series charts and dots use the provider's brand color; the Router's `CostQualityScatter` plots per-model quality against real average cost per routed request with bubble size = requests. Donut tooltips in provider mode show the provider mark. All chart series are built from real query results; nothing is synthesized for visual effect.
- **Provenance** is explicit: `ProvenanceBadge` and metric-card hints distinguish `measured`, `verified/realized`, `estimated` and `projected` values. Provider connection states show green only after a successful test-connection call; stored-but-untested credentials read "Stored · unverified".
- Common primitives: `MetricCard`, `ProviderBadge`, `ProviderLogo`, `ModelBadge`, `ChartContainer`, `ChartTooltip`, `UsageProgressBar`, `StatusBadge`, `ProvenanceBadge`, `JsonCode`.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS 3.4, Radix primitives, shadcn-style components, Recharts, Framer Motion, Sonner
- Drizzle ORM + PostgreSQL — embedded PGlite by default, managed Postgres via `DATABASE_URL`
- Geist + JetBrains Mono
- Server actions for writes, session cookies for auth, SHA-256 API key hashes, AES-256-GCM for provider credentials

## Quickstart

```bash
npm install
cp .env.example .env.local   # dev-only values are pre-filled in the example
npm run db:seed
npm run dev
```

`.env.example` ships with blank `AUTH_SECRET` / `ENCRYPTION_KEY`; development uses built-in fallbacks. Before any non-local deployment, generate real values with the `node -e` commands in that file. Never commit `.env.local` — it is gitignored.

Open http://localhost:3000 and sign in with the demo owner:

- Email: `demo@tokenburn.dev`
- Password: `tokenburn-demo`

`npm run dev` uses Turbopack. Plain `next dev` (webpack) currently fails to bundle `instrumentation.ts` for the edge runtime because it imports `node:crypto`; the production build is unaffected.

`npm run db:seed` (or the first app boot) is idempotent: it seeds the org, members, projects, pricing catalog, 55 days of synthetic usage, budgets, alerts, routing policies, gateway telemetry, rollouts, model evaluations and recommendations, and is safe to re-run. Requires Node 20+ (used `process.loadEnvFile`).

Production build:

```bash
npm run build
npm start
```

Other scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:reset` (removes the local PGlite directory; reseed or restart to rebuild), `npm run db:generate`.

## Production configuration

The server validates its environment at boot (`instrumentation.ts` → `lib/env.ts`) and refuses to start in production when `AUTH_SECRET` is missing or shorter than 32 characters, when `ENCRYPTION_KEY` is not a base64-encoded 32-byte key, when `DATABASE_URL` is not a `postgres://` URL, when only one of the Upstash variables is set, or when `TRUST_PROXY` is not `0/1/true/false`. Warnings (development-only fallbacks) are logged as structured JSON.

| Variable | Required | Notes |
| --- | --- | --- |
| `AUTH_SECRET` | production | Session signing secret, ≥32 chars. |
| `ENCRYPTION_KEY` | production | Base64 32-byte AES-256-GCM key for provider credentials. |
| `DATABASE_URL` | recommended | Managed Postgres; PGlite is embedded and single-process only. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | optional | Shared rate limiting. **Without both, rate limits are per process**, so N instances allow roughly N× the configured requests. |
| `TRUST_PROXY` | optional | Trust `X-Forwarded-For` / `X-Real-IP`. Auto-enabled on Vercel; set `true` behind your own load balancer, `false` otherwise. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY` | optional | Operator-level provider keys. Used only when the organization has no stored credential for that provider; unlike stored keys they are shared by every organization this process serves, so they suit a single-tenant beta. Stored keys always win. |

Deployment notes:

- **Rate limiting / circuits are in-memory unless Upstash is configured.** API-key limits (300 req/min per key), login buckets and provider circuit breakers are tracked per process. Upstash makes rate limits shared; circuit state stays per instance by design (see `lib/gateway/circuit.ts`).
- **PGlite is for local use.** Use `DATABASE_URL` for any multi-instance or durable deployment.
- **PostgreSQL runbook:** migration, verified results, backup/restore and the deferred container status are documented in [`docs/deployment.md`](docs/deployment.md). Pricing-catalog discrepancies are recorded in [`docs/financial-reconciliation.md`](docs/financial-reconciliation.md).
- **Shutdown**: `SIGTERM`/`SIGINT` close the database with a 10 s budget (`lib/shutdown.ts`); give your orchestrator at least that grace period.
- **Logs** are one JSON line per event on stdout/stderr; credential-shaped strings and sensitive field names are redacted before serialization. Every gateway response and gateway log line carries its request id (`x-tokenburn-request-id`), so a customer report maps to a specific recorded request.
- **Security headers** (CSP, nosniff, frame-ancestors, referrer policy, permissions policy, COOP) are set for every route in `next.config.ts`.


## Demo API key

The seed creates a live-style ingestion key scoped to **Atlas Assistant (production)**:

```
tb_live_8f4c2a91d7e5b3604e2c9a11
```

Use it with `Authorization: Bearer <key>`. Keys are shown once in the product; the database stores only the SHA-256 hash and last four characters.

## Product surfaces

| Route | What it does |
| --- | --- |
| `/dashboard` | Command Center: spend KPIs, burn trend, top features/models, anomaly feed, budget headroom, open savings |
| `/analytics` | Usage analytics: cost/token series, breakdowns by feature, model, environment, project; request explorer with filters and CSV export |
| `/projects` | Projects, environments, API key lifecycle (create/revoke) |
| `/explorer` | API explorer: endpoint reference, request/response schemas, copyable curl samples |
| `/studio` | Optimization Studio: simulate model swaps, prompt caching ladders, output caps, routing changes, 30-day forecasts |
| `/coach` | AI Usage Coach: evidence-backed recommendations (unnecessary context, repeats, caching, cheaper models, anomaly explanations), accept/dismiss workflow, Q&A over measured usage |
| `/router` | Model Router: policies and routing modes, live gateway analytics, safe rollouts with guardrails, evaluations, estimated vs realized savings, approval-gated activation |
| `/governance` | Budgets (soft/hard), approvals queue, model allow/block restrictions, audit trail |
| `/alerts` | Alert inbox, alert rules, and report snapshots |
| `/settings` | Org profile and data mode, members/roles, provider credentials (encrypted), API key overview, pricing catalog |

Everything is per-organization and RBAC-gated: `view` (any member), write actions like `manage_budgets`, `manage_keys`, `ingest` (member+), `manage_org`, `manage_providers`, `approve` (admin/owner).

## API surface

All endpoints require an API key and return `x-ratelimit-*` headers.

### `POST /api/v1/events`

Ingest one event or `{ events: [...] }` (max 100). Accepts `provider`, `model`, `feature`, `environment`, token counts (input, cached input, cache write, output, reasoning), latency, status code, timestamps, optional `requestId`/`idempotencyKey`. Server resolves pricing and stores `costUsd`; duplicates return the original record with `duplicate: true` instead of charging twice.

### `GET /api/v1/events`

Recent events for the key's project (`?limit=1..100`).

### `GET /api/v1/usage`

Aggregates with `from`, `to`, and `groupBy=day|feature|model|environment`, plus filters for `feature`, `environment`, `provider`, `model`. Maximum range: 366 days.

### `GET /api/v1/models`

Active pricing catalog with per-model rates, quality scores and typical latency.

### `POST /api/v1/route`

Pre-flight routing decision (no provider traffic). Body: `model?`, `mode` (`manual` | `recommendation` | `automatic`), `strategy` (`cost_optimized` | `quality_first` | `lowest_latency` | `balanced` | `custom`), `feature`/`environment` to resolve an active policy, plus token estimates. Returns the task classification, candidate ranking, the resolved policy, `allowed`/`reason` from governance (allowlist, blocklist, hard budgets), a priced `estimate`, and up to three cheaper alternatives at comparable quality. Blocked requests still receive cost data but `allowed: false`.

### `POST /api/v1/chat/completions`

OpenAI-compatible gateway. Streams and non-streams are supported, along with tools, structured output and provider-native parameters. Set `model` to an explicit catalog model, `"recommend"` for a decision-only response, or `"auto"` to serve through the active **automatic** policy (which must exist — otherwise `409 policy_required`). Optional body extension:

```json
{ "tokenburn": { "mode": "automatic", "strategy": "balanced", "feature": "answer-generation", "baselineModel": "openai/gpt-4.1", "environment": "production" } }
```

`x-tokenburn-mode`, `x-tokenburn-strategy`, `x-tokenburn-model`, `x-tokenburn-fallback`, `x-tokenburn-usage-source` and `x-tokenburn-request-id` mirror the decision. Requests are priced server-side, written to `gateway_requests`, and ingested as usage events so dashboards, budgets and alerts see them. Manual mode never substitutes a model; fallbacks only use permitted models. `realizedSavingsUsd` is populated only from provider-reported (or reconciled) usage — estimated usage is tagged `usageSource: "estimated"` and never counted as realized savings. Failures are returned in OpenAI error shape with a `request_id`.

### `GET /api/v1/health`

Liveness plus database reachability.

## Routing gateway

`lib/gateway/` implements the 2.0 execution path:

- **Selection** (`select.ts`) classifies the task (chat, reasoning, code, extraction, summarization, translation, creative, classification), estimates input/output tokens, prices every catalog candidate with `computeCost`, and ranks them by strategy. Quality floors per task, context-window fit, policy candidate/fallback sets, provider availability, configured credentials, organization allow/block lists and remaining budget are hard filters — an ineligible model is never selected.
- **Modes** are explicit. `manual` serves the requested model and never substitutes. `recommendation` returns a ranked decision without provider traffic. `automatic` requires an approved policy with `mode: "automatic"`; the policy's candidates, fallback and optional quality/latency floors constrain the choice.
- **Transport** (`transport.ts`) adapts OpenAI, Anthropic, Gemini, Groq and Mistral request/response shapes, including tool calls, JSON/structured output, streaming translation to OpenAI chunks, usage metadata and redacted provider errors. Retries use exponential backoff with `Retry-After` support and per-attempt timeouts; initial connection errors can fall back, mid-stream errors are surfaced to the client. A per-organization, per-provider circuit breaker (`circuit.ts`) opens after five availability failures for 30 s, allows a single half-open probe, and never counts credential or request-validation errors.
- **Governance** is checked again before *every* attempt, including fallbacks: `checkRoutingAllowance` reserves budget headroom inside a per-organization advisory lock, releases holds when an attempt fails, and records denials. Fallback candidates are additionally filtered by the organization allow/block lists at selection time, so a fallback can never escape governance. Blocked models are rejected before any provider request.
- **Recording** (`record.ts`) writes `gateway_requests`, ingests an idempotent usage event (`gateway:{id}`), and computes realized savings only from baseline pricing × provider-reported tokens.
- **Rollouts** (`rollout.ts`, approval-gated): shadow mirrors candidate responses without serving or billing them; canary serves a traffic slice with configurable error/P95-latency/quality guardrails. Guardrails arm after `minSamples`; breaches trigger an audited automatic rollback. Promotion is an admin action and only allowed when guardrails pass. Every rollout starts as `pending_approval`.
- **Evaluations** (`evaluate.ts`) run real provider calls over a stored dataset, score JSON validity, expected keywords, reference similarity and latency, and persist per-case results with provider usage and cost per success. Models without configured credentials are skipped as `provider_not_configured`; no tokens or costs are invented.

The Model Router page surfaces requests routed, model distribution, average cost per request, realized vs estimated savings, quality/latency by model, fallback rate, routing failures, rollout guardrails and evaluation summaries.

## Cost engine

- Pricing is versioned per provider/model with `effectiveFrom`; historical events keep their cost, and re-costing is explicit.
- `computeCost` treats input tokens as a total with cached input as a subset billed at the cached rate; cache writes bill at the write rate or 1.25x input; output and reasoning tokens bill at the output rate. Values are rounded to 6 decimals.
- Feature attribution comes from the event's `feature` field; the seed uses realistic feature names so every dashboard reflects the same taxonomy.
- Savings in Coach, Studio and Router always label **measured** (replayed against stored tokens) versus **estimated** (projected).

## Provider integrations

`lib/providers/index.ts` normalizes usage payloads from OpenAI, Anthropic, Gemini, Groq and Mistral. Each adapter recombines cache reads/writes with reported input tokens before pricing (Anthropic reports them separately; Gemini uses `usageMetadata`), preserves reported values only — nothing is fabricated when a field is absent — and `extractStreamUsage` merges streaming chunks/SSE. `normalizeProviderError` redacts credential-shaped strings, and Settings → Providers → **Test completion** sends one minimal real request (`max_tokens: 16`) and marks a provider verified only when the provider reports token usage; the audit entry records the model, tokens, latency, server-side cost and pricing version.

Live verification (2.3.1, 2026-11-26, operator environment keys): **Gemini** completed a real `gemini-3.5-flash-lite` request (8 input / 1 output tokens, HTTP 200, 5,418 ms) and **Groq** completed a real `qwen/qwen3.8-27b` request (19 input / 2 output tokens, HTTP 200, 354 ms); both provider rows became `verified` only after those completions. **OpenAI** (429, no credits), **Anthropic** (400, credit balance too low) and **Mistral** (402, subscription required) were rejected by the providers and remain `error`/unverified. Neither verified model exists in the pricing catalog, so their server-side cost is `null` and the gateway rejects them with `422 model_not_found` ("not in the active pricing catalog"). Never treat a provider as connected or verified without a successful real completion.

Credentials come from either source: keys saved in Settings are AES-256-GCM encrypted per organization, while `OPENAI_API_KEY` and friends act as an operator-level fallback for a single-tenant deployment (`lib/providers/env-keys.ts`). Stored keys always win over environment keys.

`tests/gateway-live.test.ts` contains optional live smoke tests (one per provider). They do not run by default; set `TOKENBURN_LIVE_SMOKE=1` and any of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY` to exercise the real APIs. Unconfigured providers are skipped. On 2026-11-26 the suite ran against all five configured keys: 2 passed (Gemini, Groq) and 3 failed with the provider billing errors above. The smoke tests call the provider transport directly, so their successful completions are not ingested into usage analytics.

## Tests and checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs `node --test` through tsx over `tests/*.test.ts` with `--test-concurrency=1` (PGlite's WASM instance is process-global; parallel files can exhaust memory). Provider HTTP calls are mocked; tests never send traffic to a real LLM API unless `TOKENBURN_LIVE_SMOKE=1` is explicitly set. Suites cover:

- `cost-engine` — versioned pricing resolution, cached-input subset math, cache writes, reasoning tokens, rounding, historical cost stability.
- `providers` — usage normalization per provider, streaming usage merge, secret redaction, normalized errors.
- `gateway-selection` — task classification, bounded token estimates, manual/no-substitution, every strategy, org restrictions and provider availability as hard filters, policy candidate sets, custom ordering, recommendation mode, context windows, realized-savings semantics.
- `gateway-transport` — OpenAI/Anthropic/Gemini request translation (tools, structured output), streaming translation to OpenAI chunks, usage capture, retries, redacted errors, pre-stream failure behavior, wire model ids.
- `gateway-orchestration` — mocked end-to-end: manual success with provider usage and usage-event ingestion, automatic policy gate (409), cheapest automatic selection with realized savings, fallback on provider 401, recommendation makes no provider call, blocked model 403 before provider, streaming usage recorded after finalize, circuit opening and provider short-circuiting, no fallback outside the allow-list, hard budgets denying before any provider call.
- `gateway-rollout` — shadow mirrors the candidate without billing it, canary guardrail auto-rollback with system audit entry, evaluation summaries and persistence, credential-less evaluation skipped honestly.
- `governance` — allow/block lists, hard budgets, pre-request denial and fallback estimates, reservation release, concurrent preflights serialized by the advisory lock.
- `reliability` — environment validation (production boot errors, warnings, Redis pair, proxy trust), structured-log redaction by field and credential shape, circuit-breaker threshold/cooldown/half-open/tenant isolation and availability-failure classification.
- `recommendations` — structured evidence contract, one counted lever per feature (no double counting), stale-finding refresh.
- `studio` — simulation math through the authoritative engine, context/output reductions, cache ladders, forecasts.
- `security` — org isolation for analytics/detail pages, page-size clamping and pagination, SQL percentiles, cross-org key rejection, RBAC matrix, credential encryption roundtrip, scrypt verification, hashed keys.
- `gateway-live` — optional real-provider smoke calls (skipped unless explicitly enabled).

`npx tsx scripts/pg-verify.ts` verifies survival outside PGlite: it starts a real PostgreSQL cluster, copies the development database and compares counts/costs, runs the suite plus a budget-reservation check against PostgreSQL, boots the production build and probes ingest/dedupe/usage/recommendations, then restores a cold data-directory copy.

## Security

- Passwords: scrypt with per-user salt.
- Sessions: HttpOnly `tb_session` cookie; only the SHA-256 token hash is stored, and sessions can be revoked.
- API keys: SHA-256 hash + prefix/last4 for display; per-key rate limiting (300 req/min default).
- Rate-limit identity: client IPs come from `X-Forwarded-For` only when `TRUST_PROXY` is enabled (or on Vercel); otherwise local/`X-Real-IP` is used so spoofed headers cannot mint fresh buckets. Login is limited per IP (10 / 5 min) and per account (20 / 15 min).
- Provider credentials: AES-256-GCM encrypted with `ENCRYPTION_KEY`; the UI only ever shows the last four characters.
- Environment: production boot fails fast on weak/missing `AUTH_SECRET` or `ENCRYPTION_KEY`, malformed `DATABASE_URL`, half-configured Redis, or an invalid `TRUST_PROXY`.
- Response headers: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and COOP are applied to all routes; the framework `X-Powered-By` header is disabled.
- Logs: structured JSON with credential-shaped strings and sensitive keys redacted; gateway errors are normalized and capped before storage or display.
- Multi-tenancy: every query is scoped by `org_id`; actions check RBAC and write audit entries. API-key authentication re-checks that the key's project and environment belong to the same organization as the key.
- Production routing changes require an explicit approval record; approvals are unique per pending target and the full trail (`policy_created` → `approval_requested` → `approval.approve`/`policy_activated`) is visible in Governance → Audit trail.
- Gateway rollouts are approval-gated: `pending_approval` → `running` only after an admin decision; promotion is admin-only and refuses when guardrails fail or samples are insufficient. Automatic rollbacks are audited with a system actor. Shadow samples are stored separately and never billed or ingested as production usage.
- Ingestion dedupes on idempotency key, request ID, then fingerprint.
- CSV export neutralizes leading `= + - @` / tab characters so spreadsheet apps do not evaluate exported cells as formulas; login `returnTo` only accepts same-origin absolute paths.

## Synthetic vs live data

The seed is synthetic and labeled as such throughout the UI ("Synthetic data is labeled throughout"). Org settings expose a data mode (`synthetic`, `live`, `hybrid`). Requests hitting `/api/v1/events` or `/api/v1/chat/completions` arrive through real API keys and are distinguishable from seeded rows; dashboards do not pretend seeded numbers are provider-reported. The seeded gateway telemetry, rollouts, shadow samples and evaluations exist so the Router surface demonstrates its full state machine; live gateway rows carry `usageSource` and provider request ids. To use live data only, seed a fresh database and point your SDK at the gateway or ingestion endpoint — no seeded gateway rows are required for any surface to function.

## Architecture

```
app/
  (app)/            authenticated shell: dashboard, analytics, projects,
                    explorer, studio, coach, router, governance, alerts, settings
  api/v1/           events, usage, models, route, chat/completions, health
  login/            auth screens
components/         design system + feature clients (charts, simulators, dialogs)
lib/
  db/               schema, PGlite/Postgres client, seed
  gateway/          selection, orchestration, transport, recording,
                    rollout guardrails, evaluation engine, circuit breaker
  providers/        OpenAI, Anthropic, Gemini, Groq, Mistral adapters,
                    streaming usage merge, redaction, normalized errors
  pricing*.ts       pricing resolution + authoritative cost math
  governance.ts     allow/block lists, budgets, routing decisions
  ingest.ts         validation, normalization, dedupe
  coach.ts          evidence-based recommendation engine + Q&A
  auth.ts, crypto.ts, cache.ts, audit.ts
  log.ts, env.ts, shutdown.ts   structured logging, boot validation, graceful stop
  actions/          server actions per surface
drizzle/            SQL migrations
scripts/            seed, reset
tests/              node:test suites (cost engine, providers, gateway,
                    selection, transport, orchestration, rollout, governance,
                    recommendations, studio, security, optional live smoke)
```

Local state lives in `.data/` (PGlite) and is gitignored.

## Verification status

Run locally on 2026-11-26 for **2.3.1 live provider verification**:

- `npm test` — 124 tests, 15 suites, 119 passed, 5 skipped (optional live smoke), 0 failed. `npx tsc --noEmit` clean. `npx eslint .` clean.
- Live smoke command: `TOKENBURN_LIVE_SMOKE=1 node --env-file=.env.local --import tsx --test --test-concurrency=1 tests/gateway-live.test.ts` — 5 tests, 2 passed (Gemini, Groq), 3 failed with the providers' billing/subscription errors.
- Provider verification through the real Settings → Providers action, with audit metadata:

| Provider | Exact model | Provider-reported usage | HTTP | Latency | Server cost | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Gemini | `gemini-3.5-flash-lite` | 8 in / 1 out | 200 | 5,418 ms | `null` (unpriced) | **VERIFIED** |
| Groq | `qwen/qwen3.8-27b` | 19 in / 2 out | 200 | 354 ms | `null` (unpriced) | **VERIFIED** |
| OpenAI | `gpt-4.1-mini` | none | 429 | — | — | CHECK FAILED — no credits |
| Anthropic | `claude-3-5-haiku`, `claude-sonnet-4` | none | 400 | — | — | CHECK FAILED — low credit balance |
| Mistral | `mistral-small-latest` | none | 402 | — | — | CHECK FAILED — subscription required |

- Provider status changed only after a successful real completion. Failed attempts persisted provider messages (no key material) and no token/cost data; audit rows contain the model, attempt ladder, tokens, latency and request id, and never the credential.
- Gateway/governance enforcement exercised live: no key → `401 missing_key`; unpriced current model → `422 model_not_found`; organization-blocked model → `403 model_blocked` before any provider call; a manual request whose first model was rejected fell back to `openai/gpt-4.1-mini` and recorded both attempts. Every probe wrote a `gateway_requests` row attributed to feature `live-verification`, environment `development`.
- Usage analytics: Acme's `/api/v1/usage` returned one event (`support-summarizer`, `openai/gpt-4.1-mini`, 3,200/800 tokens, $0.00256, 640 ms), matching the catalog exactly (3,200 × $0.40/M + 800 × $1.60/M). **No successful live gateway request exists yet**, so "each successful live request appears in analytics" is not verified; the smoke suite bypasses ingestion by design.
- Duplicate handling is covered by `tests/cost-engine.test.ts` (same-org idempotency dedupe, no cross-org collision, price effective at event time). It was not replayed live in 2.3.1 because ingestion requires a priced model.
- Defects found: stale Gemini/Groq verification model IDs (fixed in `lib/gateway/verification.ts` and the live smoke list); current models absent from the pricing catalog; no publish flow in Settings → Pricing catalog despite ingestion's hint; pre-provider gateway failures persist `usage_source = "provider_reported"` with zero tokens (no usage event is written).
- Still untested/blocked: live server-side cost for the two verified models, live end-to-end analytics and attribution from a successful gateway request, live duplicate replay, and any OpenAI/Anthropic/Mistral completion until those accounts have credits/a subscription.

Run locally on 2026-11-26 for the 2.2 production-validation pass, against `next start` (production build):

- `npx tsc --noEmit` — clean. `npx eslint app components lib tests --max-warnings=0` — clean.
- `npm test` — 120 tests, 15 suites, 115 passed, 5 skipped (optional live-provider smoke), 0 failed. New coverage: circuit breaker (threshold, cooldown, half-open probe, per-tenant isolation), no-fallback-outside-allow-list, hard budget denies before any provider call, concurrent preflights serialized by the advisory lock, env validation, log redaction, and gateway/usage-cost reconciliation.
- `npm run build` — succeeds; all pages and API routes compile.
- **Live provider validation was not performed.** `.env.local` still has no `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` or `MISTRAL_API_KEY`, so all five providers remain "Stored · unverified" and the live smoke suite stayed skipped. Nothing here should be read as a real provider success.
- Headers verified with `curl -I http://localhost:3000/`: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, COOP and `X-DNS-Prefetch-Control: off` are present; `X-Powered-By` is absent. Boot logged `{"event":"env.validated","production":true,"issues":0}`.
- API behaviour against the running server: `/api/v1/usage` returned 401 without a key and with a bad key, 200 with the demo key plus `x-ratelimit-remaining/reset`; `POST /api/v1/events` recorded one event priced server-side at $0.0036 (1,000 input × $2/M + 200 output × $8/M), an identical replay returned `duplicate: true` without a second charge, and `/api/v1/usage` totals moved exactly +$0.003600 and +1 request. `POST /api/v1/chat/completions` with `model: "recommend"` returned a recommendation and no provider call. `/api/export/usage` returned 401 without a session and, inside the session, exported exactly that recorded event (`beta-smoke`, 1000/200 tokens, cost 0.003600, `is_synthetic=false`), confirming dashboards and exports read the same event store.
- Layout swept on 10 routes (`/`, dashboard, analytics, projects, studio, coach, router, governance, alerts, settings) × 4 widths (1440, 1024, 640, 390) using same-origin frames: zero horizontal overflow and a rendered `main` on every combination, after fixing four narrow-width defects (`DataNote` flex rows, `CardTopBar` and the Router evaluation/endpoint headers, and dashboard alert rows).
- Full-page screenshots at the in-app browser's native ~526 px viewport were captured for the landing page, Command Center, Analytics, Projects, Studio, Coach, Model Router, Governance, Alerts and Settings (`docs/screenshots/2.2-*.png`). Exact-width screenshots at 1440/1024/640/390 were **not** possible with the available browser tooling; those widths were verified via frame metrics and DOM measurement, not images.
- Limitations: rate limits and circuit state are in-memory because Upstash is not configured (see Production configuration); `SIGTERM` on Windows closed the port but did not run the graceful-shutdown handler (POSIX signal delivery is required to verify it); the signup/new-organization flow was not re-exercised this round; no real provider credential exists to test live traffic, cost reconciliation against a real invoice, or provider-side rate-limit behaviour.

Run locally on 2026-11-25 for the 2.1.1 chromatic-data pass:

- `npx tsc --noEmit` and `npx eslint app components lib --max-warnings=0` — clean.
- `npm test` — 105 registered, 100 passed, 5 skipped (optional live-provider smoke), 0 failed.
- `npm run build` — succeeds; all pages and API routes compile.
- Browser QA against `next start` in the in-app browser at its native ~526 px viewport. Full-page screenshots were captured this round of the landing page, Command Center, Usage Analytics, Projects, Optimization Studio, AI Usage Coach, Model Router, Governance, Alerts and Settings. Inspected: Provider Mix donuts, token splits, feature/model distribution bars, latency/error trends, budget utilization, alert severity rails, and the two new charts.
- Live DOM checks confirmed the Router "Model cost vs quality" scatter renders 7 real gateway points coloured by provider brand (OpenAI `#F2F5F7`, Anthropic `#D97757`, Gemini `#5C8DFF`, Groq `#F43E01`) with a provider legend; the Projects comparison bars use each project's stable accent (violet/cyan/pink) matching its card; the dashboard token-split legend dots match the chart fills; both Studio model selects carry an authentic provider mark and chevron.
- Desktop sweep repeated: every route loaded in a 1440 px same-origin frame. Zero blue-dominant backgrounds (`b − r > 14 && b − g > 10`) on any page; the only flagged nodes were KPI icon glyphs, chart bars/legend dots and rollout status dots — the permitted data accents. Zero horizontal overflow on all routes at 1440 px and at the 526 px viewport.
- Settings → Providers still lists five credentials as "Stored · unverified" with `0 verified`; no connection state is claimed without a successful test call. All surface data remains labelled synthetic.
- Limitations: screenshots cover the single in-app viewport (~526 px, mobile-ish layout); desktop visuals were verified via frame metrics and DOM inspection, not screenshots. The Settings → Providers tab and the donut hover tooltip were verified through DOM structure after loading each tab/state (the screenshot API reported an occluded viewport mid-tab), and tooltip hover states were not exercised with a pointer.

Earlier run on 2026-11-24 against the monochrome correction:

- `npx tsc --noEmit` — clean.
- `npx eslint app components lib --max-warnings=0` — clean.
- `npm test` — 105 tests registered, 12 suites, 100 passed, 5 skipped (optional live-provider smoke tests; no real keys configured), 0 failed.
- `npm run build` — production build succeeds; all application routes and API endpoints compile.
- Browser sweep against `next start` (production build) in the in-app browser. Each route was loaded in a 1440 px-wide same-origin frame and every rendered element's computed background/border was scanned for blue-dominant surfaces (`b − r > 14 && b − g > 10`). Routes checked: landing, `/login`, `/signup`, 404, Command Center, Analytics, Projects, project detail, API Explorer, Studio, Coach, Model Router, Governance, Alerts, Settings. Zero navy page/card/nav surfaces remained; the only flagged nodes were 24 px KPI icon tiles, small 10 %-tinted category chips, progress/chart bars and provider brand marks — the permitted data accents. Zero horizontal overflow on every route at 1440 px, and on the 640 px screenshot viewport.
- Full auth loop exercised: signed out through the user menu → `/login` rendered and was screenshotted (white primary button, graphite inputs) → signed back in with the demo owner credentials → `/dashboard` restored.
- Contrast audit on the Command Center and Settings (`main` content, every visible leaf text node measured against its effective background): zero nodes below WCAG AA 4.5:1. The Command Center audit covers 243 nodes with a minimum of 5.02:1; the Settings tabs measured clean as well. The audit initially found 78 labels at 3.89:1 (`#737373` micro-labels on `#141414` cards) and four form labels at 2.36:1 (`ink.dim`); the muted token was raised to `#8A8A8A` (5.34:1 on cards, 4.61:1 on the `#222222` hover surface), chart axis ticks followed, and form labels now use secondary `#A1A1AA` (7.19:1). Accent-tinted small text (KPI chips, status labels) was not separately re-measured after the token change.
- Settings → Providers still showed five stored credentials, all labelled "Stored · unverified"/"never" with `0 verified`. No green connected state appeared without a successful test call.
- Screenshots were captured this round for `/login` and the Command Center. The landing page and the other authenticated surfaces were verified structurally after the correction (computed styles, navy scan, overflow); the in-app browser intermittently reported an occluded viewport, so no post-correction desktop screenshot set exists for them.
- Only one in-app viewport width (~640 px) was available for screenshots; tablet/desktop visuals were checked via the 1440 px frame metrics, not screenshots.
- Gateway wiring on `next start`: `POST /api/v1/chat/completions` with `model: "recommend"` returns a decision with ranked candidates and no provider traffic; an empty `messages` array returns `422`. The full provider path is exercised with mocked providers in `gateway-orchestration`, `gateway-transport` and `gateway-rollout`.

Not verified: any live provider completion with a real credential (the live smoke suite exists but was skipped; see Provider integrations). Rollout promotion/ramp and auto-rollback are covered by tests and the seeded state machine, but were not clicked through from the UI against live traffic.
