/**
 * Core types for the Site API generation system.
 * Defines the data model for auto-generated programmatic APIs from websites.
 */

import type { PageData, InteractiveElement, PageForm } from "@webmap/core";

// ─── Action Tiers ─────────────────────────────────────────────────

/** Three tiers of generated functions */
export type ActionTier = "navigation" | "interaction" | "direct-api";

/** Reliability rating from self-testing pipeline */
export type ActionReliability =
  | "verified-passed"   // Tested and confirmed working
  | "verified-failed"   // Tested and failed
  | "untested"          // Generated but not yet tested
  | "stale";            // Was passing but has since failed in production

/** How the action was discovered */
export type ActionSource =
  | "crawl"                // Directly from InteractiveElement in a11y tree
  | "llm-generated"       // LLM inferred composite action
  | "fallback-learned"    // Captured from successful CUA fallback
  | "network-intercepted"; // From intercepted XHR/fetch request

// ─── Action Building Blocks ───────────────────────────────────────

/** A single step in an action's execution sequence */
export interface ActionStep {
  /** Step type — maps to a Playwright operation */
  type: "click" | "fill" | "select" | "key" | "scroll" | "wait" | "goto" | "hover" | "fetch";
  /** Target selector (a11y-style: role + name), e.g. 'role=button, name="Search"' */
  selector?: string;
  /** Value template: "${paramName}" for dynamic or static string */
  value?: string;
  /** For fetch steps: HTTP request template */
  request?: NetworkRequestTemplate;
  /** Timeout in ms (default 5000) */
  timeout?: number;
  /** Human-readable description of this step */
  description?: string;
}

/** Template for a network request (direct-api tier) */
export interface NetworkRequestTemplate {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** URL with ${param} placeholders */
  urlPattern: string;
  headers?: Record<string, string>;
  /** JSON body template with ${param} placeholders */
  bodyTemplate?: string;
  contentType?: string;
}

/** A parameter for a site API function */
export interface ActionParam {
  name: string;
  type: "string" | "number" | "boolean" | "select";
  description: string;
  required: boolean;
  /** For select type: valid options (discovered from dropdowns) */
  options?: string[];
  /** Default value for self-testing */
  testDefault?: string;
  /** Validation pattern (regex) */
  pattern?: string;
}

/** Expected result after executing an action — used for self-test verification */
export interface ExpectedResult {
  /** Human-readable expected outcome */
  description: string;
  /** Expected URL change pattern (null = no navigation expected) */
  urlChange?: string;
  /** Elements that should appear/disappear in the a11y tree */
  a11yDiff?: {
    shouldAppear?: string[];
    shouldDisappear?: string[];
  };
  /** Expected network response (for direct-api tier) */
  expectedResponse?: {
    status: number;
    bodyContains?: string;
  };
}

// ─── Core SiteAction ──────────────────────────────────────────────

/** A generated site API function — the core unit of the system */
export interface SiteAction {
  /** Unique ID: domain + page-pattern + action-hash */
  id: string;
  /** Function name: "search_products", "click_add_to_cart" */
  name: string;
  /** Natural language description for retrieval matching */
  description: string;
  /** Which tier: navigation, interaction, or direct-api */
  tier: ActionTier;
  /** URL pattern this action applies to (glob or path prefix) */
  pagePattern: string;
  /** Specific page URL where this was discovered */
  sourceUrl: string;

  // Execution definition
  /** Ordered Playwright action sequence */
  steps: ActionStep[];
  /** Parameters the caller must provide */
  params: ActionParam[];
  /** What to expect after execution (for verification) */
  expectedResult: ExpectedResult;

  // Reliability metadata
  reliability: ActionReliability;
  successCount: number;
  failureCount: number;
  lastTestedAt?: string;
  lastSuccessAt?: string;
  lastError?: string;

  // Source tracking
  source: ActionSource;
  createdAt: string;
  updatedAt: string;
}

// ─── Page & Domain Bundles ────────────────────────────────────────

/** All actions for a single page */
export interface PageAPI {
  /** URL pattern for this page */
  urlPattern: string;
  /** Canonical URL (the URL used during discovery) */
  canonicalUrl: string;
  /** Page description */
  description: string;
  /** All actions available on this page */
  actions: SiteAction[];
  /** When this page's actions were generated */
  generatedAt: string;
}

/** A discovered network endpoint */
export interface NetworkEndpoint {
  method: string;
  /** URL pattern with :id placeholders */
  urlPattern: string;
  /** Parameters extracted from request bodies/query strings */
  params: ActionParam[];
  /** Typical response shape (truncated JSON) */
  responseShape?: string;
  /** Example request body */
  exampleBody?: string;
  /** Which page triggered this endpoint */
  sourcePageUrl: string;
  /** Content type */
  contentType?: string;
  /** Which SiteAction IDs trigger this endpoint */
  triggeredBy: string[];
}

/** An intercepted request/response pair from network interception */
export interface InterceptedRequest {
  method: string;
  url: string;
  contentType?: string;
  /** Request body (truncated to 2KB) */
  requestBody?: string;
  /** Response status */
  responseStatus: number;
  /** Response body shape (truncated to 2KB) */
  responseBody?: string;
  /** Which page URL triggered this */
  sourcePageUrl: string;
  /** Timestamp */
  timestamp: string;
}

/** Complete Site API for a domain — the top-level cached object */
export interface DomainAPI {
  domain: string;
  rootUrl: string;
  /** Schema version for cache invalidation / migration */
  schemaVersion: number;
  /** When the API was generated */
  generatedAt: string;
  /** When the API was last self-tested */
  lastTestedAt?: string;
  /** Global navigation actions (always available, ~20) */
  globalActions: SiteAction[];
  /** Per-page actions indexed by URL pattern */
  pages: Record<string, PageAPI>;
  /** Discovered REST/GraphQL endpoints */
  networkEndpoints: NetworkEndpoint[];
  /** Aggregate reliability stats */
  stats: DomainAPIStats;
}

export interface DomainAPIStats {
  totalActions: number;
  verifiedPassed: number;
  verifiedFailed: number;
  untested: number;
  stale: number;
  totalPages: number;
  totalNetworkEndpoints: number;
  /** 0-1 score: verifiedPassed / (verifiedPassed + verifiedFailed) */
  avgReliabilityScore: number;
  /** Generation cost in USD */
  generationCostUsd: number;
  /** Generation time in ms */
  generationDurationMs: number;
  /** Total tokens used for generation */
  generationTokensUsed: number;
}

// ─── Discovery / Crawl Types ──────────────────────────────────────

export interface APIDiscoveryCrawlOptions {
  url: string;
  /** Max pages to crawl (default 150, higher than standard 50) */
  maxPages?: number;
  /** Max crawl depth (default 4) */
  maxDepth?: number;
  /** Whether to actively interact with elements during discovery */
  activeExploration?: boolean;
  /** Whether to intercept network requests */
  interceptNetwork?: boolean;
  /** Authentication credentials if needed */
  auth?: {
    loginUrl: string;
    credentials: Record<string, string>;
    loginSteps?: ActionStep[];
  };
  /** Anthropic API key for LLM generation */
  apiKey?: string;
}

/** Extended crawl result with network + exploration data */
export interface EnhancedCrawlResult {
  /** Original crawl pages */
  pages: PageData[];
  /** URLs that were discovered but not crawled */
  skippedUrls: string[];
  /** Total crawl duration in ms */
  durationMs: number;
  /** Intercepted network requests */
  interceptedRequests: InterceptedRequest[];
  /** Discovered dropdown/combobox options per element */
  discoveredOptions: Map<string, string[]>;
  /** Expanded elements discovered during active exploration */
  expandedElements: Map<string, InteractiveElement[]>;
}

// ─── Testing Types ────────────────────────────────────────────────

export interface ActionTestResult {
  actionId: string;
  actionName: string;
  passed: boolean;
  /** Error message if failed */
  error?: string;
  /** A11y snapshot before execution */
  beforeSnapshot?: string;
  /** A11y snapshot after execution */
  afterSnapshot?: string;
  /** Whether expected result matched actual */
  resultMatched: boolean;
  /** LLM judge explanation (if slow path used) */
  judgeReason?: string;
  durationMs: number;
  timestamp: string;
}

export interface SelfTestReport {
  domain: string;
  totalTested: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  results: ActionTestResult[];
  timestamp: string;
}

// ─── Learning Types ───────────────────────────────────────────────

/** A captured fallback event during CUA execution */
export interface FallbackEvent {
  /** The SiteAction that was attempted */
  failedActionId: string;
  failedActionName: string;
  /** Error from the failed action */
  error: string;
  /** The successful fallback sequence (a11y browser_action calls) */
  fallbackSteps: Array<{
    action: string;
    role?: string;
    name?: string;
    text?: string;
  }>;
  /** Page URL where fallback happened */
  pageUrl: string;
  /** Task context */
  taskInstruction: string;
  timestamp: string;
}

// ─── Execution Types ──────────────────────────────────────────────

/** Result of executing a single SiteAction */
export interface ActionExecutionResult {
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** A11y tree snapshot after execution */
  resultSnapshot: string;
  /** Current URL after execution */
  currentUrl: string;
  /** Duration in ms */
  durationMs: number;
}

// ─── Cache Types ──────────────────────────────────────────────────

export interface DomainAPICacheEntry {
  domainApi: DomainAPI;
  /** Timestamp when this entry expires */
  expiresAt: number;
  /** Per-function failure counts for staleness detection */
  failureCounts: Record<string, number>;
}

/** Current schema version */
export const SCHEMA_VERSION = 1;

/** Default cache TTL: 7 days */
export const DEFAULT_CACHE_TTL_HOURS = 168;

/** Max tools to provide per CUA step */
export const MAX_TOOLS_PER_STEP = 80;

/** Failure count threshold before marking action as stale */
export const STALE_FAILURE_THRESHOLD = 3;
