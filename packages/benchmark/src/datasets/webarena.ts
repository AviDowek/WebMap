/**
 * WebArena-Verified dataset loader.
 * Tasks are bundled in the package; URLs are remapped to the local Docker base URL.
 *
 * Self-hosted Docker required: https://github.com/web-arena-x/webarena
 * Default ports: Shopping=7770, Reddit=9999, GitLab=8023, CMS=3000
 *
 * Tasks sourced from: https://github.com/ServiceNow/webarena-verified
 */

import type { BenchmarkTask } from "../types.js";
import type { DatasetConfig } from "./types.js";

// Bundled representative subset of WebArena-Verified tasks
// Full dataset requires cloning: https://github.com/web-arena-x/webarena
const BUNDLED_TASKS: Array<{
  id: string;
  site: "shopping" | "reddit" | "gitlab" | "cms";
  path: string;
  instruction: string;
  successCriteria: string;
  category: string;
}> = [
  {
    id: "webarena-0",
    site: "shopping",
    path: "/",
    instruction: "Find the cheapest available laptop on the site and add it to cart.",
    successCriteria: "A laptop has been added to the shopping cart",
    category: "e-commerce",
  },
  {
    id: "webarena-1",
    site: "shopping",
    path: "/",
    instruction: "Search for wireless headphones under $50 and sort by price ascending.",
    successCriteria: "Search results show wireless headphones sorted by price low to high",
    category: "e-commerce",
  },
  {
    id: "webarena-2",
    site: "shopping",
    path: "/",
    instruction: "Find a product with at least 4 stars rating and add it to wishlist.",
    successCriteria: "A 4+ star product has been added to wishlist",
    category: "e-commerce",
  },
  {
    id: "webarena-3",
    site: "reddit",
    path: "/",
    instruction: "Find the most upvoted post in the programming subreddit this week.",
    successCriteria: "The top post in r/programming this week is displayed",
    category: "social",
  },
  {
    id: "webarena-4",
    site: "reddit",
    path: "/",
    instruction: "Create a new post in the worldnews subreddit with the title 'Test post'.",
    successCriteria: "A new post titled 'Test post' has been created in r/worldnews",
    category: "social",
  },
  {
    id: "webarena-5",
    site: "gitlab",
    path: "/",
    instruction: "Create a new project named 'test-project' with a README.",
    successCriteria: "A new GitLab project named 'test-project' exists with a README file",
    category: "development",
  },
  {
    id: "webarena-6",
    site: "gitlab",
    path: "/",
    instruction: "Find all open issues in the first available project.",
    successCriteria: "Open issues list is visible for a project",
    category: "development",
  },
  {
    id: "webarena-7",
    site: "cms",
    path: "/",
    instruction: "Create a new blog post draft with title 'Hello World'.",
    successCriteria: "A draft blog post titled 'Hello World' has been created",
    category: "content",
  },
];

const SITE_PORTS: Record<string, number> = {
  shopping: 7770,
  reddit: 9999,
  gitlab: 8023,
  cms: 3000,
};

export async function loadWebArena(config: DatasetConfig): Promise<BenchmarkTask[]> {
  const base = config.dockerBaseUrl || "http://localhost";

  if (!config.dockerBaseUrl) {
    console.warn(
      "[webarena] No dockerBaseUrl configured. Using default localhost ports.\n" +
      "  Set up Docker: https://github.com/web-arena-x/webarena\n" +
      "  Then set dockerBaseUrl in dataset config."
    );
  }

  const tasks: BenchmarkTask[] = BUNDLED_TASKS.map((t) => {
    const port = SITE_PORTS[t.site] || 7770;
    const baseWithPort = base.includes(":") && !base.match(/:\d+$/)
      ? base
      : `${base}:${port}`;

    return {
      id: t.id,
      url: `${baseWithPort}${t.path}`,
      instruction: t.instruction,
      successCriteria: t.successCriteria,
      category: t.category,
      source: "webarena",
    };
  });

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
