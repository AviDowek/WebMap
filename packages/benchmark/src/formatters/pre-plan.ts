/**
 * Pre-plan generator — uses Claude to create a task-specific plan from docs.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SiteDocumentation } from "@webmap/core";
import type { BenchmarkTask } from "../types.js";
import { formatFullGuide } from "./full-guide.js";

/**
 * Use Claude to generate a task-specific plan from the documentation
 * before the CUA agent starts. This is a separate, cheap API call.
 */
export async function generatePrePlan(
  client: Anthropic,
  task: BenchmarkTask,
  doc: SiteDocumentation
): Promise<string> {
  const fullGuide = formatFullGuide(doc);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: [{ type: "text" as const, text: "You are a planning assistant. Given a website guide and a task, produce a concise step-by-step plan (max 5 steps) for a vision-based browser agent to complete the task. Each step should describe what to look for visually and what action to take. Be specific but brief.", cache_control: { type: "ephemeral" as const } }],
    messages: [
      {
        role: "user",
        content: `SITE GUIDE:\n${fullGuide}\n\nTASK: ${task.instruction}\nSUCCESS CRITERIA: ${task.successCriteria}\n\nProduce a concise action plan:`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return text.trim();
}
