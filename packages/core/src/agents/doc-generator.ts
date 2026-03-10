/**
 * LLM-powered documentation generator.
 * Takes raw crawl data and uses Claude to generate comprehensive,
 * agent-friendly documentation.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  PageData,
  SiteDocumentation,
  SiteMap,
  SiteMapNode,
  Workflow,
  CrawlOptions,
} from "../types.js";
import type { CrawlResult } from "../crawler/site-crawler.js";
import {
  callLLMWithValidation,
  CuaPageEnrichmentSchema,
  PageEnrichmentSchema,
  WorkflowsSchema,
  type LLMCallResult,
} from "./llm-validation.js";

const SYSTEM_PROMPT = `You are a documentation generator for AI agents. Your job is to analyze web page data (accessibility tree snapshots, interactive elements, forms) and produce comprehensive documentation that enables AI agents to navigate and operate the website without vision.

Your documentation must be:
1. ACTIONABLE — every element includes its exact accessibility selector
2. COMPLETE — every interactive element, form, and dynamic behavior is documented
3. FLOW-ORIENTED — document how to reach each page and what actions lead where
4. CONCISE — use tables and structured formats, not prose

Always use accessibility selectors (role=button, name="Submit") not CSS selectors.`;

const CUA_SYSTEM_PROMPT = `You are a documentation generator for VISION-BASED browser automation agents. These agents see screenshots and click on coordinates — they do NOT use accessibility selectors.

Your documentation should be a concise navigation guide:
1. Describe the visual layout (where are navigation elements, sidebars, content areas?)
2. Provide navigation strategy (how would a human visually find features?)
3. Keep descriptions short — under 100 words per page.
Do NOT catalog individual elements or provide selectors.`;

interface GeneratorOptions {
  /** Anthropic API key */
  apiKey: string;
  /** Model for page analysis (default: claude-sonnet-4-20250514) */
  pageModel?: string;
  /** Model for synthesis/workflows (default: claude-sonnet-4-20250514) */
  synthesisModel?: string;
  /** Generate concise CUA-friendly docs instead of full element catalogs */
  cuaMode?: boolean;
  /** Optional pre-constructed Anthropic client (for testing) */
  client?: Anthropic;
}

/** Safely extract text from an Anthropic API response */
export function extractText(response: Anthropic.Message): string {
  if (!response.content || response.content.length === 0) return "";
  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

/** Safely parse JSON from LLM output, returning null on failure */
export function safeParseJson(text: string): Record<string, unknown> | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Sanitize a string from LLM output — strip HTML tags and control chars */
export function sanitize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "") // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // strip control chars
    .trim();
}

export class DocGenerator {
  private client: Anthropic;
  private pageModel: string;
  private synthesisModel: string;
  private cuaMode: boolean;
  private tokensUsed = 0;
  private llmRetries = 0;
  private llmFailures = 0;
  private confidenceScores: number[] = [];

  constructor(options: GeneratorOptions) {
    this.client = options.client || new Anthropic({ apiKey: options.apiKey });
    this.pageModel = options.pageModel || "claude-sonnet-4-20250514";
    this.synthesisModel = options.synthesisModel || "claude-sonnet-4-20250514";
    this.cuaMode = options.cuaMode || false;
  }

  /**
   * Generate complete site documentation from crawl results.
   */
  async generate(
    crawlResult: CrawlResult,
    crawlOptions: CrawlOptions
  ): Promise<SiteDocumentation> {
    const { pages } = crawlResult;
    const rootUrl = crawlOptions.url;
    const domain = new URL(rootUrl).hostname;

    // Step 1: Enrich each page with LLM-generated descriptions
    const enrichedPages = await this.enrichPages(pages, rootUrl);

    // Step 2: Build site map
    const siteMap = this.buildSiteMap(enrichedPages, rootUrl);

    // Step 3: Detect workflows using LLM (skip in CUA mode — too verbose)
    const workflows = this.cuaMode
      ? []
      : await this.detectWorkflows(enrichedPages, domain);

    // Step 4: Generate site description
    const description = await this.generateSiteDescription(
      enrichedPages,
      domain
    );

    const enrichedCount = this.confidenceScores.filter((c) => c > 0).length;

    return {
      domain,
      rootUrl,
      description,
      crawledAt: new Date().toISOString(),
      siteMap,
      pages: enrichedPages,
      workflows,
      metadata: {
        totalPages: enrichedPages.length,
        totalElements: enrichedPages.reduce(
          (sum, p) => sum + p.elements.length,
          0
        ),
        totalWorkflows: workflows.length,
        crawlDurationMs: crawlResult.durationMs,
        tokensUsed: this.tokensUsed,
        llmRetries: this.llmRetries,
        llmFailures: this.llmFailures,
        avgConfidence:
          this.confidenceScores.length > 0
            ? this.confidenceScores.reduce((a, b) => a + b, 0) /
              this.confidenceScores.length
            : 0,
        enrichmentRate:
          enrichedPages.length > 0
            ? enrichedCount / enrichedPages.length
            : 0,
      },
    };
  }

  /**
   * Enrich pages with LLM-generated purpose, howToReach, and dynamic behavior.
   * Processes pages in parallel batches.
   */
  private async enrichPages(pages: PageData[], rootUrl: string): Promise<PageData[]> {
    const batchSize = 5;
    const enriched: PageData[] = [];
    const pageList = pages.map((p) => p.url).join("\n");

    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      const enrichFn = this.cuaMode
        ? (page: PageData) => this.enrichPageCUA(page)
        : (page: PageData) => this.enrichSinglePage(page, rootUrl, pageList);
      const results = await Promise.all(batch.map(enrichFn));
      enriched.push(...results);
    }

    return enriched;
  }

  /**
   * CUA-mode page enrichment: concise visual layout + navigation strategy.
   * Produces ~100 tokens per page instead of ~500+ in standard mode.
   */
  private async enrichPageCUA(page: PageData): Promise<PageData> {
    const prompt = `Analyze this web page for a VISION-BASED browser automation agent that sees screenshots and clicks coordinates.

Page URL: ${page.url}
Page Title: ${page.title}

Accessibility Tree (for context):
${page.accessibilitySnapshot?.substring(0, 6000) || "Not available"}

Respond in this exact JSON format:
{
  "purpose": "One sentence: what this page does",
  "visualLayout": "Describe the visual layout: where is the nav bar, sidebar, content area, search, etc. (2-3 sentences)",
  "navigationStrategy": "How would a human visually navigate from this page to key features? (2-3 sentences)"
}`;

    const result = await callLLMWithValidation({
      client: this.client,
      model: this.pageModel,
      maxTokens: 500,
      system: CUA_SYSTEM_PROMPT,
      prompt,
      schema: CuaPageEnrichmentSchema,
    });

    this.trackResult(result);

    if (result.data) {
      page.purpose = sanitize(result.data.purpose) || page.title;
      page.visualLayout = sanitize(result.data.visualLayout) || "";
      page.navigationStrategy = sanitize(result.data.navigationStrategy) || "";
    } else {
      page.purpose = page.title || "Unknown page";
    }

    return page;
  }

  private async enrichSinglePage(
    page: PageData,
    rootUrl: string,
    pageList: string
  ): Promise<PageData> {
    const prompt = `Analyze this web page and provide:
1. A one-sentence PURPOSE describing what this page does
2. HOW TO REACH this page from the homepage (${rootUrl}) — describe the navigation steps using accessibility selectors
3. For each interactive element, what the expected RESULT of interacting with it is
4. Any DYNAMIC BEHAVIOR (infinite scroll, auto-refresh, modals, toasts, etc.)

Page URL: ${page.url}
Page Title: ${page.title}

Accessibility Tree Snapshot:
${page.accessibilitySnapshot?.substring(0, 8000) || "Not available"}

Interactive Elements Found (provide a result for EACH element below):
${page.elements.map((e) => `- ${e.role} "${e.name}" [${e.state}] selector: \`${e.selector}\``).join("\n")}

Forms Found:
${page.forms.map((f) => `- ${f.name}: ${f.fields.length} fields`).join("\n") || "None"}

Other pages on this site:
${pageList.substring(0, 1000)}

Respond in this exact JSON format:
{
  "purpose": "string",
  "howToReach": "Navigate to homepage then click ... (role=link, name=\\"...\\")",
  "elementResults": { "selectorString": "expected result description" },
  "dynamicBehavior": ["behavior 1", "behavior 2"]
}`;

    const result = await callLLMWithValidation({
      client: this.client,
      model: this.pageModel,
      maxTokens: 4000,
      system: SYSTEM_PROMPT,
      prompt,
      schema: PageEnrichmentSchema,
    });

    this.trackResult(result);

    if (result.data) {
      page.purpose = sanitize(result.data.purpose) || page.title;
      page.howToReach = sanitize(result.data.howToReach) || "";
      page.dynamicBehavior = result.data.dynamicBehavior
        .map(sanitize)
        .filter(Boolean);

      // Update element results
      for (const element of page.elements) {
        if (result.data.elementResults[element.selector]) {
          element.result = sanitize(result.data.elementResults[element.selector]);
        }
      }
    } else {
      page.purpose = page.title || "Unknown page";
    }

    return page;
  }

  /**
   * Build a hierarchical site map from flat page list.
   */
  private buildSiteMap(pages: PageData[], rootUrl: string): SiteMap {
    const sortedPages = [...pages].sort(
      (a, b) =>
        new URL(a.url).pathname.split("/").length -
        new URL(b.url).pathname.split("/").length
    );

    const nodeMap = new Map<string, SiteMapNode>();

    for (const page of sortedPages) {
      const url = new URL(page.url);
      const node: SiteMapNode = {
        url: page.url,
        title: page.title,
        description: page.purpose,
        requiresAuth: false,
        children: [],
      };
      nodeMap.set(url.pathname, node);
    }

    const rootNodes: SiteMapNode[] = [];
    for (const [pathname, node] of nodeMap) {
      const parentPath = pathname.split("/").slice(0, -1).join("/") || "/";
      const parent = nodeMap.get(parentPath);
      if (parent && parent !== node) {
        parent.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    return { rootUrl, pages: rootNodes };
  }

  /**
   * Use LLM to detect common workflows from the page data.
   */
  private async detectWorkflows(
    pages: PageData[],
    domain: string
  ): Promise<Workflow[]> {
    const pageSummaries = pages
      .map(
        (p) =>
          `- ${p.url}: ${p.purpose} | Elements: ${p.elements.map((e) => `${e.role}:"${e.name}"`).join(", ")} | Forms: ${p.forms.map((f) => f.name).join(", ") || "none"}`
      )
      .join("\n");

    const prompt = `Given these pages from ${domain}, identify the main user workflows (e.g., login, purchase, search, signup, etc.).

Pages:
${pageSummaries.substring(0, 6000)}

For each workflow, provide step-by-step instructions using accessibility selectors.

Respond in this exact JSON format:
{
  "workflows": [
    {
      "name": "Workflow Name",
      "description": "What this workflow accomplishes",
      "steps": [
        {
          "step": 1,
          "description": "What to do",
          "selector": "role=button, name=\\"Submit\\"",
          "actionType": "click|type|select|navigate|wait",
          "value": "optional value for type/select",
          "expectedResult": "What should happen"
        }
      ]
    }
  ]
}`;

    const result = await callLLMWithValidation({
      client: this.client,
      model: this.synthesisModel,
      maxTokens: 4000,
      system: SYSTEM_PROMPT,
      prompt,
      schema: WorkflowsSchema,
    });

    this.trackResult(result);

    if (result.data) {
      return result.data.workflows
        .map((w) => ({
          name: sanitize(w.name),
          description: sanitize(w.description),
          steps: w.steps.map((s) => ({
            step: s.step,
            description: sanitize(s.description),
            selector: s.selector ? sanitize(s.selector) : undefined,
            actionType: sanitize(s.actionType) || "click",
            value: s.value ? sanitize(s.value) : undefined,
            expectedResult: sanitize(s.expectedResult) || "",
          })),
        }))
        .filter((w) => w.name);
    }

    return [];
  }

  /**
   * Generate a brief site description.
   */
  private async generateSiteDescription(
    pages: PageData[],
    domain: string
  ): Promise<string> {
    const pageTitles = pages.map((p) => `${p.url}: ${p.title}`).join("\n");

    try {
      const response = await this.client.messages.create({
        model: this.pageModel,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `In one sentence, describe what the website ${domain} does based on these pages:\n${pageTitles.substring(0, 2000)}`,
          },
        ],
      });

      this.tokensUsed +=
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0);

      return sanitize(extractText(response)) || domain;
    } catch {
      return `Website at ${domain}`;
    }
  }

  /** Track validation metrics from an LLM call result */
  private trackResult<T>(result: LLMCallResult<T>): void {
    this.tokensUsed += result.tokensUsed;
    this.confidenceScores.push(result.confidence);
    if (result.attempts > 1) {
      this.llmRetries += result.attempts - 1;
    }
    if (result.data === null) {
      this.llmFailures++;
    }
  }

  get totalTokensUsed(): number {
    return this.tokensUsed;
  }
}
