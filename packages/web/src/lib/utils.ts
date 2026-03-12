import type { DocMethod } from "./types";
import { METHOD_AVG_TOKENS, METHOD_IS_HAIKU } from "./constants";

// Model pricing (per token)
const HAIKU_INPUT = 1.0 / 1_000_000;
const HAIKU_OUTPUT = 5.0 / 1_000_000;
const SONNET_INPUT = 3.0 / 1_000_000;
const SONNET_OUTPUT = 15.0 / 1_000_000;

// CUA token split: ~95% input, 5% output (vision tasks are input-heavy)
const INPUT_RATIO = 0.95;
const OUTPUT_RATIO = 0.05;

// Prompt caching saves ~50% on total cost (system prompt ~40% of input, cached at 10%)
const CACHE_FACTOR = 0.5;

/** Estimated cost per task for a given method (uncached, USD) */
export function estimateCostPerTask(method: DocMethod): number {
  const tokens = METHOD_AVG_TOKENS[method] ?? 120_000;
  const isHaiku = METHOD_IS_HAIKU[method];

  if (method === "cascade") {
    // Blended: ~60% Haiku + 40% Sonnet
    const haiku = tokens * INPUT_RATIO * HAIKU_INPUT + tokens * OUTPUT_RATIO * HAIKU_OUTPUT;
    const sonnet = tokens * INPUT_RATIO * SONNET_INPUT + tokens * OUTPUT_RATIO * SONNET_OUTPUT;
    return haiku * 0.6 + sonnet * 0.4;
  }

  if (isHaiku) {
    return tokens * INPUT_RATIO * HAIKU_INPUT + tokens * OUTPUT_RATIO * HAIKU_OUTPUT;
  }

  return tokens * INPUT_RATIO * SONNET_INPUT + tokens * OUTPUT_RATIO * SONNET_OUTPUT;
}

export interface CostEstimate {
  /** Total cost per method for all tasks combined (uncached) */
  perMethod: Record<DocMethod, number>;
  /** Total uncached cost across all methods */
  uncachedTotal: number;
  /** Total with prompt caching (~50% savings) */
  cachedTotal: number;
  /** Number of tasks */
  taskCount: number;
}

/**
 * Compute estimated cost for a benchmark run.
 * @param methods - Methods being tested
 * @param taskCount - Number of tasks
 * @param avgTokensOverride - Override per-task token count (e.g. from dataset metadata)
 */
export function computeEstimatedCost(
  methods: DocMethod[],
  taskCount: number,
  avgTokensOverride?: number
): CostEstimate {
  const perMethod = {} as Record<DocMethod, number>;
  let uncachedTotal = 0;

  for (const method of methods) {
    // costPerSingleTask = cost to run one task with this method
    let costPerSingleTask: number;

    if (avgTokensOverride) {
      // Use dataset-specific token count with method's model pricing
      const isHaiku = METHOD_IS_HAIKU[method];
      if (method === "cascade") {
        const haiku = avgTokensOverride * INPUT_RATIO * HAIKU_INPUT + avgTokensOverride * OUTPUT_RATIO * HAIKU_OUTPUT;
        const sonnet = avgTokensOverride * INPUT_RATIO * SONNET_INPUT + avgTokensOverride * OUTPUT_RATIO * SONNET_OUTPUT;
        costPerSingleTask = haiku * 0.6 + sonnet * 0.4;
      } else if (isHaiku) {
        costPerSingleTask = avgTokensOverride * INPUT_RATIO * HAIKU_INPUT + avgTokensOverride * OUTPUT_RATIO * HAIKU_OUTPUT;
      } else {
        costPerSingleTask = avgTokensOverride * INPUT_RATIO * SONNET_INPUT + avgTokensOverride * OUTPUT_RATIO * SONNET_OUTPUT;
      }
    } else {
      costPerSingleTask = estimateCostPerTask(method);
    }

    // perMethod stores total cost for all tasks via this method
    const methodTotal = costPerSingleTask * taskCount;
    perMethod[method] = methodTotal;
    uncachedTotal += methodTotal;
  }

  return {
    perMethod,
    uncachedTotal,
    cachedTotal: uncachedTotal * CACHE_FACTOR,
    taskCount,
  };
}

export function formatUsd(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
