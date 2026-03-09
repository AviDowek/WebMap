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

/** Safely extract text from an Anthropic API response */
function extractText(response: Anthropic.Message): string {
  if (!response.content || response.content.length === 0) return "";
  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

/** Safely parse JSON from LLM output, returning null on failure */
function safeParseJson(text: string): Record<string, unknown> | null {
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
function sanitize(value: unknown): string {
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
    const enrichedPages = await this.enrichPages(pages, rootUrl);

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
  private async enrichPages(pages: PageData[], rootUrl: string): Promise<PageData[]> {
    const batchSize = 5;
    const enriched: PageData[] = [];
    const pageList = pages.map((p) => p.url).join("\n");

    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((page) => this.enrichSinglePage(page, rootUrl, pageList))
      );
      enriched.push(...results);
    }

    return enriched;
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

    try {
      const response = await this.client.messages.create({
        model: this.pageModel,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      this.tokensUsed +=
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0);

      const text = extractText(response);
      const data = safeParseJson(text);

      if (data) {
        page.purpose = sanitize(data.purpose) || page.title;
        page.howToReach = sanitize(data.howToReach) || "";
        page.dynamicBehavior = Array.isArray(data.dynamicBehavior)
          ? data.dynamicBehavior.map(sanitize).filter(Boolean)
          : [];

        // Update element results
        if (data.elementResults && typeof data.elementResults === "object") {
          const results = data.elementResults as Record<string, unknown>;
          for (const element of page.elements) {
            if (results[element.selector]) {
              element.result = sanitize(results[element.selector]);
            }
          }
        }
      }
    } catch {
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

      const text = extractText(response);
      const data = safeParseJson(text);

      if (data && Array.isArray(data.workflows)) {
        return data.workflows
          .filter(
            (w: unknown): w is Record<string, unknown> =>
              typeof w === "object" && w !== null
          )
          .map((w) => ({
            name: sanitize(w.name),
            description: sanitize(w.description),
            steps: Array.isArray(w.steps)
              ? w.steps
                  .filter(
                    (s: unknown): s is Record<string, unknown> =>
                      typeof s === "object" && s !== null
                  )
                  .map((s) => ({
                    step: typeof s.step === "number" ? s.step : 0,
                    description: sanitize(s.description),
                    selector: sanitize(s.selector) || undefined,
                    actionType: sanitize(s.actionType) || "click",
                    value: sanitize(s.value) || undefined,
                    expectedResult: sanitize(s.expectedResult) || "",
                  }))
              : [],
          }))
          .filter((w: { name: string }) => w.name);
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

      return sanitize(extractText(response)) || domain;
    } catch {
      return `Website at ${domain}`;
    }
  }

  get totalTokensUsed(): number {
    return this.tokensUsed;
  }
}
