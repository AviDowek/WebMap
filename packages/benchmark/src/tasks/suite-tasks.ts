/**
 * Curated benchmark tasks for the reproducible benchmark suite.
 * 15 manually-written tasks (3 per site) covering diverse categories.
 * Hardcoded for reproducibility — no AI generation variance between runs.
 */

import type { BenchmarkTask } from "../runner.js";

export interface BenchmarkSite {
  url: string;
  name: string;
  category: string;
}

/** Five diverse, stable, publicly accessible sites */
export const SUITE_SITES: BenchmarkSite[] = [
  {
    url: "https://news.ycombinator.com",
    name: "Hacker News",
    category: "news-aggregator",
  },
  {
    url: "https://en.wikipedia.org",
    name: "Wikipedia",
    category: "reference",
  },
  {
    url: "https://docs.python.org/3/",
    name: "Python Docs",
    category: "documentation",
  },
  {
    url: "https://httpbin.org",
    name: "httpbin",
    category: "developer-tool",
  },
  {
    url: "https://books.toscrape.com",
    name: "Books to Scrape",
    category: "e-commerce",
  },
];

/** 15 curated tasks — 3 per site */
export const SUITE_TASKS: BenchmarkTask[] = [
  // ─── Hacker News (3 tasks) ──────────────────────────────────────
  {
    id: "hn-nav-1",
    url: "https://news.ycombinator.com",
    instruction:
      "Navigate to the 'new' page to see the newest stories on Hacker News.",
    successCriteria:
      "The page shows the newest stories list and the URL contains '/newest'.",
    category: "navigation",
    source: "manual",
  },
  {
    id: "hn-nav-2",
    url: "https://news.ycombinator.com",
    instruction:
      "Click on the 'comments' link of the first story on the Hacker News front page to view its discussion.",
    successCriteria:
      "The comments/discussion page for the first story is displayed.",
    category: "navigation",
    source: "manual",
  },
  {
    id: "hn-info-1",
    url: "https://news.ycombinator.com",
    instruction:
      "Navigate to the 'Show HN' section by clicking the 'show' link in the top navigation.",
    successCriteria:
      "The page displays Show HN posts and the URL contains '/show'.",
    category: "navigation",
    source: "manual",
  },

  // ─── Wikipedia (3 tasks) ────────────────────────────────────────
  {
    id: "wiki-search-1",
    url: "https://en.wikipedia.org",
    instruction:
      "Search for 'machine learning' using the search bar on the Wikipedia homepage.",
    successCriteria:
      "The Wikipedia article about Machine Learning is displayed.",
    category: "search",
    source: "manual",
  },
  {
    id: "wiki-nav-1",
    url: "https://en.wikipedia.org/wiki/Machine_learning",
    instruction:
      "Navigate to the 'History' section of the Machine Learning article by clicking its link in the table of contents.",
    successCriteria:
      "The page scrolls to or displays the History section of the article.",
    category: "navigation",
    source: "manual",
  },
  {
    id: "wiki-info-1",
    url: "https://en.wikipedia.org",
    instruction:
      "From the Wikipedia main page, navigate to the 'Random article' page using the sidebar link.",
    successCriteria: "A random Wikipedia article is displayed.",
    category: "navigation",
    source: "manual",
  },

  // ─── Python Docs (3 tasks) ─────────────────────────────────────
  {
    id: "pydocs-search-1",
    url: "https://docs.python.org/3/",
    instruction:
      "Use the search functionality to search for 'json' in the Python documentation.",
    successCriteria:
      "Search results related to the json module are displayed.",
    category: "search",
    source: "manual",
  },
  {
    id: "pydocs-nav-1",
    url: "https://docs.python.org/3/",
    instruction:
      "Navigate to the 'Library Reference' from the Python docs homepage.",
    successCriteria:
      "The Library Reference page is displayed listing Python standard library modules.",
    category: "navigation",
    source: "manual",
  },
  {
    id: "pydocs-nav-2",
    url: "https://docs.python.org/3/",
    instruction:
      "Navigate to the Tutorial section and then to the 'Data Structures' chapter.",
    successCriteria:
      "The Data Structures tutorial page is displayed with content about lists, tuples, etc.",
    category: "multi-step",
    source: "manual",
  },

  // ─── httpbin (3 tasks) ─────────────────────────────────────────
  {
    id: "httpbin-form-1",
    url: "https://httpbin.org",
    instruction:
      "Navigate to the httpbin forms/post page and fill out the form with: customer name 'John Doe', large pizza size, and cheese topping, then submit it.",
    successCriteria:
      "The form is submitted and a response page shows the submitted data.",
    category: "form-fill",
    source: "manual",
  },
  {
    id: "httpbin-nav-1",
    url: "https://httpbin.org",
    instruction:
      "Find and navigate to the '/get' endpoint page on httpbin to see a sample GET response.",
    successCriteria:
      "The /get endpoint response is displayed showing headers and request info.",
    category: "navigation",
    source: "manual",
  },
  {
    id: "httpbin-nav-2",
    url: "https://httpbin.org",
    instruction:
      "Navigate to the '/headers' endpoint to view the current request headers.",
    successCriteria:
      "The /headers endpoint response is displayed showing request headers as JSON.",
    category: "navigation",
    source: "manual",
  },

  // ─── Books to Scrape (3 tasks) ─────────────────────────────────
  {
    id: "books-nav-1",
    url: "https://books.toscrape.com",
    instruction:
      "Navigate to the 'Mystery' category from the sidebar navigation on books.toscrape.com.",
    successCriteria:
      "The Mystery category page is displayed showing mystery books.",
    category: "navigation",
    source: "manual",
  },
  {
    id: "books-nav-2",
    url: "https://books.toscrape.com",
    instruction:
      "Click on the first book on the homepage to view its details, including the price and description.",
    successCriteria:
      "The individual book page is displayed showing the book's title, price, description, and availability.",
    category: "multi-step",
    source: "manual",
  },
  {
    id: "books-nav-3",
    url: "https://books.toscrape.com",
    instruction:
      "Navigate to page 2 of the book catalog by clicking the 'next' button at the bottom of the homepage.",
    successCriteria:
      "Page 2 of the book catalog is displayed with different books than page 1.",
    category: "navigation",
    source: "manual",
  },
];
