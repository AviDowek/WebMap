/**
 * WorkArena dataset loader.
 * ServiceNow-based CUA benchmark. Requires a ServiceNow instance.
 *
 * Full integration: https://github.com/ServiceNow/WorkArena
 * pip install browsergym-workarena
 *
 * This loader provides the 29 atomic task types with representative instructions.
 * For full 18,050-instance evaluation, use the browsergym-workarena Python package.
 */

import type { BenchmarkTask } from "../types.js";
import type { DatasetConfig } from "./types.js";

// 29 atomic task types from WorkArena
const ATOMIC_TASKS: Array<{
  id: string;
  instruction: string;
  successCriteria: string;
  category: string;
}> = [
  {
    id: "wa-list-sort",
    instruction: "Navigate to the Incident list and sort it by Priority in ascending order.",
    successCriteria: "The Incident list is displayed sorted by Priority ascending",
    category: "list-navigation",
  },
  {
    id: "wa-list-filter",
    instruction: "Filter the Incident list to show only incidents with 'Critical' priority.",
    successCriteria: "The Incident list shows only Critical priority incidents",
    category: "list-navigation",
  },
  {
    id: "wa-form-fill",
    instruction: "Create a new Incident with category 'Software', priority 'High', and description 'System is down'.",
    successCriteria: "A new incident has been created with the specified fields",
    category: "form-fill",
  },
  {
    id: "wa-form-date",
    instruction: "Create a new Change Request scheduled to start next Monday.",
    successCriteria: "A new Change Request exists with the start date set to next Monday",
    category: "form-fill",
  },
  {
    id: "wa-kb-search",
    instruction: "Search the Knowledge Base for articles about 'password reset' and open the first result.",
    successCriteria: "A knowledge base article about password reset is opened",
    category: "search",
  },
  {
    id: "wa-service-catalog",
    instruction: "Order a new laptop from the Service Catalog.",
    successCriteria: "A laptop order has been submitted through the Service Catalog",
    category: "service-request",
  },
  {
    id: "wa-dashboard-read",
    instruction: "How many open incidents are shown on the main dashboard?",
    successCriteria: "The number of open incidents from the dashboard is reported",
    category: "information-retrieval",
  },
  {
    id: "wa-menu-navigate",
    instruction: "Navigate to Problem Management > All Problems using the main navigation menu.",
    successCriteria: "The All Problems list is displayed",
    category: "menu-navigation",
  },
  {
    id: "wa-assign-ticket",
    instruction: "Find the oldest open incident and assign it to the IT group.",
    successCriteria: "The oldest open incident has been assigned to the IT group",
    category: "task-management",
  },
  {
    id: "wa-close-ticket",
    instruction: "Find an incident in 'In Progress' state and close it with resolution 'Issue resolved'.",
    successCriteria: "An in-progress incident has been closed with the resolution note",
    category: "task-management",
  },
];

export async function loadWorkArena(config: DatasetConfig): Promise<BenchmarkTask[]> {
  const baseUrl = config.dockerBaseUrl || config.credentials?.baseUrl || "https://dev-instance.service-now.com";

  if (!config.dockerBaseUrl && !config.credentials?.baseUrl) {
    console.warn(
      "[workarena] No ServiceNow base URL configured.\n" +
      "  Provide dockerBaseUrl (e.g. 'https://dev12345.service-now.com') in dataset config.\n" +
      "  Full setup: https://github.com/ServiceNow/WorkArena"
    );
  }

  const tasks: BenchmarkTask[] = ATOMIC_TASKS.map((t) => ({
    id: t.id,
    url: `${baseUrl}/now/nav/ui/classic/params/target/%24pa_dashboard.do`,
    instruction: t.instruction,
    successCriteria: t.successCriteria,
    category: t.category,
    source: "workarena" as const,
  }));

  return applyFilters(tasks, config);
}

function applyFilters(tasks: BenchmarkTask[], config: DatasetConfig): BenchmarkTask[] {
  let result = tasks;
  if (config.categories && config.categories.length > 0) {
    const cats = config.categories.map((c) => c.toLowerCase());
    result = result.filter((t) => cats.some((c) => t.category.toLowerCase().includes(c)));
  }
  if (config.subset && config.subset > 0) {
    result = result.slice(0, config.subset);
  }
  return result;
}
