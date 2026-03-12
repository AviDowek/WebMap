/**
 * WebChoreArena dataset loader.
 * Extension of WebArena focused on long-horizon tasks requiring memory and calculation.
 * Self-hosted Docker required: https://github.com/WebChoreArena/WebChoreArena
 *
 * Challenge types:
 * - massive-memory: retrieve large amounts of information across many items
 * - calculation: compute values across multiple pages/items
 * - long-term-memory: remember information from early steps to use later
 */

import type { BenchmarkTask } from "../types.js";
import type { DatasetConfig } from "./types.js";

const BUNDLED_TASKS: Array<{
  id: string;
  site: "shopping" | "shopping-admin" | "reddit" | "gitlab";
  path: string;
  instruction: string;
  successCriteria: string;
  category: string;
  challengeType: "massive-memory" | "calculation" | "long-term-memory";
}> = [
  {
    id: "webchore-0",
    site: "shopping",
    path: "/",
    instruction: "Find the total price of all items currently in all users' wishlists. Sum the prices of every wishlist item across all accounts.",
    successCriteria: "The total sum of all wishlist item prices is correctly computed",
    category: "calculation",
    challengeType: "calculation",
  },
  {
    id: "webchore-1",
    site: "shopping-admin",
    path: "/admin",
    instruction: "List all orders placed in the last 7 days and compute the total revenue generated.",
    successCriteria: "All recent orders are found and total revenue is correctly calculated",
    category: "calculation",
    challengeType: "calculation",
  },
  {
    id: "webchore-2",
    site: "shopping-admin",
    path: "/admin",
    instruction: "Find which product category had the most returns last month. Count all return requests by category.",
    successCriteria: "The product category with the most returns is identified",
    category: "massive-memory",
    challengeType: "massive-memory",
  },
  {
    id: "webchore-3",
    site: "reddit",
    path: "/",
    instruction: "Find the user who has commented the most across all posts in r/programming this week. Count comments per user.",
    successCriteria: "The most active commenter in r/programming this week is identified",
    category: "massive-memory",
    challengeType: "massive-memory",
  },
  {
    id: "webchore-4",
    site: "gitlab",
    path: "/",
    instruction: "Find the commit that introduced the most lines of code changes in the last month across all projects.",
    successCriteria: "The largest commit by line count in the last month is identified",
    category: "massive-memory",
    challengeType: "massive-memory",
  },
  {
    id: "webchore-5",
    site: "shopping",
    path: "/",
    instruction: "Remember the first product you see on the homepage. Navigate to electronics, find a similar product, and compare their prices.",
    successCriteria: "Both products are found and their prices are compared",
    category: "long-term-memory",
    challengeType: "long-term-memory",
  },
];

const SITE_PORTS: Record<string, number> = {
  shopping: 7770,
  "shopping-admin": 7780,
  reddit: 9999,
  gitlab: 8023,
};

export async function loadWebChoreArena(config: DatasetConfig): Promise<BenchmarkTask[]> {
  const base = config.dockerBaseUrl || "http://localhost";

  if (!config.dockerBaseUrl) {
    console.warn(
      "[webchore-arena] No dockerBaseUrl configured. Using default localhost ports.\n" +
      "  Set up Docker: https://github.com/WebChoreArena/WebChoreArena"
    );
  }

  const tasks: BenchmarkTask[] = BUNDLED_TASKS.map((t) => {
    const port = SITE_PORTS[t.site] || 7770;
    const baseWithPort = `${base}:${port}`;

    return {
      id: t.id,
      url: `${baseWithPort}${t.path}`,
      instruction: t.instruction,
      successCriteria: t.successCriteria,
      category: t.category,
      source: "webchore-arena",
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
