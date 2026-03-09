/**
 * WebMap MCP Server — Exposes website documentation as MCP tools.
 *
 * Tools:
 *   get_site_docs(url)              — Get/generate full site documentation
 *   get_page_docs(url)              — Get docs for a specific page
 *   get_workflow(domain, task)       — Get relevant workflow steps for a task
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { webmap, type WebMapResult } from "@webmap/core";

// In-memory doc cache
const docsCache = new Map<string, WebMapResult>();

const server = new McpServer({
  name: "webmap",
  version: "0.1.0",
});

// Tool: get_site_docs
server.tool(
  "get_site_docs",
  "Crawl a website and generate comprehensive documentation for AI agents. Returns markdown with site map, interactive elements, forms, and workflows.",
  {
    url: z.string().url().describe("The website URL to document"),
    max_pages: z
      .number()
      .optional()
      .default(30)
      .describe("Maximum pages to crawl (default: 30)"),
    depth: z
      .number()
      .optional()
      .default(3)
      .describe("Maximum crawl depth (default: 3)"),
  },
  async ({ url, max_pages, depth }) => {
    const domain = new URL(url).hostname;

    // Return cached if available
    if (docsCache.has(domain)) {
      return {
        content: [
          {
            type: "text" as const,
            text: docsCache.get(domain)!.markdown,
          },
        ],
      };
    }

    try {
      const result = await webmap({
        url,
        maxPages: max_pages,
        maxDepth: depth,
      });
      docsCache.set(domain, result);

      return {
        content: [
          {
            type: "text" as const,
            text: result.markdown,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error crawling ${url}: ${error instanceof Error ? error.message : error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_page_docs
server.tool(
  "get_page_docs",
  "Get documentation for a specific page on a previously crawled website. Returns interactive elements, forms, and dynamic behavior for that page.",
  {
    url: z.string().url().describe("The specific page URL to get docs for"),
  },
  async ({ url }) => {
    const domain = new URL(url).hostname;
    const path = new URL(url).pathname;

    const cached = docsCache.get(domain);
    if (!cached) {
      // Auto-crawl if not cached
      try {
        const result = await webmap({ url, maxPages: 10, maxDepth: 1 });
        docsCache.set(domain, result);

        const page = result.documentation.pages.find(
          (p) => new URL(p.url).pathname === path
        );
        if (page) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : error}`,
            },
          ],
          isError: true,
        };
      }
    }

    const page = cached?.documentation.pages.find(
      (p) => new URL(p.url).pathname === path
    );

    if (!page) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No documentation found for ${url}. The page may not have been crawled.`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
    };
  }
);

// Tool: get_workflow
server.tool(
  "get_workflow",
  "Find a relevant workflow for a task on a documented website. Returns step-by-step instructions with accessibility selectors.",
  {
    domain: z.string().describe("The domain to search workflows for"),
    task: z
      .string()
      .describe(
        'Description of what you want to accomplish (e.g., "purchase a product", "create an account")'
      ),
  },
  async ({ domain, task }) => {
    const cached = docsCache.get(domain);
    if (!cached) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No documentation found for ${domain}. Use get_site_docs first to crawl the site.`,
          },
        ],
      };
    }

    const workflows = cached.documentation.workflows;
    if (workflows.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No workflows detected for ${domain}. The site documentation is available via get_site_docs.`,
          },
        ],
      };
    }

    // Simple keyword matching (could be enhanced with LLM-based matching)
    const taskLower = task.toLowerCase();
    const matched = workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(taskLower) ||
        w.description.toLowerCase().includes(taskLower) ||
        taskLower.split(" ").some(
          (word) =>
            w.name.toLowerCase().includes(word) ||
            w.description.toLowerCase().includes(word)
        )
    );

    if (matched.length === 0) {
      // Return all workflows as suggestions
      return {
        content: [
          {
            type: "text" as const,
            text: `No workflow matched "${task}". Available workflows:\n${workflows.map((w) => `- ${w.name}: ${w.description}`).join("\n")}`,
          },
        ],
      };
    }

    const formatted = matched
      .map((w) => {
        const steps = w.steps
          .map(
            (s) =>
              `${s.step}. ${s.description}${s.selector ? ` → \`${s.selector}\`` : ""}${s.value ? ` (value: "${s.value}")` : ""}`
          )
          .join("\n");
        return `### ${w.name}\n${w.description}\n\n${steps}`;
      })
      .join("\n\n");

    return {
      content: [{ type: "text" as const, text: formatted }],
    };
  }
);

// Start the MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WebMap MCP server running on stdio");
}

main().catch(console.error);
