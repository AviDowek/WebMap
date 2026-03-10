/**
 * A/B benchmark run routes (baseline vs with-docs).
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  crawlSite,
  DocGenerator,
  formatAsMarkdown,
  type CrawlResult,
  type SiteDocumentation,
} from "@webmap/core";
import {
  runBenchmark,
  sampleTasks,
  type BenchmarkTask,
} from "@webmap/benchmark";
import { benchmarkHistoryStore } from "../persistence.js";
import {
  runWithConcurrency,
  setCache,
  benchmarkSites,
  benchmarkJobs,
  getBenchmarkHistory,
  getMultiMethodHistory,
  MAX_HISTORY,
  ANTHROPIC_KEY,
  type BenchmarkState,
} from "../state.js";

const routes = new Hono();

// Start an A/B benchmark
routes.post("/api/benchmark", async (c) => {
  const body = await c.req.json<{
    tasks?: BenchmarkTask[];
    useSampleTasks?: boolean;
    useConfiguredSites?: boolean;
  }>().catch(() => ({}));

  if (!ANTHROPIC_KEY) {
    return c.json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  const opts = body as {
    tasks?: BenchmarkTask[];
    useSampleTasks?: boolean;
    useConfiguredSites?: boolean;
  };

  // Determine tasks to run
  let tasks: BenchmarkTask[];

  if (opts.tasks && opts.tasks.length > 0) {
    tasks = opts.tasks;
  } else if (opts.useConfiguredSites) {
    // Collect tasks from all configured sites
    tasks = [];
    for (const site of benchmarkSites.values()) {
      tasks.push(...site.tasks);
    }
    if (tasks.length === 0) {
      return c.json({ error: "No tasks configured. Add sites and tasks first." }, 400);
    }
  } else {
    // Default to sample tasks
    tasks = sampleTasks;
  }

  if (tasks.length > 20) {
    return c.json({ error: "Maximum 20 benchmark tasks per run" }, 400);
  }

  const benchId = randomUUID();
  benchmarkJobs.set(benchId, {
    id: benchId,
    status: "generating-docs",
    tasksTotal: tasks.length,
    tasksCompleted: 0,
  });

  // Run benchmark in background
  (async () => {
    const state = benchmarkJobs.get(benchId)!;

    try {
      // Step 1a: Crawl all target domains in parallel
      const docsMap = new Map<string, SiteDocumentation>();
      const domains = [...new Set(tasks.map((t) => new URL(t.url).hostname))];
      const crawlResults = new Map<string, { url: string; result: CrawlResult }>();

      await runWithConcurrency(domains, 2, async (domain) => {
        const task = tasks.find((t) => new URL(t.url).hostname === domain)!;
        try {
          const result = await crawlSite({ url: task.url, maxPages: 15, maxDepth: 2 });
          crawlResults.set(domain, { url: task.url, result });
        } catch {
          // Skip domain if crawl fails
        }
      });

      // Step 1b: Generate docs sequentially (avoid Claude API rate limits)
      for (const [domain, { url, result: crawlResult }] of crawlResults) {
        try {
          const generator = new DocGenerator({ apiKey: ANTHROPIC_KEY!, cuaMode: true });
          const documentation = await generator.generate(crawlResult, { url, maxPages: 15, maxDepth: 2 });
          const markdown = formatAsMarkdown(documentation);
          setCache(domain, { documentation, markdown });
          docsMap.set(domain, documentation);
        } catch {
          // Skip domain if doc generation fails
        }
      }

      // Step 2: Run CUA benchmark
      state.status = "running-baseline";
      const result = await runBenchmark(tasks, docsMap, {
        apiKey: ANTHROPIC_KEY,
        onPhaseChange: (phase: string, completed: number) => {
          if (phase === "baseline") {
            state.status = "running-baseline";
          } else {
            state.status = "running-with-docs";
          }
          state.tasksCompleted = completed;
        },
      });

      state.status = "done";
      state.result = result;

      // Auto-save to history (persisted)
      const history = getBenchmarkHistory();
      if (history.length >= MAX_HISTORY) {
        history.shift(); // remove oldest
      }
      history.push({
        id: benchId,
        timestamp: result.timestamp,
        tasksTotal: tasks.length,
        result,
      });
      await benchmarkHistoryStore.save();
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
    }
  })();

  return c.json({ benchId, status: "started", tasksTotal: tasks.length });
});

// Check benchmark status
routes.get("/api/benchmark/status/:benchId", (c) => {
  const benchId = c.req.param("benchId");
  const state = benchmarkJobs.get(benchId);
  if (!state) {
    // Check if it's a completed run that was persisted before a restart
    const savedSingle = getBenchmarkHistory().find((r) => r.id === benchId);
    if (savedSingle) {
      return c.json({
        id: benchId, status: "done", tasksTotal: savedSingle.tasksTotal,
        tasksCompleted: savedSingle.tasksTotal, result: savedSingle.result,
        multiResult: null, multiMethod: false,
        currentSite: null, currentMethod: null, error: null,
      });
    }
    const savedMulti = getMultiMethodHistory().find((r) => r.id === benchId);
    if (savedMulti) {
      return c.json({
        id: benchId, status: "done", tasksTotal: savedMulti.result.totalTasks,
        tasksCompleted: savedMulti.result.totalTasks, result: null,
        multiResult: savedMulti.result, multiMethod: true,
        currentSite: null, currentMethod: null, error: null,
      });
    }
    return c.json({ error: "Benchmark not found. It may have been interrupted by a server restart." }, 404);
  }

  return c.json({
    id: state.id,
    status: state.status,
    tasksTotal: state.tasksTotal,
    tasksCompleted: state.tasksCompleted,
    result: state.result || null,
    multiResult: state.multiResult || null,
    multiMethod: state.multiMethod || false,
    currentSite: state.currentSite || null,
    currentMethod: state.currentMethod || null,
    error: state.error || null,
  });
});

// List saved benchmark runs
routes.get("/api/benchmark/history", (c) => {
  const history = getBenchmarkHistory();
  return c.json({
    runs: history.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      tasksTotal: r.tasksTotal,
      successRateBaseline: r.result.summary.baseline.successRate,
      successRateWithDocs: r.result.summary.withDocs.successRate,
      improvement: r.result.summary.improvement,
    })),
  });
});

// Get a specific saved run
routes.get("/api/benchmark/history/:runId", (c) => {
  const runId = c.req.param("runId");
  const run = getBenchmarkHistory().find((r) => r.id === runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }
  return c.json(run);
});

// Delete a saved run
routes.delete("/api/benchmark/history/:runId", async (c) => {
  const runId = c.req.param("runId");
  const history = getBenchmarkHistory();
  const idx = history.findIndex((r) => r.id === runId);
  if (idx === -1) {
    return c.json({ error: "Run not found" }, 404);
  }
  history.splice(idx, 1);
  await benchmarkHistoryStore.save();
  return c.json({ ok: true });
});

export default routes;
