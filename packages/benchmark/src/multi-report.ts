/**
 * Multi-method benchmark report generator.
 * Produces markdown reports from MultiMethodBenchmarkResult data.
 * Costs are computed from actual per-task estimatedCostUsd (model-aware, cache-aware).
 * Verification overhead is reported separately and never included in task cost.
 */

import type {
  MultiMethodBenchmarkResult,
  MethodResult,
  DocMethod,
  TaskResult,
} from "./types.js";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatCost(usd: number): string {
  if (usd < 0.0001) return "$0.0000";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

function padLeft(str: string, len: number): string {
  return " ".repeat(Math.max(0, len - str.length)) + str;
}

const METHOD_SHORT: Record<DocMethod, string> = {
  "none": "Baseline",
  "micro-guide": "Micro Guide",
  "full-guide": "Full Guide",
  "first-message": "First Msg",
  "pre-plan": "Pre-Plan",
  "a11y-tree": "A11y Tree",
  "hybrid": "Hybrid",
  "a11y-first-message": "A11y+FirstMsg",
  "haiku-vision": "Haiku Vision",
  "cascade": "Cascade",
};

/**
 * Generate a markdown report from multi-method benchmark results.
 */
export function generateMultiMethodReport(
  result: MultiMethodBenchmarkResult
): string {
  const lines: string[] = [];

  lines.push("# Multi-Method Benchmark Results");
  lines.push("");
  lines.push(`**Date:** ${new Date(result.timestamp).toLocaleString()}`);
  lines.push(`**Sites:** ${result.sites.length}`);
  lines.push(`**Total Tasks:** ${result.totalTasks}`);
  lines.push(`**Methods:** ${result.methods.map((m) => METHOD_SHORT[m]).join(", ")}`);
  if (result.config?.runsPerTask && result.config.runsPerTask > 1) {
    lines.push(`**Runs per Task:** ${result.config.runsPerTask} (cost shown per single run)`);
  }
  lines.push("");

  // ─── Overall Comparison Table ──────────────────────────────────
  lines.push("## Overall Method Comparison");
  lines.push("");
  lines.push(
    "| Method | Success Rate | Avg Tokens | Avg Steps | Avg Duration | Cost/Task | Total Cost |"
  );
  lines.push(
    "|--------|-------------|------------|-----------|--------------|-----------|------------|"
  );

  for (const mr of result.overall) {
    const m = mr.metrics;
    lines.push(
      `| ${METHOD_SHORT[mr.method]} | ${(m.successRate * 100).toFixed(1)}% | ${m.avgTokensPerTask.toFixed(0)} | ${m.avgSteps.toFixed(1)} | ${formatDuration(m.avgDurationMs)} | ${formatCost(m.avgCostUsd)} | ${formatCost(m.totalCostUsd)} |`
    );
  }

  lines.push("");

  // ─── Per-Site Breakdown ────────────────────────────────────────
  lines.push("## Per-Site Breakdown");
  lines.push("");

  for (const site of result.sites) {
    lines.push(`### ${site.domain}`);
    lines.push(`URL: ${site.url}`);
    lines.push("");
    lines.push(
      "| Method | Success Rate | Avg Tokens | Avg Steps | Avg Duration | Cost/Task | Total Cost |"
    );
    lines.push(
      "|--------|-------------|------------|-----------|--------------|-----------|------------|"
    );

    for (const mr of site.methods) {
      const m = mr.metrics;
      lines.push(
        `| ${METHOD_SHORT[mr.method]} | ${(m.successRate * 100).toFixed(1)}% | ${m.avgTokensPerTask.toFixed(0)} | ${m.avgSteps.toFixed(1)} | ${formatDuration(m.avgDurationMs)} | ${formatCost(m.avgCostUsd)} | ${formatCost(m.totalCostUsd)} |`
      );
    }

    lines.push("");

    // Per-task details
    lines.push("<details>");
    lines.push("<summary>Task Details</summary>");
    lines.push("");

    // Get task IDs from first method
    const firstMethod = site.methods[0];
    if (firstMethod) {
      for (const task of firstMethod.tasks) {
        lines.push(`**${task.taskId}**`);
        lines.push("");
        lines.push("| Method | Result | Steps | Tokens | Cost | Duration |");
        lines.push("|--------|--------|-------|--------|------|----------|");

        for (const mr of site.methods) {
          const tr = mr.tasks.find((t) => t.taskId === task.taskId);
          if (tr) {
            const costStr = tr.estimatedCostUsd !== undefined ? formatCost(tr.estimatedCostUsd) : "—";
            const cascadeStr = tr.cascadeEscalations !== undefined && tr.cascadeEscalations > 0
              ? ` (↑${tr.cascadeEscalations})`
              : "";
            lines.push(
              `| ${METHOD_SHORT[mr.method]} | ${tr.success ? "✓ PASS" : "✗ FAIL"} | ${tr.steps}${cascadeStr} | ${tr.tokensUsed.toLocaleString()} | ${costStr} | ${formatDuration(tr.durationMs)} |`
            );
          }
        }
        lines.push("");
      }
    }

    lines.push("</details>");
    lines.push("");
  }

  // ─── Cost Summary ─────────────────────────────────────────────
  lines.push("## Cost Summary");
  lines.push("");
  lines.push("*Costs computed from actual input/output tokens using model-specific pricing.*");
  lines.push("*Haiku: $1.00/$5.00 per MTok · Sonnet: $3.00/$15.00 per MTok · Cache reads: 10% · Cache writes: 125%*");
  lines.push("");

  let grandTotalCost = 0;
  let grandTotalVerifyCost = 0;

  for (const mr of result.overall) {
    const m = mr.metrics;
    grandTotalCost += m.totalCostUsd;

    const cacheReadTotal = mr.tasks.reduce((s, t: TaskResult) => s + (t.cacheReadTokens ?? 0), 0);
    const cacheCreationTotal = mr.tasks.reduce((s, t: TaskResult) => s + (t.cacheCreationTokens ?? 0), 0);
    const cacheNote = cacheReadTotal > 0
      ? ` ↳ Cache: ${cacheReadTotal.toLocaleString()} reads, ${cacheCreationTotal.toLocaleString()} writes`
      : "";

    lines.push(
      `- **${METHOD_SHORT[mr.method]}**: ${m.avgTokensPerTask.toFixed(0)} avg tokens | ${formatCost(m.avgCostUsd)}/task | ${formatCost(m.totalCostUsd)} total (${m.totalTasks} tasks)${cacheNote}`
    );

    if (m.verificationOverhead) {
      grandTotalVerifyCost += m.verificationOverhead.totalCostUsd;
    }
  }

  lines.push("");
  lines.push(`**Total CUA cost (all methods):** ${formatCost(grandTotalCost)}`);

  if (grandTotalVerifyCost > 0) {
    lines.push("");
    lines.push("### Verification Overhead");
    lines.push("*(Not included in task costs above — tracked separately)*");
    lines.push("");
    for (const mr of result.overall) {
      if (mr.metrics.verificationOverhead) {
        const vo = mr.metrics.verificationOverhead;
        lines.push(
          `- **${METHOD_SHORT[mr.method]}**: ${formatCost(vo.avgCostUsd)}/task | ${formatCost(vo.totalCostUsd)} total`
        );
      }
    }
    lines.push("");
    lines.push(`**Total verification cost:** ${formatCost(grandTotalVerifyCost)}`);
    lines.push(`**Grand total (CUA + verification):** ${formatCost(grandTotalCost + grandTotalVerifyCost)}`);
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Print a console-friendly summary of multi-method results.
 */
export function printMultiMethodSummary(
  result: MultiMethodBenchmarkResult
): void {
  console.log("\n" + "=".repeat(88));
  console.log("  MULTI-METHOD BENCHMARK RESULTS");
  console.log("=".repeat(88));
  console.log(
    `  Sites: ${result.sites.length} | Tasks: ${result.totalTasks} | Methods: ${result.methods.length}`
  );
  if (result.config?.runsPerTask && result.config.runsPerTask > 1) {
    console.log(`  Runs per task: ${result.config.runsPerTask} (cost = per single run avg)`);
  }
  console.log("");

  // Header
  console.log(
    `  ${padRight("Method", 16)} ${padLeft("Success", 9)} ${padLeft("Tokens", 10)} ${padLeft("Steps", 7)} ${padLeft("Duration", 10)} ${padLeft("Cost/Task", 10)} ${padLeft("Total", 9)}`
  );
  console.log("  " + "─".repeat(76));

  for (const mr of result.overall) {
    const m = mr.metrics;
    console.log(
      `  ${padRight(METHOD_SHORT[mr.method], 16)} ${padLeft((m.successRate * 100).toFixed(1) + "%", 9)} ${padLeft(m.avgTokensPerTask.toFixed(0), 10)} ${padLeft(m.avgSteps.toFixed(1), 7)} ${padLeft(formatDuration(m.avgDurationMs), 10)} ${padLeft(formatCost(m.avgCostUsd), 10)} ${padLeft(formatCost(m.totalCostUsd), 9)}`
    );
  }

  console.log("=".repeat(88));

  // Cost totals
  const grandTotal = result.overall.reduce((s, mr) => s + mr.metrics.totalCostUsd, 0);
  const verifyTotal = result.overall.reduce((s, mr) => s + (mr.metrics.verificationOverhead?.totalCostUsd ?? 0), 0);

  console.log(`  Total CUA cost: ${formatCost(grandTotal)}`);
  if (verifyTotal > 0) {
    console.log(`  Verification overhead: ${formatCost(verifyTotal)} (excluded from above)`);
    console.log(`  Grand total: ${formatCost(grandTotal + verifyTotal)}`);
  }

  // Cache summary if any caching occurred
  const totalCacheReads = result.overall.flatMap(mr => mr.tasks).reduce((s, t: TaskResult) => s + (t.cacheReadTokens ?? 0), 0);
  if (totalCacheReads > 0) {
    const totalCacheCreations = result.overall.flatMap(mr => mr.tasks).reduce((s, t: TaskResult) => s + (t.cacheCreationTokens ?? 0), 0);
    console.log(`  Prompt cache: ${totalCacheReads.toLocaleString()} read tokens, ${totalCacheCreations.toLocaleString()} write tokens`);
  }

  console.log("");
}
