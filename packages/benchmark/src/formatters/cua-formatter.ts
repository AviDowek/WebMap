/**
 * Transform raw WebMap markdown docs into a CUA-friendly briefing.
 *
 * Keeps: site map, page purposes, navigation hints, workflow summaries,
 *        dynamic behavior notes.
 * Strips: accessibility selectors, element tables, form field tables.
 */
export function formatDocsForCUA(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let skip = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip Interactive Elements tables
    if (line.startsWith("### Interactive Elements")) {
      skip = true;
      continue;
    }

    // Skip Forms tables
    if (line.startsWith("### Forms")) {
      skip = true;
      continue;
    }

    // Stop skipping at next heading
    if (skip && (line.startsWith("## ") || line.startsWith("### "))) {
      if (
        !line.startsWith("### Interactive Elements") &&
        !line.startsWith("### Forms")
      ) {
        skip = false;
      } else {
        continue;
      }
    }

    if (skip) continue;

    // Skip table rows (markdown tables with |)
    if (line.startsWith("|") && line.includes("|")) continue;

    // Skip Submit: lines with selectors
    if (line.startsWith("Submit: `")) continue;

    // Strip inline selectors: ` → \`...\`` patterns from workflow steps
    let cleaned = line.replace(/ → `[^`]*`/g, "");

    // Strip backtick selectors that remain
    cleaned = cleaned.replace(/`[^`]*`/g, "");

    // Skip crawl metadata line
    if (cleaned.startsWith("*Crawled:")) continue;

    // Clean up excess whitespace from removals
    cleaned = cleaned.replace(/\s{2,}/g, " ").trimEnd();

    // Skip lines that became empty after stripping (but keep intentional blank lines)
    if (cleaned === "" && line.trim() !== "") continue;

    output.push(cleaned);
  }

  // Remove consecutive blank lines
  const deduped: string[] = [];
  for (const line of output) {
    if (line === "" && deduped.length > 0 && deduped[deduped.length - 1] === "") {
      continue;
    }
    deduped.push(line);
  }

  return deduped.join("\n").trim();
}
