/**
 * The discover_actions meta-tool for CUA agents.
 * Allows the agent to search for available functions across all pages.
 */

import type { DomainAPI } from "../types.js";
import { searchActions } from "./page-scope.js";

/**
 * Claude tool definition for discover_actions.
 */
export const DISCOVER_ACTIONS_TOOL = {
  name: "discover_actions",
  description:
    "Search for available site-specific functions across all pages. " +
    "Use this when you need to do something not in your current tool set, " +
    "or when you need to find what actions are available on a different page. " +
    "Returns matching function names, descriptions, and which page they are on.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Natural language description of what you want to do (e.g. 'search for products', 'add item to cart', 'login')",
      },
      page_url: {
        type: "string",
        description: "Optional: URL of a specific page to search on",
      },
    },
    required: ["query"],
  },
};

/**
 * The fallback browser_action tool — escape hatch for when API functions fail.
 * This is the existing A11Y_BROWSER_TOOL from a11y-actions.ts, renamed.
 */
export const FALLBACK_BROWSER_TOOL = {
  name: "fallback_browser_action",
  description:
    "Generic browser action for when site-specific functions fail or aren't available. " +
    "Use role and name from the accessibility tree to identify elements. " +
    "Prefer site-specific functions over this tool — only use as a fallback.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["click", "type", "scroll", "key", "goto"],
        description: "The action to perform",
      },
      role: {
        type: "string",
        description: "ARIA role of the target element (e.g. 'link', 'button', 'textbox')",
      },
      name: {
        type: "string",
        description: "Accessible name of the target element",
      },
      text: {
        type: "string",
        description: "Text to type (for 'type' action) or key to press (for 'key' action)",
      },
      direction: {
        type: "string",
        enum: ["up", "down"],
        description: "Scroll direction (for 'scroll' action)",
      },
      url: {
        type: "string",
        description: "URL to navigate to (for 'goto' action)",
      },
    },
    required: ["action"],
  },
};

/**
 * Handle a discover_actions tool call.
 * Returns formatted search results for Claude.
 */
export function handleDiscoverActions(
  domainApi: DomainAPI,
  input: Record<string, unknown>
): string {
  const query = input.query as string;
  if (!query) return "Error: query is required";

  const results = searchActions(domainApi, query, 10);

  if (results.length === 0) {
    return `No matching actions found for "${query}". Try a different query or use fallback_browser_action.`;
  }

  const formatted = results.map((r, i) =>
    `${i + 1}. ${r.name} (${r.tier}) — ${r.description}\n   Page: ${r.pagePattern}`
  ).join("\n\n");

  return `Found ${results.length} matching action(s) for "${query}":\n\n${formatted}\n\nTo use an action, navigate to its page and call it directly.`;
}
