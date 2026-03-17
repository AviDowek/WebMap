/**
 * Crawl and documentation routes.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  crawlSite,
  DocGenerator,
  formatAsMarkdown,
  type WebMapResult,
} from "@webmap/core";
import {
  isBlockedUrl,
  clampNumber,
  RATE_LIMIT_MAX_CRAWLS,
  RATE_LIMIT_MAX_READS,
} from "../security.js";
import {
  checkRateLimit,
  docsCache,
  getCached,
  setCache,
  saveDocsCache,
  jobStatus,
  activeCrawls,
  MAX_CONCURRENT_CRAWLS,
  MAX_PAGES_LIMIT,
  MAX_DEPTH_LIMIT,
  CRAWL_TIMEOUT_MS,
  getRequestAnthropicKey,
  benchmarkSites,
  getUserDocs,
  deleteUserCache,
} from "../state.js";
import { getUserIdFromHeader } from "../auth.js";

const routes = new Hono();

// Start a crawl job
routes.post("/api/crawl", async (c) => {
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
  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;

  // Check cache first
  const cached = getCached(domain, userId);
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

  const anthropicKey = getRequestAnthropicKey(c.req.header("x-anthropic-key"));
  if (!anthropicKey) {
    return c.json({ error: "Anthropic API key required. Provide via x-anthropic-key header or set ANTHROPIC_API_KEY on server." }, 400);
  }

  // Clamp inputs
  const maxDepth = clampNumber(body.depth, 1, MAX_DEPTH_LIMIT, 3);
  const maxPages = clampNumber(body.maxPages, 1, MAX_PAGES_LIMIT, 50);

  const jobId = randomUUID();
  jobStatus.set(jobId, { status: "queued", ownerId: userId });
  activeCrawls.add(domain);

  // Run pipeline in background with phase tracking and timeout
  (async () => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      jobStatus.set(jobId, { status: "error", error: "Crawl timed out", ownerId: userId });
      activeCrawls.delete(domain);
    }, CRAWL_TIMEOUT_MS);

    try {
      // Phase 1: Crawl
      jobStatus.set(jobId, { status: "crawling", ownerId: userId });
      const crawlResult = await crawlSite({
        url: body.url,
        maxDepth,
        maxPages,
      });
      if (timedOut) return;

      jobStatus.set(jobId, {
        status: "analyzing",
        pagesFound: crawlResult.pages.length,
        ownerId: userId,
      });

      // Phase 2: LLM enrichment
      const generator = new DocGenerator({
        apiKey: anthropicKey,
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
        ownerId: userId,
      });
      const markdown = formatAsMarkdown(documentation);

      const result: WebMapResult = { documentation, markdown };
      setCache(domain, result, userId);
      jobStatus.set(jobId, {
        status: "done",
        result,
        pagesFound: crawlResult.pages.length,
        ownerId: userId,
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
routes.get("/api/status/:jobId", (c) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, RATE_LIMIT_MAX_READS)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const jobId = c.req.param("jobId");
  const job = jobStatus.get(jobId);
  if (!job || (job.ownerId && job.ownerId !== userId)) {
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

// List all cached docs (for UI management) — scoped to user
routes.get("/api/docs", (c) => {
  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const userDocs = getUserDocs(userId);

  const docs = userDocs.map(({ domain, result }) => {
    const meta = result.documentation.metadata;
    return {
      domain,
      totalPages: meta.totalPages,
      totalElements: meta.totalElements,
      totalWorkflows: meta.totalWorkflows,
      tokensUsed: meta.tokensUsed,
      crawledAt: result.documentation.crawledAt,
    };
  });

  return c.json({ docs });
});

// Get cached documentation for a domain
routes.get("/api/docs/:domain", (c) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, RATE_LIMIT_MAX_READS)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const domain = c.req.param("domain");
  const cached = getCached(domain, userId);

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
routes.get("/api/docs/:domain/:path{.*}", (c) => {
  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const domain = c.req.param("domain");
  const path = "/" + (c.req.param("path") || "");
  const cached = getCached(domain, userId);

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

// Delete cached docs for a domain
routes.delete("/api/docs/:domain", (c) => {
  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const domain = c.req.param("domain");
  if (!deleteUserCache(domain, userId)) {
    return c.json({ error: "No cached docs for this domain" }, 404);
  }
  return c.json({ ok: true });
});

// Regenerate docs for a domain (delete cache + re-crawl)
routes.post("/api/docs/:domain/regenerate", async (c) => {
  const userId = getUserIdFromHeader(c.req.header("Authorization"))!;
  const domain = c.req.param("domain");

  const anthropicKey = getRequestAnthropicKey(c.req.header("x-anthropic-key"));
  if (!anthropicKey) {
    return c.json({ error: "Anthropic API key required. Provide via x-anthropic-key header or set ANTHROPIC_API_KEY on server." }, 400);
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
  deleteUserCache(domain, userId);

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
      const generator = new DocGenerator({ apiKey: anthropicKey });
      const documentation = await generator.generate(crawlResult, { url: siteUrl!, maxDepth: 3, maxPages: 50 });
      if (timedOut) return;

      jobStatus.set(jobId, { status: "formatting", pagesFound: crawlResult.pages.length });
      const markdown = formatAsMarkdown(documentation);
      const result: WebMapResult = { documentation, markdown };
      setCache(domain, result, userId);
      jobStatus.set(jobId, { status: "done", result, pagesFound: crawlResult.pages.length, ownerId: userId });
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

export default routes;
