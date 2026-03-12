/**
 * Benchmark site and task management routes.
 */

import { Hono } from "hono";
import {
  crawlSite,
  DocGenerator,
  formatAsMarkdown,
} from "@webmap/core";
import Anthropic from "@anthropic-ai/sdk";
import {
  generateTasksForSite,
  generateDiverseSites,
  createManualTask,
  type BenchmarkTask,
} from "@webmap/benchmark";
import { isBlockedUrl, clampNumber } from "../security.js";
import {
  getCached,
  setCache,
  benchmarkSites,
  saveBenchmarkSites,
  ANTHROPIC_KEY,
} from "../state.js";

const routes = new Hono();

// List all configured benchmark sites
routes.get("/api/benchmark/sites", (c) => {
  const sites = Array.from(benchmarkSites.values()).map((s) => ({
    url: s.url,
    domain: s.domain,
    tasks: s.tasks,
    hasDocumentation: s.hasDocumentation,
    addedAt: s.addedAt,
  }));
  return c.json({ sites });
});

// Add a site to the benchmark pool
routes.post("/api/benchmark/sites", async (c) => {
  const body = await c.req.json<{ url: string; tasks?: BenchmarkTask[] }>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(body.url.startsWith("http") ? body.url : `https://${body.url}`);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  if (isBlockedUrl(parsed.href)) {
    return c.json({ error: "URL not allowed" }, 403);
  }

  const domain = parsed.hostname;

  if (benchmarkSites.has(domain)) {
    return c.json(
      { error: `Site already exists: ${domain}. Delete it first to re-add.` },
      409
    );
  }

  const hasDocs = getCached(domain) !== null;

  const site = {
    url: parsed.href,
    domain,
    tasks: body.tasks || [],
    hasDocumentation: hasDocs,
    addedAt: new Date().toISOString(),
  };

  benchmarkSites.set(domain, site);
  await saveBenchmarkSites();

  return c.json({ domain, url: parsed.href, tasks: site.tasks, hasDocumentation: hasDocs });
});

// Remove a site from the benchmark pool
routes.delete("/api/benchmark/sites/:domain", async (c) => {
  const domain = c.req.param("domain");
  if (!benchmarkSites.has(domain)) {
    return c.json({ error: "Site not found" }, 404);
  }
  benchmarkSites.delete(domain);
  await saveBenchmarkSites();
  return c.json({ ok: true });
});

// Add a manual task to a site
routes.post("/api/benchmark/sites/:domain/tasks", async (c) => {
  const domain = c.req.param("domain");
  const site = benchmarkSites.get(domain);
  if (!site) {
    return c.json({ error: "Site not found. Add the site first." }, 404);
  }

  const body = await c.req.json<{
    instruction: string;
    successCriteria: string;
    category?: string;
  }>();

  if (!body.instruction || !body.successCriteria) {
    return c.json({ error: "instruction and successCriteria are required" }, 400);
  }

  const task = createManualTask({
    url: site.url,
    instruction: body.instruction,
    successCriteria: body.successCriteria,
    category: body.category,
  });

  site.tasks.push(task);
  await saveBenchmarkSites();

  return c.json({ task, totalTasks: site.tasks.length });
});

// Delete a task from a site
routes.delete("/api/benchmark/sites/:domain/tasks/:taskId", async (c) => {
  const domain = c.req.param("domain");
  const taskId = c.req.param("taskId");
  const site = benchmarkSites.get(domain);
  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  const idx = site.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) {
    return c.json({ error: "Task not found" }, 404);
  }
  site.tasks.splice(idx, 1);
  await saveBenchmarkSites();
  return c.json({ ok: true, remainingTasks: site.tasks.length });
});

// AI-generate tasks for a site
routes.post("/api/benchmark/tasks/generate", async (c) => {
  const body = await c.req.json<{ url: string; count?: number }>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }
  if (!ANTHROPIC_KEY) {
    return c.json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  let parsed: URL;
  try {
    parsed = new URL(body.url.startsWith("http") ? body.url : `https://${body.url}`);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const domain = parsed.hostname;
  const count = clampNumber(body.count, 1, 10, 3);

  // Get or generate documentation
  let docs = getCached(domain);
  if (!docs) {
    // Quick crawl to generate docs
    try {
      const crawlResult = await crawlSite({ url: parsed.href, maxDepth: 2, maxPages: 15 });
      const generator = new DocGenerator({ apiKey: ANTHROPIC_KEY! });
      const documentation = await generator.generate(crawlResult, {
        url: parsed.href,
        maxDepth: 2,
        maxPages: 15,
      });
      const markdown = formatAsMarkdown(documentation);
      docs = { documentation, markdown };
      setCache(domain, docs);
    } catch (error) {
      return c.json({
        error: `Failed to crawl site: ${error instanceof Error ? error.message : error}`,
      }, 500);
    }
  }

  // Generate tasks using AI
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const tasks = await generateTasksForSite(client, parsed.href, docs.markdown, count);

    // Auto-add site if not already present
    if (!benchmarkSites.has(domain)) {
      benchmarkSites.set(domain, {
        url: parsed.href,
        domain,
        tasks: [],
        hasDocumentation: true,
        addedAt: new Date().toISOString(),
      });
    }

    // Append generated tasks to the site
    const site = benchmarkSites.get(domain)!;
    site.tasks.push(...tasks);
    site.hasDocumentation = true;
    await saveBenchmarkSites();

    return c.json({ tasks, totalTasks: site.tasks.length });
  } catch (error) {
    return c.json({
      error: `Task generation failed: ${error instanceof Error ? error.message : error}`,
    }, 500);
  }
});

// AI-generate diverse sites for benchmark
routes.post("/api/benchmark/sites/generate", async (c) => {
  const body = await c.req.json<{ count?: number }>().catch(() => ({}));

  if (!ANTHROPIC_KEY) {
    return c.json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  const opts = body as { count?: number };
  const count = clampNumber(opts.count, 1, 20, 5);

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const sites = await generateDiverseSites(client, count);

    // Auto-add generated sites to benchmark pool
    for (const site of sites) {
      const domain = new URL(site.url).hostname;
      if (!benchmarkSites.has(domain)) {
        benchmarkSites.set(domain, {
          url: site.url,
          domain,
          tasks: [],
          hasDocumentation: false,
          addedAt: new Date().toISOString(),
        });
      }
    }
    await saveBenchmarkSites();

    return c.json({ sites, addedCount: sites.length });
  } catch (error) {
    return c.json({
      error: `Site generation failed: ${error instanceof Error ? error.message : error}`,
    }, 500);
  }
});

export default routes;
