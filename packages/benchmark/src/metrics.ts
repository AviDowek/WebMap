/**
 * Benchmark metric computation and summary printing.
 */

import type { TaskResult, AggregateMetrics, BenchmarkResult, MultiRunTaskResult } from "./types.js";

export function computeMetrics(results: TaskResult[]): AggregateMetrics {
  const total = results.length;
  const successes = results.filter((r) => r.success).length;
  const totalTokens = results.reduce((s, r) => s + r.tokensUsed, 0);
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  const totalSteps = results.reduce((s, r) => s + r.steps, 0);

  const successRate = total > 0 ? successes / total : 0;

  // Wilson score confidence interval for binomial proportion
  const ci = total >= 2 ? wilsonConfidenceInterval(successes, total, 0.05) : undefined;

  // Verification override rate
  const verifiedResults = results.filter((r) => r.verified !== undefined);
  const overrides = verifiedResults.filter(
    (r) => r.selfReportedSuccess !== undefined && r.selfReportedSuccess !== r.success
  );
  const verificationOverrideRate =
    verifiedResults.length > 0 ? overrides.length / verifiedResults.length : undefined;

  return {
    totalTasks: total,
    successRate,
    avgTokensPerTask: total > 0 ? totalTokens / total : 0,
    avgDurationMs: total > 0 ? totalDuration / total : 0,
    avgSteps: total > 0 ? totalSteps / total : 0,
    confidenceInterval95: ci,
    verificationOverrideRate,
  };
}

/**
 * Wilson score confidence interval for a binomial proportion.
 * More accurate than normal approximation for small samples and extreme probabilities.
 * https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval
 */
export function wilsonConfidenceInterval(
  successes: number,
  total: number,
  alpha: number
): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 0 };

  // z-score for confidence level (alpha=0.05 → z=1.96)
  const z = alpha === 0.05 ? 1.96 : alpha === 0.01 ? 2.576 : 1.96;
  const p = successes / total;
  const n = total;

  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);

  return {
    lower: Math.max(0, (centre - margin) / denominator),
    upper: Math.min(1, (centre + margin) / denominator),
  };
}

/**
 * Aggregate multiple runs of the same task into a single result.
 * The aggregated TaskResult uses majority-vote success and averaged metrics.
 */
export function aggregateRuns(runs: TaskResult[]): MultiRunTaskResult {
  if (runs.length === 0) throw new Error("Cannot aggregate 0 runs");

  const taskId = runs[0].taskId;
  const successes = runs.filter((r) => r.success).length;
  const totalRuns = runs.length;
  const successRate = successes / totalRuns;

  const avgTokensUsed = runs.reduce((s, r) => s + r.tokensUsed, 0) / totalRuns;
  const avgDurationMs = runs.reduce((s, r) => s + r.durationMs, 0) / totalRuns;
  const avgSteps = runs.reduce((s, r) => s + r.steps, 0) / totalRuns;

  // Majority vote for the aggregated success
  const majoritySuccess = successes > totalRuns / 2;

  // Pick the run closest to the median for the representative result
  const medianRun = [...runs].sort((a, b) => a.tokensUsed - b.tokensUsed)[
    Math.floor(totalRuns / 2)
  ];

  return {
    taskId,
    runs,
    totalRuns,
    successes,
    successRate,
    avgTokensUsed,
    avgDurationMs,
    avgSteps,
    aggregated: {
      ...medianRun,
      taskId,
      success: majoritySuccess,
      tokensUsed: Math.round(avgTokensUsed),
      durationMs: Math.round(avgDurationMs),
      steps: Math.round(avgSteps),
    },
  };
}

export function printBenchmarkSummary(result: BenchmarkResult): void {
  const { baseline, withDocs, improvement } = result.summary;

  console.log("\n" + "=".repeat(60));
  console.log("  CUA BENCHMARK RESULTS");
  console.log("=".repeat(60));
  console.log("");
  console.log("                    Baseline    With Docs    Delta");
  console.log("  ─────────────────────────────────────────────────");
  console.log(
    `  Success Rate      ${(baseline.successRate * 100).toFixed(1)}%        ${(withDocs.successRate * 100).toFixed(1)}%         ${improvement.successRateDelta > 0 ? "+" : ""}${(improvement.successRateDelta * 100).toFixed(1)}pp`
  );
  if (baseline.confidenceInterval95) {
    console.log(
      `    95% CI          [${(baseline.confidenceInterval95.lower * 100).toFixed(1)}%, ${(baseline.confidenceInterval95.upper * 100).toFixed(1)}%]    [${(withDocs.confidenceInterval95?.lower ?? 0 * 100).toFixed(1)}%, ${(withDocs.confidenceInterval95?.upper ?? 0 * 100).toFixed(1)}%]`
    );
  }
  console.log(
    `  Avg Tokens        ${baseline.avgTokensPerTask.toFixed(0)}        ${withDocs.avgTokensPerTask.toFixed(0)}         ${improvement.tokenReduction > 0 ? "-" : "+"}${Math.abs(improvement.tokenReduction).toFixed(1)}%`
  );
  console.log(
    `  Avg Duration      ${(baseline.avgDurationMs / 1000).toFixed(1)}s        ${(withDocs.avgDurationMs / 1000).toFixed(1)}s         ${improvement.speedup.toFixed(2)}x`
  );
  console.log(
    `  Avg Steps         ${baseline.avgSteps.toFixed(1)}          ${withDocs.avgSteps.toFixed(1)}          ${(withDocs.avgSteps - baseline.avgSteps).toFixed(1)}`
  );
  if (baseline.verificationOverrideRate !== undefined) {
    console.log(
      `  Verify Overrides  ${(baseline.verificationOverrideRate * 100).toFixed(1)}%        ${((withDocs.verificationOverrideRate ?? 0) * 100).toFixed(1)}%`
    );
  }
  console.log("=".repeat(60));
}
