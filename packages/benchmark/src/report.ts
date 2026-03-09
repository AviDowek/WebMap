#!/usr/bin/env node

/**
 * Benchmark Report Generator — reads saved benchmark results and produces
 * a formatted markdown report comparing baseline vs. documentation-assisted runs.
 *
 * Usage:
 *   node dist/report.js                              # Latest result
 *   node dist/report.js benchmark-results/file.json  # Specific file
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { BenchmarkResult, TaskResult } from "./runner.js";

const RESULTS_DIR = "./benchmark-results";

async function loadResult(filePath?: string): Promise<{ result: BenchmarkResult; path: string }> {
  if (filePath) {
    const raw = await readFile(filePath, "utf-8");
    return { result: JSON.parse(raw), path: filePath };
  }

  // Find the latest result file
  const files = (await readdir(RESULTS_DIR))
    .filter((f) => f.startsWith("benchmark-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error(`No benchmark results found in ${RESULTS_DIR}. Run a benchmark first.`);
  }

  const latestPath = join(RESULTS_DIR, files[0]);
  const raw = await readFile(latestPath, "utf-8");
  return { result: JSON.parse(raw), path: latestPath };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusIcon(success: boolean): string {
  return success ? "PASS" : "FAIL";
}

function generateMarkdownReport(result: BenchmarkResult, sourcePath: string): string {
  const { baseline, withDocs, improvement } = result.summary;
  const lines: string[] = [];

  lines.push("# WebMap Benchmark Report");
  lines.push("");
  lines.push(`> Generated from: \`${basename(sourcePath)}\``);
  lines.push(`> Benchmark run: ${result.timestamp}`);
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Baseline | With Docs | Delta |");
  lines.push("|--------|----------|-----------|-------|");
  lines.push(
    `| Success Rate | ${(baseline.successRate * 100).toFixed(1)}% | ${(withDocs.successRate * 100).toFixed(1)}% | ${improvement.successRateDelta > 0 ? "+" : ""}${(improvement.successRateDelta * 100).toFixed(1)}pp |`
  );
  lines.push(
    `| Avg Tokens | ${baseline.avgTokensPerTask.toFixed(0)} | ${withDocs.avgTokensPerTask.toFixed(0)} | ${improvement.tokenReduction > 0 ? "-" : "+"}${Math.abs(improvement.tokenReduction).toFixed(1)}% |`
  );
  lines.push(
    `| Avg Duration | ${formatDuration(baseline.avgDurationMs)} | ${formatDuration(withDocs.avgDurationMs)} | ${improvement.speedup.toFixed(2)}x |`
  );
  lines.push(
    `| Avg Steps | ${baseline.avgSteps.toFixed(1)} | ${withDocs.avgSteps.toFixed(1)} | ${(withDocs.avgSteps - baseline.avgSteps).toFixed(1)} |`
  );
  lines.push(
    `| Total Tasks | ${baseline.totalTasks} | ${withDocs.totalTasks} | — |`
  );
  lines.push("");

  // Per-task breakdown
  lines.push("## Per-Task Results");
  lines.push("");
  lines.push("| Task ID | Category | Baseline | With Docs | Tokens (B) | Tokens (D) | Speedup |");
  lines.push("|---------|----------|----------|-----------|------------|------------|---------|");

  for (let i = 0; i < result.baseline.length; i++) {
    const b = result.baseline[i];
    const d = result.withDocs[i];
    if (!d) continue;

    const speedup = b.durationMs > 0 && d.durationMs > 0
      ? (b.durationMs / d.durationMs).toFixed(2) + "x"
      : "—";

    lines.push(
      `| ${b.taskId} | — | ${statusIcon(b.success)} | ${statusIcon(d.success)} | ${b.tokensUsed} | ${d.tokensUsed} | ${speedup} |`
    );
  }
  lines.push("");

  // Detailed action logs
  lines.push("## Action Logs");
  lines.push("");

  const allTasks = [
    ...result.baseline.map((t) => ({ ...t, phase: "Baseline" })),
    ...result.withDocs.map((t) => ({ ...t, phase: "With Docs" })),
  ];

  for (const task of allTasks) {
    lines.push(`### ${task.phase}: ${task.taskId}`);
    lines.push("");
    lines.push(`- **Result:** ${statusIcon(task.success)}${task.error ? ` — ${task.error}` : ""}`);
    lines.push(`- **Steps:** ${task.steps} | **Tokens:** ${task.tokensUsed} | **Duration:** ${formatDuration(task.durationMs)}`);
    lines.push("");
    if (task.actions.length > 0) {
      lines.push("```");
      for (const action of task.actions) {
        lines.push(action);
      }
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main() {
  const fileArg = process.argv[2];

  console.log("WebMap Benchmark Report Generator\n");

  const { result, path: sourcePath } = await loadResult(fileArg);

  // Print console summary
  const { baseline, withDocs, improvement } = result.summary;
  console.log(`Source: ${sourcePath}`);
  console.log(`Run: ${result.timestamp}`);
  console.log(`Tasks: ${baseline.totalTasks}\n`);

  console.log("  Metric            Baseline    With Docs    Delta");
  console.log("  ────────────────────────────────────────────────────");
  console.log(
    `  Success Rate      ${(baseline.successRate * 100).toFixed(1).padStart(6)}%     ${(withDocs.successRate * 100).toFixed(1).padStart(6)}%     ${improvement.successRateDelta > 0 ? "+" : ""}${(improvement.successRateDelta * 100).toFixed(1)}pp`
  );
  console.log(
    `  Avg Tokens        ${baseline.avgTokensPerTask.toFixed(0).padStart(7)}     ${withDocs.avgTokensPerTask.toFixed(0).padStart(7)}     ${improvement.tokenReduction > 0 ? "-" : "+"}${Math.abs(improvement.tokenReduction).toFixed(1)}%`
  );
  console.log(
    `  Avg Duration      ${formatDuration(baseline.avgDurationMs).padStart(7)}     ${formatDuration(withDocs.avgDurationMs).padStart(7)}     ${improvement.speedup.toFixed(2)}x`
  );
  console.log("");

  // Generate and save markdown report
  const markdown = generateMarkdownReport(result, sourcePath);
  const reportPath = sourcePath.replace(".json", "-report.md");
  await writeFile(reportPath, markdown, "utf-8");
  console.log(`Markdown report saved to: ${reportPath}`);
}

main().catch(console.error);
