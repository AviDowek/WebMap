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
  loadDataset,
  DATASET_REGISTRY,
  ALL_DOC_METHODS,
  type BenchmarkTask,
  type DocMethod,
  type DatasetConfig,
  type DatasetSource,
} from "@webmap/benchmark";
import { getUserIdFromHeader } from "../auth.js";
import { clampNumber } from "../security.js";
import { multiMethodHistoryStore } from "../persistence.js";
import {
  runWithConcurrency,
  getCached,
  setCache,
  benchmarkSites,
  saveBenchmarkSites,
  benchmarkJobs,
  getMultiMethodHistory,
  MAX_HISTORY,
  getRequestAnthropicKey,
  type BenchmarkState,
} from "../state.js";

// Methods that don't need docs at all — skip crawling when only these are selected
const DOC_INDEPENDENT_METHODS = new Set<DocMethod>(["none", "a11y-tree", "haiku-vision", "cascade", "programmatic"]);

const routes = new Hono();

// ─── Dataset endpoints ──────────────────────────────────────────────

routes.get("/api/benchmark/datasets", (c) => {
  return c.json({ datasets: DATASET_REGISTRY });
});

routes.get("/api/benchmark/datasets/:id/preview", async (c) => {
  const id = c.req.param("id") as DatasetSource;
  const subset = clampNumber(parseInt(c.req.query("subset") || "5"), 1, 20, 5);

  const info = DATASET_REGISTRY.find((d) => d.id === id);
  if (!info) {
    return c.json({ error: `Unknown dataset: ${id}` }, 404);
  }

  try {
    const tasks = await loadDataset({ source: id, subset });
    return c.json({ tasks, info });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

routes.post("/api/benchmark/datasets/estimate", async (c) => {
  type EstimateBody = { methods?: DocMethod[]; datasetConfig?: DatasetConfig; taskCount?: number };
  const body = (await c.req.json<EstimateBody>().catch(() => ({}))) as EstimateBody;

  const methods = body.methods || ALL_DOC_METHODS;
  const taskCount = body.taskCount || (
    body.datasetConfig
      ? (() => {
          const info = DATASET_REGISTRY.find((d) => d.id === body.datasetConfig!.source);
          return body.datasetConfig.subset || info?.taskCount || 10;
        })()
      : 10
  );
  const datasetInfo = body.datasetConfig
    ? DATASET_REGISTRY.find((d) => d.id === body.datasetConfig!.source)
    : null;
  const avgTokens = datasetInfo?.avgTokensPerTask || 120_000;

  // Model pricing
  const HAIKU_INPUT = 1.0 / 1_000_000;
  const HAIKU_OUTPUT = 5.0 / 1_000_000;
  const SONNET_INPUT = 3.0 / 1_000_000;
  const SONNET_OUTPUT = 15.0 / 1_000_000;
  const HAIKU_METHODS = new Set(["a11y-tree", "haiku-vision", "a11y-first-message"]);
  // Cascade: blended ~60% Haiku + 40% Sonnet
  const INPUT_RATIO = 0.95;
  const OUTPUT_RATIO = 0.05;
  const CACHE_FACTOR = 0.5; // ~50% cost reduction with prompt caching

  const perMethod: Record<string, number> = {};
  let uncachedTotal = 0;

  for (const method of methods) {
    let costPerToken: number;
    if (HAIKU_METHODS.has(method)) {
      costPerToken = avgTokens * INPUT_RATIO * HAIKU_INPUT + avgTokens * OUTPUT_RATIO * HAIKU_OUTPUT;
    } else if (method === "cascade") {
      const haikuCost = avgTokens * INPUT_RATIO * HAIKU_INPUT + avgTokens * OUTPUT_RATIO * HAIKU_OUTPUT;
      const sonnetCost = avgTokens * INPUT_RATIO * SONNET_INPUT + avgTokens * OUTPUT_RATIO * SONNET_OUTPUT;
      costPerToken = haikuCost * 0.6 + sonnetCost * 0.4;
    } else {
      costPerToken = avgTokens * INPUT_RATIO * SONNET_INPUT + avgTokens * OUTPUT_RATIO * SONNET_OUTPUT;
    }
    const methodTotal = costPerToken * taskCount;
    perMethod[method] = methodTotal;
    uncachedTotal += methodTotal;
  }

  return c.json({
    taskCount,
    uncachedTotal,
    total: uncachedTotal * CACHE_FACTOR,
    perMethod,
    perMethodCached: Object.fromEntries(
      Object.entries(perMethod).map(([m, v]) => [m, v * CACHE_FACTOR])
    ),
  });
});

// ─── Multi-method benchmark ─────────────────────────────────────────

routes.post("/api/benchmark/multi", async (c) => {
  const body = await c.req.json<{
    methods?: DocMethod[];
    siteCount?: number;
    generateSites?: boolean;
    useConfiguredSites?: boolean;
    tasksPerSite?: number;
    runsPerTask?: number;
    verifyResults?: boolean;
    siteConcurrency?: number;
    methodParallel?: boolean;
    datasetConfig?: DatasetConfig;
  }>().catch(() => ({}));

  const anthropicKey = getRequestAnthropicKey(c.req.header("x-anthropic-key"));
  if (!anthropicKey) {
    return c.json({ error: "Anthropic API key required. Provide via x-anthropic-key header or set ANTHROPIC_API_KEY on server." }, 400);
  }

  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;

  type MultiBody = {
    methods?: DocMethod[];
    siteCount?: number;
    generateSites?: boolean;
    useConfiguredSites?: boolean;
    tasksPerSite?: number;
    runsPerTask?: number;
    verifyResults?: boolean;
    siteConcurrency?: number;
    methodParallel?: boolean;
    datasetConfig?: DatasetConfig;
  };
  const opts = body as MultiBody;

  const methods: DocMethod[] = opts.methods && opts.methods.length > 0
    ? opts.methods.filter((m) => ALL_DOC_METHODS.includes(m))
    : [...ALL_DOC_METHODS];

  const tasksPerSite = clampNumber(opts.tasksPerSite, 1, 5, 3);
  const runsPerTask = clampNumber(opts.runsPerTask, 1, 5, 1);
  const verifyResults = opts.verifyResults || false;
  const siteConcurrency = clampNumber(opts.siteConcurrency, 1, 8, 2);
  const sequential = opts.methodParallel === false; // default: parallel

  const benchId = randomUUID();
  benchmarkJobs.set(benchId, {
    id: benchId,
    status: "generating-docs",
    tasksTotal: 0,
    tasksCompleted: 0,
    multiMethod: true,
    ownerId: userId,
  });

  // Run in background
  (async () => {
    const state = benchmarkJobs.get(benchId)!;
    const client = new Anthropic({ apiKey: anthropicKey });

    try {
      // Step 1: Determine sites (either from dataset or generated/configured)
      let siteUrls: Array<{ url: string; domain: string }> = [];

      // Dataset mode: load tasks directly from an industry benchmark
      if (opts.datasetConfig && opts.datasetConfig.source !== "custom") {
        state.phase = `Loading ${opts.datasetConfig.source} dataset...`;
        const datasetTasks = await loadDataset(opts.datasetConfig);

        if (datasetTasks.length === 0) {
          state.status = "error";
          state.error = `No tasks loaded from dataset ${opts.datasetConfig.source}.`;
          return;
        }

        // Group tasks by domain
        const domainGroups = new Map<string, { url: string; tasks: BenchmarkTask[] }>();
        for (const task of datasetTasks) {
          try {
            const domain = new URL(task.url).hostname;
            if (!domainGroups.has(domain)) {
              domainGroups.set(domain, { url: task.url, tasks: [] });
            }
            domainGroups.get(domain)!.tasks.push(task);
          } catch { /* skip invalid URLs */ }
        }

        // ── Doc generation for dataset domains ───────────────────────
        // Doc-dependent methods (micro-guide, full-guide, first-message, pre-plan,
        // a11y-first-message, hybrid) need documentation to function — without it
        // they're identical to "none". Crawl every unique domain from the loaded tasks
        // so all methods produce meaningful, comparable results.
        //
        // The user controls volume via datasetConfig.subset — if they load 50 tasks
        // spanning 8 domains, we crawl those 8 domains. Large subsets take longer.
        const needsDocs = methods.some((m) => !DOC_INDEPENDENT_METHODS.has(m));
        const docsMap = new Map<string, SiteDocumentation>();

        if (needsDocs) {
          const domainList = [...domainGroups.keys()];
          console.log(`[dataset:${opts.datasetConfig.source}] Crawling ${domainList.length} unique domains for doc generation...`);

          // Step A: Crawl all unique domains in parallel (respecting siteConcurrency)
          state.status = "generating-docs";
          state.phase = `Crawling ${domainList.length} dataset sites...`;
          const crawlResults = new Map<string, { url: string; result: CrawlResult }>();

          await runWithConcurrency(
            domainList.map((domain) => ({ domain, url: domainGroups.get(domain)!.url })),
            siteConcurrency,
            async ({ domain, url }) => {
              state.currentSite = domain;

              // Use cached docs if available (avoids redundant crawls)
              const cached = getCached(domain);
              if (cached?.documentation) {
                docsMap.set(domain, cached.documentation);
                console.log(`  [dataset] ${domain}: using cached docs`);
                return;
              }

              try {
                const result = await crawlSite({ url, maxPages: 15, maxDepth: 2 });
                crawlResults.set(domain, { url, result });
                console.log(`  [dataset] Crawled ${domain}: ${result.pages.length} pages`);
              } catch (e) {
                console.error(`  [dataset] Failed to crawl ${domain}: ${e instanceof Error ? e.message : e}`);
              }
            }
          );

          // Step B: Generate CUA docs for crawled domains (sequential to avoid rate limits)
          state.phase = `Generating docs for ${crawlResults.size} dataset sites...`;
          for (const [domain, { url, result: crawlResult }] of crawlResults) {
            state.currentSite = domain;
            try {
              const generator = new DocGenerator({ apiKey: anthropicKey, cuaMode: true });
              const documentation = await generator.generate(crawlResult, { url, maxPages: 15, maxDepth: 2 });
              const markdown = formatAsMarkdown(documentation);
              setCache(domain, { documentation, markdown });
              docsMap.set(domain, documentation);
              console.log(`  [dataset] Generated docs for ${domain}`);
            } catch (e) {
              console.error(`  [dataset] Doc generation failed for ${domain}: ${e instanceof Error ? e.message : e}`);
            }
          }

          const docsGenerated = docsMap.size;
          const docsFailed = domainList.length - docsGenerated;
          console.log(`[dataset] Docs ready: ${docsGenerated}/${domainList.length} domains${docsFailed > 0 ? ` (${docsFailed} failed — those domains run without docs)` : ""}`);
        }

        // ── Run multi-method benchmark ────────────────────────────────
        state.status = "running";
        const siteTasks = domainGroups;
        const totalTasks = [...siteTasks.values()].reduce(
          (sum, s) => sum + s.tasks.length * methods.length * runsPerTask, 0
        );
        state.tasksTotal = totalTasks;
        console.log(`[dataset:${opts.datasetConfig.source}] ${siteTasks.size} domains, ${datasetTasks.length} tasks`);

        const result = await runMultiMethodBenchmark(siteTasks, docsMap, {
          apiKey: anthropicKey,
          methods,
          runsPerTask,
          verifyResults,
          sequential,
          siteConcurrency,
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
        const mmHistory = getMultiMethodHistory();
        if (mmHistory.length >= MAX_HISTORY) mmHistory.shift();
        mmHistory.push({ id: benchId, timestamp: result.timestamp, result, ownerId: userId });
        await multiMethodHistoryStore.save();
        return;
      }

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
            apiKey: anthropicKey,
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
        apiKey: anthropicKey,
        methods,
        runsPerTask,
        verifyResults,
        sequential,
        siteConcurrency,
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
        ownerId: userId,
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
  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const mmHistory = getMultiMethodHistory().filter((r) => (r as any).ownerId === userId || !(r as any).ownerId);
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
  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const runId = c.req.param("runId");
  const run = getMultiMethodHistory().find((r) => r.id === runId);
  if (!run || ((run as any).ownerId && (run as any).ownerId !== userId)) {
    return c.json({ error: "Run not found" }, 404);
  }
  return c.json(run);
});

routes.delete("/api/benchmark/multi/history/:runId", async (c) => {
  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const runId = c.req.param("runId");
  const mmHistory = getMultiMethodHistory();
  const idx = mmHistory.findIndex((r) => r.id === runId);
  if (idx === -1) {
    return c.json({ error: "Run not found" }, 404);
  }
  const entry = mmHistory[idx] as any;
  if (entry.ownerId && entry.ownerId !== userId) {
    return c.json({ error: "Run not found" }, 404);
  }
  mmHistory.splice(idx, 1);
  await multiMethodHistoryStore.save();
  return c.json({ ok: true });
});

export default routes;
