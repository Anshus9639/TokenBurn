import test from "node:test";
import assert from "node:assert/strict";
import { PRICING_CATALOG, computeCost } from "@/lib/pricing";
import { classifyTask } from "@/lib/gateway/classify";
import { estimateTokens } from "@/lib/gateway/estimate";
import { resolveCatalogModel, selectModel } from "@/lib/gateway/selection";
import { computeRealizedSavings, estimatedSavings } from "@/lib/gateway/savings";
import type { CatalogModel, GatewayChatRequest, SelectionContext } from "@/lib/gateway/types";

const catalog: CatalogModel[] = PRICING_CATALOG.map((seed) => ({ ...seed, version: 1 }));
const ALL_PROVIDERS = ["openai", "anthropic", "gemini", "groq", "mistral"];

function request(overrides: Partial<GatewayChatRequest> = {}): GatewayChatRequest {
  return { messages: [{ role: "user", content: "Hello there" }], ...overrides };
}

function context(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return { availableProviders: ALL_PROVIDERS, ...overrides };
}

function find(modelKey: string): CatalogModel {
  const entry = resolveCatalogModel(catalog, modelKey);
  assert.ok(entry, `catalog entry ${modelKey} should exist`);
  return entry;
}

test("gateway task classification", () => {
  const extraction = classifyTask(
    request({
      messages: [{ role: "user", content: "Extract the invoice number and return JSON only." }],
      response_format: { type: "json_object" },
    }),
  );
  assert.equal(extraction.kind, "extraction");
  assert.ok(extraction.signals.includes("json response format"));

  const reasoning = classifyTask(
    request({ messages: [{ role: "user", content: "Prove step by step why this recurrence converges." }] }),
  );
  assert.equal(reasoning.kind, "reasoning");
  assert.equal(reasoning.complexity, "low");

  const code = classifyTask(
    request({ messages: [{ role: "user", content: "Fix this TypeScript function:\n```ts\nconst x = ;\n```" }] }),
  );
  assert.equal(code.kind, "code");

  const summary = classifyTask(request({ messages: [{ role: "user", content: "Summarize these meeting notes." }] }));
  assert.equal(summary.kind, "summarization");

  const plain = classifyTask(request({ messages: [{ role: "user", content: "What are your opening hours?" }] }));
  assert.equal(plain.kind, "chat");
});

test("gateway token estimates are bounded by max_tokens", () => {
  const classification = classifyTask(request({ messages: [{ role: "user", content: "Classify this intent." }] }));
  const estimate = estimateTokens(
    request({ messages: [{ role: "user", content: "Classify this intent." }], max_tokens: 16 }),
    classification,
  );
  assert.equal(estimate.outputTokens, 16);
  assert.ok(estimate.inputTokens >= 1);
  assert.match(estimate.note, /Heuristic estimate/);

  const long = estimateTokens(
    request({ messages: [{ role: "user", content: "word ".repeat(4_000) }] }),
    classification,
  );
  assert.ok(long.inputTokens > 2_000);
});

test("manual mode uses the requested model and never substitutes", () => {
  const selection = selectModel(request({ model: "openai/gpt-4.1" }), catalog, context());
  assert.equal(selection.mode, "manual");
  assert.equal(selection.error, null);
  assert.equal(selection.selected?.key, "openai/gpt-4.1");
  assert.equal(selection.baseline?.key, "openai/gpt-4.1");

  const blocked = selectModel(
    request({ model: "openai/gpt-4.1" }),
    catalog,
    context({ blockedModels: ["gpt-4.1"] }),
  );
  assert.equal(blocked.selected, null);
  assert.equal(blocked.error?.code, "model_blocked");

  const missing = selectModel(
    request({ model: "openai/gpt-4.1" }),
    catalog,
    context({ availableProviders: ["groq"] }),
  );
  assert.equal(missing.error?.code, "provider_not_configured");

  const unknown = selectModel(request({ model: "openai/not-a-model" }), catalog, context());
  assert.equal(unknown.error?.code, "model_not_found");
});

test("automatic lowest-cost routing respects the task quality floor", () => {
  const chat = selectModel(
    request({ model: "auto", tokenburn: { mode: "automatic", strategy: "lowest_cost" } }),
    catalog,
    context(),
  );
  assert.equal(chat.error, null);
  assert.equal(chat.selected?.key, "groq/llama-3.1-8b-instant");

  const reasoning = selectModel(
    request({
      model: "auto",
      tokenburn: { mode: "automatic", strategy: "lowest_cost" },
      messages: [{ role: "user", content: "Prove step by step why this series diverges." }],
    }),
    catalog,
    context(),
  );
  assert.equal(reasoning.error, null);
  assert.ok((reasoning.selected?.qualityScore ?? 0) >= 82);
});

test("automatic best-quality routing honors remaining budget headroom", () => {
  const unconstrained = selectModel(
    request({ model: "auto", tokenburn: { mode: "automatic", strategy: "best_quality" } }),
    catalog,
    context(),
  );
  assert.equal(unconstrained.selected?.key, "anthropic/claude-opus-4");

  const smallPrompt = request({ model: "auto", tokenburn: { mode: "automatic", strategy: "best_quality" } });
  const task = classifyTask(smallPrompt);
  const estimate = estimateTokens(smallPrompt, task);
  const cheap = find("openai/gpt-4.1-mini");
  const budget = computeCost(cheap, { inputTokens: estimate.inputTokens, outputTokens: estimate.outputTokens }).costUsd;

  const constrained = selectModel(smallPrompt, catalog, context({ budgetRemainingUsd: budget }));
  assert.equal(constrained.error, null);
  assert.notEqual(constrained.selected?.key, "anthropic/claude-opus-4");
  assert.ok((constrained.selected?.costUsd ?? Infinity) <= budget + 1e-9);
});

test("automatic lowest-latency routing prefers the fastest qualifying model", () => {
  const selection = selectModel(
    request({ model: "auto", tokenburn: { mode: "automatic", strategy: "lowest_latency" } }),
    catalog,
    context(),
  );
  assert.equal(selection.error, null);
  assert.equal(selection.selected?.key, "groq/llama-3.1-8b-instant");
});

test("organization restrictions and provider availability are hard filters", () => {
  const allowListed = selectModel(
    request({ model: "auto", tokenburn: { mode: "automatic", strategy: "lowest_cost" } }),
    catalog,
    context({ allowedModels: ["openai/gpt-4.1"] }),
  );
  assert.equal(allowListed.selected?.key, "openai/gpt-4.1");

  const onlyGroq = selectModel(
    request({ model: "auto", tokenburn: { mode: "automatic", strategy: "best_quality" } }),
    catalog,
    context({ availableProviders: ["groq"] }),
  );
  assert.equal(onlyGroq.selected?.key, "groq/llama-3.3-70b-versatile");

  const none = selectModel(
    request({ model: "auto" }),
    catalog,
    context({ availableProviders: [] }),
  );
  assert.equal(none.error?.code, "no_configured_provider");

  const budget = selectModel(
    request({ model: "auto" }),
    catalog,
    context({ budgetRemainingUsd: 0 }),
  );
  assert.equal(budget.error?.code, "budget_exhausted");
});

test("automatic mode stays inside the policy candidate set and fallback", () => {
  const policy = {
    id: "policy-1",
    mode: "automatic",
    strategy: "balanced",
    primaryModel: "openai/gpt-4.1",
    fallbackModel: "openai/gpt-4.1-mini",
    candidates: ["openai/gpt-4.1", "openai/gpt-4.1-mini"],
  };
  const selection = selectModel(request({ model: "auto" }), catalog, context({ policy }));
  assert.equal(selection.error, null);
  assert.equal(selection.policyId, "policy-1");
  assert.ok(["openai/gpt-4.1", "openai/gpt-4.1-mini"].includes(selection.selected?.key ?? ""));
  assert.equal(selection.baseline?.key, "openai/gpt-4.1");
  const other = selection.selected?.key === "openai/gpt-4.1" ? "openai/gpt-4.1-mini" : "openai/gpt-4.1";
  assert.ok(selection.fallbackChain.includes(other));

  const blockedPrimary = selectModel(
    request({ model: "auto" }),
    catalog,
    context({ policy, blockedModels: ["openai/gpt-4.1"] }),
  );
  assert.equal(blockedPrimary.selected?.key, "openai/gpt-4.1-mini");
});

test("custom strategy follows the explicit candidate order", () => {
  const policy = {
    id: "policy-2",
    mode: "automatic",
    strategy: "custom",
    candidates: ["openai/gpt-4.1-mini", "openai/gpt-4.1"],
  };
  const selection = selectModel(request({ model: "auto" }), catalog, context({ policy }));
  assert.equal(selection.selected?.key, "openai/gpt-4.1-mini");
  assert.equal(selection.strategy, "custom");
});

test("recommendation mode scores the full catalog without executing a policy", () => {
  const policy = {
    id: "policy-3",
    mode: "automatic",
    strategy: "balanced",
    candidates: ["openai/gpt-4.1"],
  };
  const selection = selectModel(request({ model: "recommend" }), catalog, context({ policy }));
  assert.equal(selection.mode, "recommendation");
  assert.ok(selection.selected);
  assert.notEqual(selection.selected?.key, "openai/gpt-4.1");
  assert.equal(selection.decision.mode, "recommendation");
});

test("context windows exclude models that cannot fit the estimate", () => {
  const huge = "word ".repeat(500_000);
  const selection = selectModel(
    request({ model: "openai/gpt-4o", messages: [{ role: "user", content: huge }] }),
    catalog,
    context(),
  );
  assert.equal(selection.error?.code, "context_window_exceeded");
});

test("realized savings require provider-reported usage and baseline pricing", () => {
  const usage = { inputTokens: 1_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 500, reasoningTokens: 0 };
  const baseline = find("openai/gpt-4.1");
  const selected = find("openai/gpt-4.1-mini");
  const actualCost = computeCost(selected, usage).costUsd;

  const realized = computeRealizedSavings({
    usage,
    actualCostUsd: actualCost,
    usageSource: "provider_reported",
    baselinePricing: baseline,
  });
  assert.equal(realized.realized, true);
  assert.ok((realized.realizedSavingsUsd ?? 0) > 0);
  assert.equal(realized.baselineCostUsd, 0.006);

  const estimated = computeRealizedSavings({
    usage,
    actualCostUsd: actualCost,
    usageSource: "estimated",
    baselinePricing: baseline,
  });
  assert.equal(estimated.realized, false);
  assert.equal(estimated.realizedSavingsUsd, null);

  const noPricing = computeRealizedSavings({
    usage,
    actualCostUsd: actualCost,
    usageSource: "provider_reported",
    baselinePricing: null,
  });
  assert.equal(noPricing.realized, false);

  assert.equal(estimatedSavings(0.01, 0.004), 0.006);
  assert.equal(estimatedSavings(null, 0.004), null);
});
