"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error", error);
  }, [error]);

  return (
    <div className="flex min-h-[52vh] items-center justify-center">
      <div className="w-full max-w-[460px] rounded-lg border border-hairline bg-[#0E0E0E] p-7 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-hairline-strong bg-[#242424]">
          <AlertOctagon className="size-4 text-ink-muted" strokeWidth={1.5} />
        </div>
        <h1 className="mt-4 text-[16px] font-medium text-ink">This screen hit an error</h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
          The request was handled on the server, but the page could not finish rendering. Nothing was changed in your
          data. Retry, or go back to the command center.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">ref {error.digest}</p>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button size="sm" onClick={() => reset()}>
            Retry
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard">Command center</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
