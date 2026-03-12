/**
 * Local file cache for downloaded benchmark datasets.
 * Caches JSON to disk to avoid re-downloading on every run.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DatasetSource } from "./types.js";

const DEFAULT_CACHE_DIR = join(homedir(), ".webmap", "datasets");

export function getCacheDir(): string {
  return process.env.WEBMAP_DATASET_CACHE || DEFAULT_CACHE_DIR;
}

export function getCachePath(id: DatasetSource): string {
  return join(getCacheDir(), `${id}.json`);
}

export async function loadCached<T>(id: DatasetSource): Promise<T | null> {
  try {
    const data = await readFile(getCachePath(id), "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export async function saveCache<T>(id: DatasetSource, data: T): Promise<void> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getCachePath(id), JSON.stringify(data), "utf-8");
}

/** Returns true if the cache file exists and is newer than maxAgeHours */
export async function isFresh(id: DatasetSource, maxAgeHours = 24): Promise<boolean> {
  try {
    const s = await stat(getCachePath(id));
    const ageMs = Date.now() - s.mtimeMs;
    return ageMs < maxAgeHours * 3_600_000;
  } catch {
    return false;
  }
}
