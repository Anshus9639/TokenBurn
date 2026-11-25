import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-obsidian px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_45%_at_50%_10%,rgba(255,255,255,0.06),transparent_72%)]"
      />
      <div className="relative w-full max-w-[440px] rounded-lg border border-hairline bg-surface p-8 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint">Error 404</div>
        <h1 className="mt-3 text-[18px] font-medium text-ink">That screen does not exist</h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
          The link may be outdated, or the project or policy it pointed to was removed. Return to the command center to
          keep going.
        </p>
        <div className="mt-6">
          <Button size="sm" asChild>
            <Link href="/dashboard">Back to command center</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
