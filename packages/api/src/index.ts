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
import {
  loadAll as loadPersistedState,
} from "./persistence.js";
import {
  requireAuth,
  loadBenchmarkSitesFromStore,
  loadDocsCacheFromStore,
  loadActiveJobsFromStore,
  ANTHROPIC_KEY,
  API_KEY,
} from "./state.js";

// ─── Route modules ───────────────────────────────────────────────────────────

import healthRoutes from "./routes/health.js";
import crawlRoutes from "./routes/crawl.js";
import batchRoutes from "./routes/batch.js";
import benchmarkSitesRoutes from "./routes/benchmark-sites.js";
import benchmarkRunsRoutes from "./routes/benchmark-runs.js";
import benchmarkMultiRoutes from "./routes/benchmark-multi.js";
import proxyRoutes from "./routes/proxy.js";

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

// Mount route modules
app.route("/", healthRoutes);
app.route("/", crawlRoutes);
app.route("/", batchRoutes);
app.route("/", benchmarkSitesRoutes);
app.route("/", benchmarkRunsRoutes);
app.route("/", benchmarkMultiRoutes);
app.route("/", proxyRoutes);

// ─── Export for testing ─────────────────────────────────────────────────────

export { app };

// ─── Start server ───────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "3001");

if (!ANTHROPIC_KEY) {
  console.error("WARNING: ANTHROPIC_API_KEY not set. Crawl requests will fail.");
}

// Load persisted state, then start server
(async () => {
  await loadPersistedState();
  loadBenchmarkSitesFromStore();
  loadDocsCacheFromStore();
  loadActiveJobsFromStore();

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
})();
