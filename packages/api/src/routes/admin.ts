/**
 * Admin-only routes — accessible only to the admin email.
 *
 * GET /api/admin/stats       — Platform overview stats
 * GET /api/admin/users       — All registered users
 * GET /api/admin/jobs        — All active/recent jobs (crawl, batch, benchmark)
 * GET /api/admin/history     — All benchmark history (all users)
 * GET /api/admin/cache       — Docs cache entries
 */

import { Hono } from "hono";
import { isAdminRequest, getAllUsers } from "../auth.js";
import {
  jobStatus,
  batchJobs,
  benchmarkJobs,
  docsCache,
  benchmarkSites,
  getBenchmarkHistory,
  getMultiMethodHistory,
} from "../state.js";

const admin = new Hono();

// ─── Admin guard middleware ──────────────────────────────────────────

admin.use("/api/admin/*", async (c, next) => {
  if (!isAdminRequest(c.req.header("Authorization"))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return next();
});

// ─── Platform Stats ──────────────────────────────────────────────────

admin.get("/api/admin/stats", (c) => {
  const users = getAllUsers();
  const allJobs = Array.from(jobStatus.values());
  const allBatches = Array.from(batchJobs.values());
  const allBenchmarks = Array.from(benchmarkJobs.values());
  const benchHistory = getBenchmarkHistory();
  const multiHistory = getMultiMethodHistory();

  return c.json({
    users: {
      total: users.length,
      recentSignups: users
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5)
        .map((u) => ({ email: u.email, createdAt: u.createdAt })),
    },
    jobs: {
      crawls: {
        total: allJobs.length,
        active: allJobs.filter((j) => j.status !== "done" && j.status !== "error").length,
        done: allJobs.filter((j) => j.status === "done").length,
        error: allJobs.filter((j) => j.status === "error").length,
      },
      batches: {
        total: allBatches.length,
        active: allBatches.filter((b) => b.status === "running").length,
        done: allBatches.filter((b) => b.status === "done").length,
      },
      benchmarks: {
        total: allBenchmarks.length,
        active: allBenchmarks.filter((b) => b.status !== "done" && b.status !== "error").length,
        done: allBenchmarks.filter((b) => b.status === "done").length,
        error: allBenchmarks.filter((b) => b.status === "error").length,
      },
    },
    history: {
      benchmarkRuns: benchHistory.length,
      multiMethodRuns: multiHistory.length,
    },
    cache: {
      docsEntries: docsCache.size,
      benchmarkSites: benchmarkSites.size,
    },
    server: {
      uptime: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      nodeVersion: process.version,
    },
  });
});

// ─── All Users ───────────────────────────────────────────────────────

admin.get("/api/admin/users", (c) => {
  const users = getAllUsers();
  // Enrich with activity counts
  const enriched = users.map((u) => {
    const crawlCount = Array.from(jobStatus.values()).filter((j) => j.ownerId === u.id).length;
    const batchCount = Array.from(batchJobs.values()).filter((b) => b.ownerId === u.id).length;
    const benchmarkCount = Array.from(benchmarkJobs.values()).filter((b) => b.ownerId === u.id).length;
    const benchHistoryCount = getBenchmarkHistory().filter((r) => r.ownerId === u.id).length;
    const multiHistoryCount = getMultiMethodHistory().filter((r) => r.ownerId === u.id).length;
    const siteCount = Array.from(benchmarkSites.values()).filter((s) => s.ownerId === u.id).length;
    const cacheCount = Array.from(docsCache.keys()).filter((k) => k.startsWith(`${u.id}:`)).length;

    return {
      ...u,
      activity: {
        crawls: crawlCount,
        batches: batchCount,
        benchmarks: benchmarkCount,
        benchmarkHistory: benchHistoryCount,
        multiMethodHistory: multiHistoryCount,
        sites: siteCount,
        cachedDocs: cacheCount,
      },
    };
  });

  return c.json({
    total: enriched.length,
    users: enriched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  });
});

// ─── All Jobs ────────────────────────────────────────────────────────

admin.get("/api/admin/jobs", (c) => {
  const crawls = Array.from(jobStatus.entries()).map(([id, j]) => ({
    id,
    type: "crawl" as const,
    status: j.status,
    ownerId: j.ownerId,
    error: j.error,
    pagesFound: j.pagesFound,
  }));

  const batches = Array.from(batchJobs.entries()).map(([id, b]) => ({
    id,
    type: "batch" as const,
    status: b.status,
    ownerId: b.ownerId,
    sitesCount: b.sites.length,
    startedAt: b.startedAt,
  }));

  const benchmarks = Array.from(benchmarkJobs.entries()).map(([id, b]) => ({
    id,
    type: "benchmark" as const,
    status: b.status,
    ownerId: b.ownerId,
    multiMethod: b.multiMethod,
    tasksTotal: b.tasksTotal,
    tasksCompleted: b.tasksCompleted,
    currentSite: b.currentSite,
    currentMethod: b.currentMethod,
    error: b.error,
  }));

  return c.json({
    crawls,
    batches,
    benchmarks,
  });
});

// ─── All Benchmark History ───────────────────────────────────────────

admin.get("/api/admin/history", (c) => {
  const benchHistory = getBenchmarkHistory().map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    ownerId: r.ownerId,
    tasksTotal: r.tasksTotal,
    baselineSuccess: r.result?.summary?.baseline?.successRate,
    withDocsSuccess: r.result?.summary?.withDocs?.successRate,
  }));

  const multiHistory = getMultiMethodHistory().map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    ownerId: r.ownerId,
    sites: r.result?.sites?.length ?? 0,
    methods: r.result?.methods ?? [],
    totalTasks: r.result?.totalTasks ?? 0,
  }));

  return c.json({
    benchmark: benchHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    multiMethod: multiHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
  });
});

// ─── Docs Cache ──────────────────────────────────────────────────────

admin.get("/api/admin/cache", (c) => {
  const now = Date.now();
  const entries = Array.from(docsCache.entries()).map(([key, entry]) => {
    const parts = key.split(":");
    const isScoped = parts.length > 1 && parts[0].includes("-"); // UUID contains dashes
    return {
      key,
      userId: isScoped ? parts[0] : null,
      domain: isScoped ? parts.slice(1).join(":") : key,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      expired: now > entry.expiresAt,
      hasResult: !!entry.result,
    };
  });

  return c.json({
    total: entries.length,
    active: entries.filter((e) => !e.expired).length,
    expired: entries.filter((e) => e.expired).length,
    entries: entries.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt)),
  });
});

export default admin;
