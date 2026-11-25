import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { BrandMark } from "@/components/app-shell";
import { signupAction } from "@/lib/actions/auth";

export const metadata = { title: "Create workspace" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative flex flex-col px-6 py-6 sm:px-12 lg:px-20">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <BrandMark className="size-6" />
          <span className="text-[13px] font-semibold tracking-[0.16em]">TOKENBURN</span>
        </Link>

        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-[400px] animate-fade-up">
            <div className="kicker mb-3">New organization</div>
            <h1 className="text-[28px] font-medium leading-[1.15] tracking-[-0.035em]">
              Stand up a multi-tenant
              <br />
              cost workspace.
            </h1>
            <p className="mt-3 mb-8 text-[13px] leading-relaxed text-ink-faint">
              You become the owner. Create projects, issue hashed ingest keys and set
              budgets. New workspaces start empty — the seeded demo lives in its own
              organization.
            </p>
            <AuthForm mode="signup" action={signupAction} />
          </div>
        </div>

        <p className="pt-8 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          SOC-minded defaults · scrypt · AES-256-GCM
        </p>
      </div>

      <div className="relative hidden overflow-hidden border-l border-hairline lg:block">
        <div className="absolute inset-0 grid-etch opacity-40" />
        <div className="relative flex h-full flex-col justify-center gap-4 p-12 xl:p-16">
          {[
            ["01", "Tenant isolation", "Every query is scoped by organization membership and server-side role checks."],
            ["02", "Hashed keys", "Project ingest keys are stored as SHA-256 digests. Plaintext is shown once."],
            ["03", "Versioned pricing", "Events keep the catalog version used at ingest so history never re-prices silently."],
            ["04", "Approval gates", "Production routing changes wait for an explicit admin decision and an audit entry."],
          ].map(([n, title, body]) => (
            <div key={n} className="panel flex gap-4 p-4">
              <span className="font-mono text-[11px] text-ink-faint">{n}</span>
              <div>
                <div className="text-[13px] font-medium text-ink">{title}</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
