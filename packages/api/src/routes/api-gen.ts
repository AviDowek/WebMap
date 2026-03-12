/**
 * API Generation routes — manage auto-generated site APIs.
 *
 * Endpoints:
 *   POST   /api/api-gen/discover         — Start API discovery crawl (async job)
 *   GET    /api/api-gen/status/:jobId     — Poll discovery job status
 *   GET    /api/api-gen/domains           — List all cached domains
 *   GET    /api/api-gen/:domain           — Get full DomainAPI for a domain
 *   POST   /api/api-gen/:domain/test      — Trigger self-test pipeline
 *   DELETE /api/api-gen/:domain           — Clear cached API
 */

import { Hono } from "hono";
import {
  loadDomainAPIFromCache,
  loadDomainAPIStale,
  saveDomainAPIToCache,
  deleteDomainAPICache,
  listCachedDomains,
  runDiscoveryCrawl,
  generateDomainAPI,
  runSelfTest,
  applyTestResults,
} from "@webmap/api-gen";
import { ANTHROPIC_KEY } from "../state.js";

const routes = new Hono();

// In-memory job tracking for async operations
interface DiscoveryJob {
  id: string;
  domain: string;
  url: string;
  status: "running" | "done" | "error";
  startedAt: string;
  completedAt?: string;
  error?: string;
  stats?: { totalActions: number; totalPages: number; verifiedPassed: number };
}

const activeJobs = new Map<string, DiscoveryJob>();

// ─── List cached domains ──────────────────────────────────────────

routes.get("/api/api-gen/domains", async (c) => {
  try {
    const domains = await listCachedDomains();
    return c.json({ domains });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── Get full DomainAPI ───────────────────────────────────────────

routes.get("/api/api-gen/:domain", async (c) => {
  const domain = c.req.param("domain");
  try {
    const api = await loadDomainAPIFromCache(domain) ?? await loadDomainAPIStale(domain);
    if (!api) {
      return c.json({ error: `No API found for domain: ${domain}` }, 404);
    }
    return c.json(api);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ─── Start discovery crawl ────────────────────────────────────────

routes.post("/api/api-gen/discover", async (c) => {
  const body = await c.req.json<{ url: string }>();
  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  const apiKey = ANTHROPIC_KEY;
  if (!apiKey) {
    return c.json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  }

  let domain: string;
  try {
    domain = new URL(body.url).hostname;
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const jobId = `apigen-${domain}-${Date.now()}`;
  const job: DiscoveryJob = {
    id: jobId,
    domain,
    url: body.url,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  activeJobs.set(jobId, job);

  // Run async
  (async () => {
    try {
      console.log(`[api-gen] Starting discovery for ${domain}...`);
      const crawlResult = await runDiscoveryCrawl({ url: body.url, maxPages: 150, maxDepth: 4 });
      console.log(`[api-gen] Crawled ${crawlResult.pages.length} pages, generating API...`);

      const api = await generateDomainAPI(crawlResult, apiKey, domain, body.url);
      await saveDomainAPIToCache(api);

      job.status = "done";
      job.completedAt = new Date().toISOString();
      job.stats = {
        totalActions: api.stats.totalActions,
        totalPages: api.stats.totalPages,
        verifiedPassed: api.stats.verifiedPassed,
      };
      console.log(`[api-gen] Generated ${api.stats.totalActions} actions for ${domain}`);
    } catch (err) {
      job.status = "error";
      job.error = (err as Error).message;
      job.completedAt = new Date().toISOString();
      console.error(`[api-gen] Discovery failed for ${domain}: ${(err as Error).message}`);
    }
  })();

  return c.json({ jobId, domain, status: "running" });
});

// ─── Poll job status ──────────────────────────────────────────────

routes.get("/api/api-gen/status/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = activeJobs.get(jobId);
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }
  return c.json(job);
});

// ─── Trigger self-test ────────────────────────────────────────────

routes.post("/api/api-gen/:domain/test", async (c) => {
  const domain = c.req.param("domain");
  const apiKey = ANTHROPIC_KEY;
  if (!apiKey) {
    return c.json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  }

  const api = await loadDomainAPIFromCache(domain) ?? await loadDomainAPIStale(domain);
  if (!api) {
    return c.json({ error: `No API found for domain: ${domain}` }, 404);
  }

  const jobId = `test-${domain}-${Date.now()}`;
  const job: DiscoveryJob = {
    id: jobId,
    domain,
    url: api.rootUrl,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  activeJobs.set(jobId, job);

  // Run async
  (async () => {
    try {
      console.log(`[api-gen] Running self-test for ${domain}...`);
      const report = await runSelfTest(api, { apiKey, maxActions: 100 });
      const updated = applyTestResults(api, report);
      await saveDomainAPIToCache(updated);

      job.status = "done";
      job.completedAt = new Date().toISOString();
      job.stats = {
        totalActions: updated.stats.totalActions,
        totalPages: updated.stats.totalPages,
        verifiedPassed: updated.stats.verifiedPassed,
      };
      console.log(`[api-gen] Self-test complete: ${report.passed}/${report.totalTested} passed`);
    } catch (err) {
      job.status = "error";
      job.error = (err as Error).message;
      job.completedAt = new Date().toISOString();
    }
  })();

  return c.json({ jobId, domain, status: "running" });
});

// ─── Delete cached API ────────────────────────────────────────────

routes.delete("/api/api-gen/:domain", async (c) => {
  const domain = c.req.param("domain");
  try {
    await deleteDomainAPICache(domain);
    return c.json({ deleted: true, domain });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default routes;
