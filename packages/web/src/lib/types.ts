// ─── Types ───────────────────────────────────────────────────────────

export type Tab = "generate" | "batch" | "benchmark" | "apis" | "guide";

export interface CrawlStatus {
  state: "idle" | "crawling" | "done" | "error";
  phase?: "queued" | "crawling" | "analyzing" | "formatting";
  pagesFound?: number;
  markdown?: string;
  metadata?: {
    totalPages: number;
    totalElements: number;
    totalWorkflows: number;
    crawlDurationMs: number;
    tokensUsed: number;
  };
  error?: string;
}

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

export interface BatchStatus {
  state: "idle" | "running" | "done" | "error";
  batchId?: string;
  sites?: BatchSiteResult[];
  error?: string;
}

export interface BenchmarkMetrics {
  totalTasks: number;
  successRate: number;
  avgTokensPerTask: number;
  avgDurationMs: number;
  avgSteps: number;
  avgCostUsd?: number;
  totalCostUsd?: number;
  apiSuccessRate?: number;
  visionFallbackRate?: number;
}

export interface BenchmarkStatus {
  state: "idle" | "running" | "done" | "error";
  benchId?: string;
  phase?: string;
  tasksTotal?: number;
  tasksCompleted?: number;
  multiMethod?: boolean;
  currentSite?: string;
  currentMethod?: string;
  result?: {
    summary: {
      baseline: BenchmarkMetrics;
      withDocs: BenchmarkMetrics;
      improvement: {
        successRateDelta: number;
        tokenReduction: number;
        speedup: number;
      };
    };
    baseline: Array<{
      taskId: string;
      success: boolean;
      steps: number;
      tokensUsed: number;
      durationMs: number;
      error?: string;
    }>;
    withDocs: Array<{
      taskId: string;
      success: boolean;
      steps: number;
      tokensUsed: number;
      durationMs: number;
      error?: string;
    }>;
  };
  multiResult?: MultiMethodResult;
  error?: string;
}

export type DocMethod =
  | "none"
  | "micro-guide"
  | "full-guide"
  | "first-message"
  | "pre-plan"
  | "a11y-tree"
  | "hybrid"
  | "a11y-first-message"
  | "haiku-vision"
  | "cascade"
  | "programmatic";

export interface MethodResultData {
  method: DocMethod;
  tasks: Array<{
    taskId: string;
    success: boolean;
    steps: number;
    tokensUsed: number;
    durationMs: number;
    error?: string;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    cascadeEscalations?: number;
    apiCallCount?: number;
    visionFallbackCount?: number;
  }>;
  metrics: BenchmarkMetrics;
}

export interface SiteResultData {
  domain: string;
  url: string;
  methods: MethodResultData[];
}

export interface MultiMethodResult {
  timestamp: string;
  sites: SiteResultData[];
  overall: MethodResultData[];
  methods: DocMethod[];
  totalTasks: number;
  config?: {
    runsPerTask?: number;
    verifyResults?: boolean;
  };
}

export interface MultiMethodHistoryEntry {
  id: string;
  timestamp: string;
  sites: number;
  methods: DocMethod[];
  totalTasks: number;
}

export interface CachedDoc {
  domain: string;
  totalPages: number;
  totalElements: number;
  totalWorkflows: number;
  tokensUsed: number;
  crawledAt: string;
}

export interface BenchmarkSite {
  url: string;
  domain: string;
  tasks: Array<{
    id: string;
    url: string;
    instruction: string;
    successCriteria: string;
    category: string;
    source?: string;
  }>;
  hasDocumentation: boolean;
}

export interface BenchmarkHistoryEntry {
  id: string;
  timestamp: string;
  tasksTotal: number;
  successRateBaseline: number;
  successRateWithDocs: number;
  improvement: {
    successRateDelta: number;
    tokenReduction: number;
    speedup: number;
  };
}
