/**
 * LLM-powered API generator.
 * Enriches deterministic action stubs with descriptions, expected results,
 * and discovers composite workflow actions.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PageData } from "@webmap/core";
import { callLLMWithValidation } from "@webmap/core";
import type { SiteAction, PageAPI, DomainAPI, DomainAPIStats, NetworkEndpoint, EnhancedCrawlResult } from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { PageEnrichmentResponseSchema, type PageEnrichmentResponse } from "./schemas.js";
import { buildActionsFromPage } from "./function-builder.js";
import { deduplicateEndpoints } from "../discovery/network-interceptor.js";
import { mergeExplorationResults } from "../discovery/active-crawler.js";

/** Max pages to process for LLM enrichment (to control cost) */
const MAX_ENRICHMENT_PAGES = 100;
/** Batch size for parallel LLM calls */
const ENRICHMENT_BATCH_SIZE = 5;
/** Model for enrichment */
const ENRICHMENT_MODEL = "claude-haiku-4-5-20251001";

const ENRICHMENT_SYSTEM_PROMPT = `You are analyzing a web page to generate programmatic API functions.
Given the page's accessibility tree, interactive elements, and forms, you will:
1. Enrich each element-based action with a clear description and expected result
2. Discover composite actions (multi-step workflows like "search and filter", "add to cart")

Rules:
- Descriptions should be concise and action-oriented (what the function DOES)
- Expected results should describe what changes after the action executes
- URL changes should use patterns like "/products?q=\${query}"
- a11yDiff.shouldAppear should list element names that should become visible
- Composite actions must have 2+ steps using existing element selectors
- Use \${paramName} for dynamic values in steps`;

/**
 * Generate a complete DomainAPI from an enhanced crawl result.
 */
export async function generateDomainAPI(
  crawlResult: EnhancedCrawlResult,
  apiKey: string,
  domain: string,
  rootUrl: string
): Promise<DomainAPI> {
  const client = new Anthropic({ apiKey });
  const startTime = Date.now();
  let totalTokens = 0;

  // Merge exploration results back into pages
  const mergedPages = mergeExplorationResults(crawlResult.pages, crawlResult);

  // Deduplicate network endpoints
  const networkEndpoints = deduplicateEndpoints(crawlResult.interceptedRequests);

  // Step 1: Build deterministic stubs for all pages
  const allPageActions = new Map<string, SiteAction[]>();
  for (const page of mergedPages) {
    const pageEndpoints = networkEndpoints.filter(e => e.sourcePageUrl === page.url);
    const actions = buildActionsFromPage(page, domain, pageEndpoints);
    allPageActions.set(page.url, actions);
  }

  // Step 2: LLM enrichment (batched, capped)
  const pagesToEnrich = mergedPages.slice(0, MAX_ENRICHMENT_PAGES);
  for (let i = 0; i < pagesToEnrich.length; i += ENRICHMENT_BATCH_SIZE) {
    const batch = pagesToEnrich.slice(i, i + ENRICHMENT_BATCH_SIZE);
    const promises = batch.map(async (page) => {
      const actions = allPageActions.get(page.url) || [];
      if (actions.length === 0) return;

      try {
        const { enriched, tokens } = await enrichPageActions(page, actions, client);
        totalTokens += tokens;

        // Merge enrichments back
        const enrichedMap = new Map(enriched.enrichedActions.map(e => [e.name, e]));
        const updatedActions = actions.map(action => {
          const enrichment = enrichedMap.get(action.name);
          if (!enrichment) return action;
          return {
            ...action,
            description: enrichment.description,
            expectedResult: {
              ...action.expectedResult,
              ...enrichment.expectedResult,
            },
            steps: enrichment.additionalSteps
              ? [...action.steps, ...enrichment.additionalSteps]
              : action.steps,
            updatedAt: new Date().toISOString(),
          };
        });

        // Add composite actions from LLM
        if (enriched.compositeActions) {
          for (const composite of enriched.compositeActions) {
            const now = new Date().toISOString();
            updatedActions.push({
              id: `${domain}:${composite.name}:llm`,
              name: composite.name,
              description: composite.description,
              tier: "interaction",
              pagePattern: extractPagePattern(page.url),
              sourceUrl: page.url,
              steps: composite.steps as SiteAction["steps"],
              params: composite.params as SiteAction["params"],
              expectedResult: composite.expectedResult as SiteAction["expectedResult"],
              reliability: "untested",
              successCount: 0,
              failureCount: 0,
              source: "llm-generated",
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        allPageActions.set(page.url, updatedActions);
      } catch (err) {
        console.warn(`  [api-gen] Enrichment failed for ${page.url}: ${(err as Error).message}`);
      }
    });

    await Promise.all(promises);
  }

  // Step 3: Identify global navigation actions (appear on >80% of pages)
  const { globalActions, pageAPIs } = classifyActions(
    allPageActions,
    mergedPages,
    mergedPages.length
  );

  // Step 4: Compute stats
  const allActions = [...globalActions];
  for (const pageApi of Object.values(pageAPIs)) {
    allActions.push(...pageApi.actions);
  }

  const stats: DomainAPIStats = {
    totalActions: allActions.length,
    verifiedPassed: allActions.filter(a => a.reliability === "verified-passed").length,
    verifiedFailed: allActions.filter(a => a.reliability === "verified-failed").length,
    untested: allActions.filter(a => a.reliability === "untested").length,
    stale: allActions.filter(a => a.reliability === "stale").length,
    totalPages: Object.keys(pageAPIs).length,
    totalNetworkEndpoints: networkEndpoints.length,
    avgReliabilityScore: 0, // Updated after self-testing
    generationCostUsd: estimateGenerationCost(totalTokens),
    generationDurationMs: Date.now() - startTime,
    generationTokensUsed: totalTokens,
  };

  return {
    domain,
    rootUrl,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    globalActions,
    pages: pageAPIs,
    networkEndpoints,
    stats,
  };
}

/**
 * Enrich a page's actions via LLM.
 */
async function enrichPageActions(
  page: PageData,
  actions: SiteAction[],
  client: Anthropic
): Promise<{ enriched: PageEnrichmentResponse; tokens: number }> {
  // Build context for the LLM
  const actionSummary = actions.map(a =>
    `- ${a.name} (${a.tier}): ${a.steps.map(s => `${s.type}${s.selector ? ` ${s.selector}` : ""}`).join(" → ")}`
  ).join("\n");

  const elementSummary = page.elements.slice(0, 50).map(e =>
    `- ${e.role} "${e.name}" [${e.state || "enabled"}]`
  ).join("\n");

  const formSummary = page.forms.map(f =>
    `Form "${f.name}": ${f.fields.map(ff => `${ff.label}(${ff.inputType}${ff.required ? "*" : ""})`).join(", ")}`
  ).join("\n");

  const a11yTree = page.accessibilitySnapshot
    ? page.accessibilitySnapshot.slice(0, 4000)
    : "Not available";

  const userPrompt = `Page: ${page.url}
Title: ${page.title}
Purpose: ${page.purpose || "Unknown"}

Accessibility Tree (truncated):
${a11yTree}

Interactive Elements:
${elementSummary}

Forms:
${formSummary || "None"}

Current Action Stubs:
${actionSummary}

Enrich these actions with better descriptions and expected results.
Also identify any composite/workflow actions (multi-step sequences) that would be useful.
Return JSON matching the schema.`;

  const result = await callLLMWithValidation({
    client,
    model: ENRICHMENT_MODEL,
    system: ENRICHMENT_SYSTEM_PROMPT,
    prompt: userPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: PageEnrichmentResponseSchema as any,
    maxTokens: 2000,
    cacheSystem: true,
  });

  return {
    enriched: (result.data as PageEnrichmentResponse | null) ?? { enrichedActions: [], compositeActions: [] },
    tokens: result.tokensUsed,
  };
}

/**
 * Classify actions into global navigation and page-scoped.
 * Global = link/button actions that appear on >80% of pages.
 */
function classifyActions(
  allPageActions: Map<string, SiteAction[]>,
  pages: PageData[],
  totalPages: number
): {
  globalActions: SiteAction[];
  pageAPIs: Record<string, PageAPI>;
} {
  // Count how many pages each navigation action name appears on
  const navActionCounts = new Map<string, number>();
  const navActionExamples = new Map<string, SiteAction>();

  for (const [, actions] of allPageActions) {
    const seenOnThisPage = new Set<string>();
    for (const action of actions) {
      if (action.tier === "navigation" && !seenOnThisPage.has(action.name)) {
        seenOnThisPage.add(action.name);
        navActionCounts.set(action.name, (navActionCounts.get(action.name) || 0) + 1);
        if (!navActionExamples.has(action.name)) {
          navActionExamples.set(action.name, action);
        }
      }
    }
  }

  // Global: appears on >80% of pages
  const globalThreshold = Math.ceil(totalPages * 0.8);
  const globalNames = new Set<string>();
  const globalActions: SiteAction[] = [];
  for (const [name, count] of navActionCounts) {
    if (count >= globalThreshold) {
      globalNames.add(name);
      const example = navActionExamples.get(name)!;
      globalActions.push({ ...example, pagePattern: "/*" });
    }
  }

  // Build page APIs (exclude global actions)
  const pageAPIs: Record<string, PageAPI> = {};
  const pageMap = new Map(pages.map(p => [p.url, p]));

  for (const [url, actions] of allPageActions) {
    const pageScoped = actions.filter(a => !globalNames.has(a.name));
    if (pageScoped.length === 0) continue;

    const pageData = pageMap.get(url);
    const pattern = extractPagePattern(url);

    pageAPIs[pattern] = {
      urlPattern: pattern,
      canonicalUrl: url,
      description: pageData?.purpose || pageData?.title || url,
      actions: pageScoped,
      generatedAt: new Date().toISOString(),
    };
  }

  return { globalActions, pageAPIs };
}

function extractPagePattern(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").map(seg => {
      if (/^\d+$/.test(seg)) return "*";
      if (/^[0-9a-f]{8,}$/i.test(seg)) return "*";
      return seg;
    });
    return segments.join("/") || "/";
  } catch {
    return "/";
  }
}

function estimateGenerationCost(tokens: number): number {
  // Haiku pricing: $1/MTok input, $5/MTok output
  // Assume 90% input, 10% output (typical for enrichment)
  const inputTokens = tokens * 0.9;
  const outputTokens = tokens * 0.1;
  return (inputTokens * 1.0 + outputTokens * 5.0) / 1_000_000;
}
