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
const DATA_DIR = join(__dirname, "..", "data");

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

/**
 * Load all stores from disk. Call once at startup.
 */
export async function loadAll(): Promise<void> {
  await Promise.all([
    benchmarkHistoryStore.load(),
    multiMethodHistoryStore.load(),
    benchmarkSitesStore.load(),
    docsCacheStore.load(),
  ]);
  const docsCount = Object.keys(docsCacheStore.data as Record<string, unknown>).length;
  console.log(
    `  Loaded persisted state: ${(benchmarkHistoryStore.data as unknown[]).length} benchmark runs, ` +
    `${(multiMethodHistoryStore.data as unknown[]).length} multi-method runs, ` +
    `${Object.keys(benchmarkSitesStore.data as Record<string, unknown>).length} sites, ` +
    `${docsCount} cached docs`
  );
}
