/**
 * Industry CUA benchmark dataset registry and loader.
 *
 * Supported datasets:
 * - mind2web: Mind2Web Online (300 tasks, HuggingFace download, live websites)
 * - webbench: WebBench (2,454 tasks, HuggingFace download, live websites, 2025)
 * - webarena: WebArena-Verified (812 tasks, self-hosted Docker)
 * - webchore-arena: WebChoreArena (532 tasks, self-hosted Docker, long-horizon)
 * - visual-webarena: VisualWebArena (910 tasks, self-hosted Docker, visual grounding)
 * - workarena: WorkArena (29 atomic tasks, ServiceNow SaaS)
 */

import type { BenchmarkTask } from "../types.js";
import type { DatasetInfo, DatasetConfig, DatasetSource } from "./types.js";
import { loadMind2Web } from "./mind2web.js";
import { loadWebBench } from "./webbench.js";
import { loadWebArena } from "./webarena.js";
import { loadWebChoreArena } from "./webchore-arena.js";
import { loadVisualWebArena } from "./visual-webarena.js";
import { loadWorkArena } from "./workarena.js";

export type { DatasetSource, DatasetInfo, DatasetConfig, CostEstimate } from "./types.js";

/** Registry of all supported datasets with metadata for UI display and cost estimation */
export const DATASET_REGISTRY: DatasetInfo[] = [
  {
    id: "mind2web",
    name: "Mind2Web Online",
    description: "300 tasks across 137 live websites in 31 categories. Covers shopping, travel, social media, and more. Downloaded from HuggingFace.",
    taskCount: 300,
    avgTokensPerTask: 120_000,
    requiresDocker: false,
    requiresCredentials: false,
    hfDataset: "osunlp/Online-Mind2Web",
  },
  {
    id: "webbench",
    name: "WebBench (2025)",
    description: "2,454 open tasks across 452 live websites. Write-heavy workflows (forms, purchases, auth). Latest benchmark — Claude 3.7 is current SOTA. Downloaded from HuggingFace.",
    taskCount: 2454,
    avgTokensPerTask: 130_000,
    requiresDocker: false,
    requiresCredentials: false,
    hfDataset: "bytedance-research/Web-Bench",
  },
  {
    id: "webarena",
    name: "WebArena-Verified",
    description: "812 tasks across self-hosted Shopping, Reddit, GitLab and CMS sites. Deterministic JSON-based evaluation. Most widely cited browser-agent benchmark. 8 tasks bundled; full set requires Docker setup.",
    taskCount: 812,
    bundledTaskCount: 8,
    avgTokensPerTask: 120_000,
    requiresDocker: true,
    requiresCredentials: false,
    dockerRepo: "web-arena-x/webarena",
    defaultBaseUrl: "http://localhost",
  },
  {
    id: "webchore-arena",
    name: "WebChoreArena",
    description: "532 long-horizon tasks on WebArena environments requiring memory across pages and calculation across many items. Significantly harder than base WebArena. 6 tasks bundled; full set requires Docker setup.",
    taskCount: 532,
    bundledTaskCount: 6,
    avgTokensPerTask: 150_000,
    requiresDocker: true,
    requiresCredentials: false,
    dockerRepo: "WebChoreArena/WebChoreArena",
    defaultBaseUrl: "http://localhost",
  },
  {
    id: "visual-webarena",
    name: "VisualWebArena",
    description: "910 visually-grounded tasks requiring visual reasoning (e.g. click the red button, find the sale badge). Tests both HTML and visual understanding. 6 tasks bundled; full set requires Docker setup.",
    taskCount: 910,
    bundledTaskCount: 6,
    avgTokensPerTask: 160_000,
    requiresDocker: true,
    requiresCredentials: false,
    dockerRepo: "web-arena-x/visualwebarena",
    defaultBaseUrl: "http://localhost",
  },
  {
    id: "workarena",
    name: "WorkArena (ServiceNow)",
    description: "29 atomic tasks on ServiceNow SaaS: list navigation, form filling, knowledge base search, service catalog. Requires a ServiceNow instance.",
    taskCount: 29,
    avgTokensPerTask: 100_000,
    requiresDocker: false,
    requiresCredentials: true,
  },
];

/** Load tasks from an industry benchmark dataset */
export async function loadDataset(config: DatasetConfig): Promise<BenchmarkTask[]> {
  switch (config.source) {
    case "mind2web":
      return loadMind2Web(config);
    case "webbench":
      return loadWebBench(config);
    case "webarena":
      return loadWebArena(config);
    case "webchore-arena":
      return loadWebChoreArena(config);
    case "visual-webarena":
      return loadVisualWebArena(config);
    case "workarena":
      return loadWorkArena(config);
    default:
      throw new Error(`Unknown dataset source: ${(config as DatasetConfig).source}`);
  }
}

/** Get info for a specific dataset */
export function getDatasetInfo(source: DatasetSource): DatasetInfo | undefined {
  return DATASET_REGISTRY.find((d) => d.id === source);
}
