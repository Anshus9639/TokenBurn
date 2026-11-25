import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CircleDot } from "lucide-react";
import { getSession } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { BrandMark } from "@/components/app-shell";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { loginAction } from "@/lib/actions/auth";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative flex flex-col px-6 py-6 sm:px-12 lg:px-20">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <BrandMark className="size-6" />
          <span className="text-[13px] font-semibold tracking-[0.16em]">TOKENBURN</span>
        </Link>

        <div className="flex flex-1 items-center">
          <div className="w-full max-w-[380px] animate-fade-up">
            <div className="kicker mb-3">Secure workspace access</div>
            <h1 className="text-[28px] font-medium leading-[1.15] tracking-[-0.035em]">
              Sign in to your
              <br />
              cost control plane.
            </h1>
            <p className="mt-3 mb-8 text-[13px] leading-relaxed text-ink-faint">
              Organization-scoped sessions, hashed project keys and encrypted provider
              credentials. No provider traffic leaves through TokenBurn.
            </p>
            <AuthForm mode="login" action={loginAction} demo={{ email: "demo@tokenburn.dev", password: "tokenburn-demo" }} />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-8 text-[10px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            <CircleDot className="size-2.5" /> Synthetic demo included
          </span>
          <span className="text-hairline-strong">/</span>
          <span>Local Postgres (PGlite)</span>
        </div>
      </div>

      <div className="relative hidden overflow-hidden border-l border-hairline lg:block">
        <div className="absolute inset-0 grid-etch opacity-[0.5]" />
        <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_60%_18%,rgba(255,255,255,0.06),transparent_70%),radial-gradient(45%_45%_at_85%_75%,rgba(255,255,255,0.03),transparent_72%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center justify-between">
            <span className="kicker">Control plane / 01</span>
            <span className="badge inline-flex items-center gap-1.5 rounded-full border border-hairline-strong bg-black/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
              <span className="size-1 rounded-full bg-[#6EE7B7]" /> All systems nominal
            </span>
          </div>

          <div className="metal-panel noise relative overflow-hidden rounded-xl p-6">
            <div className="flex items-center justify-between border-b border-hairline px-1 pb-3">
              <span className="kicker">Month-to-date burn</span>
              <span className="font-mono text-[10px] text-ink-faint">LIVE · SYNTHETIC</span>
            </div>
            <div className="flex items-end justify-between pt-5">
              <div>
                <div className="font-mono text-[34px] leading-none tabular tracking-tight text-ink">$365.84</div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                  7,278 requests · 12 features
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[11px] text-[#6EE7B7]">+18.2%</div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">vs prior month</div>
              </div>
            </div>
            <svg viewBox="0 0 520 120" className="mt-6 w-full" aria-hidden>
              <defs>
                <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="hero-line" x1="0" y1="0" x2="520" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#3B82F6" />
                  <stop offset="55%" stopColor="#8B5CF6" />
                  <stop offset="100%" stopColor="#22D3EE" />
                </linearGradient>
              </defs>
              <path
                d="M0,92 C30,82 42,88 70,74 C98,60 112,70 140,64 C168,58 180,44 210,50 C240,56 252,38 280,42 C308,46 320,30 350,34 C380,38 392,22 420,26 C448,30 470,14 520,10 L520,120 L0,120 Z"
                fill="url(#hero-fill)"
              />
              <path
                d="M0,92 C30,82 42,88 70,74 C98,60 112,70 140,64 C168,58 180,44 210,50 C240,56 252,38 280,42 C308,46 320,30 350,34 C380,38 392,22 420,26 C448,30 470,14 520,10"
                fill="none"
                stroke="url(#hero-line)"
                strokeWidth="1.6"
              />
            </svg>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
              {[
                ["Schema summarizer", "$137.61"],
                ["Invoice extraction", "$72.14"],
                ["Answer generation", "$60.01"],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">{label}</div>
                  <div className="mt-1 font-mono text-[13px] tabular text-ink">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <blockquote className="max-w-md">
            <p className="text-[15px] leading-relaxed text-ink-muted">
              “We finally know which feature burns the margin. TokenBurn turned a
              mystery line item into a routing decision.”
            </p>
            <footer className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Synthetic testimonial · Northwind Labs
            </footer>
          </blockquote>

          <div className="flex items-center justify-between text-[10px] text-ink-faint">
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1.5" aria-hidden>
                {["openai", "anthropic", "gemini", "groq", "mistral"].map((p) => (
                  <ProviderLogo key={p} provider={p} size={12} decorative />
                ))}
              </span>
              <span className="hidden xl:inline">OpenAI · Anthropic · Gemini · Groq · Mistral</span>
            </span>
            <Link href="/" className="flex items-center gap-1.5 text-ink-muted hover:text-ink">
              Product overview <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
