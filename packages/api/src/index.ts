/**
 * WebMap API Server — Hono-based REST API + URL-prefix proxy.
 *
 * Endpoints:
 *   POST /api/crawl       — Start a crawl job
 *   GET  /api/docs/:domain — Get cached documentation for a domain
 *   GET  /api/docs/:domain/:path — Get docs for a specific page
 *   GET  /api/status/:jobId — Check crawl job status
 *   GET  /api/health       — Health check
 *   GET  /:targetUrl       — URL-prefix proxy (returns markdown)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import {
  crawlSite,
  DocGenerator,
  formatAsMarkdown,
  type WebMapResult,
  type SiteDocumentation,
} from "@webmap/core";
import Anthropic from "@anthropic-ai/sdk";
import {
  runBenchmark,
  runMultiMethodBenchmark,
  sampleTasks,
  generateTasksForSite,
  generateDiverseSites,
  createManualTask,
  ALL_DOC_METHODS,
  type BenchmarkTask,
  type BenchmarkResult,
  type DocMethod,
  type MultiMethodBenchmarkResult,
} from "@webmap/benchmark";
import {
  isBlockedUrl,
  createRateLimiter,
  requireAuth as checkAuth,
  clampNumber,
  RATE_LIMIT_MAX_CRAWLS,
  RATE_LIMIT_MAX_READS,
} from "./security.js";

// ─── Concurrency Helper ──────────────────────────────────────────────────────

/** Run async tasks with a concurrency limit. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const rateLimiter = createRateLimiter();
function checkRateLimit(ip: string, limit: number): boolean {
  return rateLimiter.check(ip, limit);
}

// ─── Cache with size limits and TTL ─────────────────────────────────────────

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const docsCache = new Map<string, { result: WebMapResult; expiresAt: number }>();

type JobPhase = "queued" | "crawling" | "analyzing" | "formatting" | "done" | "error";

interface JobState {
  status: JobPhase;
  result?: WebMapResult;
  error?: string;
  pagesFound?: number;
}

const jobStatus = new Map<string, JobState>();

// Active crawl tracking to prevent duplicate concurrent crawls
const activeCrawls = new Set<string>();
const MAX_CONCURRENT_CRAWLS = 5;

function getCached(domain: string): WebMapResult | null {
  const entry = docsCache.get(domain);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    docsCache.delete(domain);
    return null;
  }
  return entry.result;
}

function setCache(domain: string, result: WebMapResult): void {
  // Evict oldest if at capacity
  if (docsCache.size >= MAX_CACHE_SIZE) {
    const firstKey = docsCache.keys().next().value;
    if (firstKey) docsCache.delete(firstKey);
  }
  docsCache.set(domain, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Server-side limits ─────────────────────────────────────────────────────

const MAX_PAGES_LIMIT = 100;
const MAX_DEPTH_LIMIT = 5;
const CRAWL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Authentication ─────────────────────────────────────────────────────────

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const API_KEY = process.env.WEBMAP_API_KEY;

function requireAuth(authHeader: string | undefined): boolean {
  return checkAuth(authHeader, API_KEY);
}

// ─── App ────────────────────────────────────────────────────────────────────

const app = new Hono();

// CORS — defaults to localhost:3000 only; set ALLOWED_ORIGINS=* to open
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:3000",
];
app.use(
  "*",
  cors({
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    allowMethods: ["GET", "POST", "DELETE"],
    maxAge: 86400,
  })
);

// Request body size limit (1MB)
app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));

// Auth middleware (skip health check)
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  if (!requireAuth(c.req.header("Authorization"))) {
    return c.json({ error: "Unauthorized. Set Authorization header." }, 401);
  }
  return next();
});

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// Start a crawl job
app.post("/api/crawl", async (c) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, RATE_LIMIT_MAX_CRAWLS)) {
    return c.json({ error: "Rate limit exceeded. Max 5 crawls per minute." }, 429);
  }

  const body = await c.req.json<{
    url: string;
    depth?: number;
    maxPages?: number;
  }>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  // Validate URL
  try {
    const parsed = new URL(body.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return c.json({ error: "Only http and https URLs are allowed" }, 400);
    }
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  // SSRF check
  if (isBlockedUrl(body.url)) {
    return c.json({ error: "URL not allowed (private/internal address)" }, 403);
  }

  const domain = new URL(body.url).hostname;

  // Check cache first
  const cached = getCached(domain);
  if (cached) {
    return c.json({
      status: "cached",
      domain,
      documentation: cached.markdown,
    });
  }

  // Prevent duplicate concurrent crawls for same domain
  if (activeCrawls.has(domain)) {
    return c.json({ error: "Crawl already in progress for this domain" }, 409);
  }

  // Global concurrent crawl limit
  if (activeCrawls.size >= MAX_CONCURRENT_CRAWLS) {
    return c.json({ error: "Too many concurrent crawls. Try again later." }, 503);
  }

  if (!ANTHROPIC_KEY) {
    return c.json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  // Clamp inputs
  const maxDepth = clampNumber(body.depth, 1, MAX_DEPTH_LIMIT, 3);
  const maxPages = clampNumber(body.maxPages, 1, MAX_PAGES_LIMIT, 50);

  const jobId = randomUUID();
  jobStatus.set(jobId, { status: "queued" });
  activeCrawls.add(domain);

  // Run pipeline in background with phase tracking and timeout
  (async () => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      jobStatus.set(jobId, { status: "error", error: "Crawl timed out" });
      activeCrawls.delete(domain);
    }, CRAWL_TIMEOUT_MS);

    try {
      // Phase 1: Crawl
      jobStatus.set(jobId, { status: "crawling" });
      const crawlResult = await crawlSite({
        url: body.url,
        maxDepth,
        maxPages,
      });
      if (timedOut) return;

      jobStatus.set(jobId, {
        status: "analyzing",
        pagesFound: crawlResult.pages.length,
      });

      // Phase 2: LLM enrichment
      const generator = new DocGenerator({
        apiKey: ANTHROPIC_KEY!,
      });
      const documentation = await generator.generate(crawlResult, {
        url: body.url,
        maxDepth,
        maxPages,
      });
      if (timedOut) return;

      // Phase 3: Format
      jobStatus.set(jobId, {
        status: "formatting",
        pagesFound: crawlResult.pages.length,
      });
      const markdown = formatAsMarkdown(documentation);

      const result: WebMapResult = { documentation, markdown };
      setCache(domain, result);
      jobStatus.set(jobId, {
        status: "done",
        result,
        pagesFound: crawlResult.pages.length,
      });
    } catch (error) {
      if (!timedOut) {
        jobStatus.set(jobId, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      clearTimeout(timer);
      activeCrawls.delete(domain);
    }
  })();

  return c.json({ jobId, status: "started", domain });
});

// Check job status
app.get("/api/status/:jobId", (c) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, RATE_LIMIT_MAX_READS)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const jobId = c.req.param("jobId");
  const job = jobStatus.get(jobId);
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status === "done" && job.result) {
    return c.json({
      status: "done",
      metadata: job.result.documentation.metadata,
      markdown: job.result.markdown,
    });
  }

  return c.json({
    status: job.status,
    error: job.error || null,
    pagesFound: job.pagesFound || null,
  });
});

// Get cached documentation for a domain
app.get("/api/docs/:domain", (c) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, RATE_LIMIT_MAX_READS)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const domain = c.req.param("domain");
  const cached = getCached(domain);

  if (!cached) {
    return c.json({ error: "No documentation found. Start a crawl first." }, 404);
  }

  const format = c.req.query("format") || "markdown";
  if (format === "json") {
    return c.json(cached.documentation);
  }

  return c.text(cached.markdown);
});

// Get docs for a specific page path
app.get("/api/docs/:domain/:path{.*}", (c) => {
  const domain = c.req.param("domain");
  const path = "/" + (c.req.param("path") || "");
  const cached = getCached(domain);

  if (!cached) {
    return c.json({ error: "No documentation found." }, 404);
  }

  const page = cached.documentation.pages.find((p) => {
    const pagePath = new URL(p.url).pathname;
    return pagePath === path;
  });

  if (!page) {
    return c.json({ error: `No docs for path: ${path}` }, 404);
  }

  return c.json(page);
});

// List all cached docs (for UI management)
app.get("/api/docs", (c) => {
  const docs: Array<{
    domain: string;
    totalPages: number;
    totalElements: number;
    totalWorkflows: number;
    tokensUsed: number;
    crawledAt: string;
  }> = [];

  for (const [domain, entry] of docsCache.entries()) {
    if (Date.now() > entry.expiresAt) continue;
    const meta = entry.result.documentation.metadata;
    docs.push({
      domain,
      totalPages: meta.totalPages,
      totalElements: meta.totalElements,
      totalWorkflows: meta.totalWorkflows,
      tokensUsed: meta.tokensUsed,
      crawledAt: entry.result.documentation.crawledAt,
    });
  }

  return c.json({ docs });
});

// Delete cached docs for a domain
app.delete("/api/docs/:domain", (c) => {
  const domain = c.req.param("domain");
  if (!docsCache.has(domain)) {
    return c.json({ error: "No cached docs for this domain" }, 404);
  }
  docsCache.delete(domain);
  return c.json({ ok: true });
});

// Regenerate docs for a domain (delete cache + re-crawl)
app.post("/api/docs/:domain/regenerate", async (c) => {
  const domain = c.req.param("domain");

  if (!ANTHROPIC_KEY) {
    return c.json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  // Find the URL from cache or benchmark sites
  let siteUrl: string | null = null;
  const cached = docsCache.get(domain);
  if (cached) {
    const firstPage = cached.result.documentation.pages[0];
    if (firstPage) {
      const parsed = new URL(firstPage.url);
      siteUrl = `${parsed.protocol}//${parsed.hostname}`;
    }
  }
  const benchSite = benchmarkSites.get(domain);
  if (!siteUrl && benchSite) {
    siteUrl = benchSite.url;
  }
  if (!siteUrl) {
    siteUrl = `https://${domain}`;
  }

  // Delete old cache
  docsCache.delete(domain);

  // Start a new crawl job
  const jobId = randomUUID();
  jobStatus.set(jobId, { status: "queued" });
  activeCrawls.add(domain);

  (async () => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      jobStatus.set(jobId, { status: "error", error: "Crawl timed out" });
      activeCrawls.delete(domain);
    }, CRAWL_TIMEOUT_MS);

    try {
      jobStatus.set(jobId, { status: "crawling" });
      const crawlResult = await crawlSite({ url: siteUrl!, maxDepth: 3, maxPages: 50 });
      if (timedOut) return;

      jobStatus.set(jobId, { status: "analyzing", pagesFound: crawlResult.pages.length });
      const generator = new DocGenerator({ apiKey: ANTHROPIC_KEY! });
      const documentation = await generator.generate(crawlResult, { url: siteUrl!, maxDepth: 3, maxPages: 50 });
      if (timedOut) return;

      jobStatus.set(jobId, { status: "formatting", pagesFound: crawlResult.pages.length });
      const markdown = formatAsMarkdown(documentation);
      const result: WebMapResult = { documentation, markdown };
      setCache(domain, result);
      jobStatus.set(jobId, { status: "done", result, pagesFound: crawlResult.pages.length });
    } catch (error) {
      if (!timedOut) {
        jobStatus.set(jobId, { status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      clearTimeout(timer);
      activeCrawls.delete(domain);
    }
  })();

  return c.json({ jobId, status: "regenerating", domain });
});

// ─── Benchmark Run History ──────────────────────────────────────────────────

interface SavedBenchmarkRun {
  id: string;
  timestamp: string;
  tasksTotal: number;
  result: BenchmarkResult;
}

const benchmarkHistory: SavedBenchmarkRun[] = [];
const MAX_HISTORY = 20;

// List saved benchmark runs
app.get("/api/benchmark/history", (c) => {
  return c.json({
    runs: benchmarkHistory.map((r) => ({
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
app.get("/api/benchmark/history/:runId", (c) => {
  const runId = c.req.param("runId");
  const run = benchmarkHistory.find((r) => r.id === runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }
  return c.json(run);
});

// Delete a saved run
app.delete("/api/benchmark/history/:runId", (c) => {
  const runId = c.req.param("runId");
  const idx = benchmarkHistory.findIndex((r) => r.id === runId);
  if (idx === -1) {
    return c.json({ error: "Run not found" }, 404);
  }
  benchmarkHistory.splice(idx, 1);
  return c.json({ ok: true });
});

// ─── Batch Testing ───────────────────────────────────────────────────────────

interface BatchSiteResult {
  url: string;
  domain: string;
  status: "pending" | "crawling" | "analyzing" | "done" | "error";
  pagesFound?: number;
  elementsFound?: number;
  workflowsFound?: number;
  tokensUsed?: number;
  durationMs?: number;
  error?: string;
}

interface BatchState {
  id: string;
  status: "running" | "done";
  sites: BatchSiteResult[];
  startedAt: string;
}

const batchJobs = new Map<string, BatchState>();

app.post("/api/batch", async (c) => {
  const body = await c.req.json<{ urls: string[] }>();

  if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
    return c.json({ error: "urls array is required" }, 400);
  }

  if (body.urls.length > 20) {
    return c.json({ error: "Maximum 20 URLs per batch" }, 400);
  }

  if (!ANTHROPIC_KEY) {
    return c.json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  // Validate and filter URLs
  const validUrls: string[] = [];
  for (const raw of body.urls) {
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (isBlockedUrl(url)) continue;
      validUrls.push(url);
    } catch {
      // skip invalid
    }
  }

  if (validUrls.length === 0) {
    return c.json({ error: "No valid URLs provided" }, 400);
  }

  const batchId = randomUUID();
  const sites: BatchSiteResult[] = validUrls.map((url) => ({
    url,
    domain: new URL(url).hostname,
    status: "pending" as const,
  }));

  batchJobs.set(batchId, {
    id: batchId,
    status: "running",
    sites,
    startedAt: new Date().toISOString(),
  });

  // Process concurrently in background (up to 2 at a time)
  (async () => {
    const batch = batchJobs.get(batchId)!;

    await runWithConcurrency(batch.sites, 2, async (site) => {
      const startTime = Date.now();

      try {
        // Check cache first
        const cached = getCached(site.domain);
        if (cached) {
          site.status = "done";
          site.pagesFound = cached.documentation.metadata.totalPages;
          site.elementsFound = cached.documentation.metadata.totalElements;
          site.workflowsFound = cached.documentation.metadata.totalWorkflows;
          site.tokensUsed = cached.documentation.metadata.tokensUsed;
          site.durationMs = 0;
          return;
        }

        site.status = "crawling";
        const crawlResult = await crawlSite({
          url: site.url,
          maxDepth: 2,
          maxPages: 30,
        });

        site.status = "analyzing";
        site.pagesFound = crawlResult.pages.length;

        const generator = new DocGenerator({ apiKey: ANTHROPIC_KEY! });
        const documentation = await generator.generate(crawlResult, {
          url: site.url,
          maxDepth: 2,
          maxPages: 30,
        });
        const markdown = formatAsMarkdown(documentation);
        const result: WebMapResult = { documentation, markdown };
        setCache(site.domain, result);

        site.status = "done";
        site.elementsFound = documentation.metadata.totalElements;
        site.workflowsFound = documentation.metadata.totalWorkflows;
        site.tokensUsed = documentation.metadata.tokensUsed;
        site.durationMs = Date.now() - startTime;
      } catch (error) {
        site.status = "error";
        site.error = error instanceof Error ? error.message : String(error);
        site.durationMs = Date.now() - startTime;
      }
    });

    batch.status = "done";
  })();

  return c.json({ batchId, status: "started", totalSites: validUrls.length });
});

app.get("/api/batch/status/:batchId", (c) => {
  const batchId = c.req.param("batchId");
  const batch = batchJobs.get(batchId);
  if (!batch) {
    return c.json({ error: "Batch not found" }, 404);
  }

  const completed = batch.sites.filter((s) => s.status === "done" || s.status === "error").length;

  return c.json({
    id: batch.id,
    status: batch.status,
    startedAt: batch.startedAt,
    progress: { completed, total: batch.sites.length },
    sites: batch.sites.map((s) => ({
      url: s.url,
      domain: s.domain,
      status: s.status,
      pagesFound: s.pagesFound,
      elementsFound: s.elementsFound,
      workflowsFound: s.workflowsFound,
      tokensUsed: s.tokensUsed,
      durationMs: s.durationMs,
      error: s.error,
    })),
  });
});

// ─── Benchmark Site & Task Management ────────────────────────────────────────

interface BenchmarkSiteConfig {
  url: string;
  domain: string;
  tasks: BenchmarkTask[];
  hasDocumentation: boolean;
  addedAt: string;
}

const benchmarkSites = new Map<string, BenchmarkSiteConfig>();

// List all configured benchmark sites
app.get("/api/benchmark/sites", (c) => {
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
app.post("/api/benchmark/sites", async (c) => {
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
  const hasDocs = getCached(domain) !== null;

  const site: BenchmarkSiteConfig = {
    url: parsed.href,
    domain,
    tasks: body.tasks || [],
    hasDocumentation: hasDocs,
    addedAt: new Date().toISOString(),
  };

  benchmarkSites.set(domain, site);

  return c.json({ domain, url: parsed.href, tasks: site.tasks, hasDocumentation: hasDocs });
});

// Remove a site from the benchmark pool
app.delete("/api/benchmark/sites/:domain", (c) => {
  const domain = c.req.param("domain");
  if (!benchmarkSites.has(domain)) {
    return c.json({ error: "Site not found" }, 404);
  }
  benchmarkSites.delete(domain);
  return c.json({ ok: true });
});

// Add a manual task to a site
app.post("/api/benchmark/sites/:domain/tasks", async (c) => {
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

  return c.json({ task, totalTasks: site.tasks.length });
});

// Delete a task from a site
app.delete("/api/benchmark/sites/:domain/tasks/:taskId", (c) => {
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
  return c.json({ ok: true, remainingTasks: site.tasks.length });
});

// AI-generate tasks for a site
app.post("/api/benchmark/tasks/generate", async (c) => {
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

    return c.json({ tasks, totalTasks: site.tasks.length });
  } catch (error) {
    return c.json({
      error: `Task generation failed: ${error instanceof Error ? error.message : error}`,
    }, 500);
  }
});

// AI-generate diverse sites for benchmark
app.post("/api/benchmark/sites/generate", async (c) => {
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

    return c.json({ sites, addedCount: sites.length });
  } catch (error) {
    return c.json({
      error: `Site generation failed: ${error instanceof Error ? error.message : error}`,
    }, 500);
  }
});

// ─── Benchmark Runs ──────────────────────────────────────────────────────────

interface BenchmarkState {
  id: string;
  status: "generating-docs" | "generating-tasks" | "running-baseline" | "running-with-docs" | "running" | "done" | "error";
  phase?: string;
  result?: BenchmarkResult;
  multiResult?: MultiMethodBenchmarkResult;
  error?: string;
  tasksTotal: number;
  tasksCompleted: number;
  /** Whether this is a multi-method benchmark */
  multiMethod?: boolean;
  /** Current site being tested */
  currentSite?: string;
  /** Current method being tested */
  currentMethod?: string;
}

const benchmarkJobs = new Map<string, BenchmarkState>();

app.post("/api/benchmark", async (c) => {
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
      // Step 1: Generate docs for all target domains (CUA mode for benchmarks)
      const docsMap = new Map<string, SiteDocumentation>();
      const domains = [...new Set(tasks.map((t) => new URL(t.url).hostname))];

      await runWithConcurrency(domains, 2, async (domain) => {
        const task = tasks.find((t) => new URL(t.url).hostname === domain)!;
        try {
          // Always generate fresh CUA-optimized docs for benchmarks.
          // Cached docs may have been generated without cuaMode.
          const crawlResult = await crawlSite({
            url: task.url,
            maxPages: 15,
            maxDepth: 2,
          });
          const generator = new DocGenerator({
            apiKey: ANTHROPIC_KEY!,
            cuaMode: true,
          });
          const documentation = await generator.generate(crawlResult, {
            url: task.url,
            maxPages: 15,
            maxDepth: 2,
          });
          const markdown = formatAsMarkdown(documentation);
          setCache(domain, { documentation, markdown });
          docsMap.set(domain, documentation);
        } catch {
          // Skip domain if crawl fails
        }
      });

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

      // Auto-save to history
      if (benchmarkHistory.length >= MAX_HISTORY) {
        benchmarkHistory.shift(); // remove oldest
      }
      benchmarkHistory.push({
        id: benchId,
        timestamp: result.timestamp,
        tasksTotal: tasks.length,
        result,
      });
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
    }
  })();

  return c.json({ benchId, status: "started", tasksTotal: tasks.length });
});

app.get("/api/benchmark/status/:benchId", (c) => {
  const benchId = c.req.param("benchId");
  const state = benchmarkJobs.get(benchId);
  if (!state) {
    return c.json({ error: "Benchmark not found" }, 404);
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

// ─── Multi-Method Benchmark ──────────────────────────────────────────────────

interface MultiMethodSavedRun {
  id: string;
  timestamp: string;
  result: MultiMethodBenchmarkResult;
}

const multiMethodHistory: MultiMethodSavedRun[] = [];

app.post("/api/benchmark/multi", async (c) => {
  const body = await c.req.json<{
    methods?: DocMethod[];
    siteCount?: number;
    generateSites?: boolean;
    useConfiguredSites?: boolean;
    tasksPerSite?: number;
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
  };

  const methods: DocMethod[] = opts.methods && opts.methods.length > 0
    ? opts.methods.filter((m) => ALL_DOC_METHODS.includes(m))
    : [...ALL_DOC_METHODS];

  const tasksPerSite = clampNumber(opts.tasksPerSite, 1, 5, 3);

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

      // Step 2: Generate docs for all sites (CUA mode)
      state.status = "generating-docs";
      state.phase = "Crawling sites and generating CUA documentation...";
      const docsMap = new Map<string, SiteDocumentation>();

      await runWithConcurrency(siteUrls, 2, async ({ url, domain }) => {
        state.currentSite = domain;
        try {
          const crawlResult = await crawlSite({
            url,
            maxPages: 15,
            maxDepth: 2,
          });
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

          // Update benchmark site config
          const siteConfig = benchmarkSites.get(domain);
          if (siteConfig) siteConfig.hasDocumentation = true;
        } catch (e) {
          const errMsg = e instanceof Error ? e.stack || e.message : String(e);
          console.error(`Failed to crawl/generate docs for ${domain}: ${errMsg}`);
          // Skip this site
        }
      });

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
        (sum, s) => sum + s.tasks.length * methods.length, 0
      );
      state.tasksTotal = totalTasks;

      const result = await runMultiMethodBenchmark(siteTasks, docsMap, {
        apiKey: ANTHROPIC_KEY,
        methods,
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

      // Save to history
      if (multiMethodHistory.length >= MAX_HISTORY) {
        multiMethodHistory.shift();
      }
      multiMethodHistory.push({
        id: benchId,
        timestamp: result.timestamp,
        result,
      });
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
    }
  })();

  return c.json({ benchId, status: "started", multiMethod: true });
});

// Multi-method benchmark history
app.get("/api/benchmark/multi/history", (c) => {
  return c.json({
    runs: multiMethodHistory.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      sites: r.result.sites.length,
      methods: r.result.methods,
      totalTasks: r.result.totalTasks,
    })),
  });
});

app.get("/api/benchmark/multi/history/:runId", (c) => {
  const runId = c.req.param("runId");
  const run = multiMethodHistory.find((r) => r.id === runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }
  return c.json(run);
});

app.delete("/api/benchmark/multi/history/:runId", (c) => {
  const runId = c.req.param("runId");
  const idx = multiMethodHistory.findIndex((r) => r.id === runId);
  if (idx === -1) {
    return c.json({ error: "Run not found" }, 404);
  }
  multiMethodHistory.splice(idx, 1);
  return c.json({ ok: true });
});

// URL-prefix proxy: GET /https://example.com → returns markdown docs
app.get("/http*", async (c) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, RATE_LIMIT_MAX_CRAWLS)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const targetUrl = c.req.path.slice(1);

  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return c.json({ error: "Only http/https URLs allowed" }, 400);
    }
  } catch {
    return c.json({ error: "Invalid target URL" }, 400);
  }

  // SSRF check
  if (isBlockedUrl(targetUrl)) {
    return c.json({ error: "URL not allowed (private/internal address)" }, 403);
  }

  const domain = new URL(targetUrl).hostname;

  // Return cached if available
  const cached = getCached(domain);
  if (cached) {
    return c.text(cached.markdown);
  }

  if (!ANTHROPIC_KEY) {
    return c.json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }, 500);
  }

  // Crawl on-demand with timeout
  try {
    const crawlResult = await crawlSite({
      url: targetUrl,
      maxDepth: 2,
      maxPages: 20,
    });
    const generator = new DocGenerator({
      apiKey: ANTHROPIC_KEY!,
    });
    const documentation = await generator.generate(crawlResult, {
      url: targetUrl,
      maxDepth: 2,
      maxPages: 20,
    });
    const markdown = formatAsMarkdown(documentation);
    const result: WebMapResult = { documentation, markdown };
    setCache(domain, result);
    return c.text(result.markdown);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Crawl failed" },
      500
    );
  }
});

const port = parseInt(process.env.PORT || "3001");

if (!ANTHROPIC_KEY) {
  console.error("WARNING: ANTHROPIC_API_KEY not set. Crawl requests will fail.");
}

console.log(`WebMap API server starting on port ${port}`);
if (API_KEY) {
  console.log("  Auth: API key required (set WEBMAP_API_KEY)");
} else {
  console.log("  Auth: OPEN (set WEBMAP_API_KEY to require auth)");
}
serve({ fetch: app.fetch, port });
console.log(`WebMap API server running at http://localhost:${port}`);
console.log(`  POST /api/crawl          — Start a crawl`);
console.log(`  GET  /api/docs/:domain   — Get cached docs`);
console.log(`  GET  /api/status/:jobId  — Check job status`);
console.log(`  GET  /{url}              — URL-prefix proxy`);
