/**
 * Shared in-memory state, caches, and helpers used across route modules.
 */

import {
  crawlSite,
  DocGenerator,
  formatAsMarkdown,
  type CrawlResult,
  type WebMapResult,
  type SiteDocumentation,
} from "@webmap/core";
import {
  type BenchmarkTask,
  type BenchmarkResult,
  type DocMethod,
  type MultiMethodBenchmarkResult,
} from "@webmap/benchmark";
import {
  createRateLimiter,
  requireAuth as checkAuth,
} from "./security.js";
import {
  benchmarkHistoryStore,
  multiMethodHistoryStore,
  benchmarkSitesStore,
  docsCacheStore,
  activeJobsStore,
  activeBatchesStore,
  activeBenchmarksStore,
  debouncedSave,
  startCleanupTimer,
} from "./persistence.js";

// ─── Concurrency Helper ──────────────────────────────────────────────────────

/** Run async tasks with a concurrency limit. */
export async function runWithConcurrency<T, R>(
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

export const rateLimiter = createRateLimiter();
export function checkRateLimit(ip: string, limit: number): boolean {
  return rateLimiter.check(ip, limit);
}

// ─── Cache with size limits and TTL ─────────────────────────────────────────

export const MAX_CACHE_SIZE = 100;
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const docsCache = new Map<string, { result: WebMapResult; expiresAt: number }>();

export type JobPhase = "queued" | "crawling" | "analyzing" | "formatting" | "done" | "error";

export interface JobState {
  status: JobPhase;
  result?: WebMapResult;
  error?: string;
  pagesFound?: number;
}

export const jobStatus = new Map<string, JobState>();

/** Update a job's status and persist the change (debounced). */
export function setJobStatus(jobId: string, state: JobState): void {
  jobStatus.set(jobId, state);
  const data = activeJobsStore.data as Record<string, unknown>;
  data[jobId] = { ...state, completedAt: state.status === "done" || state.status === "error" ? Date.now() : undefined };
  debouncedSave(activeJobsStore as { data: unknown; save(): Promise<void>; load(): Promise<void> }, "active-jobs");
}

// Active crawl tracking to prevent duplicate concurrent crawls
export const activeCrawls = new Set<string>();
export const MAX_CONCURRENT_CRAWLS = 5;

export function getCached(domain: string): WebMapResult | null {
  const entry = docsCache.get(domain);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    docsCache.delete(domain);
    saveDocsCache();
    return null;
  }
  return entry.result;
}

export function setCache(domain: string, result: WebMapResult): void {
  // Evict oldest if at capacity
  if (docsCache.size >= MAX_CACHE_SIZE) {
    const firstKey = docsCache.keys().next().value;
    if (firstKey) docsCache.delete(firstKey);
  }
  docsCache.set(domain, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  // Persist to disk (fire-and-forget)
  saveDocsCache();
}

export function saveDocsCache(): void {
  const obj: Record<string, { result: WebMapResult; expiresAt: number }> = {};
  for (const [k, v] of docsCache) obj[k] = v;
  (docsCacheStore as { data: unknown }).data = obj;
  docsCacheStore.save().catch((e) => console.error("Failed to persist docs cache:", e));
}

export function loadDocsCacheFromStore(): void {
  docsCache.clear();
  const obj = docsCacheStore.data as Record<string, { result: WebMapResult; expiresAt: number }>;
  const now = Date.now();
  for (const [k, v] of Object.entries(obj)) {
    // Skip expired entries on load
    if (v.expiresAt && v.expiresAt < now) continue;
    // Extend TTL for persisted docs so they survive longer
    docsCache.set(k, { result: v.result, expiresAt: Math.max(v.expiresAt, now + CACHE_TTL_MS) });
  }
}

// ─── Server-side limits ─────────────────────────────────────────────────────

export const MAX_PAGES_LIMIT = 100;
export const MAX_DEPTH_LIMIT = 5;
export const CRAWL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Authentication ─────────────────────────────────────────────────────────

export const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
export const API_KEY = process.env.WEBMAP_API_KEY;

export function requireAuth(authHeader: string | undefined): boolean {
  return checkAuth(authHeader, API_KEY);
}

// ─── Batch Jobs ──────────────────────────────────────────────────────────────

export interface BatchSiteResult {
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

export interface BatchState {
  id: string;
  status: "running" | "done";
  sites: BatchSiteResult[];
  startedAt: string;
}

export const batchJobs = new Map<string, BatchState>();

/** Update a batch job's state and persist (debounced). */
export function setBatchJob(batchId: string, state: BatchState): void {
  batchJobs.set(batchId, state);
  const data = activeBatchesStore.data as Record<string, unknown>;
  data[batchId] = { ...state, completedAt: state.status === "done" ? Date.now() : undefined };
  debouncedSave(activeBatchesStore as { data: unknown; save(): Promise<void>; load(): Promise<void> }, "active-batches");
}

// ─── Benchmark Sites ─────────────────────────────────────────────────────────

export interface BenchmarkSiteConfig {
  url: string;
  domain: string;
  tasks: BenchmarkTask[];
  hasDocumentation: boolean;
  addedAt: string;
}

// In-memory Map backed by persisted store
export const benchmarkSites = new Map<string, BenchmarkSiteConfig>();

export async function saveBenchmarkSites(): Promise<void> {
  const obj: Record<string, BenchmarkSiteConfig> = {};
  for (const [k, v] of benchmarkSites) obj[k] = v;
  (benchmarkSitesStore as { data: unknown }).data = obj;
  await benchmarkSitesStore.save();
}

export function loadBenchmarkSitesFromStore(): void {
  benchmarkSites.clear();
  const obj = benchmarkSitesStore.data as Record<string, BenchmarkSiteConfig>;
  for (const [k, v] of Object.entries(obj)) {
    benchmarkSites.set(k, v);
  }
}

// ─── Benchmark Runs ──────────────────────────────────────────────────────────

export interface BenchmarkState {
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

export const benchmarkJobs = new Map<string, BenchmarkState>();

/** Update a benchmark job's state and persist (debounced). */
export function setBenchmarkJob(benchId: string, state: BenchmarkState): void {
  benchmarkJobs.set(benchId, state);
  const data = activeBenchmarksStore.data as Record<string, unknown>;
  data[benchId] = { ...state, completedAt: state.status === "done" || state.status === "error" ? Date.now() : undefined };
  debouncedSave(activeBenchmarksStore as { data: unknown; save(): Promise<void>; load(): Promise<void> }, "active-benchmarks");
}

// ─── Benchmark History ───────────────────────────────────────────────────────

export interface SavedBenchmarkRun {
  id: string;
  timestamp: string;
  tasksTotal: number;
  result: BenchmarkResult;
}

export interface MultiMethodSavedRun {
  id: string;
  timestamp: string;
  result: MultiMethodBenchmarkResult;
}

export const MAX_HISTORY = 20;

export function getBenchmarkHistory(): SavedBenchmarkRun[] {
  return benchmarkHistoryStore.data as SavedBenchmarkRun[];
}

export function getMultiMethodHistory(): MultiMethodSavedRun[] {
  return multiMethodHistoryStore.data as MultiMethodSavedRun[];
}

// ─── Startup Recovery ─────────────────────────────────────────────────────────

/**
 * Hydrate in-memory Maps from persisted active job stores.
 * Jobs that were interrupted (non-terminal status) are already marked
 * as error by persistence.loadAll(), so we just load them into the Maps.
 * Also starts the periodic cleanup timer.
 */
export function loadActiveJobsFromStore(): void {
  // Load crawl jobs
  const jobs = activeJobsStore.data as Record<string, JobState & { completedAt?: number }>;
  for (const [id, job] of Object.entries(jobs)) {
    jobStatus.set(id, job);
  }

  // Load batch jobs
  const batches = activeBatchesStore.data as Record<string, BatchState & { completedAt?: number }>;
  for (const [id, batch] of Object.entries(batches)) {
    batchJobs.set(id, batch);
  }

  // Load benchmark jobs
  const benchmarks = activeBenchmarksStore.data as Record<string, BenchmarkState & { completedAt?: number }>;
  for (const [id, bench] of Object.entries(benchmarks)) {
    benchmarkJobs.set(id, bench);
  }

  const totalRecovered = jobStatus.size + batchJobs.size + benchmarkJobs.size;
  if (totalRecovered > 0) {
    console.log(`  Recovered ${totalRecovered} active job(s) from disk`);
  }

  // Start periodic cleanup of old completed jobs
  startCleanupTimer();
}
