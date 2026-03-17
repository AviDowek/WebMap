/**
 * Simple JSON file persistence for benchmark state.
 *
 * Stores data in a `data/` directory next to the API server.
 * Each collection is a separate JSON file, written atomically on every mutation.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");

// ─── Low-level helpers ───────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

function filePath(name: string): string {
  return join(DATA_DIR, `${name}.json`);
}

async function readJSON<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath(name), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(name: string, data: unknown): Promise<void> {
  await ensureDir();
  // Write to temp file first, then rename for atomicity
  const path = filePath(name);
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  // On Windows, rename can fail if target exists — use writeFile directly as fallback
  try {
    const { rename } = await import("node:fs/promises");
    await rename(tmp, path);
  } catch {
    await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
  }
}

// ─── Typed store ─────────────────────────────────────────────────────────────

export interface Store<T> {
  /** Current in-memory data */
  data: T;
  /** Persist current data to disk */
  save(): Promise<void>;
  /** Reload from disk */
  load(): Promise<void>;
}

export function createStore<T>(name: string, fallback: T): Store<T> {
  const store: Store<T> = {
    data: structuredClone(fallback),

    async save() {
      await writeJSON(name, store.data);
    },

    async load() {
      store.data = await readJSON<T>(name, fallback);
    },
  };

  return store;
}

// ─── Pre-defined stores ──────────────────────────────────────────────────────

// These match the interfaces in index.ts — imported types would create a
// circular dependency, so we keep them generic and cast at the call site.

export const benchmarkHistoryStore = createStore<unknown[]>("benchmark-history", []);
export const multiMethodHistoryStore = createStore<unknown[]>("multi-method-history", []);
export const benchmarkSitesStore = createStore<Record<string, unknown>>("benchmark-sites", {});
export const docsCacheStore = createStore<Record<string, unknown>>("docs-cache", {});

// Active job stores — persisted so we can recover state after restart
export const activeJobsStore = createStore<Record<string, unknown>>("active-jobs", {});
export const activeBatchesStore = createStore<Record<string, unknown>>("active-batches", {});
export const activeBenchmarksStore = createStore<Record<string, unknown>>("active-benchmarks", {});

// ─── Debounced save ──────────────────────────────────────────────────────────

const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule a debounced save for a store. Coalesces rapid mutations into
 * a single disk write after `delayMs` (default 200ms).
 */
export function debouncedSave(store: Store<unknown>, key: string, delayMs = 200): void {
  const existing = pendingSaves.get(key);
  if (existing) clearTimeout(existing);
  pendingSaves.set(
    key,
    setTimeout(() => {
      pendingSaves.delete(key);
      store.save().catch((e) => console.error(`Failed to persist ${key}:`, e));
    }, delayMs)
  );
}

/**
 * Load all stores from disk. Call once at startup.
 */
export async function loadAll(): Promise<void> {
  await Promise.all([
    benchmarkHistoryStore.load(),
    multiMethodHistoryStore.load(),
    benchmarkSitesStore.load(),
    docsCacheStore.load(),
    activeJobsStore.load(),
    activeBatchesStore.load(),
    activeBenchmarksStore.load(),
  ]);
  const docsCount = Object.keys(docsCacheStore.data as Record<string, unknown>).length;
  console.log(
    `  Loaded persisted state: ${(benchmarkHistoryStore.data as unknown[]).length} benchmark runs, ` +
    `${(multiMethodHistoryStore.data as unknown[]).length} multi-method runs, ` +
    `${Object.keys(benchmarkSitesStore.data as Record<string, unknown>).length} sites, ` +
    `${docsCount} cached docs`
  );

  // Mark any non-terminal active jobs as interrupted
  let interrupted = 0;
  for (const store of [activeJobsStore, activeBatchesStore, activeBenchmarksStore]) {
    const data = store.data as Record<string, { status: string; error?: string }>;
    for (const [id, job] of Object.entries(data)) {
      if (job.status !== "done" && job.status !== "error") {
        data[id] = { ...job, status: "error", error: "Interrupted by server restart" };
        interrupted++;
      }
    }
    if (interrupted > 0) await store.save();
  }
  if (interrupted > 0) {
    console.log(`  Marked ${interrupted} interrupted job(s) as error`);
  }
}

// ─── Periodic cleanup ────────────────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_COMPLETED_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Start periodic cleanup of completed jobs older than 1 hour.
 */
export function startCleanupTimer(): void {
  setInterval(async () => {
    const now = Date.now();
    for (const store of [activeJobsStore, activeBatchesStore, activeBenchmarksStore]) {
      const data = store.data as Record<string, { status: string; completedAt?: number }>;
      let changed = false;
      for (const [id, job] of Object.entries(data)) {
        if ((job.status === "done" || job.status === "error") && job.completedAt && now - job.completedAt > MAX_COMPLETED_AGE_MS) {
          delete data[id];
          changed = true;
        }
      }
      if (changed) await store.save().catch(() => {});
    }
  }, CLEANUP_INTERVAL_MS);
}
