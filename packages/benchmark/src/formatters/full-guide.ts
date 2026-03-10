/**
 * Full Guide (~400 tokens with layout/nav/sitemap) formatter.
 */

import type { SiteDocumentation } from "@webmap/core";

/**
 * Build a compact but comprehensive CUA guide (~400 tokens).
 * Includes layout description, navigation strategy, and site map.
 */
export function formatFullGuide(doc: SiteDocumentation): string {
  const lines: string[] = [];

  lines.push(`SITE: ${doc.domain}`);
  if (doc.description) {
    const firstSentence = doc.description.split(/\.\s/)[0];
    lines.push(firstSentence.endsWith(".") ? firstSentence : firstSentence + ".");
  }

  // Homepage layout
  const homePage = doc.pages.find((p) => {
    try {
      const pathname = new URL(p.url).pathname;
      return pathname === "/" || pathname === "";
    } catch { return false; }
  }) || doc.pages[0];

  if (homePage?.visualLayout && homePage.visualLayout.trim()) {
    lines.push(`\nLAYOUT: ${homePage.visualLayout.trim()}`);
  }

  if (homePage?.navigationStrategy && homePage.navigationStrategy.trim()) {
    lines.push(`\nNAVIGATION: ${homePage.navigationStrategy.trim()}`);
  }

  // Compact site map (top-level pages only)
  const siteMapLines: string[] = [];
  for (const page of doc.pages.slice(0, 8)) {
    try {
      const pathname = new URL(page.url).pathname;
      const purpose = page.purpose ? ` — ${page.purpose.split(/\.\s/)[0]}` : "";
      siteMapLines.push(`  ${pathname}${purpose}`);
    } catch { /* skip */ }
  }
  if (siteMapLines.length > 0) {
    lines.push(`\nSITE MAP:\n${siteMapLines.join("\n")}`);
  }

  return lines.join("\n").trim();
}
