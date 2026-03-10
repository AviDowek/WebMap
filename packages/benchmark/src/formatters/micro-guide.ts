/**
 * Micro Guide (~100 tokens) and compact CUA guide formatters.
 */

import type { SiteDocumentation } from "@webmap/core";

/**
 * Build an ultra-minimal site guide for CUA agents (~100 tokens / ~400 chars).
 * Minimizes system prompt overhead that compounds over 18+ step conversations.
 * Only includes: domain, one-line description, one-line nav hint from homepage.
 */
export function formatMicroGuide(doc: SiteDocumentation): string {
  const lines: string[] = [];

  lines.push(`SITE: ${doc.domain}`);
  if (doc.description) {
    // Truncate description to first sentence
    const firstSentence = doc.description.split(/\.\s/)[0];
    lines.push(firstSentence.endsWith(".") ? firstSentence : firstSentence + ".");
  }

  // One-line nav hint from homepage visual layout
  const homePage = doc.pages.find((p) => {
    try {
      const pathname = new URL(p.url).pathname;
      return pathname === "/" || pathname === "";
    } catch { return false; }
  }) || doc.pages[0];

  if (homePage?.visualLayout && homePage.visualLayout.trim()) {
    // Take just the first sentence of visual layout
    const navHint = homePage.visualLayout.split(/\.\s/)[0];
    lines.push(`NAV: ${navHint.endsWith(".") ? navHint : navHint + "."}`);
  }

  return lines.join("\n").trim();
}

// Keep formatCompactCUAGuide as a re-export of formatMicroGuide for backward compat
export const formatCompactCUAGuide = formatMicroGuide as (
  doc: SiteDocumentation,
  task?: { instruction: string; category: string }
) => string;
