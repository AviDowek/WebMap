/**
 * @webmap/api-gen — Auto-generate programmatic APIs from websites.
 *
 * Pipeline: Crawl → Discover → Generate → Test → Serve → Learn
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  ActionTier,
  ActionReliability,
  ActionSource,
  ActionStep,
  NetworkRequestTemplate,
  ActionParam,
  ExpectedResult,
  SiteAction,
  PageAPI,
  NetworkEndpoint,
  InterceptedRequest,
  DomainAPI,
  DomainAPIStats,
  APIDiscoveryCrawlOptions,
  EnhancedCrawlResult,
  ActionTestResult,
  SelfTestReport,
  FallbackEvent,
  ActionExecutionResult,
  DomainAPICacheEntry,
} from "./types.js";

export {
  SCHEMA_VERSION,
  DEFAULT_CACHE_TTL_HOURS,
  MAX_TOOLS_PER_STEP,
  STALE_FAILURE_THRESHOLD,
} from "./types.js";

// ─── Discovery ────────────────────────────────────────────────────
export { runDiscoveryCrawl, mergeExplorationResults } from "./discovery/active-crawler.js";
export { attachNetworkInterceptor, deduplicateEndpoints } from "./discovery/network-interceptor.js";
export { explorePage } from "./discovery/element-explorer.js";

// ─── Generation ───────────────────────────────────────────────────
export { generateDomainAPI } from "./generation/api-generator.js";
export { buildActionsFromPage } from "./generation/function-builder.js";
export { PageEnrichmentResponseSchema } from "./generation/schemas.js";

// ─── Testing ──────────────────────────────────────────────────────
export { runSelfTest, applyTestResults } from "./testing/self-tester.js";
export { generateTestParams } from "./testing/test-param-gen.js";
export { judgeActionResult } from "./testing/diff-judge.js";

// ─── Retrieval ────────────────────────────────────────────────────
export { executeSiteAction } from "./retrieval/site-api-executor.js";
export { findPageForUrl, searchActions } from "./retrieval/page-scope.js";
export { buildToolsForStep, type ToolDefinition } from "./retrieval/context-builder.js";
export { DISCOVER_ACTIONS_TOOL, FALLBACK_BROWSER_TOOL, handleDiscoverActions } from "./retrieval/meta-tool.js";

// ─── Learning ─────────────────────────────────────────────────────
export { FailureTracker } from "./learning/failure-tracker.js";
export { FallbackCapture } from "./learning/fallback-capture.js";
export { updateDomainAPIFromExecution } from "./learning/api-updater.js";

// ─── Storage ──────────────────────────────────────────────────────
export {
  loadDomainAPIFromCache,
  loadDomainAPIStale,
  saveDomainAPIToCache,
  updateFailureCounts,
  getFailureCounts,
  deleteDomainAPICache,
  listCachedDomains,
  isCacheFresh,
} from "./storage/api-cache.js";
export { migrateIfNeeded, isCurrentVersion } from "./storage/versioning.js";
