import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cacheLadder, compareModels, forecastMonth, simulate, type SimModel } from "@/lib/studio";

const gpt41: SimModel = {
  key: "gpt-4.1",
  label: "GPT-4.1",
  provider: "openai",
  inputPerM: 2,
  cachedInputPerM: 0.5,
  outputPerM: 8,
  cacheWritePerM: null,
  qualityScore: 92,
  latencyMs: 900,
  contextWindow: 1_000_000,
  maxOutput: 32_768,
};

const mini: SimModel = {
  ...gpt41,
  key: "gpt-4.1-mini",
  label: "GPT-4.1 mini",
  inputPerM: 0.4,
  cachedInputPerM: 0.1,
  outputPerM: 1.6,
  qualityScore: 84,
  latencyMs: 650,
  contextWindow: 128_000,
  maxOutput: 16_384,
};

const workload = { requests: 1, avgInput: 1_000_000, avgOutput: 1_000_000, cachedShare: 0.25 };

describe("studio simulation math", () => {
  it("prices through the authoritative cost engine with cached input", () => {
    const result = simulate(gpt41, workload);
    // 750k uncached * $2/M + 250k cached * $0.5/M + 1M output * $8/M
    assert.equal(result.costUsd, 9.625);
    assert.equal(result.inputTokens, 1_000_000);
    assert.equal(result.cachedInputTokens, 250_000);
    assert.equal(result.outputUsd, 8);
  });

  it("applies context and output reductions and clamps invalid values", () => {
    const half = simulate(gpt41, workload, { inputReduction: 0.5, outputReduction: 0.2 });
    assert.equal(half.inputTokens, 500_000);
    assert.equal(half.cachedInputTokens, 125_000);
    assert.equal(half.outputTokens, 800_000);

    const clampedHigh = simulate(gpt41, workload, { inputReduction: 4, outputReduction: 4 });
    assert.equal(clampedHigh.inputTokens, 0);
    assert.equal(clampedHigh.outputTokens, 0);

    const clampedLow = simulate(gpt41, workload, { inputReduction: -2, outputReduction: -2 });
    assert.equal(clampedLow.inputTokens, 1_000_000);
    assert.equal(clampedLow.outputTokens, 1_000_000);
  });

  it("compares a baseline against a reduced candidate without mixing them up", () => {
    const cmp = compareModels(gpt41, mini, { ...workload, requests: 100, avgInput: 10_000, avgOutput: 2_000 }, {
      inputReduction: 0.2,
      outputReduction: 0.1,
    });
    assert.ok(cmp.baseline.costUsd > 0);
    assert.ok(cmp.optimized.costUsd < cmp.baseline.costUsd);
    assert.ok(Math.abs(cmp.inputTokenDeltaPct - 0.2) < 1e-9);
    assert.ok(Math.abs(cmp.outputTokenDeltaPct - 0.1) < 1e-9);
    assert.equal(cmp.qualityDelta, -8);
    assert.equal(cmp.latencyDeltaMs, -250);
    assert.equal(cmp.contextFit, true);
    assert.equal(cmp.outputFit, true);
  });

  it("flags workloads that no longer fit the candidate limits", () => {
    const cmp = compareModels(gpt41, mini, { requests: 10, avgInput: 200_000, avgOutput: 1_000, cachedShare: 0 });
    assert.equal(cmp.contextFit, false);
  });

  it("produces a monotonic cache ladder from the same engine", () => {
    const ladder = cacheLadder(gpt41, { ...workload, requests: 1000, avgInput: 8_000, avgOutput: 500 });
    assert.deepEqual(
      ladder.map((row) => row.sharePct),
      [0, 20, 40, 60, 80],
    );
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(ladder[i]!.costUsd <= ladder[i - 1]!.costUsd);
      assert.ok(ladder[i]!.savedUsd >= ladder[i - 1]!.savedUsd);
    }
    assert.equal(ladder[0]!.savedUsd, 0);
  });

  it("extrapolates run-rate with growth and routing ratios", () => {
    const f = forecastMonth({ mtdCost: 150, dayOfMonth: 15, daysInMonth: 30, growthPct: 10, routingRatio: 0.5 });
    assert.equal(f.dailyRate, 10);
    assert.equal(f.projected, 330);
    assert.equal(f.projectedRouted, 165);
  });

  it("survives a zero-length month without dividing by zero", () => {
    const f = forecastMonth({ mtdCost: 0, dayOfMonth: 0, daysInMonth: 30 });
    assert.equal(f.dailyRate, 0);
    assert.equal(f.projected, 0);
  });
});
