"use client";

import * as React from "react";
import { Loader2, Play, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { JsonCode } from "@/components/json-code";
import { cn } from "@/lib/utils";

const ENDPOINTS = [
  {
    id: "POST /api/v1/events",
    method: "POST",
    path: "/api/v1/events",
    body: true,
    sample: {
      provider: "openai",
      model: "gpt-4.1-mini",
      feature: "chat-completion",
      environment: "development",
      inputTokens: 1200,
      cachedInputTokens: 800,
      outputTokens: 240,
      latencyMs: 842,
      statusCode: 200,
      requestId: "req_demo_console_001",
      idempotencyKey: "demo-console-001",
      promptHash: "sha256:demo-prompt-fingerprint",
    },
  },
  {
    id: "POST /api/v1/route",
    method: "POST",
    path: "/api/v1/route",
    body: true,
    sample: {
      model: "openai/gpt-4.1",
      feature: "schema-summarizer",
      environment: "production",
      inputTokens: 118000,
      cachedInputTokens: 0,
      outputTokens: 900,
    },
  },
  {
    id: "POST /api/v1/chat/completions",
    method: "POST",
    path: "/api/v1/chat/completions",
    body: true,
    sample: {
      model: "recommend",
      messages: [{ role: "user", content: "Summarize this support ticket for a handoff note." }],
      tokenburn: { feature: "support-reply", strategy: "balanced" },
    },
  },
  {
    id: "GET /api/v1/usage",
    method: "GET",
    path: "/api/v1/usage?groupBy=feature",
    body: false,
    sample: null,
  },
  {
    id: "GET /api/v1/models",
    method: "GET",
    path: "/api/v1/models",
    body: false,
    sample: null,
  },
] as const;

export function ApiConsole() {
  const [endpointId, setEndpointId] = React.useState<string>(ENDPOINTS[0].id);
  const endpoint = ENDPOINTS.find((e) => e.id === endpointId) ?? ENDPOINTS[0];
  const [key, setKey] = React.useState("");
  const [body, setBody] = React.useState(() => JSON.stringify(ENDPOINTS[0].sample, null, 2));
  const [response, setResponse] = React.useState<{
    status: number;
    statusText: string;
    ms: number;
    text: string;
    headers: Record<string, string>;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    setBody(endpoint.sample ? JSON.stringify(endpoint.sample, null, 2) : "");
    setResponse(null);
    setError(null);
  }, [endpointId, endpoint.sample]);

  async function send() {
    setError(null);
    setResponse(null);
    if (!key.trim()) {
      setError("Enter a project API key first. Create one from Projects → a project → API keys.");
      return;
    }
    let parsed: unknown = undefined;
    if (endpoint.body) {
      try {
        parsed = body.trim() ? JSON.parse(body) : {};
      } catch {
        setError("Request body is not valid JSON.");
        return;
      }
    }
    setPending(true);
    const started = performance.now();
    try {
      const res = await fetch(endpoint.path, {
        method: endpoint.method,
        headers: {
          authorization: `Bearer ${key.trim()}`,
          ...(endpoint.body ? { "content-type": "application/json" } : {}),
        },
        body: endpoint.body ? JSON.stringify(parsed) : undefined,
      });
      const text = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((value, name) => {
        if (name.startsWith("x-ratelimit") || name === "content-type") headers[name] = value;
      });
      setResponse({
        status: res.status,
        statusText: res.statusText,
        ms: Math.round(performance.now() - started),
        text,
        headers,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  let pretty = response?.text ?? "";
  try {
    if (response) pretty = JSON.stringify(JSON.parse(response.text), null, 2);
  } catch {
    /* keep raw */
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {ENDPOINTS.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setEndpointId(e.id)}
              className={cn(
                "rounded-md border px-2.5 py-1 font-mono text-[10px] transition-colors",
                endpointId === e.id
                  ? "border-hairline-strong bg-white/[0.07] text-ink"
                  : "border-hairline text-ink-faint hover:border-hairline-strong hover:text-ink-muted",
              )}
            >
              <span className={e.method === "GET" ? "text-[#6EE7B7]" : "text-[#FCD34D]"}>{e.method}</span>{" "}
              {e.path.split("?")[0]}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="console-key">Project API key</Label>
          <Input
            id="console-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="tb_live_…"
            autoComplete="off"
            className="font-mono text-[11px]"
          />
          <p className="text-[10.5px] leading-relaxed text-ink-faint">
            Sent as <span className="font-mono">Authorization: Bearer</span> from this browser to your own deployment.
            Keys are hashed server-side; this field is never stored.
          </p>
        </div>

        {endpoint.body ? (
          <div className="space-y-1.5">
            <Label htmlFor="console-body">JSON body</Label>
            <textarea
              id="console-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-3 py-2 font-mono text-[11px] leading-relaxed text-ink shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] transition-colors focus:border-[#6B6B6B] focus:outline-none focus:ring-2 focus:ring-white/[0.06]"
            />
            <p className="text-[10.5px] text-ink-faint">
              Resubmitting the same <span className="font-mono">idempotencyKey</span> returns{" "}
              <span className="font-mono">duplicate: true</span> — that is the dedupe guarantee, not an error.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-hairline-faint bg-white/[0.015] px-3 py-2.5 text-[11px] text-ink-faint">
            No body. The key determines the project scope; <span className="font-mono">GET</span> endpoints accept query
            parameters such as <span className="font-mono">from</span>, <span className="font-mono">to</span>,{" "}
            <span className="font-mono">feature</span>, <span className="font-mono">model</span> and{" "}
            <span className="font-mono">groupBy</span>.
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" onClick={send} disabled={pending} size="sm">
            {pending ? <Loader2 className="animate-spin" /> : <Play className="size-3.5" />}
            {pending ? "Sending…" : "Send request"}
          </Button>
          <span className="font-mono text-[10px] text-ink-faint">{endpoint.method} {endpoint.path}</span>
        </div>
        {error ? (
          <div className="rounded-md border border-accent-rose/30 bg-accent-rose/[0.07] px-3 py-2 text-[11px] text-[#FDA4AF]">
            {error}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-[360px] flex-col rounded-md border border-hairline bg-[#0A0A0A] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex items-center justify-between border-b border-hairline-faint px-3 py-2">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            <TerminalSquare className="size-3.5" />
            Response
          </span>
          {response ? (
            <span className="flex items-center gap-2 font-mono text-[10px]">
              <span
                className={cn(
                  "rounded-full border px-1.5 py-px",
                  response.status < 300
                    ? "border-accent-emerald/35 bg-accent-emerald/10 text-[#6EE7B7]"
                    : response.status < 500
                      ? "border-accent-amber/35 bg-accent-amber/10 text-[#FCD34D]"
                      : "border-accent-rose/35 bg-accent-rose/10 text-[#FDA4AF]",
                )}
              >
                {response.status} {response.statusText}
              </span>
              <span className="text-ink-faint">{response.ms}ms</span>
            </span>
          ) : null}
        </div>
        <div className="flex-1 overflow-auto px-3 py-3">
          {response ? (
            <JsonCode code={pretty} className="border-0 bg-transparent px-0 py-0 shadow-none whitespace-pre-wrap break-words" />
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center text-center text-[11.5px] text-ink-faint">
              Send a request to inspect the normalized response, cost and governance decision.
            </div>
          )}
        </div>
        {response && Object.keys(response.headers).length ? (
          <div className="border-t border-hairline-faint px-3 py-2">
            {Object.entries(response.headers).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-3 font-mono text-[9.5px] text-ink-faint">
                <span>{name}</span>
                <span className="truncate">{value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
