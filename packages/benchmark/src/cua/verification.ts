/**
 * Automated success verification via independent LLM judgment.
 *
 * After the CUA agent finishes a task, this module takes a final screenshot
 * of the browser state and asks a separate Claude instance to judge whether
 * the success criteria were actually met — independent of the agent's
 * self-report.
 *
 * This eliminates the "agent says it succeeded but actually didn't" problem,
 * which is the #1 reliability gap in CUA benchmarks.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";

import type { BenchmarkTask } from "../types.js";
import { captureScreenshot, getA11ySnapshot } from "./screenshot.js";

export interface VerificationResult {
  /** Independent judgment: did the task succeed? */
  success: boolean;
  /** Confidence 0-1 in the judgment */
  confidence: number;
  /** Explanation of why the verifier judged pass or fail */
  reason: string;
  /** Total tokens used (input + output) */
  tokensUsed: number;
  /** Input tokens (for accurate cost computation) */
  inputTokens: number;
  /** Output tokens (for accurate cost computation) */
  outputTokens: number;
}

/**
 * Verify whether a CUA task was actually completed successfully.
 *
 * Takes a screenshot + accessibility snapshot of the current browser state,
 * then asks Claude to independently judge whether the success criteria are met.
 */
export async function verifyTaskSuccess(
  client: Anthropic,
  page: Page,
  task: BenchmarkTask,
  selfReportedSuccess: boolean
): Promise<VerificationResult> {
  // Capture final state
  let screenshot: string;
  let a11yTree: string;
  try {
    screenshot = await captureScreenshot(page);
    a11yTree = await getA11ySnapshot(page);
  } catch {
    // Can't capture state — can't verify
    return {
      success: selfReportedSuccess,
      confidence: 0,
      reason: "Could not capture browser state for verification",
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const prompt = `You are an independent judge evaluating whether a browser automation task was completed successfully.

## Task
**Instruction:** ${task.instruction}
**Success Criteria:** ${task.successCriteria}
**Target URL:** ${task.url}

## Agent's Self-Report
The agent reported: ${selfReportedSuccess ? "TASK_COMPLETE (success)" : "TASK_FAILED (failure)"}

## Current Browser State
The screenshot below shows the current state of the browser after the agent finished.

**Accessibility tree of the current page:**
${a11yTree.slice(0, 3000)}

## Your Task
Look at the screenshot and accessibility tree. Based ONLY on the observable browser state (not the agent's self-report), determine whether the success criteria have been met.

Respond with EXACTLY this JSON format:
{
  "success": true or false,
  "confidence": 0.0 to 1.0,
  "reason": "Brief explanation of your judgment"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: screenshot },
            },
          ],
        },
      ],
    });

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const tokensUsed = inputTokens + outputTokens;

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: selfReportedSuccess,
        confidence: 0,
        reason: "Verification response did not contain valid JSON",
        tokensUsed,
        inputTokens,
        outputTokens,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      success?: boolean;
      confidence?: number;
      reason?: string;
    };

    return {
      success: typeof parsed.success === "boolean" ? parsed.success : selfReportedSuccess,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      reason: parsed.reason || "No reason provided",
      tokensUsed,
      inputTokens,
      outputTokens,
    };
  } catch (e) {
    return {
      success: selfReportedSuccess,
      confidence: 0,
      reason: `Verification API call failed: ${e instanceof Error ? e.message : String(e)}`,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}
