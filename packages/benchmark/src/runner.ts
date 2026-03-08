/**
 * WebMap Benchmark Runner — A/B test agent performance with and without docs.
 *
 * Tests whether WebMap documentation measurably improves AI agent
 * task success rates, reduces token usage, and increases consistency.
 */

import Anthropic from "@anthropic-ai/sdk";
import { chromium, type Browser, type Page } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface BenchmarkTask {
  /** Unique task ID */
  id: string;
  /** Target website URL */
  url: string;
  /** Task description in natural language */
  instruction: string;
  /** Expected outcome / success criteria */
  successCriteria: string;
  /** Category (navigation, form-fill, search, purchase, etc.) */
  category: string;
}

export interface TaskResult {
  taskId: string;
  /** Whether the task was completed successfully */
  success: boolean;
  /** Number of steps/actions taken */
  steps: number;
  /** Total tokens consumed */
  tokensUsed: number;
  /** Time taken in ms */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Action log */
  actions: string[];
}

export interface BenchmarkResult {
  /** When the benchmark was run */
  timestamp: string;
  /** Results without documentation */
  baseline: TaskResult[];
  /** Results with documentation */
  withDocs: TaskResult[];
  /** Aggregate comparison */
  summary: {
    baseline: AggregateMetrics;
    withDocs: AggregateMetrics;
    improvement: {
      successRateDelta: number; // percentage points
      tokenReduction: number; // percentage
      speedup: number; // ratio
    };
  };
}

interface AggregateMetrics {
  totalTasks: number;
  successRate: number;
  avgTokensPerTask: number;
  avgDurationMs: number;
  avgSteps: number;
}

/**
 * Run a single task using Claude as the browser agent.
 */
async function runTask(
  client: Anthropic,
  browser: Browser,
  task: BenchmarkTask,
  documentation?: string
): Promise<TaskResult> {
  const startTime = Date.now();
  const actions: string[] = [];
  let tokensUsed = 0;
  let success = false;
  let error: string | undefined;

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(task.url, { waitUntil: "domcontentloaded" });

    const systemPrompt = documentation
      ? `You are a web browser agent. You navigate websites to complete tasks.

You have documentation for this website:

${documentation}

Use the accessibility selectors from the documentation to interact with elements.
Respond with actions in JSON format: {"action": "click|type|navigate|done|fail", "selector": "...", "value": "..."}`
      : `You are a web browser agent. You navigate websites to complete tasks.
Analyze the page content and interact with elements to complete the given task.
Respond with actions in JSON format: {"action": "click|type|navigate|done|fail", "selector": "...", "value": "..."}`;

    const maxSteps = 15;
    for (let step = 0; step < maxSteps; step++) {
      // Get current page state via accessibility snapshot
      let snapshot: string;
      try {
        snapshot = await page.locator("body").ariaSnapshot();
      } catch {
        snapshot = await page.title();
      }

      const currentUrl = page.url();

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Task: ${task.instruction}\nSuccess criteria: ${task.successCriteria}\n\nCurrent URL: ${currentUrl}\nPage state:\n${snapshot.substring(0, 3000)}\n\nWhat is the next action?`,
          },
        ],
      });

      tokensUsed +=
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0);

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      // Parse action
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        actions.push(`Step ${step + 1}: Could not parse action`);
        continue;
      }

      const action = JSON.parse(jsonMatch[0]);
      actions.push(
        `Step ${step + 1}: ${action.action} ${action.selector || ""} ${action.value || ""}`
      );

      if (action.action === "done") {
        success = true;
        break;
      }

      if (action.action === "fail") {
        error = action.value || "Agent reported failure";
        break;
      }

      // Execute the action
      try {
        if (action.action === "click" && action.selector) {
          await page.locator(action.selector).first().click({ timeout: 5000 });
        } else if (action.action === "type" && action.selector && action.value) {
          await page
            .locator(action.selector)
            .first()
            .fill(action.value, { timeout: 5000 });
        } else if (action.action === "navigate" && action.value) {
          await page.goto(action.value, { waitUntil: "domcontentloaded" });
        }
      } catch (actionError) {
        actions.push(
          `  → Error: ${actionError instanceof Error ? actionError.message : actionError}`
        );
      }

      // Wait for any navigation/updates
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    await context.close();
  }

  return {
    taskId: task.id,
    success,
    steps: actions.length,
    tokensUsed,
    durationMs: Date.now() - startTime,
    error,
    actions,
  };
}

function computeMetrics(results: TaskResult[]): AggregateMetrics {
  const total = results.length;
  const successes = results.filter((r) => r.success).length;
  const totalTokens = results.reduce((s, r) => s + r.tokensUsed, 0);
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  const totalSteps = results.reduce((s, r) => s + r.steps, 0);

  return {
    totalTasks: total,
    successRate: total > 0 ? successes / total : 0,
    avgTokensPerTask: total > 0 ? totalTokens / total : 0,
    avgDurationMs: total > 0 ? totalDuration / total : 0,
    avgSteps: total > 0 ? totalSteps / total : 0,
  };
}

/**
 * Run the full A/B benchmark: tasks without docs vs tasks with docs.
 */
export async function runBenchmark(
  tasks: BenchmarkTask[],
  documentation: Map<string, string>,
  options?: { apiKey?: string }
): Promise<BenchmarkResult> {
  const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required for benchmarks");
  }

  const client = new Anthropic({ apiKey });
  const browser = await chromium.launch({ headless: true });

  console.log(`Running benchmark with ${tasks.length} tasks...`);
  console.log("Phase 1: Baseline (no documentation)...");

  // Run baseline (no docs)
  const baselineResults: TaskResult[] = [];
  for (const task of tasks) {
    console.log(`  [baseline] ${task.id}: ${task.instruction}`);
    const result = await runTask(client, browser, task);
    baselineResults.push(result);
    console.log(`    → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`);
  }

  console.log("\nPhase 2: With documentation...");

  // Run with docs
  const withDocsResults: TaskResult[] = [];
  for (const task of tasks) {
    const domain = new URL(task.url).hostname;
    const docs = documentation.get(domain);
    console.log(`  [with-docs] ${task.id}: ${task.instruction}${docs ? " (docs available)" : " (no docs)"}`);
    const result = await runTask(client, browser, task, docs);
    withDocsResults.push(result);
    console.log(`    → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`);
  }

  await browser.close();

  // Compute metrics
  const baselineMetrics = computeMetrics(baselineResults);
  const withDocsMetrics = computeMetrics(withDocsResults);

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    baseline: baselineResults,
    withDocs: withDocsResults,
    summary: {
      baseline: baselineMetrics,
      withDocs: withDocsMetrics,
      improvement: {
        successRateDelta: withDocsMetrics.successRate - baselineMetrics.successRate,
        tokenReduction:
          baselineMetrics.avgTokensPerTask > 0
            ? (1 - withDocsMetrics.avgTokensPerTask / baselineMetrics.avgTokensPerTask) * 100
            : 0,
        speedup:
          withDocsMetrics.avgDurationMs > 0
            ? baselineMetrics.avgDurationMs / withDocsMetrics.avgDurationMs
            : 0,
      },
    },
  };

  return result;
}

/**
 * Pretty-print benchmark results.
 */
export function printBenchmarkSummary(result: BenchmarkResult): void {
  const { baseline, withDocs, improvement } = result.summary;

  console.log("\n" + "=".repeat(60));
  console.log("  BENCHMARK RESULTS");
  console.log("=".repeat(60));
  console.log("");
  console.log("                    Baseline    With Docs    Delta");
  console.log("  ─────────────────────────────────────────────────");
  console.log(
    `  Success Rate      ${(baseline.successRate * 100).toFixed(1)}%        ${(withDocs.successRate * 100).toFixed(1)}%         ${improvement.successRateDelta > 0 ? "+" : ""}${(improvement.successRateDelta * 100).toFixed(1)}pp`
  );
  console.log(
    `  Avg Tokens        ${baseline.avgTokensPerTask.toFixed(0)}        ${withDocs.avgTokensPerTask.toFixed(0)}         ${improvement.tokenReduction > 0 ? "-" : "+"}${Math.abs(improvement.tokenReduction).toFixed(1)}%`
  );
  console.log(
    `  Avg Duration      ${(baseline.avgDurationMs / 1000).toFixed(1)}s        ${(withDocs.avgDurationMs / 1000).toFixed(1)}s         ${improvement.speedup.toFixed(2)}x`
  );
  console.log(
    `  Avg Steps         ${baseline.avgSteps.toFixed(1)}          ${withDocs.avgSteps.toFixed(1)}          ${(withDocs.avgSteps - baseline.avgSteps).toFixed(1)}`
  );
  console.log("=".repeat(60));
}
