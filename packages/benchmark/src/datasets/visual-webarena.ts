/**
 * VisualWebArena dataset loader.
 * Multimodal variant of WebArena emphasizing visual grounding.
 * Self-hosted Docker required: https://github.com/web-arena-x/visualwebarena
 *
 * Covers: Classifieds, Shopping, Reddit
 * Tests both HTML understanding and visual reasoning (e.g. "click the red button in the top-right")
 */

import type { BenchmarkTask } from "../types.js";
import type { DatasetConfig } from "./types.js";

const BUNDLED_TASKS: Array<{
  id: string;
  site: "classifieds" | "shopping" | "reddit";
  path: string;
  instruction: string;
  successCriteria: string;
  category: string;
}> = [
  {
    id: "vwa-0",
    site: "classifieds",
    path: "/",
    instruction: "Find the listing with the most photos and click on it to view details.",
    successCriteria: "The listing with the most photos is opened",
    category: "visual-grounding",
  },
  {
    id: "vwa-1",
    site: "classifieds",
    path: "/",
    instruction: "Look at the homepage image gallery. Click on the second image in the featured listings carousel.",
    successCriteria: "The second featured listing image is clicked and its detail page is opened",
    category: "visual-grounding",
  },
  {
    id: "vwa-2",
    site: "shopping",
    path: "/",
    instruction: "Find a product that has a sale badge/tag visible on its image and click it.",
    successCriteria: "A product with a visible sale indicator is selected",
    category: "visual-grounding",
  },
  {
    id: "vwa-3",
    site: "shopping",
    path: "/",
    instruction: "On the product listing page, find the item with the most stars shown in its rating display and add it to cart.",
    successCriteria: "The highest-rated product is added to cart",
    category: "visual-grounding",
  },
  {
    id: "vwa-4",
    site: "reddit",
    path: "/",
    instruction: "Find a post that has an image or video thumbnail attached. Open it and describe what you see in the media.",
    successCriteria: "A post with media is opened and the media content is described",
    category: "visual-grounding",
  },
  {
    id: "vwa-5",
    site: "reddit",
    path: "/",
    instruction: "Navigate to the most visually prominent subreddit banner on the page. What community is being featured?",
    successCriteria: "The featured/prominent subreddit is identified from visual elements",
    category: "visual-grounding",
  },
];

const SITE_PORTS: Record<string, number> = {
  classifieds: 9980,
  shopping: 7770,
  reddit: 9999,
};

export async function loadVisualWebArena(config: DatasetConfig): Promise<BenchmarkTask[]> {
  const base = config.dockerBaseUrl || "http://localhost";

  if (!config.dockerBaseUrl) {
    console.warn(
      "[visual-webarena] No dockerBaseUrl configured. Using default localhost ports.\n" +
      "  Set up Docker: https://github.com/web-arena-x/visualwebarena"
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
      source: "visual-webarena",
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
