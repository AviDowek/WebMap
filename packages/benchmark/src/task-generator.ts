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
