/**
 * Shared types and constants for the WebMap benchmark runner.
 */

import type { SiteDocumentation } from "@webmap/core";

// ─── Types ───────────────────────────────────────────────────────────

export interface BenchmarkTask {
  /** Unique task ID */
  id: string;
  /** Target website URL */
  url: string;
  /** Task description in natural language */
  instruction: string;
  /** Expected outcome / success criteria */
  successCriteria: string;
  /** Category (navigation, form-fill, search, purchase, etc.) */
  category: string;
  /** Source of the task */
  source?: "sample" | "manual" | "ai-generated"
    | "mind2web" | "webbench" | "webarena"
    | "webchore-arena" | "visual-webarena" | "workarena";
}

export interface TaskResult {
  taskId: string;
  /** Whether the task was completed successfully (verified if verification enabled) */
  success: boolean;
  /** Number of CUA steps/actions taken (excludes verification) */
  steps: number;
  /** Tokens consumed by the CUA agent (excludes verification overhead) */
  tokensUsed: number;
  /** CUA execution time in ms (excludes verification overhead) */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Action log */
  actions: string[];
  /** Whether success was independently verified by a second LLM call */
  verified?: boolean;
  /** What the agent self-reported (before verification override) */
  selfReportedSuccess?: boolean;
  /** Explanation from the verification judge */
  verificationReason?: string;
  /** Tokens consumed by the verification call (separate from CUA tokensUsed) */
  verificationTokensUsed?: number;
  /** Time spent on verification in ms (separate from CUA durationMs) */
  verificationDurationMs?: number;
  /** Which run this is (1-indexed), when runsPerTask > 1 */
  runIndex?: number;
  /** Estimated USD cost of the CUA run (excludes verification). Computed from actual input/output tokens × model pricing. */
  estimatedCostUsd?: number;
  /** Prompt cache read tokens (10% of normal input price) */
  cacheReadTokens?: number;
  /** Prompt cache creation tokens (125% of normal input price) */
  cacheCreationTokens?: number;
  /** Estimated USD cost of the verification call (separate from estimatedCostUsd) */
  verificationCostUsd?: number;
  /** Number of times the cascade method escalated from Haiku to Sonnet */
  cascadeEscalations?: number;
  /** Number of successful site API function calls (programmatic method) */
  apiCallCount?: number;
  /** Number of fallback browser_action calls when API failed (programmatic method) */
  visionFallbackCount?: number;
  /** Names of site API functions called (programmatic method) */
  siteApiFunctionsCalled?: string[];
  /** Number of site API fallbacks (programmatic method) */
  siteApiFallbacks?: number;
}

/** Aggregated result across multiple runs of the same task+method */
export interface MultiRunTaskResult {
  taskId: string;
  /** Individual results from each run */
  runs: TaskResult[];
  /** Number of runs */
  totalRuns: number;
  /** How many runs succeeded */
  successes: number;
  /** Success rate across runs (0-1) */
  successRate: number;
  /** Average tokens across runs */
  avgTokensUsed: number;
  /** Average duration across runs */
  avgDurationMs: number;
  /** Average steps across runs */
  avgSteps: number;
  /** Collapsed into a single TaskResult for backward compatibility */
  aggregated: TaskResult;
}

export interface BenchmarkResult {
  /** When the benchmark was run */
  timestamp: string;
  /** Results without documentation */
  baseline: TaskResult[];
  /** Results with documentation */
  withDocs: TaskResult[];
  /** Aggregate comparison */
  summary: {
    baseline: AggregateMetrics;
    withDocs: AggregateMetrics;
    improvement: {
      successRateDelta: number; // percentage points
      tokenReduction: number; // percentage
      speedup: number; // ratio
    };
  };
}

export interface AggregateMetrics {
  totalTasks: number;
  successRate: number;
  avgTokensPerTask: number;
  avgDurationMs: number;
  avgSteps: number;
  /** Average USD cost per task (CUA only, excludes verification) */
  avgCostUsd: number;
  /** Total USD cost across all tasks in this aggregate (CUA only, excludes verification) */
  totalCostUsd: number;
  /** 95% Wilson confidence interval for success rate (only with multiple runs) */
  confidenceInterval95?: { lower: number; upper: number };
  /** Fraction of tasks where verification disagreed with agent self-report */
  verificationOverrideRate?: number;
  /** Verification overhead tracked separately from CUA metrics */
  verificationOverhead?: {
    avgTokensPerTask: number;
    avgDurationMs: number;
    avgCostUsd: number;
    totalCostUsd: number;
  };
  /** Fraction of tool calls that used site API vs fallback (programmatic method only) */
  apiSuccessRate?: number;
  /** Fraction of tool calls that fell back to vision/browser_action (programmatic method only) */
  visionFallbackRate?: number;
}

// ─── Multi-Method Types ─────────────────────────────────────────────

/** Doc injection methods to compare in benchmarks */
export type DocMethod =
  | "none"               // Baseline — no documentation
  | "micro-guide"        // ~100 token guide in system prompt
  | "full-guide"         // ~400 token guide with layout/nav/sitemap in system prompt
  | "first-message"      // Docs injected in first user message (doesn't compound)
  | "pre-plan"           // Use docs to generate task-specific plan before CUA starts
  | "a11y-tree"          // Text-based: accessibility tree instead of screenshots (Haiku)
  | "hybrid"             // Both: accessibility tree + screenshots
  | "a11y-first-message" // A11y Tree (Haiku) + first-message doc injection
  | "haiku-vision"       // computer_use with Haiku model (3x cheaper than Sonnet)
  | "cascade"            // Haiku vision → escalate to Sonnet when stuck
  | "programmatic";      // Pre-built site APIs (Haiku, text-only)

export const ALL_DOC_METHODS: DocMethod[] = [
  "none",
  "micro-guide",
  "full-guide",
  "first-message",
  "pre-plan",
  "a11y-tree",
  "hybrid",
  "a11y-first-message",
  "haiku-vision",
  "cascade",
  "programmatic",
];

export const DOC_METHOD_LABELS: Record<DocMethod, string> = {
  "none": "Baseline (no docs)",
  "micro-guide": "Micro Guide (~100 tokens, system prompt)",
  "full-guide": "Full Guide (~400 tokens, system prompt)",
  "first-message": "First Message Injection (no compounding)",
  "pre-plan": "Pre-Plan (task-specific plan from docs, Haiku)",
  "a11y-tree": "A11y Tree (text-only, no screenshots, Haiku)",
  "hybrid": "Hybrid (a11y tree + screenshots)",
  "a11y-first-message": "A11y Tree + First Message Docs (Haiku)",
  "haiku-vision": "Haiku Vision (computer_use, 3x cheaper)",
  "cascade": "Cascade (Haiku→Sonnet on stuck)",
  "programmatic": "Programmatic (site APIs, Haiku)",
};

export interface MethodResult {
  method: DocMethod;
  tasks: TaskResult[];
  metrics: AggregateMetrics;
}

export interface SiteResult {
  domain: string;
  url: string;
  methods: MethodResult[];
}

export interface MultiMethodBenchmarkResult {
  timestamp: string;
  sites: SiteResult[];
  /** Overall metrics per method across all sites */
  overall: MethodResult[];
  /** Which methods were tested */
  methods: DocMethod[];
  /** Total tasks across all sites */
  totalTasks: number;
  /** Configuration used for this run */
  config?: {
    runsPerTask?: number;
    verifyResults?: boolean;
  };
}

export interface MultiMethodBenchmarkOptions {
  apiKey?: string;
  methods?: DocMethod[];
  /** Run methods sequentially per task instead of in parallel (avoids API rate limits) */
  sequential?: boolean;
  /** Number of times to run each task per method (default: 1). Higher = more reliable but costlier. */
  runsPerTask?: number;
  /** Enable automated success verification via independent LLM judgment (default: false). */
  verifyResults?: boolean;
  /**
   * Maximum number of sites to run concurrently (default: 2).
   * Higher values reduce wall time but increase concurrent API calls.
   * Warning: concurrency × methods.length > 20 may trigger API rate limits.
   */
  siteConcurrency?: number;
  onProgress?: (update: {
    phase: string;
    site?: string;
    method?: DocMethod;
    tasksCompleted: number;
    tasksTotal: number;
    currentRun?: number;
    totalRuns?: number;
  }) => void;
}
