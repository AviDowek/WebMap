/**
 * AI-powered task generator — creates benchmark tasks from site documentation.
 *
 * Uses Claude to analyze WebMap-generated docs and produce realistic
 * browser tasks that test different interaction patterns.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { BenchmarkTask } from "./runner.js";

/**
 * Generate benchmark tasks for a site using Claude to analyze its documentation.
 */
export async function generateTasksForSite(
  client: Anthropic,
  siteUrl: string,
  documentation: string,
  count: number = 3
): Promise<BenchmarkTask[]> {
  const domain = new URL(siteUrl).hostname;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system:
      "You generate realistic browser automation tasks for benchmarking AI agents. Return ONLY a valid JSON array, no markdown fencing or explanation.",
    messages: [
      {
        role: "user",
        content: `Generate ${count} diverse browser tasks for ${siteUrl}.

Website documentation:
${documentation.substring(0, 8000)}

Return a JSON array where each item has these exact fields:
- "instruction": string — what the agent should do (natural language)
- "successCriteria": string — how to verify it worked
- "category": string — one of: "navigation", "search", "form-fill", "multi-step", "information-extraction"

Make tasks realistic and varied. They should be completable by a browser agent using mouse clicks and keyboard input on the live site. Do NOT include tasks that require authentication or creating accounts.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Failed to parse task list from AI response");
  }

  const rawTasks: Array<{
    instruction: string;
    successCriteria: string;
    category: string;
  }> = JSON.parse(jsonMatch[0]);

  return rawTasks.map((t, i) => ({
    id: `${domain.replace(/\./g, "-")}-gen-${i + 1}`,
    url: siteUrl,
    instruction: t.instruction,
    successCriteria: t.successCriteria,
    category: t.category || "navigation",
    source: "ai-generated",
  }));
}

/**
 * AI-generated diverse site list for benchmarking.
 * Asks Claude to suggest a diverse set of websites across different categories.
 */
export async function generateDiverseSites(
  client: Anthropic,
  count: number = 5
): Promise<Array<{ url: string; category: string; description: string }>> {
  const clampedCount = Math.min(Math.max(count, 1), 20);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system:
      "You suggest real, publicly accessible websites for benchmarking browser automation agents. Return ONLY a valid JSON array, no markdown fencing or explanation. Choose well-known, stable sites that don't require authentication.",
    messages: [
      {
        role: "user",
        content: `Suggest ${clampedCount} diverse websites for benchmarking a browser automation AI agent. Each site should be a DIFFERENT type/category.

Include a mix from these categories:
- Documentation sites (developer docs, wikis)
- News/media (news aggregators, blogs)
- Reference (Wikipedia, dictionaries, encyclopedias)
- Developer tools (GitHub, package registries)
- E-commerce (product catalogs — public pages only)
- Government/public data
- Educational (university sites, online courses)
- Social/community (forums, Q&A — public pages only)

Return a JSON array where each item has:
- "url": string — the full URL (https://...)
- "category": string — the site category
- "description": string — one sentence about the site

Choose REAL sites that are publicly accessible without login. Prefer well-known stable sites.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Failed to parse site list from AI response");
  }

  const sites: Array<{ url: string; category: string; description: string }> =
    JSON.parse(jsonMatch[0]);

  // Validate URLs
  return sites.filter((s) => {
    try {
      const parsed = new URL(s.url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }).slice(0, clampedCount);
}

/**
 * Validate a user-submitted task input and convert to BenchmarkTask.
 */
export function createManualTask(input: {
  url: string;
  instruction: string;
  successCriteria: string;
  category?: string;
}): BenchmarkTask {
  const url = new URL(input.url); // throws on invalid
  const domain = url.hostname.replace(/\./g, "-");
  const id = `${domain}-manual-${Date.now().toString(36)}`;

  return {
    id,
    url: input.url,
    instruction: input.instruction,
    successCriteria: input.successCriteria,
    category: input.category || "navigation",
    source: "manual",
  };
}
