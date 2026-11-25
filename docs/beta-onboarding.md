# Beta onboarding workflow

Target: a new developer can go from sign-up to a priced usage event and a governance-aware routing decision without operator help. Verified on 2026-11-26 against the local PGlite dev database in a real browser session (Chrome via the in-app browser), with a disposable workspace.

## The path

1. **Create the workspace** — `/signup` with name, organization, work email and a 10+ character password. Signup creates the organization (plan `starter`, `dataMode: live`), the owner membership, a `First Project` with `production` and `development` environments, and a soft `$100.00` monthly organization budget. The session lands on `/dashboard`.
2. **Provider credentials (optional today)** — `/settings?tab=providers`. Statuses are honest by construction: a provider with no stored key and no env key shows `DISCONNECTED` / `not stored` / `LAST VERIFIED never`; an operator env key shows `ENVIRONMENT · UNVERIFIED` until a real "Test completion" succeeds. Usage ingestion does not require a stored provider key.
3. **Issue an ingest key** — project → `API keys` tab → name + environment + kind → `Create key`. The key is shown once (`tb_live_…`), stored only as a SHA-256 hash, and only the prefix/last four are listed afterwards.
4. **Record the first event** — `POST /api/v1/events` with `Authorization: Bearer <key>`. The server prices the event from the catalog version effective at `occurredAt` and returns the immutable breakdown. Replaying the same `requestId`/`idempotencyKey` returns the original event with `duplicate: true`.
5. **See it everywhere** — Command Center (spend, tokens, budget burn, feature attribution, ingestion health), Analytics (`?project=…` filter and feature filter), Governance (budget utilization).
6. **First gateway request** — `POST /api/v1/chat/completions` with `model: "recommend"` returns a routing decision (`x-tokenburn-mode: recommendation`) without any provider call, so it works before credentials exist. Actual completions need a verified provider credential.
7. **Recommendations** — `/coach` states its threshold explicitly ("Findings need at least 25 requests per feature/model") and shows an empty, labeled state until usage qualifies.

## Verified run (2026-11-26)

| Step | Observed |
| --- | --- |
| Signup | Workspace "Acme Eval Lab" created; dashboard $0.00 / 0 requests; budget `$0.00 of $100.00`; starter project listed |
| Providers | OpenAI/Anthropic/Groq/Mistral `DISCONNECTED · not stored · never`; Gemini `ENVIRONMENT · UNVERIFIED · never` |
| Key creation | `beta-ingest` issued for `production`; one-time display + "stored only as a SHA-256 hash" notice |
| First event | `POST /api/v1/events` → 201, cost `0.00256`, breakdown `inputUsd 0.00128 + outputUsd 0.00128`, `pricingVersion 1` (openai/gpt-4.1-mini, 3200 in / 800 out) |
| Duplicate replay | Same `requestId` → `duplicate: true`, same event id and cost |
| Usage API | `GET /api/v1/usage?groupBy=feature` → totals `{costUsd: 0.00256, requests: 1, inputTokens: 3200, outputTokens: 800, avgLatencyMs: 640}`; group `support-summarizer` |
| Dashboard | MTD `$0.0026`, tokens `4,000`, requests `1`, budget `$0.0026 of $100.00`, feature row `First Project / support-summarizer`, ingestion health `LIVE`, last event "just now" |
| Gateway | `POST /api/v1/chat/completions` `model: "recommend"` → 200, `x-tokenburn-mode: recommendation`, classifier `summarization:low`, candidate ladder with estimates |
| Governance | `Organization monthly budget` `SOFT`, `$0.0026 / 0% of $100.00`, thresholds 50/75/90/100 |
| Coach | `0 OPEN FINDINGS`, threshold message shown, savings labeled `ESTIMATED $0.00` |

## Known gaps (documented, not hidden)

- Signup does not issue an API key. The empty dashboard links to projects/analytics, and the key lives one level down in the project's `API keys` tab. Beta instructions must say so; adding a key-creation shortcut to the empty state would be the next onboarding improvement.
- A live completion needs a stored or env provider credential plus a passing connection test; unconfigured providers stay `never` verified.
- `npm run dev` uses Turbopack. Plain `next dev` (webpack) currently fails bundling `instrumentation.ts` for the edge runtime (`node:crypto`); the production build is unaffected.
- Single instance only while Redis is unconfigured (see `docs/deployment.md`).
