import { eq } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import {
  evaluationResults,
  modelEvaluations,
  type EvaluationCase,
  type EvaluationModelSummary,
} from "@/lib/db/schema";
import { getActiveCatalog, type PricingRecord } from "@/lib/pricing-db";
import { computeCost } from "@/lib/pricing";
import { completeChat } from "./transport";
import { resolveCatalogModel } from "./selection";
import { modelKey } from "./types";

export const EVALUATION_LIMITS = {
  maxCases: 20,
  maxModels: 5,
  defaultMaxOutputTokens: 512,
};

export type EvaluationInput = {
  orgId: string;
  projectId: string;
  name: string;
  baselineModel: string | null;
  candidateModels: string[];
  dataset: EvaluationCase[];
  credentials: Map<string, string>;
  createdBy?: string | null;
  fetchImpl?: typeof fetch;
};

export type EvaluationRunResult = {
  id: string;
  status: "completed" | "failed";
  summary: { models: EvaluationModelSummary[] } | null;
  error: string | null;
};

type CaseExecution = {
  caseId: string;
  model: string;
  status: "success" | "error" | "skipped";
  passed: boolean;
  qualityScore: number | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  usageSource: string;
  finishReason: string | null;
  outputExcerpt: string | null;
  errorCode: string | null;
};

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1),
  );
}

function keywordCoverage(output: string, keywords: string[] | undefined): number {
  if (!keywords?.length) return 1;
  const haystack = output.toLowerCase();
  const present = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
  return present / keywords.length;
}

function similarity(output: string, reference: string | undefined): number | null {
  if (!reference) return null;
  const expected = tokenSet(reference);
  const actual = tokenSet(output);
  if (!expected.size || !actual.size) return 0;
  let overlap = 0;
  for (const token of expected) if (actual.has(token)) overlap++;
  const jaccard = overlap / new Set([...expected, ...actual]).size;
  const containment = overlap / expected.size;
  return Math.max(jaccard, containment * 0.85);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[index]!;
}

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function scoreCase(
  testCase: EvaluationCase,
  output: string,
  latencyMs: number,
): { passed: boolean; qualityScore: number; failures: string[] } {
  const failures: string[] = [];
  let parsedJson: unknown = null;
  let validJson = true;
  if (testCase.mustBeJson) {
    try {
      parsedJson = JSON.parse(output);
    } catch {
      validJson = false;
      failures.push("output is not valid JSON");
    }
  }
  if (!output.trim() && parsedJson === null) failures.push("empty output");

  const coverage = keywordCoverage(output, testCase.expectedKeywords);
  if (coverage < 1) {
    const missing = (testCase.expectedKeywords ?? []).filter(
      (keyword) => !output.toLowerCase().includes(keyword.toLowerCase()),
    );
    failures.push(`missing keywords: ${missing.join(", ")}`);
  }
  const refSimilarity = similarity(output, testCase.referenceAnswer);
  if (refSimilarity !== null && refSimilarity < 0.25) {
    failures.push(`reference similarity ${refSimilarity.toFixed(2)} is below 0.25`);
  }
  const latencyOk = testCase.maxLatencyMs ? latencyMs <= testCase.maxLatencyMs : true;
  if (!latencyOk) failures.push(`latency ${latencyMs}ms exceeded ${testCase.maxLatencyMs}ms`);

  let quality = 50;
  quality += coverage * 30;
  quality += refSimilarity === null ? 10 : refSimilarity * 15;
  quality += latencyOk ? 5 : 0;
  if (!output.trim() && parsedJson === null) quality -= 35;
  if (!validJson) quality -= 20;

  return {
    passed: failures.length === 0,
    qualityScore: Math.max(0, Math.min(100, Math.round(quality))),
    failures,
  };
}

function summarize(model: string, cases: CaseExecution[]): EvaluationModelSummary {
  const executed = cases.filter((row) => row.status !== "skipped");
  const successes = executed.filter((row) => row.status === "success");
  const failures = cases.filter((row) => row.status === "error").length;
  const passed = executed.filter((row) => row.passed).length;
  const qualities = executed
    .map((row) => row.qualityScore)
    .filter((value): value is number => value !== null);
  const latencies = executed.map((row) => row.latencyMs).sort((a, b) => a - b);
  const totalCostUsd = executed.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  return {
    model,
    cases: cases.length,
    successes: successes.length,
    failures,
    passed,
    taskSuccessRate: cases.length ? round(passed / cases.length, 4) : 0,
    averageQuality: qualities.length
      ? Math.round(qualities.reduce((sum, value) => sum + value, 0) / qualities.length)
      : null,
    p95LatencyMs: percentile(latencies, 0.95),
    totalCostUsd: round(totalCostUsd),
    costPerSuccessUsd: passed ? round(totalCostUsd / passed) : null,
    inputTokens: executed.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: executed.reduce((sum, row) => sum + row.outputTokens, 0),
  };
}

/**
 * Runs a deterministic, provider-backed evaluation. Each case is executed once per model;
 * provider-reported usage is priced with the active catalog. Failures are recorded rather than
 * thrown so partial results remain visible.
 */
export async function runEvaluation(db: AppDb, input: EvaluationInput): Promise<EvaluationRunResult> {
  const [evaluation] = await db
    .insert(modelEvaluations)
    .values({
      orgId: input.orgId,
      projectId: input.projectId,
      name: input.name.slice(0, 160),
      status: "running",
      baselineModel: input.baselineModel,
      candidateModels: input.candidateModels,
      dataset: input.dataset,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: modelEvaluations.id });
  const evaluationId = evaluation!.id;

  try {
    const catalog = await getActiveCatalog(db);
    const requested = [...(input.baselineModel ? [input.baselineModel] : []), ...input.candidateModels];
    const models: Array<{ key: string; entry: PricingRecord }> = [];
    const excluded: string[] = [];
    for (const raw of requested) {
      const resolved = resolveCatalogModel(catalog, raw);
      if (!resolved) {
        excluded.push(`${raw}: not in the active pricing catalog`);
        continue;
      }
      const entry = catalog.find(
        (row) => row.provider === resolved.provider && row.model === resolved.model,
      );
      if (!entry) {
        excluded.push(`${raw}: not in the active pricing catalog`);
        continue;
      }
      const key = modelKey(entry.provider, entry.model);
      if (!models.some((model) => model.key === key)) models.push({ key, entry });
    }

    if (!models.length) {
      const error = excluded.join("; ") || "No models could be resolved.";
      await db
        .update(modelEvaluations)
        .set({ status: "failed", error, completedAt: new Date() })
        .where(eq(modelEvaluations.id, evaluationId));
      return { id: evaluationId, status: "failed", summary: null, error };
    }

    const results: CaseExecution[] = [];
    for (const model of models) {
      for (const testCase of input.dataset) {
        const apiKey = input.credentials.get(model.entry.provider);
        if (!apiKey) {
          results.push({
            caseId: testCase.id,
            model: model.key,
            status: "skipped",
            passed: false,
            qualityScore: null,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: null,
            usageSource: "unavailable",
            finishReason: null,
            outputExcerpt: null,
            errorCode: "provider_not_configured",
          });
          continue;
        }

        try {
          const completion = await completeChat({
            provider: model.entry.provider as Parameters<typeof completeChat>[0]["provider"],
            model: model.entry.model,
            apiKey,
            request: {
              messages: [
                ...(testCase.system ? [{ role: "system" as const, content: testCase.system }] : []),
                { role: "user" as const, content: testCase.prompt },
              ],
              ...(testCase.mustBeJson ? { response_format: { type: "json_object" as const } } : {}),
            },
            maxOutputTokens: Math.min(
              EVALUATION_LIMITS.defaultMaxOutputTokens,
              model.entry.maxOutput,
            ),
            fetchImpl: input.fetchImpl,
          });
          const output =
            completion.content ||
            (completion.toolCalls.length > 0
              ? (completion.toolCalls[0]?.function?.arguments ?? "")
              : "");
          const scored = scoreCase(testCase, output, completion.latencyMs);
          const usage = completion.usage;
          results.push({
            caseId: testCase.id,
            model: model.key,
            status: "success",
            passed: scored.passed,
            qualityScore: scored.qualityScore,
            latencyMs: completion.latencyMs,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            costUsd: usage ? computeCost(model.entry, usage).costUsd : null,
            usageSource: usage ? "provider_reported" : "unreported",
            finishReason: completion.finishReason,
            outputExcerpt: output.slice(0, 500),
            errorCode: scored.failures.length ? "case_failed" : null,
          });
        } catch (error) {
          const info =
            error && typeof error === "object" && "info" in error
              ? ((error as { info?: { code?: string } }).info?.code ?? "provider_error")
              : "provider_error";
          results.push({
            caseId: testCase.id,
            model: model.key,
            status: "error",
            passed: false,
            qualityScore: null,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: null,
            usageSource: "unavailable",
            finishReason: null,
            outputExcerpt: null,
            errorCode: info,
          });
        }
      }
    }

    await db.insert(evaluationResults).values(
      results.map((row) => ({
        orgId: input.orgId,
        evaluationId,
        model: row.model,
        caseId: row.caseId,
        status: row.status,
        passed: row.passed,
        qualityScore: row.qualityScore,
        latencyMs: row.latencyMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: row.costUsd === null ? null : row.costUsd.toFixed(6),
        usageSource: row.usageSource,
        finishReason: row.finishReason,
        outputExcerpt: row.outputExcerpt,
        errorCode: row.errorCode,
      })),
    );

    const summary = {
      models: models.map((model) =>
        summarize(
          model.key,
          results.filter((row) => row.model === model.key),
        ),
      ),
    };
    const error = excluded.length ? `Excluded models: ${excluded.join("; ")}` : null;
    await db
      .update(modelEvaluations)
      .set({ status: "completed", summary, error, completedAt: new Date() })
      .where(eq(modelEvaluations.id, evaluationId));

    return { id: evaluationId, status: "completed", summary, error };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Evaluation failed";
    await db
      .update(modelEvaluations)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(eq(modelEvaluations.id, evaluationId));
    return { id: evaluationId, status: "failed", summary: null, error: message };
  }
}
