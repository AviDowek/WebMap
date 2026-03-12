/**
 * Mind2Web Online dataset loader.
 * Downloads from HuggingFace: osunlp/Online-Mind2Web
 *
 * Task structure: confirmed_task → instruction, website → url, domain → category
 */

import type { BenchmarkTask } from "../types.js";
import { loadCached, saveCache, isFresh } from "./cache.js";
import type { DatasetConfig } from "./types.js";

// Possible file paths in the HF dataset repo
const HF_URLS = [
  "https://huggingface.co/datasets/osunlp/Online-Mind2Web/resolve/main/data/online_test.json",
  "https://huggingface.co/datasets/osunlp/Online-Mind2Web/resolve/main/data/test.json",
];

interface Mind2WebRawTask {
  task_id?: string;
  confirmed_task?: string;
  website?: string;
  domain?: string;
  subdomain?: string;
  // Some variants use these field names
  annotation_id?: string;
  intent?: string;
  start_url?: string;
}

export async function loadMind2Web(config: DatasetConfig): Promise<BenchmarkTask[]> {
  // Try cache first
  if (await isFresh("mind2web")) {
    const cached = await loadCached<BenchmarkTask[]>("mind2web");
    if (cached) return applyFilters(cached, config);
  }

  // Download from HuggingFace
  let raw: Mind2WebRawTask[] | null = null;
  for (const url of HF_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) {
        const data = await res.json() as Mind2WebRawTask[] | { data: Mind2WebRawTask[] };
        raw = Array.isArray(data) ? data : data.data;
        break;
      }
    } catch {
      // Try next URL
    }
  }

  if (!raw || raw.length === 0) {
    // Download failed — fall back to stale cache if available
    const stale = await loadCached<BenchmarkTask[]>("mind2web");
    if (stale && stale.length > 0) {
      console.warn("[mind2web] Download failed; serving stale cached data.");
      return applyFilters(stale, config);
    }
    throw new Error(
      "Failed to download Mind2Web dataset. Check your internet connection.\n" +
      "Manual download: https://huggingface.co/datasets/osunlp/Online-Mind2Web"
    );
  }

  const tasks = raw.map((t, i) => convertTask(t, i));
  await saveCache("mind2web", tasks);
  return applyFilters(tasks, config);
}

function convertTask(t: Mind2WebRawTask, index: number): BenchmarkTask {
  const id = t.task_id || t.annotation_id || `mind2web-${index}`;
  const instruction = t.confirmed_task || t.intent || "Complete the task";
  const url = t.website || t.start_url || "https://example.com";
  const category = t.domain || "web";

  return {
    id,
    url: url.startsWith("http") ? url : `https://${url}`,
    instruction,
    successCriteria: `Complete the task: "${instruction}"`,
    category,
    source: "mind2web",
  };
}

function applyFilters(tasks: BenchmarkTask[], config: DatasetConfig): BenchmarkTask[] {
  let result = tasks;
  if (config.categories && config.categories.length > 0) {
    const cats = config.categories.map((c) => c.toLowerCase());
    result = result.filter((t) => cats.some((c) => t.category.toLowerCase().includes(c)));
  }
  if (config.subset && config.subset > 0) {
    result = result.slice(0, config.subset);
  }
  return result;
}
