/**
 * WebMap API Server — Hono-based REST API + URL-prefix proxy.
 *
 * Endpoints:
 *   POST /api/auth/register   — Create account
 *   POST /api/auth/login      — Login, get JWT
 *   GET  /api/auth/me         — Current user info
 *   POST /api/crawl           — Start a crawl job
 *   GET  /api/docs/:domain    — Get cached documentation for a domain
 *   GET  /api/status/:jobId   — Check crawl job status
 *   GET  /api/health          — Health check
 *   GET  /:targetUrl          — URL-prefix proxy (returns markdown)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import {
  loadAll as loadPersistedState,
} from "./persistence.js";
import {
  loadBenchmarkSitesFromStore,
  loadDocsCacheFromStore,
  loadActiveJobsFromStore,
  checkRateLimit,
  ANTHROPIC_KEY,
} from "./state.js";
import {
  loadUsers,
  registerUser,
  loginUser,
  getUserIdFromHeader,
} from "./auth.js";

// ─── Route modules ───────────────────────────────────────────────────────────

import healthRoutes from "./routes/health.js";
import crawlRoutes from "./routes/crawl.js";
import batchRoutes from "./routes/batch.js";
import benchmarkSitesRoutes from "./routes/benchmark-sites.js";
import benchmarkRunsRoutes from "./routes/benchmark-runs.js";
import benchmarkMultiRoutes from "./routes/benchmark-multi.js";
import apiGenRoutes from "./routes/api-gen.js";
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
    allowHeaders: ["Content-Type", "Authorization", "x-anthropic-key"],
    maxAge: 86400,
  })
);

// Request body size limit (1MB)
app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));

// Security headers
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

// ─── Auth routes (public, no JWT required) ──────────────────────────────────

const AUTH_RATE_LIMIT = 10; // 10 attempts per minute per IP

app.post("/api/auth/register", async (c) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, AUTH_RATE_LIMIT)) {
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }
  const body = await c.req.json<{ email: string; password: string }>().catch(() => ({} as { email: string; password: string }));
  if (!body.email || !body.password) {
    return c.json({ error: "email and password required" }, 400);
  }
  const result = await registerUser(body.email, body.password);
  if ("error" in result) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({ token: result.token, user: { id: result.user.id, email: result.user.email } });
});

app.post("/api/auth/login", async (c) => {
  const ip = c.req.header("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, AUTH_RATE_LIMIT)) {
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }
  const body = await c.req.json<{ email: string; password: string }>().catch(() => ({} as { email: string; password: string }));
  if (!body.email || !body.password) {
    return c.json({ error: "email and password required" }, 400);
  }
  const result = await loginUser(body.email, body.password);
  if ("error" in result) {
    return c.json({ error: result.error }, 401);
  }
  return c.json({ token: result.token, user: { id: result.user.id, email: result.user.email } });
});

app.get("/api/auth/me", (c) => {
  const userId = getUserIdFromHeader(c.req.header("Authorization"));
  if (!userId) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  return c.json({ userId });
});

// ─── JWT auth middleware (skip health + auth routes) ─────────────────────────

app.use("/api/*", async (c, next) => {
  // Public routes: health check and auth endpoints
  if (c.req.path === "/api/health") return next();
  if (c.req.path.startsWith("/api/auth/")) return next();

  const userId = getUserIdFromHeader(c.req.header("Authorization"));
  if (!userId) {
    return c.json({ error: "Authentication required. Please log in." }, 401);
  }

  // userId is verified — downstream routes extract it via getUserIdFromHeader()
  return next();
});

// Mount route modules
app.route("/", healthRoutes);
app.route("/", crawlRoutes);
app.route("/", batchRoutes);
app.route("/", benchmarkSitesRoutes);
app.route("/", benchmarkRunsRoutes);
app.route("/", benchmarkMultiRoutes);
app.route("/", apiGenRoutes);
app.route("/", proxyRoutes);

// ─── Export for testing ─────────────────────────────────────────────────────

export { app };

// ─── Start server ───────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "3001");

if (!ANTHROPIC_KEY) {
  console.log("  ANTHROPIC_API_KEY not set — users must provide their own key (BYOK mode)");
}

// Load persisted state, then start server
(async () => {
  await loadPersistedState();
  await loadUsers();
  loadBenchmarkSitesFromStore();
  loadDocsCacheFromStore();
  loadActiveJobsFromStore();

  console.log(`WebMap API server starting on port ${port}`);
  console.log("  Auth: JWT-based user authentication");
  const server = serve({ fetch: app.fetch, port });

  server.on("listening", () => {
    console.log(`WebMap API server running at http://localhost:${port}`);
    console.log(`  POST /api/auth/register      — Create account`);
    console.log(`  POST /api/auth/login         — Login`);
    console.log(`  POST /api/crawl              — Start a crawl`);
    console.log(`  GET  /api/docs/:domain       — Get cached docs`);
    console.log(`  GET  /api/status/:jobId      — Check job status`);
    console.log(`  POST /api/benchmark/multi    — Start multi-method benchmark`);
    console.log(`  POST /api/api-gen/discover   — Discover site APIs`);
    console.log(`  GET  /api/api-gen/domains    — List generated APIs`);
    console.log(`  GET  /{url}                  — URL-prefix proxy`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`ERROR: Port ${port} is already in use.`);
      console.error(`  Kill the other process or set PORT=<other> to use a different port.`);
      setTimeout(() => process.exit(1), 5000);
      return;
    }
    throw err;
  });
})();
