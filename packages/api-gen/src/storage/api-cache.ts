/**
 * File-based cache for DomainAPI objects.
 * Stores at ~/.webmap/apis/<domain>.json with 7-day TTL.
 * Follows the same pattern as packages/benchmark/src/datasets/cache.ts.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, stat, readdir, unlink } from "node:fs/promises";
import type { DomainAPI, DomainAPICacheEntry } from "../types.js";
import { DEFAULT_CACHE_TTL_HOURS } from "../types.js";

const DEFAULT_CACHE_DIR = join(homedir(), ".webmap", "apis");

function getCacheDir(): string {
  return process.env.WEBMAP_API_CACHE ?? DEFAULT_CACHE_DIR;
}

function getCachePath(domain: string): string {
  // Sanitize domain for filename
  const safe = domain.replace(/[^a-zA-Z0-9.-]/g, "_");
  return join(getCacheDir(), `${safe}.json`);
}

/**
 * Load a cached DomainAPI for a domain.
 * Returns null if not cached or expired.
 */
export async function loadDomainAPIFromCache(domain: string): Promise<DomainAPI | null> {
  try {
    const path = getCachePath(domain);
    const raw = await readFile(path, "utf-8");
    const entry: DomainAPICacheEntry = JSON.parse(raw);

    if (Date.now() > entry.expiresAt) {
      return null; // Expired
    }

    return entry.domainApi;
  } catch {
    return null; // File doesn't exist or parse error
  }
}

/**
 * Load a cached DomainAPI even if expired (stale fallback).
 * Useful when regeneration fails — better to have stale APIs than none.
 */
export async function loadDomainAPIStale(domain: string): Promise<DomainAPI | null> {
  try {
    const path = getCachePath(domain);
    const raw = await readFile(path, "utf-8");
    const entry: DomainAPICacheEntry = JSON.parse(raw);
    return entry.domainApi;
  } catch {
    return null;
  }
}

/**
 * Save a DomainAPI to the cache with TTL.
 */
export async function saveDomainAPIToCache(
  domainApi: DomainAPI,
  ttlHours: number = DEFAULT_CACHE_TTL_HOURS
): Promise<void> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true });

  const entry: DomainAPICacheEntry = {
    domainApi,
    expiresAt: Date.now() + ttlHours * 60 * 60 * 1000,
    failureCounts: {},
  };

  const path = getCachePath(domainApi.domain);
  // Atomic write: write to .tmp then rename
  const tmpPath = path + ".tmp";
  await writeFile(tmpPath, JSON.stringify(entry, null, 2), "utf-8");
  // Node fs.rename is atomic on most OS; writeFile then rename pattern
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, path);
}

/**
 * Update failure counts for specific actions in the cache.
 * Does not affect the DomainAPI itself — just the tracking data.
 */
export async function updateFailureCounts(
  domain: string,
  updates: Record<string, number>
): Promise<void> {
  try {
    const path = getCachePath(domain);
    const raw = await readFile(path, "utf-8");
    const entry: DomainAPICacheEntry = JSON.parse(raw);

    for (const [actionId, count] of Object.entries(updates)) {
      entry.failureCounts[actionId] = (entry.failureCounts[actionId] || 0) + count;
    }

    await writeFile(path, JSON.stringify(entry, null, 2), "utf-8");
  } catch {
    // Cache miss — nothing to update
  }
}

/**
 * Get failure counts for actions in a domain's cache.
 */
export async function getFailureCounts(domain: string): Promise<Record<string, number>> {
  try {
    const path = getCachePath(domain);
    const raw = await readFile(path, "utf-8");
    const entry: DomainAPICacheEntry = JSON.parse(raw);
    return entry.failureCounts;
  } catch {
    return {};
  }
}

/**
 * Delete the cache for a specific domain.
 */
export async function deleteDomainAPICache(domain: string): Promise<void> {
  try {
    await unlink(getCachePath(domain));
  } catch {
    // Already gone
  }
}

/**
 * List all cached domains with basic stats.
 */
export async function listCachedDomains(): Promise<Array<{
  domain: string;
  totalActions: number;
  verifiedPassed: number;
  pageCount: number;
  generatedAt: string;
  expired: boolean;
}>> {
  try {
    const dir = getCacheDir();
    const files = await readdir(dir);
    const results = [];

    for (const file of files) {
      if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const entry: DomainAPICacheEntry = JSON.parse(raw);
        const api = entry.domainApi;
        results.push({
          domain: api.domain,
          totalActions: api.stats.totalActions,
          verifiedPassed: api.stats.verifiedPassed,
          pageCount: api.stats.totalPages,
          generatedAt: api.generatedAt,
          expired: Date.now() > entry.expiresAt,
        });
      } catch {
        // Skip corrupt files
      }
    }

    return results;
  } catch {
    return []; // Cache dir doesn't exist yet
  }
}

/**
 * Check if a domain's cache is fresh.
 */
export async function isCacheFresh(domain: string): Promise<boolean> {
  try {
    const path = getCachePath(domain);
    const raw = await readFile(path, "utf-8");
    const entry: DomainAPICacheEntry = JSON.parse(raw);
    return Date.now() <= entry.expiresAt;
  } catch {
    return false;
  }
}
