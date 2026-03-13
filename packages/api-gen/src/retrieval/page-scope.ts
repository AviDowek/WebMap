/**
 * URL pattern matching for page-scoped action loading.
 * Matches a current URL to the best-matching PageAPI.
 */

import type { DomainAPI, PageAPI } from "../types.js";

/**
 * Find the best-matching PageAPI for a given URL.
 * Priority: exact URL match > pattern match > prefix match.
 */
export function findPageForUrl(domainApi: DomainAPI, currentUrl: string): PageAPI | null {
  const pages = Object.values(domainApi.pages);
  if (pages.length === 0) return null;

  let pathname: string;
  let urlNoQuery: string;
  try {
    const parsed = new URL(currentUrl);
    pathname = parsed.pathname;
    // Strip trailing slash for consistent matching (but keep "/" as-is)
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    urlNoQuery = `${parsed.origin}${pathname}`;
  } catch {
    return null;
  }

  // Priority 1: Exact canonical URL match (ignoring query params)
  for (const page of pages) {
    if (page.canonicalUrl === currentUrl || page.canonicalUrl === urlNoQuery) return page;
  }

  // Also try stripping query from canonical URLs for matching
  for (const page of pages) {
    try {
      const canonicalPath = new URL(page.canonicalUrl).pathname.replace(/\/$/, "") || "/";
      if (canonicalPath === pathname) return page;
    } catch { /* skip */ }
  }

  // Priority 2: Exact pathname match on pattern (normalize trailing slashes)
  for (const page of pages) {
    const normalizedPattern = page.urlPattern.length > 1 && page.urlPattern.endsWith("/")
      ? page.urlPattern.slice(0, -1) : page.urlPattern;
    if (normalizedPattern === pathname) return page;
  }

  // Priority 3: Glob pattern match (patterns with * wildcards)
  for (const page of pages) {
    if (page.urlPattern.includes("*")) {
      const regex = patternToRegex(page.urlPattern);
      if (regex.test(pathname)) return page;
    }
  }

  // Priority 4: Longest prefix match
  let bestMatch: PageAPI | null = null;
  let bestLength = 0;

  for (const page of pages) {
    const pattern = page.urlPattern.replace(/\*$/, "");
    if (pathname.startsWith(pattern) && pattern.length > bestLength) {
      bestMatch = page;
      bestLength = pattern.length;
    }
  }

  return bestMatch;
}

/**
 * Find all PageAPIs that might be relevant to a search query.
 * Used by the discover_actions meta-tool.
 */
export function searchActions(
  domainApi: DomainAPI,
  query: string,
  maxResults: number = 10
): Array<{
  name: string;
  description: string;
  pagePattern: string;
  tier: string;
}> {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  type ScoredAction = {
    name: string;
    description: string;
    pagePattern: string;
    tier: string;
    score: number;
  };

  const scored: ScoredAction[] = [];

  // Search global actions
  for (const action of domainApi.globalActions) {
    const score = scoreMatch(action.name, action.description, queryWords, queryLower);
    if (score > 0) {
      scored.push({
        name: action.name,
        description: action.description,
        pagePattern: "global",
        tier: action.tier,
        score,
      });
    }
  }

  // Search page-scoped actions
  for (const pageApi of Object.values(domainApi.pages)) {
    for (const action of pageApi.actions) {
      const score = scoreMatch(action.name, action.description, queryWords, queryLower);
      if (score > 0) {
        scored.push({
          name: action.name,
          description: action.description,
          pagePattern: pageApi.urlPattern,
          tier: action.tier,
          score,
        });
      }
    }
  }

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map(({ score, ...rest }) => rest);
}

/**
 * Score how well an action matches a search query.
 */
function scoreMatch(
  name: string,
  description: string,
  queryWords: string[],
  queryLower: string
): number {
  const nameLower = name.toLowerCase();
  const descLower = description.toLowerCase();
  let score = 0;

  // Exact substring match in name (highest weight)
  if (nameLower.includes(queryLower)) score += 10;

  // Exact substring match in description
  if (descLower.includes(queryLower)) score += 5;

  // Word-level matches
  for (const word of queryWords) {
    if (nameLower.includes(word)) score += 3;
    if (descLower.includes(word)) score += 1;
  }

  return score;
}

/**
 * Convert a glob pattern to a regex.
 * Supports * as wildcard for any path segment.
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}
