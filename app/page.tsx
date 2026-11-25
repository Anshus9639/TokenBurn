import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Braces,
  Check,
  GitBranch,
  LockKeyhole,
  Scale,
  Sparkles,
  Terminal,
  TrendingDown,
} from "lucide-react";
import { BrandMark } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navLinks = [
  { label: "Platform", href: "#platform" },
  { label: "Intelligence", href: "#intelligence" },
  { label: "Governance", href: "#governance" },
  { label: "Architecture", href: "#architecture" },
];

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden bg-obsidian">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[680px] bg-[radial-gradient(50%_48%_at_50%_0%,rgba(255,255,255,0.07),transparent_70%),radial-gradient(38%_36%_at_82%_6%,rgba(255,255,255,0.04),transparent_72%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] grid-etch opacity-[0.35]" />

      <header className="relative z-10 mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark className="size-6" />
          <span className="text-[13px] font-semibold tracking-[0.16em]">TOKENBURN</span>
          <span className="ml-1 hidden rounded border border-hairline-strong bg-white/[0.04] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ink-muted sm:inline">
            v2.1
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-[12px] text-ink-faint md:flex">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="px-2 text-[12px] text-ink-muted transition-colors hover:text-ink">
            Sign in
          </Link>
          <Button asChild size="sm" variant="chrome">
            <Link href="/login">
              Open demo <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid w-full max-w-6xl gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.02fr_1fr] lg:items-center lg:pt-24">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-hairline-strong bg-white/[0.04] px-3 py-1">
              <span className="size-1.5 rounded-full bg-[#D4D4D8]" />
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">
                AI cost intelligence · multi-tenant
              </span>
            </div>
            <h1 className="mt-6 text-balance text-[44px] font-medium leading-[1.02] tracking-[-0.045em] sm:text-[56px]">
              <span className="text-ink">Every token priced.</span>
              <br />
              <span className="chrome-text">
                Every feature accountable.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-[14.5px] leading-[1.7] text-ink-muted">
              TokenBurn is the cost governance layer for production AI. Normalize usage
              across OpenAI, Anthropic, Gemini, Groq and Mistral, price it against a versioned
              catalog, attribute it to projects and features, then cut spend with evidence
              — not guesswork.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" variant="chrome">
                <Link href="/login">
                  Enter the demo <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/explorer">
                  <Terminal className="size-4" /> Inspect the ingest API
                </Link>
              </Button>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-faint">
              <span className="flex items-center gap-1.5">
                <Check className="size-3" /> Deterministic synthetic dataset
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3" /> Server-side cost authority
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3" /> Explicit savings estimates
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-3xl bg-[radial-gradient(50%_60%_at_50%_40%,rgba(255,255,255,0.06),transparent_70%)]" />
            <div className="metal-panel noise relative overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-accent-rose/80" />
                  <span className="size-1.5 rounded-full bg-accent-amber/80" />
                  <span className="size-1.5 rounded-full bg-accent-emerald/80" />
                  <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                    Command Center / Synthetic
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full border border-accent-amber/35 bg-accent-amber/10 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[#FCD34D]">
                    3 anomalies
                  </span>
                  <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-faint">
                    USD
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-px bg-hairline-faint">
                {[
                  ["Month to date", "$365.84", "+18.2% vs prior"],
                  ["Projected", "$548.76", "68% of budget"],
                  ["Requests", "7,278", "0.55% errors"],
                ].map(([label, value, sub]) => (
                  <div key={label} className="bg-[#171717] px-4 py-4">
                    <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-ink-faint">{label}</div>
                    <div className="mt-1.5 font-mono text-[18px] tabular tracking-tight text-ink">{value}</div>
                    <div className="mt-1 font-mono text-[9px] text-ink-faint">{sub}</div>
                  </div>
                ))}
              </div>

              <div className="px-5 pb-5 pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                    Daily spend · 30d
                  </span>
                  <span className="font-mono text-[9px] text-ink-faint">avg $18.21</span>
                </div>
                <svg viewBox="0 0 480 130" className="w-full" aria-hidden>
                  <defs>
                    <linearGradient id="land-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="land-line" x1="0" y1="0" x2="480" y2="0" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#3B82F6" />
                      <stop offset="55%" stopColor="#8B5CF6" />
                      <stop offset="100%" stopColor="#22D3EE" />
                    </linearGradient>
                  </defs>
                  {[0, 32, 64, 96].map((y) => (
                    <line key={y} x1="0" x2="480" y1={y + 10} y2={y + 10} stroke="#303030" strokeDasharray="2 5" />
                  ))}
                  <path
                    d="M0,100 C22,96 34,102 56,92 C78,82 90,88 112,80 C134,72 146,84 168,74 C190,64 202,68 224,58 C246,48 258,62 280,54 C302,46 314,36 336,44 C358,52 370,30 392,34 C414,38 432,22 454,26 C466,28 474,20 480,18 L480,130 L0,130 Z"
                    fill="url(#land-fill)"
                  />
                  <path
                    d="M0,100 C22,96 34,102 56,92 C78,82 90,88 112,80 C134,72 146,84 168,74 C190,64 202,68 224,58 C246,48 258,62 280,54 C302,46 314,36 336,44 C358,52 370,30 392,34 C414,38 432,22 454,26 C466,28 474,20 480,18"
                    fill="none"
                    stroke="url(#land-line)"
                    strokeWidth="1.6"
                  />
                  <circle cx="454" cy="26" r="2.5" fill="#171717" stroke="#D4D4D8" strokeWidth="1.4" />
                </svg>

                <div className="mt-4 space-y-2.5 border-t border-hairline pt-4">
                  {[
                    ["schema-summarizer", 100, "$137.61", "Orbit Insights"],
                    ["invoice-extraction", 64, "$72.14", "Ledger Agents"],
                    ["answer-generation", 44, "$60.01", "Atlas Assistant"],
                  ].map(([name, width, cost, project]) => (
                    <div key={name as string} className="grid grid-cols-[1fr_auto] items-center gap-3">
                      <div>
                        <div className="flex items-center justify-between text-[10.5px]">
                          <span className="text-ink-muted">{name}</span>
                          <span className="text-ink-faint">{project}</span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-[#303030]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#3B82F6] to-[#22D3EE]"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                      <span className="font-mono text-[11px] tabular text-ink">{cost}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-hairline px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[10.5px] text-ink-muted">
                    <Sparkles className="size-3.5 text-ink-muted" />
                    Coach found $85/mo in model routing headroom
                  </span>
                  <span className="rounded-full border border-accent-amber/30 bg-accent-amber/[0.08] px-1.5 py-px font-mono text-[8px] uppercase tracking-[0.1em] text-[#FCD34D]">Estimated</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-hairline-faint bg-[#0D0D0D]">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 divide-x divide-hairline-faint px-5 md:grid-cols-4">
            {[
              ["5", "provider adapters"],
              ["17", "catalog models"],
              ["8", "cost levers"],
              ["100%", "server-priced events"],
            ].map(([value, label]) => (
              <div key={label} className="px-5 py-6 first:pl-0 last:pr-0">
                <div className="font-mono text-[22px] tabular tracking-tight text-ink">{value}</div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="platform" className="mx-auto w-full max-w-6xl px-5 py-24">
          <div className="max-w-2xl">
            <div className="kicker">The pipeline</div>
            <h2 className="mt-3 text-[32px] font-medium leading-tight tracking-[-0.035em]">
              From raw provider usage to a defensible cost decision.
            </h2>
            <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted">
              One normalized event model. One authoritative pricing engine. No client-supplied
              costs, no silent re-pricing, no orphan spend.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {[
              {
                n: "01",
                icon: Braces,
                title: "Normalize",
                body: "Provider adapters translate OpenAI, Anthropic, Gemini, Groq and Mistral payloads into one event: tokens, cache reads, cache writes, latency, status and attribution.",
                foot: "POST /api/v1/events",
              },
              {
                n: "02",
                icon: Scale,
                title: "Price",
                body: "Cost is computed server-side using the catalog version effective at the event timestamp. Cached input, cache writes and reasoning tokens each get their own rate.",
                foot: "versioned catalog · immutable events",
              },
              {
                n: "03",
                icon: GitBranch,
                title: "Attribute",
                body: "Every event carries project, environment, feature, model and prompt fingerprint so spend maps to the team that caused it.",
                foot: "project · environment · feature",
              },
            ].map((card) => (
              <div key={card.n} className="panel group p-5 transition-colors hover:border-hairline-strong">
                <div className="flex items-center justify-between">
                  <div className="flex size-8 items-center justify-center rounded-md border border-hairline-strong bg-gradient-to-b from-[#242424] to-[#161616]">
                    <card.icon className="size-4 text-[#D4D4D8]" strokeWidth={1.5} />
                  </div>
                  <span className="font-mono text-[10px] text-ink-faint">{card.n}</span>
                </div>
                <h3 className="mt-4 text-[14px] font-medium text-ink">{card.title}</h3>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">{card.body}</p>
                <div className="mt-4 border-t border-hairline-faint pt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                  {card.foot}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-[#0A0A0A]">
            <div className="flex items-center justify-between border-b border-hairline-faint px-4 py-2.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">ingest · normalized event</span>
              <span className="font-mono text-[9px] text-ink-faint">POST /api/v1/events</span>
            </div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-[11px] leading-[1.8] text-ink-muted">
{`{
  "provider": "openai",
  "model": "gpt-4.1",
  "feature": "invoice-extraction",
  "inputTokens": 76000,
  "cachedInputTokens": 24000,
  "outputTokens": 1500,
  "latencyMs": 1840,
  "promptHash": "sha256:9f2c…",
  "idempotencyKey": "inv_8f31c2"
}  →  { "costUsd": 0.1272, "pricingVersion": 1 }`}
            </pre>
          </div>
        </section>

        <section id="intelligence" className="border-y border-hairline-faint bg-[#0D0D0D]">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-24 lg:grid-cols-[1fr_0.95fr] lg:items-center">
            <div>
              <div className="kicker">AI Usage Coach</div>
              <h2 className="mt-3 text-[32px] font-medium leading-tight tracking-[-0.035em]">
                Recommendations with receipts.
              </h2>
              <p className="mt-4 max-w-lg text-[13.5px] leading-relaxed text-ink-muted">
                The coach reads your normalized events — not your prompts — and cites the exact
                token volume, spend and catalog rates behind every finding. Estimated savings are
                separated from measured variance, and overlapping levers are not stacked.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "Duplicate prompt clusters and exact-match caching",
                  "Stable-prefix caching on uncached large contexts",
                  "Model re-pricing for low-output workloads, with quality deltas",
                  "Context compression and output-cap simulations",
                  "Anomaly explanations tied to the contributing features",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[12.5px] text-ink-muted">
                    <BadgeCheck className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.4} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-hairline-faint px-5 py-3">
                <span className="kicker">Recommendation · example</span>
                <Badge variant="warn">Estimated</Badge>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-[14px] font-medium text-ink">Route schema-summarizer to Gemini 2.5 Pro</h3>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                      Orbit Insights · medium confidence
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[20px] tabular text-ink">$85.32</div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">per month</div>
                  </div>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                  331 requests averaged 116k input tokens on Claude Sonnet 4. Repriced at measured
                  token counts, Gemini 2.5 Pro costs $85.32 less per 30 days. Quality is not measured.
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    ["Observed cost", "$137.61"],
                    ["Repriced", "$52.29"],
                    ["Quality delta", "+1"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-md border border-hairline-faint bg-[#1B1B1B] px-3 py-2">
                      <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-ink-faint">{k}</div>
                      <div className={`mt-1 font-mono text-[12px] tabular ${k === "Repriced" ? "text-[#6EE7B7]" : "text-ink"}`}>{v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Button size="sm" variant="secondary">
                    <Check className="size-3.5" /> Accept
                  </Button>
                  <Button size="sm" variant="ghost">
                    Dismiss
                  </Button>
                  <span className="ml-auto font-mono text-[9px] text-ink-faint">Evidence attached · 6 fields</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="governance" className="mx-auto w-full max-w-6xl px-5 py-24">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <div className="kicker">Governance</div>
              <h2 className="mt-3 text-[32px] font-medium leading-tight tracking-[-0.035em]">
                Spend control that respects production.
              </h2>
              <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted">
                Daily and monthly limits, project and feature budgets, model allow-lists,
                approved fallbacks and hard caps. Routing changes to production are queued for
                an explicit admin decision, not applied silently.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {[
                  [LockKeyhole, "RBAC", "Owner · admin · member · viewer"],
                  [TrendingDown, "Hard limits", "Gateway denial at the cap"],
                  [GitBranch, "Approvals", "Signed decision + audit trail"],
                  [Scale, "Restrictions", "Allow-list and blocked models"],
                ].map(([Icon, title, body]) => {
                  const I = Icon as React.ComponentType<{ className?: string; strokeWidth?: number }>;
                  return (
                    <div key={title as string} className="rounded-md border border-hairline bg-white/[0.02] p-3.5">
                      <I className="size-4 text-[#D4D4D8]" strokeWidth={1.5} />
                      <div className="mt-2.5 text-[12px] font-medium text-ink">{title as string}</div>
                      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">{body as string}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel">
              <div className="flex items-center justify-between border-b border-hairline-faint px-5 py-3">
                <span className="kicker">Approval queue</span>
                <Badge variant="outline">1 pending</Badge>
              </div>
              <div className="divide-y divide-hairline-faint">
                <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-ink">Orbit schema summaries · production</div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                      Requested by Jordan · routing_change
                    </div>
                  </div>
                  <Badge variant="warn">Pending</Badge>
                </div>
                <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-ink">Atlas intents · cost first</div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                      Approved by Jordan · 33 days ago
                    </div>
                  </div>
                  <Badge variant="good">Active</Badge>
                </div>
                <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-ink">Orbit SQL · staging proposal</div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                      Draft by Sofia · staging only
                    </div>
                  </div>
                  <Badge>Draft</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-hairline-faint px-5 py-3">
                <span className="text-[10.5px] text-ink-faint">Every decision writes to the audit log.</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">Immutable</span>
              </div>
            </div>
          </div>
        </section>

        <section id="architecture" className="border-t border-hairline-faint bg-[#0D0D0D]">
          <div className="mx-auto w-full max-w-6xl px-5 py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="kicker">Architecture</div>
                <h2 className="mt-3 text-[26px] font-medium tracking-[-0.03em]">Boring, auditable infrastructure.</h2>
              </div>
              <p className="max-w-md text-[12px] leading-relaxed text-ink-faint">
                Next.js server components and actions, PostgreSQL with Drizzle ORM, Redis-compatible
                rate limiting, Vercel AI SDK for optional coach narration. Embedded PGlite for local
                development — swap in managed Postgres with one environment variable.
              </p>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline-faint sm:grid-cols-3 lg:grid-cols-6">
              {["Next.js 15", "TypeScript", "Tailwind", "Drizzle", "PostgreSQL", "Vercel AI SDK"].map((item) => (
                <div key={item} className="flex items-center justify-center gap-2 bg-[#1B1B1B] px-4 py-5 text-center">
                  <span className="size-1 rounded-full bg-[#737373]" aria-hidden />
                  <div className="font-mono text-[11px] text-ink-muted">{item}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-24 text-center">
          <div className="mx-auto max-w-2xl">
            <div className="kicker">Start with the demo</div>
            <h2 className="mt-3 text-[34px] font-medium leading-tight tracking-[-0.04em]">
              Know what your AI actually costs.
            </h2>
            <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted">
              The demo workspace ships with 55 days of labeled synthetic traffic, anomalies,
              budgets and an approval queue. Sign in and burn it down.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" variant="chrome">
                <Link href="/login">
                  Enter the demo <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/signup">Create a live workspace</Link>
              </Button>
            </div>
            <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              demo@tokenburn.dev · tokenburn-demo
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-hairline-faint">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-5" />
            <span className="text-[11px] font-semibold tracking-[0.16em] text-ink-muted">TOKENBURN</span>
          </div>
          <div className="flex items-center gap-6 text-[11px] text-ink-faint">
            <Link href="/login" className="hover:text-ink">Demo</Link>
            <Link href="/signup" className="hover:text-ink">Sign up</Link>
            <a href="#architecture" className="hover:text-ink">Architecture</a>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em]">Monochrome · v2.1</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
