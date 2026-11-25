import { computeCost, type PricingLike } from "@/lib/pricing";
import {
  imagePartCount,
  messageText,
  type GatewayChatRequest,
  type TaskClassification,
  type TokenEstimate,
} from "./types";

const MESSAGE_OVERHEAD = 4;
const PRIMING_OVERHEAD = 3;
/** Coarse image allowance. Real image token counts depend on resolution and detail. */
const IMAGE_TOKENS = 1_024;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function countTextTokens(text: string): { tokens: number; chars: number } {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 128) ascii++;
    else nonAscii++;
  }
  // English-like text is ≈4 characters per token; non-ASCII scripts are closer to 1 token per
  // character. Both are approximations and are labelled as such in the UI.
  return { tokens: Math.ceil(ascii / 4) + nonAscii, chars: ascii + nonAscii };
}

/**
 * Estimates prompt and completion tokens before a call. Estimates are deterministic heuristics,
 * never provider usage: callers must label estimated usage separately from provider-reported usage.
 */
export function estimateTokens(
  request: GatewayChatRequest,
  task: TaskClassification,
  options: { policyMaxOutputTokens?: number | null } = {},
): TokenEstimate {
  let textChars = 0;
  let textTokens = 0;
  let images = 0;

  for (const message of request.messages) {
    const text = messageText(message.content);
    const counted = countTextTokens(text);
    textChars += counted.chars;
    textTokens += counted.tokens + MESSAGE_OVERHEAD;
    images += imagePartCount(message.content);
    if (message.tool_calls?.length) {
      const serialized = JSON.stringify(message.tool_calls);
      const countedCalls = countTextTokens(serialized);
      textChars += countedCalls.chars;
      textTokens += countedCalls.tokens;
    }
  }

  if (request.tools?.length) {
    const serialized = JSON.stringify(request.tools);
    const counted = countTextTokens(serialized);
    textChars += counted.chars;
    textTokens += counted.tokens;
  }
  if (request.response_format && request.response_format.type !== "text") {
    const serialized = JSON.stringify(request.response_format);
    const counted = countTextTokens(serialized);
    textChars += counted.chars;
    textTokens += counted.tokens;
  }

  const inputTokens = Math.max(1, textTokens + images * IMAGE_TOKENS + PRIMING_OVERHEAD);

  let heuristic: number;
  switch (task.kind) {
    case "classification":
      heuristic = 32;
      break;
    case "extraction":
      heuristic = 220;
      break;
    case "summarization":
      heuristic = clamp(Math.round(inputTokens * 0.22), 120, 900);
      break;
    case "code":
      heuristic = clamp(Math.round(inputTokens * 0.6), 250, 2_000);
      break;
    case "reasoning":
      heuristic = clamp(Math.round(inputTokens * 0.9), 500, 3_500);
      break;
    case "translation":
      heuristic = clamp(Math.round(inputTokens * 1.05), 120, 2_000);
      break;
    case "creative":
      heuristic = clamp(Math.round(inputTokens * 0.8), 200, 1_600);
      break;
    default:
      heuristic = clamp(Math.round(inputTokens * 0.45), 80, 700);
      break;
  }
  if (request.tools?.length) heuristic = Math.max(heuristic, 200);
  if (request.response_format && request.response_format.type !== "text") heuristic = Math.max(heuristic, 180);

  const requestedCap = request.max_tokens ?? request.max_completion_tokens ?? options.policyMaxOutputTokens ?? null;
  const outputTokens = requestedCap && requestedCap > 0 ? Math.min(heuristic, requestedCap) : heuristic;

  return {
    inputTokens,
    outputTokens: Math.max(1, outputTokens),
    imageTokens: images * IMAGE_TOKENS,
    textChars,
    note: `Heuristic estimate: ASCII text at ~4 chars/token, 4 tokens per message, ${IMAGE_TOKENS} per image${
      images ? `, ${images} image${images === 1 ? "" : "s"}` : ""
    }; completion sized for ${task.kind} (${task.complexity} complexity).`,
  };
}

/** Estimates cost for a candidate model. Cache discounts are not assumed. */
export function costForEstimate(pricing: PricingLike, estimate: TokenEstimate): number {
  return computeCost(pricing, {
    inputTokens: estimate.inputTokens,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: estimate.outputTokens,
    reasoningTokens: 0,
  }).costUsd;
}

export function requestedOutputCap(request: GatewayChatRequest): number | null {
  const cap = request.max_tokens ?? request.max_completion_tokens;
  return typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? cap : null;
}
