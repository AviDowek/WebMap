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

const SYSTEM_PROMPT = `You are a documentation generator for AI agents. Your job is to analyze web page data (accessibility tree snapshots, interactive elements, forms) and produce comprehensive documentation that enables AI agents to navigate and operate the website without vision.

Your documentation must be:
1. ACTIONABLE — every element includes its exact accessibility selector
2. COMPLETE — every interactive element, form, and dynamic behavior is documented
3. FLOW-ORIENTED — document how to reach each page and what actions lead where
4. CONCISE — use tables and structured formats, not prose

Always use accessibility selectors (role=button, name="Submit") not CSS selectors.`;

interface GeneratorOptions {
  /** Anthropic API key */
  apiKey: string;
  /** Model for page analysis (default: claude-sonnet-4-20250514) */
  pageModel?: string;
  /** Model for synthesis/workflows (default: claude-sonnet-4-20250514) */
  synthesisModel?: string;
}

export class DocGenerator {
  private client: Anthropic;
  private pageModel: string;
  private synthesisModel: string;
  private tokensUsed = 0;

  constructor(options: GeneratorOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.pageModel = options.pageModel || "claude-sonnet-4-20250514";
    this.synthesisModel = options.synthesisModel || "claude-sonnet-4-20250514";
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
    const enrichedPages = await this.enrichPages(pages);

    // Step 2: Build site map
    const siteMap = this.buildSiteMap(enrichedPages, rootUrl);

    // Step 3: Detect workflows using LLM
    const workflows = await this.detectWorkflows(enrichedPages, domain);

    // Step 4: Generate site description
    const description = await this.generateSiteDescription(
      enrichedPages,
      domain
    );

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
      },
    };
  }

  /**
   * Enrich pages with LLM-generated purpose, howToReach, and dynamic behavior.
   * Processes pages in parallel batches.
   */
  private async enrichPages(pages: PageData[]): Promise<PageData[]> {
    const batchSize = 5;
    const enriched: PageData[] = [];

    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((page) => this.enrichSinglePage(page))
      );
      enriched.push(...results);
    }

    return enriched;
  }

  private async enrichSinglePage(page: PageData): Promise<PageData> {
    const prompt = `Analyze this web page and provide:
1. A one-sentence PURPOSE describing what this page does
2. For each interactive element, what the expected RESULT of interacting with it is
3. Any DYNAMIC BEHAVIOR (infinite scroll, auto-refresh, modals, toasts, etc.)

Page URL: ${page.url}
Page Title: ${page.title}

Accessibility Tree Snapshot:
${page.accessibilitySnapshot?.substring(0, 4000) || "Not available"}

Interactive Elements Found:
${page.elements.map((e) => `- ${e.role} "${e.name}" [${e.state}]`).join("\n")}

Forms Found:
${page.forms.map((f) => `- ${f.name}: ${f.fields.length} fields`).join("\n") || "None"}

Respond in this exact JSON format:
{
  "purpose": "string",
  "elementResults": { "selectorString": "expected result description" },
  "dynamicBehavior": ["behavior 1", "behavior 2"]
}`;

    try {
      const response = await this.client.messages.create({
        model: this.pageModel,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      this.tokensUsed +=
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0);

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      // Parse the JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);

        page.purpose = data.purpose || page.title;
        page.dynamicBehavior = data.dynamicBehavior || [];

        // Update element results
        if (data.elementResults) {
          for (const element of page.elements) {
            if (data.elementResults[element.selector]) {
              element.result = data.elementResults[element.selector];
            }
          }
        }
      }
    } catch (error) {
      // If LLM fails, use fallback descriptions
      page.purpose = page.title || "Unknown page";
    }

    return page;
  }

  /**
   * Build a hierarchical site map from flat page list.
   */
  private buildSiteMap(pages: PageData[], rootUrl: string): SiteMap {
    const root = new URL(rootUrl);

    // Sort pages by URL depth
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
        requiresAuth: false, // Will be detected by flow mapper
        children: [],
      };
      nodeMap.set(url.pathname, node);
    }

    // Build tree by connecting parent-child based on URL structure
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

    return {
      rootUrl,
      pages: rootNodes,
    };
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
          "selector": "role=button, name=\"Submit\"",
          "actionType": "click|type|select|navigate|wait",
          "value": "optional value for type/select",
          "expectedResult": "What should happen"
        }
      ]
    }
  ]
}`;

    try {
      const response = await this.client.messages.create({
        model: this.synthesisModel,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      this.tokensUsed +=
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0);

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return data.workflows || [];
      }
    } catch {
      // Return empty if detection fails
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

      return response.content[0].type === "text"
        ? response.content[0].text
        : domain;
    } catch {
      return `Website at ${domain}`;
    }
  }

  get totalTokensUsed(): number {
    return this.tokensUsed;
  }
}
