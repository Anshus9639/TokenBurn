# Financial reconciliation — catalog vs published list prices

Status as of 2026-11-25/26. This document records what was compared, what matched and what
did not. **No catalog value in `lib/pricing.ts` was changed**: the differences below are
documented rather than silently adjusted, per the 2.3 acceptance criteria.

## How costs are calculated

`computeCost` (`lib/pricing.ts`) prices each token class separately and rounds to six
decimals:

- uncached input × `inputPerM`
- cached input × `cachedInputPerM`
- cache write × `cacheWritePerM` (falls back to 1.25 × `inputPerM` when the catalog has no
  cache-write rate)
- output × `outputPerM`
- reasoning tokens × `outputPerM`

Prices are per 1M tokens. Rows are never updated in place: `resolvePricing`
(`lib/pricing-db.ts`) selects the version whose `effectiveFrom` is on or before the event
time and whose `supersededAt` is null or in the future, so replayed events keep the price
that was in force when they occurred. Verified by `tests/cost-engine.test.ts` ("resolves
the price effective at the event time, not the current catalog" and "historical cost is
unchanged").

## What "realized savings" requires

`computeRealizedSavings` (`lib/gateway/savings.ts`) returns a value only when:

1. the usage source is `provider_reported` or `reconciled`, and
2. baseline pricing exists for the comparison model, and
3. the provider reported a non-zero token total.

Estimated usage and preflight projections are labelled estimated and never counted as
realized. Verified by `tests/cost-engine.test.ts` ("realized savings require
provider-reported usage and baseline pricing") and the gateway savings suite.

## Discrepancies found (catalog vs provider pages)

Prices were read from provider pricing pages on 2026-11-25. Provider pages change without
notice; re-verify before any production claim.

| Provider / model | Catalog value | Published value | Impact |
| --- | --- | --- | --- |
| Gemini 2.5 Pro — cached input | $0.125 /M | $0.31 /M | Catalog understates the cached-input discount, so cache savings appear larger than the published rate allows. |
| Gemini 2.5 Flash — cached input | $0.03 /M | $0.075 /M | Same direction as above. |
| Gemini 2.5 Flash-Lite — cached input | $0.01 /M | $0.025 /M | Same direction as above. |
| Gemini 2.5 family — availability | listed as active | deprecated, with rerouting announced for 2026-12-01 | Historical costs remain valid; new routing should not rely on these ids after that date. |
| Mistral Large | $2 /M input, $6 /M output | $0.5 /M input, $1.5 /M output (newer model names) | Catalog overstates cost by 4× for the current Large model. Comparison is not like-for-like because the model names changed. |
| Groq — all models | catalog values | pricing page no longer exposes per-token prices | Cannot be verified from the public page at this time. |
| OpenAI — `gpt-4.1-nano`, `o4-mini` | catalog values | no longer listed on the pricing page | Treat as legacy; existing rows are priced from the catalog. |
| Anthropic — catalog model ids | catalog values | most ids no longer listed; Sonnet 4.6 shows $3 / $0.30 / $3.75 / $15 /M in the same order as the catalog | Sonnet 4.6 matches; other ids are unverifiable from the public page. |
| OpenAI, Anthropic (active ids) | catalog values | matched the pages as of 2026-11-25 | — |

## Consequences and policy

- Mis-priced rows are a **seed-data accuracy** problem, not a formula problem. The cost
  engine applies whatever rate is on the row; versioned pricing exists precisely so a
  correction can be introduced with a new `effectiveFrom` instead of rewriting history.
- Until corrected versions are published, treat Gemini cached-input savings and Mistral
  Large costs as approximate. Do not present them as invoice-reconciled figures.
- Real invoice comparison (provider billing export vs `usage_events` totals) has **not**
  been executed: no billing records were supplied for the beta environment. That step
  remains open and must not be claimed as verified.

## Reproducing the checks

```bash
npm test                       # cost engine, savings, verification suites (PGlite)
npx tsx scripts/pg-verify.ts   # full suite + ingest/dedupe/usage on real PostgreSQL
```

Provider prices: read the official pricing pages for OpenAI, Anthropic, Google, Groq and
Mistral and compare against `PRICING_CATALOG` in `lib/pricing.ts`.
