/**
 * @webmap/core — Website documentation generator for AI agents.
 *
 * Crawls websites using Playwright, extracts accessibility trees,
 * and generates comprehensive markdown documentation that AI agents
 * can use to navigate and operate websites.
 */

export { crawlSite, type CrawlResult } from "./crawler/site-crawler.js";
export { DocGenerator } from "./agents/doc-generator.js";
export { formatAsMarkdown } from "./docs/markdown-formatter.js";
export type {
  CrawlOptions,
  SiteDocumentation,
  PageData,
  InteractiveElement,
  FormField,
  PageForm,
  Workflow,
  WorkflowStep,
  SiteMap,
  SiteMapNode,
} from "./types.js";

import { crawlSite } from "./crawler/site-crawler.js";
import { DocGenerator } from "./agents/doc-generator.js";
import { formatAsMarkdown } from "./docs/markdown-formatter.js";
import type { CrawlOptions, SiteDocumentation } from "./types.js";

export interface WebMapOptions extends CrawlOptions {
  /** Anthropic API key (or set ANTHROPIC_API_KEY env var) */
  apiKey?: string;
  /** Model for page analysis */
  pageModel?: string;
  /** Model for synthesis/workflows */
  synthesisModel?: string;
}

export interface WebMapResult {
  /** Structured documentation object */
  documentation: SiteDocumentation;
  /** Formatted markdown string */
  markdown: string;
}

/**
 * Main entry point: crawl a URL and generate comprehensive documentation.
 */
export async function webmap(options: WebMapOptions): Promise<WebMapResult> {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Anthropic API key required. Set ANTHROPIC_API_KEY env var or pass apiKey option."
    );
  }

  // Step 1: Crawl the site
  const crawlResult = await crawlSite(options);

  // Step 2: Generate documentation with LLM
  const generator = new DocGenerator({
    apiKey,
    pageModel: options.pageModel,
    synthesisModel: options.synthesisModel,
  });

  const documentation = await generator.generate(crawlResult, options);

  // Step 3: Format as markdown
  const markdown = formatAsMarkdown(documentation);

  return { documentation, markdown };
}
