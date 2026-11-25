import type { GatewayRoutingDecision } from "@/lib/db/schema";
import type { PricingLike } from "@/lib/pricing";

export type { GatewayRoutingDecision };

export const GATEWAY_MODES = ["manual", "recommendation", "automatic"] as const;
export type GatewayMode = (typeof GATEWAY_MODES)[number];

export const ROUTING_STRATEGIES = [
  "lowest_cost",
  "best_quality",
  "lowest_latency",
  "balanced",
  "custom",
] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export type GatewayContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type GatewayToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

export type GatewayMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | GatewayContentPart[] | null;
  name?: string;
  tool_calls?: GatewayToolCall[];
  tool_call_id?: string;
};

export type GatewayTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
};

export type GatewayResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean; description?: string };
    };

export type GatewayToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

/** Request body accepted at the gateway (OpenAI chat-completions compatible). */
export type GatewayChatRequest = {
  model?: string;
  messages: GatewayMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  stream?: boolean;
  response_format?: GatewayResponseFormat;
  tools?: GatewayTool[];
  tool_choice?: GatewayToolChoice;
  seed?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  n?: number;
  tokenburn?: {
    mode?: string;
    strategy?: string;
    feature?: string;
    baselineModel?: string;
    environment?: string;
  };
};

export type CatalogModel = PricingLike & { version?: number };

export const TASK_KINDS = [
  "chat",
  "classification",
  "extraction",
  "summarization",
  "code",
  "reasoning",
  "translation",
  "creative",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type TaskClassification = {
  kind: TaskKind;
  complexity: "low" | "medium" | "high";
  confidence: number;
  signals: string[];
  /** Default quality floor applied when the policy does not specify one. */
  minQuality: number;
};

export type TokenEstimate = {
  inputTokens: number;
  outputTokens: number;
  imageTokens: number;
  textChars: number;
  note: string;
};

export type ScoredCandidate = {
  key: string;
  provider: string;
  model: string;
  displayName: string;
  costUsd: number;
  qualityScore: number;
  typicalLatencyMs: number;
  score: number;
  reason: string;
  pricingVersion?: number;
};

export type ExcludedCandidate = { key: string; reason: string };

export type SelectionPolicy = {
  id?: string | null;
  mode?: string | null;
  strategy?: string | null;
  primaryModel?: string | null;
  fallbackModel?: string | null;
  candidates?: string[] | null;
  minQualityScore?: number | null;
  maxLatencyMs?: number | null;
  maxOutputTokens?: number | null;
};

export type SelectionContext = {
  allowedModels?: string[] | null;
  blockedModels?: string[] | null;
  fallbackModel?: string | null;
  policy?: SelectionPolicy | null;
  /** Providers with a stored credential. Empty means nothing can execute yet. */
  availableProviders: Iterable<string>;
  /** Remaining hard-budget headroom in USD, or null when no hard budget applies. */
  budgetRemainingUsd?: number | null;
  mode?: GatewayMode | null;
  requestedModel?: string | null;
};

export type ModelSelectionError = {
  code: string;
  message: string;
};

export type ModelSelection = {
  mode: GatewayMode;
  strategy: RoutingStrategy;
  task: TaskClassification;
  estimate: TokenEstimate;
  selected: ScoredCandidate | null;
  candidates: ScoredCandidate[];
  excluded: ExcludedCandidate[];
  /** Model keys to try after the selected model fails at the provider level. */
  fallbackChain: string[];
  baseline: { key: string; costUsd: number } | null;
  policyId: string | null;
  error: ModelSelectionError | null;
  decision: GatewayRoutingDecision;
};

export function normalizeGatewayMode(value: string | null | undefined): GatewayMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "manual") return "manual";
  if (normalized === "recommendation" || normalized === "recommend") return "recommendation";
  if (normalized === "automatic" || normalized === "auto") return "automatic";
  return null;
}

export function normalizeStrategy(value: string | null | undefined): RoutingStrategy | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "lowest_cost" || normalized === "cost_optimized" || normalized === "cost") return "lowest_cost";
  if (normalized === "best_quality" || normalized === "quality_first" || normalized === "quality") return "best_quality";
  if (normalized === "lowest_latency" || normalized === "latency") return "lowest_latency";
  if (normalized === "balanced") return "balanced";
  if (normalized === "custom" || normalized === "fallback_only") return "custom";
  return null;
}

/** Flattens string or multi-part content into plain text (images are counted separately). */
export function messageText(content: GatewayMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function imagePartCount(content: GatewayMessage["content"]): number {
  if (!Array.isArray(content)) return 0;
  return content.filter((part) => part.type === "image_url").length;
}

export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}
