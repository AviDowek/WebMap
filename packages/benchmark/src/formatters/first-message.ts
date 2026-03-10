/**
 * First-message doc injection formatter.
 */

import type { SiteDocumentation } from "@webmap/core";

/**
 * Format docs for injection in the first user message.
 * Since this doesn't compound (only sent once), we can be more generous.
 */
export function formatFirstMessageDocs(doc: SiteDocumentation): string {
  const lines: string[] = [];

  lines.push(`--- SITE DOCUMENTATION: ${doc.domain} ---`);
  if (doc.description) lines.push(doc.description);

  for (const page of doc.pages.slice(0, 10)) {
    try {
      const pathname = new URL(page.url).pathname;
      lines.push(`\n[${pathname}]`);
      if (page.purpose) lines.push(`Purpose: ${page.purpose}`);
      if (page.visualLayout) lines.push(`Layout: ${page.visualLayout}`);
      if (page.navigationStrategy) lines.push(`Nav: ${page.navigationStrategy}`);
    } catch { /* skip */ }
  }

  lines.push("--- END DOCUMENTATION ---");
  return lines.join("\n");
}
