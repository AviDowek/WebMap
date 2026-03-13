/**
 * Enhanced API discovery crawl.
 * Wraps the existing crawlSite() from @webmap/core with:
 * - Higher page limits (150 vs 50)
 * - Active element exploration (dropdowns, menus, tabs)
 * - Network request interception
 */

import { chromium, type Browser, type Page } from "playwright";
import type { InteractiveElement, PageData } from "@webmap/core";
import type { APIDiscoveryCrawlOptions, EnhancedCrawlResult, InterceptedRequest } from "../types.js";
import { attachNetworkInterceptor, deduplicateEndpoints } from "./network-interceptor.js";
import { explorePage } from "./element-explorer.js";

/** Default limits for API discovery crawl */
const DEFAULT_MAX_PAGES = 150;
const DEFAULT_MAX_DEPTH = 4;
const CONCURRENT_EXPLORATION = 6;

/**
 * Run an enhanced API discovery crawl.
 * 1. Use existing crawlSite() for baseline page discovery
 * 2. Revisit each page with network interception + active exploration
 */
export async function runDiscoveryCrawl(
  options: APIDiscoveryCrawlOptions,
  /** Pre-crawled pages from crawlSite() — avoids re-crawling */
  preCrawledPages?: PageData[]
): Promise<EnhancedCrawlResult> {
  const startTime = Date.now();
  const allInterceptedRequests: InterceptedRequest[] = [];
  const allDiscoveredOptions = new Map<string, string[]>();
  const allExpandedElements = new Map<string, InteractiveElement[]>();

  // If we have pre-crawled pages, use them; otherwise call crawlSite
  let pages: PageData[];
  if (preCrawledPages && preCrawledPages.length > 0) {
    pages = preCrawledPages;
  } else {
    // Dynamic import to avoid circular dependency issues
    const { crawlSite } = await import("@webmap/core");
    const result = await crawlSite({
      url: options.url,
      maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    });
    pages = result.pages;
  }

  // Phase 2: Active exploration with network interception
  if (options.activeExploration !== false || options.interceptNetwork !== false) {
    const browser = await chromium.launch({ headless: true });
    try {
      // Process pages in batches
      for (let i = 0; i < pages.length; i += CONCURRENT_EXPLORATION) {
        const batch = pages.slice(i, i + CONCURRENT_EXPLORATION);
        const promises = batch.map(page =>
          explorePageWithInterception(
            browser,
            page,
            {
              interceptNetwork: options.interceptNetwork !== false,
              activeExploration: options.activeExploration !== false,
            }
          )
        );

        const results = await Promise.allSettled(promises);
        for (const result of results) {
          if (result.status === "fulfilled") {
            const { interceptedRequests, discoveredOptions, expandedElements, pageUrl } = result.value;
            allInterceptedRequests.push(...interceptedRequests);
            for (const [key, opts] of discoveredOptions) {
              allDiscoveredOptions.set(`${pageUrl}:${key}`, opts);
            }
            if (expandedElements.length > 0) {
              allExpandedElements.set(pageUrl, expandedElements);
            }
          }
        }
      }
    } finally {
      await browser.close();
    }
  }

  return {
    pages,
    skippedUrls: [],
    durationMs: Date.now() - startTime,
    interceptedRequests: allInterceptedRequests,
    discoveredOptions: allDiscoveredOptions,
    expandedElements: allExpandedElements,
  };
}

/**
 * Visit a single page, intercept network requests, and explore elements.
 */
async function explorePageWithInterception(
  browser: Browser,
  pageData: PageData,
  options: { interceptNetwork: boolean; activeExploration: boolean }
): Promise<{
  interceptedRequests: InterceptedRequest[];
  discoveredOptions: Map<string, string[]>;
  expandedElements: InteractiveElement[];
  pageUrl: string;
}> {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  let interceptor: ReturnType<typeof attachNetworkInterceptor> | undefined;
  let discoveredOptions = new Map<string, string[]>();
  let expandedElements: InteractiveElement[] = [];

  try {
    // Attach network interception before navigation
    if (options.interceptNetwork) {
      interceptor = attachNetworkInterceptor(page, pageData.url);
    }

    // Navigate to page
    await page.goto(pageData.url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(500); // Let XHR requests fire

    // Active exploration
    if (options.activeExploration && pageData.elements.length > 0) {
      const result = await explorePage(page, pageData.elements);
      discoveredOptions = result.discoveredOptions;
      expandedElements = result.expandedElements;
    }

    const interceptedRequests = interceptor?.getRequests() ?? [];

    return {
      interceptedRequests,
      discoveredOptions,
      expandedElements,
      pageUrl: pageData.url,
    };
  } finally {
    interceptor?.detach();
    await context.close();
  }
}

/**
 * Merge exploration results back into the original PageData array.
 * Adds discovered options as new InteractiveElements and expanded elements.
 */
export function mergeExplorationResults(
  pages: PageData[],
  result: EnhancedCrawlResult
): PageData[] {
  return pages.map(page => {
    const expandedKey = page.url;
    const expanded = result.expandedElements.get(expandedKey);

    // Merge expanded elements (dedup by selector)
    const existingSelectors = new Set(page.elements.map(e => e.selector));
    const newElements = expanded?.filter(e => !existingSelectors.has(e.selector)) ?? [];

    // Update combobox elements with discovered options
    const updatedElements = page.elements.map(el => {
      const optionsKey = `${page.url}:${el.selector}`;
      const options = result.discoveredOptions.get(optionsKey);
      if (options && options.length > 0) {
        return { ...el, result: `Options: ${options.join(", ")}` };
      }
      return el;
    });

    return {
      ...page,
      elements: [...updatedElements, ...newElements],
    };
  });
}
