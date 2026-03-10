/**
 * Batch crawl routes.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  crawlSite,
  DocGenerator,
  formatAsMarkdown,
  type WebMapResult,
} from "@webmap/core";
import { isBlockedUrl } from "../security.js";
import {
  runWithConcurrency,
  getCached,
  setCache,
  batchJobs,
  ANTHROPIC_KEY,
  type BatchSiteResult,
} from "../state.js";

const routes = new Hono();

routes.post("/api/batch", async (c) => {
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

routes.get("/api/batch/status/:batchId", (c) => {
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

export default routes;
