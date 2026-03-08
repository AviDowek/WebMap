/**
 * WebMap API Server — Hono-based REST API + URL-prefix proxy.
 *
 * Endpoints:
 *   POST /api/crawl       — Start a crawl job
 *   GET  /api/docs/:domain — Get cached documentation for a domain
 *   GET  /api/docs/:domain/:path — Get docs for a specific page
 *   GET  /api/status/:jobId — Check crawl job status
 *   GET  /:targetUrl       — URL-prefix proxy (returns markdown)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { webmap, type WebMapResult } from "@webmap/core";

const app = new Hono();

// In-memory store (replace with PostgreSQL + Redis in production)
const docsCache = new Map<string, WebMapResult>();
const jobStatus = new Map<
  string,
  { status: "pending" | "running" | "done" | "error"; result?: WebMapResult; error?: string }
>();

app.use("*", cors());

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// Start a crawl job
app.post("/api/crawl", async (c) => {
  const body = await c.req.json<{
    url: string;
    depth?: number;
    maxPages?: number;
  }>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  try {
    new URL(body.url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const domain = new URL(body.url).hostname;

  // Check cache first
  if (docsCache.has(domain)) {
    return c.json({
      status: "cached",
      domain,
      documentation: docsCache.get(domain)!.markdown,
    });
  }

  // Generate job ID
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobStatus.set(jobId, { status: "pending" });

  // Start crawl in background
  (async () => {
    jobStatus.set(jobId, { status: "running" });
    try {
      const result = await webmap({
        url: body.url,
        maxDepth: body.depth || 3,
        maxPages: body.maxPages || 50,
      });
      docsCache.set(domain, result);
      jobStatus.set(jobId, { status: "done", result });
    } catch (error) {
      jobStatus.set(jobId, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return c.json({ jobId, status: "started", domain });
});

// Check job status
app.get("/api/status/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = jobStatus.get(jobId);
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status === "done" && job.result) {
    return c.json({
      status: "done",
      metadata: job.result.documentation.metadata,
    });
  }

  return c.json({ status: job.status, error: job.error });
});

// Get cached documentation for a domain
app.get("/api/docs/:domain", (c) => {
  const domain = c.req.param("domain");
  const result = docsCache.get(domain);

  if (!result) {
    return c.json({ error: "No documentation found. Start a crawl first." }, 404);
  }

  const format = c.req.query("format") || "markdown";
  if (format === "json") {
    return c.json(result.documentation);
  }

  return c.text(result.markdown);
});

// Get docs for a specific page path
app.get("/api/docs/:domain/:path{.*}", (c) => {
  const domain = c.req.param("domain");
  const path = "/" + (c.req.param("path") || "");
  const result = docsCache.get(domain);

  if (!result) {
    return c.json({ error: "No documentation found." }, 404);
  }

  const page = result.documentation.pages.find((p) => {
    const pagePath = new URL(p.url).pathname;
    return pagePath === path;
  });

  if (!page) {
    return c.json({ error: `No docs for path: ${path}` }, 404);
  }

  return c.json(page);
});

// URL-prefix proxy: GET /https://example.com → returns markdown docs
// This is the "webmap.dev/{url}" pattern
app.get("/http*", async (c) => {
  const targetUrl = c.req.path.slice(1); // Remove leading /

  try {
    new URL(targetUrl);
  } catch {
    return c.json({ error: "Invalid target URL" }, 400);
  }

  const domain = new URL(targetUrl).hostname;

  // Return cached if available
  if (docsCache.has(domain)) {
    return c.text(docsCache.get(domain)!.markdown);
  }

  // Otherwise crawl on-demand
  try {
    const result = await webmap({
      url: targetUrl,
      maxDepth: 2,
      maxPages: 20,
    });
    docsCache.set(domain, result);
    return c.text(result.markdown);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Crawl failed" },
      500
    );
  }
});

const port = parseInt(process.env.PORT || "3001");

console.log(`WebMap API server starting on port ${port}`);
serve({ fetch: app.fetch, port });
console.log(`WebMap API server running at http://localhost:${port}`);
console.log(`  POST /api/crawl          — Start a crawl`);
console.log(`  GET  /api/docs/:domain   — Get cached docs`);
console.log(`  GET  /api/status/:jobId  — Check job status`);
console.log(`  GET  /{url}              — URL-prefix proxy`);
