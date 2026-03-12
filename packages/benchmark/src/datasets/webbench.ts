/**
 * WebBench dataset loader.
 * Downloads from HuggingFace: bytedance-research/Web-Bench
 *
 * 2,454 open tasks across 452 live websites (2025).
 */

import type { BenchmarkTask } from "../types.js";
import { loadCached, saveCache, isFresh } from "./cache.js";
import type { DatasetConfig } from "./types.js";

const HF_URLS = [
  "https://huggingface.co/datasets/bytedance-research/Web-Bench/resolve/main/WebBench.json",
  "https://huggingface.co/datasets/Halluminate/WebBench/resolve/main/WebBench.json",
];

interface WebBenchRawTask {
  id?: string;
  task_id?: string;
  url?: string;
  website?: string;
  task?: string;
  instruction?: string;
  success_criteria?: string;
  category?: string;
  domain?: string;
}

export async function loadWebBench(config: DatasetConfig): Promise<BenchmarkTask[]> {
  if (await isFresh("webbench")) {
    const cached = await loadCached<BenchmarkTask[]>("webbench");
    if (cached) return applyFilters(cached, config);
  }

  let raw: WebBenchRawTask[] | null = null;
  for (const url of HF_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) {
        const data = await res.json() as WebBenchRawTask[] | { data: WebBenchRawTask[] };
        raw = Array.isArray(data) ? data : data.data;
        break;
      }
    } catch {
      // Try next URL
    }
  }

  if (!raw || raw.length === 0) {
    // Download failed — fall back to stale cache if available
    const stale = await loadCached<BenchmarkTask[]>("webbench");
    if (stale && stale.length > 0) {
      console.warn("[webbench] Download failed; serving stale cached data.");
      return applyFilters(stale, config);
    }
    throw new Error(
      "Failed to download WebBench dataset. Check your internet connection.\n" +
      "Source: https://huggingface.co/datasets/bytedance-research/Web-Bench"
    );
  }

  const tasks = raw.map((t, i) => convertTask(t, i));
  await saveCache("webbench", tasks);
  return applyFilters(tasks, config);
}

function convertTask(t: WebBenchRawTask, index: number): BenchmarkTask {
  const id = t.id || t.task_id || `webbench-${index}`;
  const instruction = t.task || t.instruction || "Complete the task";
  const url = t.url || t.website || "https://example.com";
  const category = t.category || t.domain || "web";

  return {
    id,
    url: url.startsWith("http") ? url : `https://${url}`,
    instruction,
    successCriteria: t.success_criteria || `Complete the task: "${instruction}"`,
    category,
    source: "webbench",
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
