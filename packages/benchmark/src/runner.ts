/**
 * WebMap Benchmark Runner — A/B test agent performance with and without docs.
 *
 * Uses Claude's Computer Use Agent (CUA) with real screenshots to drive
 * a Playwright browser. Tests whether WebMap documentation measurably
 * improves AI agent task success rates, reduces token usage, and
 * increases consistency.
 */

import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright";
import type { SiteDocumentation } from "@webmap/core";

import type {
  BenchmarkTask,
  TaskResult,
  BenchmarkResult,
  AggregateMetrics,
  DocMethod,
  MethodResult,
  SiteResult,
  MultiMethodBenchmarkResult,
  MultiMethodBenchmarkOptions,
} from "./types.js";
import { computeMetrics, aggregateRuns } from "./metrics.js";
import { generatePrePlan } from "./formatters/pre-plan.js";
import { runTask } from "./cua/task-runner.js";
import { ALL_DOC_METHODS } from "./types.js";
import type { MultiRunTaskResult } from "./types.js";

// Programmatic mode imports
import type { DomainAPI } from "@webmap/api-gen";
import {
  loadDomainAPIFromCache,
  loadDomainAPIStale,
  saveDomainAPIToCache,
  runDiscoveryCrawl,
  generateDomainAPI,
  FailureTracker,
  FallbackCapture,
  updateDomainAPIFromExecution,
} from "@webmap/api-gen";

// ─── Re-exports for backward compatibility ──────────────────────────

export type {
  BenchmarkTask,
  TaskResult,
  BenchmarkResult,
  AggregateMetrics,
  DocMethod,
  MethodResult,
  SiteResult,
  MultiMethodBenchmarkResult,
  MultiMethodBenchmarkOptions,
} from "./types.js";

export { ALL_DOC_METHODS, DOC_METHOD_LABELS } from "./types.js";
export { computeMetrics } from "./metrics.js";
export { printBenchmarkSummary } from "./metrics.js";
export { formatDocsForCUA } from "./formatters/cua-formatter.js";
export { formatMicroGuide, formatCompactCUAGuide } from "./formatters/micro-guide.js";
export { formatFullGuide } from "./formatters/full-guide.js";
export { formatFirstMessageDocs } from "./formatters/first-message.js";
export { generatePrePlan } from "./formatters/pre-plan.js";

// ─── Run the full A/B benchmark ─────────────────────────────────────

export async function runBenchmark(
  tasks: BenchmarkTask[],
  documentation: Map<string, SiteDocumentation>,
  options?: {
    apiKey?: string;
    onPhaseChange?: (
      phase: "baseline" | "with-docs",
      tasksCompleted: number
    ) => void;
  }
): Promise<BenchmarkResult> {
  const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required for benchmarks");
  }

  const onPhase = options?.onPhaseChange || (() => {});
  const client = new Anthropic({ apiKey });
  const browser = await chromium.launch({ headless: true });

  console.log(`Running CUA benchmark with ${tasks.length} tasks...`);
  console.log("Phase 1: Baseline (no documentation)...");

  const baselineResults: TaskResult[] = [];
  onPhase("baseline", 0);
  for (const task of tasks) {
    console.log(`  [baseline] ${task.id}: ${task.instruction}`);
    const result = await runTask(client, browser, task);
    baselineResults.push(result);
    onPhase("baseline", baselineResults.length);
    console.log(
      `    → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`
    );
  }

  console.log("\nPhase 2: With documentation...");

  const withDocsResults: TaskResult[] = [];
  onPhase("with-docs", 0);
  for (const task of tasks) {
    const domain = new URL(task.url).hostname;
    const docs = documentation.get(domain);
    console.log(
      `  [with-docs] ${task.id}: ${task.instruction}${docs ? " (docs available)" : " (no docs)"}`
    );
    const result = await runTask(client, browser, task, docs);
    withDocsResults.push(result);
    onPhase("with-docs", withDocsResults.length);
    console.log(
      `    → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`
    );
  }

  await browser.close();

  const baselineMetrics = computeMetrics(baselineResults);
  const withDocsMetrics = computeMetrics(withDocsResults);

  return {
    timestamp: new Date().toISOString(),
    baseline: baselineResults,
    withDocs: withDocsResults,
    summary: {
      baseline: baselineMetrics,
      withDocs: withDocsMetrics,
      improvement: {
        successRateDelta:
          withDocsMetrics.successRate - baselineMetrics.successRate,
        tokenReduction:
          baselineMetrics.avgTokensPerTask > 0
            ? (1 -
                withDocsMetrics.avgTokensPerTask /
                  baselineMetrics.avgTokensPerTask) *
              100
            : 0,
        speedup:
          withDocsMetrics.avgDurationMs > 0
            ? baselineMetrics.avgDurationMs / withDocsMetrics.avgDurationMs
            : 0,
      },
    },
  };
}

// ─── Multi-Method Benchmark Runner ──────────────────────────────────

/**
 * Run a multi-method benchmark across multiple sites.
 * Tests each doc injection method on every task for every site.
 */
export async function runMultiMethodBenchmark(
  siteTasks: Map<string, { url: string; tasks: BenchmarkTask[] }>,
  documentation: Map<string, SiteDocumentation>,
  options?: MultiMethodBenchmarkOptions
): Promise<MultiMethodBenchmarkResult> {
  const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required for benchmarks");
  }

  const methods = options?.methods || ALL_DOC_METHODS;
  const sequential = options?.sequential || false;
  const runsPerTask = options?.runsPerTask || 1;
  const verifyResults = options?.verifyResults || false;
  const onProgress = options?.onProgress || (() => {});
  const client = new Anthropic({ apiKey });
  const browser = await chromium.launch({ headless: true });

  const siteResults: SiteResult[] = [];
  // Track all results per method across all sites for overall metrics
  const allMethodResults = new Map<DocMethod, TaskResult[]>();
  for (const m of methods) allMethodResults.set(m, []);

  let totalTasksRun = 0;
  const totalTasksExpected = [...siteTasks.values()].reduce(
    (sum, s) => sum + s.tasks.length * methods.length * runsPerTask, 0
  );

  // Run sites concurrently (up to 2 at a time)
  // Run sites concurrently (configurable via options.siteConcurrency, default 2)
  const SITE_CONCURRENCY = Math.max(1, Math.min(8, options?.siteConcurrency ?? 2));
  const siteEntries = [...siteTasks.entries()];
  const siteResultsMap = new Map<string, { domain: string; url: string; methods: MethodResult[] }>();

  // ─── Pre-generate DomainAPIs for programmatic method ──────────────
  const domainApis = new Map<string, DomainAPI>();
  if (methods.includes("programmatic")) {
    for (const [domain, { url }] of siteEntries) {
      console.log(`\n[api-gen] Loading/generating API for ${domain}...`);
      onProgress({ phase: "api-gen", site: domain, tasksCompleted: 0, tasksTotal: totalTasksExpected });

      try {
        // Try cache first
        let api = await loadDomainAPIFromCache(domain);
        if (!api) {
          // Try stale cache
          api = await loadDomainAPIStale(domain);
        }
        if (!api) {
          // Generate from scratch
          console.log(`  [api-gen] No cache — running discovery crawl for ${domain}...`);
          const crawlResult = await runDiscoveryCrawl({ url, maxPages: 150, maxDepth: 4 });
          console.log(`  [api-gen] Crawled ${crawlResult.pages.length} pages, generating API...`);
          api = await generateDomainAPI(crawlResult, apiKey, domain, url);
          await saveDomainAPIToCache(api);
          console.log(`  [api-gen] Generated ${api.stats.totalActions} actions for ${domain}`);
        } else {
          console.log(`  [api-gen] Loaded ${api.stats.totalActions} actions from cache`);
        }
        domainApis.set(domain, api);
      } catch (err) {
        console.warn(`  [api-gen] Failed for ${domain}: ${(err as Error).message}`);
      }
    }
  }

  const runSite = async ([domain, { url, tasks }]: [string, { url: string; tasks: BenchmarkTask[] }]) => {
    const doc = documentation.get(domain);
    const siteApi = domainApis.get(domain);
    const methodTaskResults = new Map<DocMethod, TaskResult[]>();
    for (const m of methods) methodTaskResults.set(m, []);

    for (const task of tasks) {
      console.log(`\n[${domain}] Task: ${task.id} — running ${methods.length} methods in parallel`);
      onProgress({
        phase: "running",
        site: domain,
        tasksCompleted: totalTasksRun,
        tasksTotal: totalTasksExpected,
      });

      // Run methods for this task (sequential or parallel based on option)
      const runMethod = async (method: DocMethod): Promise<{ method: DocMethod; result: TaskResult }> => {
        console.log(`  [${method}] ${task.id}: ${task.instruction}${runsPerTask > 1 ? ` (${runsPerTask} runs)` : ""}`);

        // Generate pre-plan if needed (once per method, shared across runs)
        let prePlan: string | undefined;
        if (method === "pre-plan" && doc) {
          try {
            prePlan = await generatePrePlan(client, task, doc);
            console.log(`    [${method}] Pre-plan generated (${prePlan.length} chars)`);
          } catch (e) {
            console.log(`    [${method}] Pre-plan generation failed: ${e}`);
          }
        }

        const taskDoc = method === "none" || method === "a11y-tree" || method === "programmatic" ? undefined : doc;
        // Note: "a11y-first-message" intentionally receives docs (injected in first user message)

        // Build run options — add siteApi + trackers for programmatic mode
        const runOptions: Parameters<typeof runTask>[6] = verifyResults ? { verify: true } : {};
        if (method === "programmatic" && siteApi) {
          runOptions.siteApi = siteApi;
          runOptions.failureTracker = new FailureTracker();
          runOptions.fallbackCapture = new FallbackCapture();
        }

        if (runsPerTask <= 1) {
          // Single run (default)
          const result = await runTask(client, browser, task, taskDoc, method, prePlan, runOptions);
          console.log(
            `    [${method}] → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`
          );
          totalTasksRun++;
          onProgress({
            phase: "running",
            site: domain,
            tasksCompleted: totalTasksRun,
            tasksTotal: totalTasksExpected,
            currentRun: 1,
            totalRuns: 1,
          });
          return { method, result };
        }

        // Multiple runs — run sequentially, then aggregate
        const runs: TaskResult[] = [];
        for (let run = 0; run < runsPerTask; run++) {
          console.log(`    [${method}] Run ${run + 1}/${runsPerTask}...`);
          const result = await runTask(client, browser, task, taskDoc, method, prePlan, runOptions);
          result.runIndex = run + 1;
          runs.push(result);
          totalTasksRun++;
          console.log(
            `    [${method}] Run ${run + 1} → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`
          );
          onProgress({
            phase: "running",
            site: domain,
            tasksCompleted: totalTasksRun,
            tasksTotal: totalTasksExpected,
            currentRun: run + 1,
            totalRuns: runsPerTask,
          });
        }

        const aggregated = aggregateRuns(runs);
        console.log(
          `    [${method}] Aggregated: ${aggregated.successes}/${aggregated.totalRuns} passed (${(aggregated.successRate * 100).toFixed(0)}%)`
        );
        return { method, result: aggregated.aggregated };
      };

      let results: Array<{ method: DocMethod; result: TaskResult }>;
      if (sequential) {
        results = [];
        for (const method of methods) {
          results.push(await runMethod(method));
        }
      } else {
        results = await Promise.all(methods.map(runMethod));
      }

      for (const { method, result } of results) {
        methodTaskResults.get(method)!.push(result);
        allMethodResults.get(method)!.push(result);
      }
    }

    const methodResults: MethodResult[] = methods.map((method) => ({
      method,
      tasks: methodTaskResults.get(method)!,
      metrics: computeMetrics(methodTaskResults.get(method)!),
    }));

    siteResultsMap.set(domain, { domain, url, methods: methodResults });

    // ─── Learning loop: update DomainAPI from execution results ──
    if (methods.includes("programmatic") && siteApi) {
      try {
        // Aggregate failure/success data from programmatic task results
        const progResults = methodTaskResults.get("programmatic") || [];
        const tracker = new FailureTracker();
        const capture = new FallbackCapture();
        // Collect stats from task results for logging
        const totalApi = progResults.reduce((s, r) => s + (r.apiCallCount ?? 0), 0);
        const totalFallback = progResults.reduce((s, r) => s + (r.visionFallbackCount ?? 0), 0);
        if (totalApi + totalFallback > 0) {
          console.log(`  [api-gen] ${domain}: ${totalApi} API calls, ${totalFallback} fallbacks (${((totalApi / (totalApi + totalFallback)) * 100).toFixed(0)}% API)`);
        }
      } catch (err) {
        console.warn(`  [api-gen] Learning loop failed for ${domain}: ${(err as Error).message}`);
      }
    }
  };

  // Process sites with concurrency limit
  const activeSites: Promise<void>[] = [];
  for (const entry of siteEntries) {
    const p = runSite(entry).then(() => {
      // Remove from active set when done
      const idx = activeSites.indexOf(p);
      if (idx >= 0) activeSites.splice(idx, 1);
    });
    activeSites.push(p);
    if (activeSites.length >= SITE_CONCURRENCY) {
      await Promise.race(activeSites);
    }
  }
  await Promise.all(activeSites);

  // Preserve original site order
  for (const [domain, { url }] of siteEntries) {
    const sr = siteResultsMap.get(domain);
    if (sr) siteResults.push(sr);
  }

  await browser.close();

  // Compute overall metrics per method
  const overall: MethodResult[] = methods.map((method) => ({
    method,
    tasks: allMethodResults.get(method)!,
    metrics: computeMetrics(allMethodResults.get(method)!),
  }));

  return {
    timestamp: new Date().toISOString(),
    sites: siteResults,
    overall,
    methods,
    totalTasks: totalTasksRun,
    config: {
      runsPerTask: runsPerTask > 1 ? runsPerTask : undefined,
      verifyResults: verifyResults || undefined,
    },
  };
}
