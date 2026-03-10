/**
 * URL-prefix proxy route.
 */

import { Hono } from "hono";
import {
  crawlSite,
  DocGenerator,
  formatAsMarkdown,
  type WebMapResult,
} from "@webmap/core";
import {
  isBlockedUrl,
  RATE_LIMIT_MAX_CRAWLS,
} from "../security.js";
import {
  checkRateLimit,
  getCached,
  setCache,
  ANTHROPIC_KEY,
} from "../state.js";

const routes = new Hono();

// URL-prefix proxy: GET /https://example.com -> returns markdown docs
routes.get("/http*", async (c) => {
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

export default routes;
