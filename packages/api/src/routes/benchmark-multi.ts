/**
 * Multi-method benchmark routes.
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
import Anthropic from "@anthropic-ai/sdk";
import {
  runMultiMethodBenchmark,
  generateTasksForSite,
  generateDiverseSites,
  ALL_DOC_METHODS,
  type BenchmarkTask,
  type DocMethod,
} from "@webmap/benchmark";
import { clampNumber } from "../security.js";
import { multiMethodHistoryStore } from "../persistence.js";
import {
  runWithConcurrency,
  setCache,
  benchmarkSites,
  saveBenchmarkSites,
  benchmarkJobs,
  getMultiMethodHistory,
  MAX_HISTORY,
  ANTHROPIC_KEY,
  type BenchmarkState,
} from "../state.js";

const routes = new Hono();

routes.post("/api/benchmark/multi", async (c) => {
  const body = await c.req.json<{
    methods?: DocMethod[];
    siteCount?: number;
    generateSites?: boolean;
    useConfiguredSites?: boolean;
    tasksPerSite?: number;
    runsPerTask?: number;
    verifyResults?: boolean;
  }>().catch(() => ({}));

  if (!ANTHROPIC_KEY) {
    return c.json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  const opts = body as {
    methods?: DocMethod[];
    siteCount?: number;
    generateSites?: boolean;
    useConfiguredSites?: boolean;
    tasksPerSite?: number;
    runsPerTask?: number;
    verifyResults?: boolean;
  };

  const methods: DocMethod[] = opts.methods && opts.methods.length > 0
    ? opts.methods.filter((m) => ALL_DOC_METHODS.includes(m))
    : [...ALL_DOC_METHODS];

  const tasksPerSite = clampNumber(opts.tasksPerSite, 1, 5, 3);
  const runsPerTask = clampNumber(opts.runsPerTask, 1, 5, 1);
  const verifyResults = opts.verifyResults || false;

  const benchId = randomUUID();
  benchmarkJobs.set(benchId, {
    id: benchId,
    status: "generating-docs",
    tasksTotal: 0,
    tasksCompleted: 0,
    multiMethod: true,
  });

  // Run in background
  (async () => {
    const state = benchmarkJobs.get(benchId)!;
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY! });

    try {
      // Step 1: Determine sites
      let siteUrls: Array<{ url: string; domain: string }> = [];

      if (opts.generateSites) {
        state.phase = "Generating diverse site list with AI...";
        const count = clampNumber(opts.siteCount, 1, 20, 5);
        const generated = await generateDiverseSites(client, count);
        siteUrls = generated.map((s) => ({
          url: s.url,
          domain: new URL(s.url).hostname,
        }));

        // Also add them to benchmark sites pool
        for (const g of generated) {
          const domain = new URL(g.url).hostname;
          if (!benchmarkSites.has(domain)) {
            benchmarkSites.set(domain, {
              url: g.url,
              domain,
              tasks: [],
              hasDocumentation: false,
              addedAt: new Date().toISOString(),
            });
          }
        }
        await saveBenchmarkSites();
      } else if (opts.useConfiguredSites) {
        for (const site of benchmarkSites.values()) {
          siteUrls.push({ url: site.url, domain: site.domain });
        }
      }

      if (siteUrls.length === 0) {
        state.status = "error";
        state.error = "No sites to benchmark. Generate sites or add them manually.";
        return;
      }

      // Step 2a: Crawl all sites in parallel (up to 2 at a time)
      state.status = "generating-docs";
      state.phase = "Crawling sites...";
      const docsMap = new Map<string, SiteDocumentation>();
      const crawlResults = new Map<string, { url: string; result: CrawlResult }>();

      await runWithConcurrency(siteUrls, 2, async ({ url, domain }) => {
        state.currentSite = domain;
        try {
          const result = await crawlSite({ url, maxPages: 15, maxDepth: 2 });
          crawlResults.set(domain, { url, result });
          console.log(`Crawled ${domain}: ${result.pages.length} pages`);
        } catch (e) {
          const errMsg = e instanceof Error ? e.stack || e.message : String(e);
          console.error(`Failed to crawl ${domain}: ${errMsg}`);
        }
      });

      // Step 2b: Generate docs sequentially (avoid Claude API rate limits)
      state.phase = "Generating CUA documentation...";
      for (const [domain, { url, result: crawlResult }] of crawlResults) {
        state.currentSite = domain;
        try {
          const generator = new DocGenerator({
            apiKey: ANTHROPIC_KEY!,
            cuaMode: true,
          });
          const documentation = await generator.generate(crawlResult, {
            url,
            maxPages: 15,
            maxDepth: 2,
          });
          const markdown = formatAsMarkdown(documentation);
          setCache(domain, { documentation, markdown });
          docsMap.set(domain, documentation);
          console.log(`Generated docs for ${domain}`);

          // Update benchmark site config
          const siteConfig = benchmarkSites.get(domain);
          if (siteConfig) {
            siteConfig.hasDocumentation = true;
            await saveBenchmarkSites();
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.stack || e.message : String(e);
          console.error(`Failed to generate docs for ${domain}: ${errMsg}`);
        }
      }

      // Filter to only sites we have docs for
      const successfulSites = siteUrls.filter((s) => docsMap.has(s.domain));
      if (successfulSites.length === 0) {
        state.status = "error";
        state.error = "Failed to generate docs for any site. Check server logs for details.";
        return;
      }

      // Step 3: Generate tasks for sites that don't have them
      state.status = "generating-tasks" as BenchmarkState["status"];
      state.phase = "Generating benchmark tasks with AI...";
      const siteTasks = new Map<string, { url: string; tasks: BenchmarkTask[] }>();

      for (const { url, domain } of successfulSites) {
        state.currentSite = domain;
        const siteConfig = benchmarkSites.get(domain);
        let tasks = siteConfig?.tasks || [];

        // Generate tasks if site has none
        if (tasks.length === 0) {
          try {
            const docs = docsMap.get(domain)!;
            const markdown = formatAsMarkdown(docs);
            const generated = await generateTasksForSite(client, url, markdown, tasksPerSite);
            tasks = generated;

            // Save to site config
            if (siteConfig) {
              siteConfig.tasks = generated;
              await saveBenchmarkSites();
            }
          } catch (e) {
            console.error(`Failed to generate tasks for ${domain}: ${e}`);
            continue;
          }
        }

        if (tasks.length > 0) {
          siteTasks.set(domain, { url, tasks });
        }
      }

      if (siteTasks.size === 0) {
        state.status = "error";
        state.error = "Failed to generate tasks for any site.";
        return;
      }

      // Step 4: Run multi-method benchmark
      state.status = "running";
      const totalTasks = [...siteTasks.values()].reduce(
        (sum, s) => sum + s.tasks.length * methods.length * runsPerTask, 0
      );
      state.tasksTotal = totalTasks;

      const result = await runMultiMethodBenchmark(siteTasks, docsMap, {
        apiKey: ANTHROPIC_KEY,
        methods,
        runsPerTask,
        verifyResults,
        onProgress: (update) => {
          state.phase = update.phase;
          state.currentSite = update.site;
          state.currentMethod = update.method;
          state.tasksCompleted = update.tasksCompleted;
          state.tasksTotal = update.tasksTotal;
        },
      });

      state.status = "done";
      state.multiResult = result;

      // Save to history (persisted)
      const mmHistory = getMultiMethodHistory();
      if (mmHistory.length >= MAX_HISTORY) {
        mmHistory.shift();
      }
      mmHistory.push({
        id: benchId,
        timestamp: result.timestamp,
        result,
      });
      await multiMethodHistoryStore.save();
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
    }
  })();

  return c.json({ benchId, status: "started", multiMethod: true });
});

// Multi-method benchmark history
routes.get("/api/benchmark/multi/history", (c) => {
  const mmHistory = getMultiMethodHistory();
  return c.json({
    runs: mmHistory.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      sites: r.result.sites.length,
      methods: r.result.methods,
      totalTasks: r.result.totalTasks,
    })),
  });
});

routes.get("/api/benchmark/multi/history/:runId", (c) => {
  const runId = c.req.param("runId");
  const run = getMultiMethodHistory().find((r) => r.id === runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }
  return c.json(run);
});

routes.delete("/api/benchmark/multi/history/:runId", async (c) => {
  const runId = c.req.param("runId");
  const mmHistory = getMultiMethodHistory();
  const idx = mmHistory.findIndex((r) => r.id === runId);
  if (idx === -1) {
    return c.json({ error: "Run not found" }, 404);
  }
  mmHistory.splice(idx, 1);
  await multiMethodHistoryStore.save();
  return c.json({ ok: true });
});

export default routes;
