/**
 * Build the per-step tool set for CUA programmatic mode.
 * Combines global navigation + page-scoped + meta-tool + fallback.
 */

import type { DomainAPI, SiteAction } from "../types.js";
import { MAX_TOOLS_PER_STEP } from "../types.js";
import { findPageForUrl } from "./page-scope.js";
import { DISCOVER_ACTIONS_TOOL, FALLBACK_BROWSER_TOOL } from "./meta-tool.js";

/** Tool definition matching Claude's expected format */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Build the complete tool set for a CUA step.
 * Returns tools + a system addendum describing available actions.
 */
export function buildToolsForStep(
  domainApi: DomainAPI,
  currentUrl: string
): {
  tools: ToolDefinition[];
  actionMap: Map<string, SiteAction>;
  systemAddendum: string;
} {
  const actionMap = new Map<string, SiteAction>();
  const tools: ToolDefinition[] = [];

  // Reserve slots for meta-tools
  const reserved = 2; // discover_actions + fallback_browser_action
  const maxActionTools = MAX_TOOLS_PER_STEP - reserved;

  // 1. Collect candidate actions with priority scoring
  const candidates: Array<{ action: SiteAction; priority: number }> = [];

  // Global navigation actions (priority 2)
  for (const action of domainApi.globalActions) {
    if (action.reliability !== "verified-failed") {
      candidates.push({ action, priority: 2 });
    }
  }

  // Page-scoped actions (priority 3 — highest)
  const currentPage = findPageForUrl(domainApi, currentUrl);
  if (currentPage) {
    for (const action of currentPage.actions) {
      if (action.reliability !== "verified-failed") {
        candidates.push({ action, priority: 3 });
      }
    }
  }

  // 2. Sort by priority, then by reliability
  candidates.sort((a, b) => {
    // Higher priority first
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Verified-passed > untested > stale
    return reliabilityScore(b.action.reliability) - reliabilityScore(a.action.reliability);
  });

  // 3. Take top N actions
  const selected = candidates.slice(0, maxActionTools);

  // 4. Convert to tool definitions
  for (const { action } of selected) {
    const tool = actionToTool(action);
    tools.push(tool);
    actionMap.set(action.name, action);
  }

  // 5. Add meta-tools
  tools.push(DISCOVER_ACTIONS_TOOL as ToolDefinition);
  tools.push(FALLBACK_BROWSER_TOOL as ToolDefinition);

  // 6. Build system addendum
  const pageScoped = selected.filter(c => c.priority === 3).length;
  const global = selected.filter(c => c.priority === 2).length;
  const systemAddendum = [
    `You have ${tools.length} tools available:`,
    `- ${pageScoped} page-specific functions for the current page`,
    `- ${global} global navigation functions`,
    `- discover_actions: search for functions on other pages`,
    `- fallback_browser_action: generic browser action (use as last resort)`,
    ``,
    `Prefer page-specific functions over fallback_browser_action.`,
    `If a function fails, check the error and try fallback_browser_action.`,
    `Use discover_actions when you need to find functions on a different page.`,
  ].join("\n");

  return { tools, actionMap, systemAddendum };
}

/**
 * Convert a SiteAction to a Claude tool definition.
 */
function actionToTool(action: SiteAction): ToolDefinition {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const param of action.params) {
    const prop: Record<string, unknown> = {
      type: param.type === "select" ? "string" : param.type,
      description: param.description,
    };
    if (param.type === "select" && param.options) {
      prop.enum = param.options;
    }
    if (param.pattern) {
      prop.pattern = param.pattern;
    }
    properties[param.name] = prop;
    if (param.required) required.push(param.name);
  }

  return {
    name: action.name,
    description: action.description,
    input_schema: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

/**
 * Score reliability for sorting (higher = better).
 */
function reliabilityScore(reliability: string): number {
  switch (reliability) {
    case "verified-passed": return 3;
    case "untested": return 2;
    case "stale": return 1;
    case "verified-failed": return 0;
    default: return 1;
  }
}
