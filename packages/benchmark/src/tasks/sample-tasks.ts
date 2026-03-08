/**
 * Sample benchmark tasks for testing WebMap documentation effectiveness.
 * These use publicly accessible websites for testing.
 */

import type { BenchmarkTask } from "../runner.js";

export const sampleTasks: BenchmarkTask[] = [
  {
    id: "hn-001",
    url: "https://news.ycombinator.com",
    instruction: "Find the top story on Hacker News and click on its comments link",
    successCriteria: "The comments page for the top story is loaded",
    category: "navigation",
  },
  {
    id: "wiki-001",
    url: "https://en.wikipedia.org",
    instruction: "Search for 'Artificial Intelligence' on Wikipedia",
    successCriteria: "The Wikipedia article about Artificial Intelligence is displayed",
    category: "search",
  },
  {
    id: "wiki-002",
    url: "https://en.wikipedia.org/wiki/Artificial_intelligence",
    instruction: "Navigate to the 'History' section of the AI article and find the first link in that section",
    successCriteria: "Successfully identified and could click the first link in the History section",
    category: "navigation",
  },
  {
    id: "gh-001",
    url: "https://github.com/explore",
    instruction: "Find the trending repositories section on GitHub Explore",
    successCriteria: "Trending repositories are visible on the page",
    category: "navigation",
  },
  {
    id: "hn-002",
    url: "https://news.ycombinator.com",
    instruction: "Navigate to the 'new' stories page",
    successCriteria: "The newest stories page is loaded (URL contains /newest)",
    category: "navigation",
  },
];
