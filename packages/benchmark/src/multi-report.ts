/**
 * Multi-method benchmark report generator.
 * Produces markdown reports from MultiMethodBenchmarkResult data.
 */

import type {
  MultiMethodBenchmarkResult,
  MethodResult,
  DocMethod,
} from "./types.js";

// Sonnet: $3/$15 per MTok input/output (approximate 70/30 split)
const COST_PER_TOKEN_INPUT = 3 / 1_000_000;
const COST_PER_TOKEN_OUTPUT = 15 / 1_000_000;
const INPUT_RATIO = 0.7;

function estimateCost(totalTokens: number): number {
  const inputTokens = totalTokens * INPUT_RATIO;
  const outputTokens = totalTokens * (1 - INPUT_RATIO);
  return inputTokens * COST_PER_TOKEN_INPUT + outputTokens * COST_PER_TOKEN_OUTPUT;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
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
  lines.push("");

  // ─── Overall Comparison Table ──────────────────────────────────
  lines.push("## Overall Method Comparison");
  lines.push("");
  lines.push(
    "| Method | Success Rate | Avg Tokens | Avg Steps | Avg Duration | Est. Cost/Task |"
  );
  lines.push(
    "|--------|-------------|------------|-----------|--------------|----------------|"
  );

  for (const mr of result.overall) {
    const m = mr.metrics;
    const cost = estimateCost(m.avgTokensPerTask);
    lines.push(
      `| ${METHOD_SHORT[mr.method]} | ${(m.successRate * 100).toFixed(1)}% | ${m.avgTokensPerTask.toFixed(0)} | ${m.avgSteps.toFixed(1)} | ${formatDuration(m.avgDurationMs)} | $${cost.toFixed(3)} |`
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
      "| Method | Success Rate | Avg Tokens | Avg Steps | Avg Duration |"
    );
    lines.push(
      "|--------|-------------|------------|-----------|--------------|"
    );

    for (const mr of site.methods) {
      const m = mr.metrics;
      lines.push(
        `| ${METHOD_SHORT[mr.method]} | ${(m.successRate * 100).toFixed(1)}% | ${m.avgTokensPerTask.toFixed(0)} | ${m.avgSteps.toFixed(1)} | ${formatDuration(m.avgDurationMs)} |`
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
        lines.push("| Method | Result | Steps | Tokens | Duration |");
        lines.push("|--------|--------|-------|--------|----------|");

        for (const mr of site.methods) {
          const tr = mr.tasks.find((t) => t.taskId === task.taskId);
          if (tr) {
            lines.push(
              `| ${METHOD_SHORT[mr.method]} | ${tr.success ? "PASS" : "FAIL"} | ${tr.steps} | ${tr.tokensUsed} | ${formatDuration(tr.durationMs)} |`
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

  let totalTokens = 0;
  for (const mr of result.overall) {
    const methodTokens = mr.tasks.reduce((s, t) => s + t.tokensUsed, 0);
    totalTokens += methodTokens;
    const cost = estimateCost(methodTokens);
    lines.push(
      `- **${METHOD_SHORT[mr.method]}**: ${methodTokens.toLocaleString()} tokens (~$${cost.toFixed(2)})`
    );
  }

  const totalCost = estimateCost(totalTokens);
  lines.push("");
  lines.push(
    `**Total**: ${totalTokens.toLocaleString()} tokens (~$${totalCost.toFixed(2)})`
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Print a console-friendly summary of multi-method results.
 */
export function printMultiMethodSummary(
  result: MultiMethodBenchmarkResult
): void {
  console.log("\n" + "=".repeat(80));
  console.log("  MULTI-METHOD BENCHMARK RESULTS");
  console.log("=".repeat(80));
  console.log(
    `  Sites: ${result.sites.length} | Tasks: ${result.totalTasks} | Methods: ${result.methods.length}`
  );
  console.log("");

  // Header
  console.log(
    `  ${padRight("Method", 16)} ${padLeft("Success", 9)} ${padLeft("Tokens", 10)} ${padLeft("Steps", 7)} ${padLeft("Duration", 10)} ${padLeft("Cost", 8)}`
  );
  console.log("  " + "─".repeat(66));

  for (const mr of result.overall) {
    const m = mr.metrics;
    const cost = estimateCost(m.avgTokensPerTask);
    console.log(
      `  ${padRight(METHOD_SHORT[mr.method], 16)} ${padLeft((m.successRate * 100).toFixed(1) + "%", 9)} ${padLeft(m.avgTokensPerTask.toFixed(0), 10)} ${padLeft(m.avgSteps.toFixed(1), 7)} ${padLeft(formatDuration(m.avgDurationMs), 10)} ${padLeft("$" + cost.toFixed(3), 8)}`
    );
  }

  console.log("=".repeat(80));

  // Total cost
  let totalTokens = 0;
  for (const mr of result.overall) {
    totalTokens += mr.tasks.reduce((s, t) => s + t.tokensUsed, 0);
  }
  console.log(`  Total tokens: ${totalTokens.toLocaleString()}`);
  console.log(`  Estimated total cost: $${estimateCost(totalTokens).toFixed(2)}`);
  console.log("");
}
