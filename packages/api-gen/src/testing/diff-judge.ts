/**
 * Compare expected vs actual results after executing a SiteAction.
 * Fast path: check URL change and a11y element presence.
 * Slow path: LLM judge when fast path is inconclusive.
 */

import Anthropic from "@anthropic-ai/sdk";
import { callLLMWithValidation } from "@webmap/core";
import { z } from "zod";
import type { ExpectedResult } from "../types.js";

const JudgeResultSchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

/**
 * Judge whether an action's execution matched its expected result.
 */
export async function judgeActionResult(
  expected: ExpectedResult,
  actual: {
    beforeSnapshot: string;
    afterSnapshot: string;
    beforeUrl: string;
    afterUrl: string;
    error?: string;
  },
  apiKey?: string
): Promise<{ passed: boolean; reason: string; usedLLM: boolean }> {
  // If there was an execution error, it's a failure
  if (actual.error) {
    return { passed: false, reason: `Execution error: ${actual.error}`, usedLLM: false };
  }

  // Fast path checks
  const fastResult = fastJudge(expected, actual);
  if (fastResult !== null) {
    return { ...fastResult, usedLLM: false };
  }

  // Slow path: LLM judge
  if (apiKey) {
    try {
      const llmResult = await llmJudge(expected, actual, apiKey);
      return { ...llmResult, usedLLM: true };
    } catch {
      // LLM failed — be optimistic
      return { passed: true, reason: "Fast path inconclusive, LLM judge unavailable", usedLLM: false };
    }
  }

  // No API key and fast path inconclusive — be optimistic
  return { passed: true, reason: "No verification available", usedLLM: false };
}

/**
 * Fast path: check URL changes and a11y element presence/absence.
 * Returns null if inconclusive.
 */
function fastJudge(
  expected: ExpectedResult,
  actual: { beforeSnapshot: string; afterSnapshot: string; beforeUrl: string; afterUrl: string }
): { passed: boolean; reason: string } | null {
  // Check URL change
  if (expected.urlChange) {
    const pattern = expected.urlChange.replace(/\$\{[^}]+\}/g, "[^/]+");
    const regex = new RegExp(pattern);
    if (!regex.test(actual.afterUrl) && actual.beforeUrl === actual.afterUrl) {
      return { passed: false, reason: `Expected URL change matching "${expected.urlChange}" but URL unchanged` };
    }
    if (regex.test(actual.afterUrl)) {
      return { passed: true, reason: `URL changed to match pattern "${expected.urlChange}"` };
    }
  }

  // Check a11y element appearance
  if (expected.a11yDiff?.shouldAppear && expected.a11yDiff.shouldAppear.length > 0) {
    const found = expected.a11yDiff.shouldAppear.filter(name =>
      actual.afterSnapshot.includes(name)
    );
    const missing = expected.a11yDiff.shouldAppear.filter(name =>
      !actual.afterSnapshot.includes(name)
    );

    if (missing.length === 0) {
      return { passed: true, reason: `All expected elements appeared: ${found.join(", ")}` };
    }
    if (found.length === 0) {
      return { passed: false, reason: `Expected elements not found: ${missing.join(", ")}` };
    }
    // Partial match — inconclusive
  }

  // Check a11y element disappearance
  if (expected.a11yDiff?.shouldDisappear && expected.a11yDiff.shouldDisappear.length > 0) {
    const stillPresent = expected.a11yDiff.shouldDisappear.filter(name =>
      actual.afterSnapshot.includes(name)
    );
    if (stillPresent.length > 0) {
      return { passed: false, reason: `Elements should have disappeared: ${stillPresent.join(", ")}` };
    }
    return { passed: true, reason: "Expected elements disappeared" };
  }

  // Check if something actually changed
  if (actual.beforeSnapshot !== actual.afterSnapshot || actual.beforeUrl !== actual.afterUrl) {
    // Something changed, but we can't verify what — inconclusive
    return null;
  }

  // Nothing changed at all — probably a failure (action had no effect)
  if (actual.beforeSnapshot === actual.afterSnapshot && actual.beforeUrl === actual.afterUrl) {
    return null; // Inconclusive — some actions (like toggle) might not show visible changes
  }

  return null;
}

/**
 * Slow path: use LLM to judge whether the action succeeded.
 */
async function llmJudge(
  expected: ExpectedResult,
  actual: { beforeSnapshot: string; afterSnapshot: string; beforeUrl: string; afterUrl: string },
  apiKey: string
): Promise<{ passed: boolean; reason: string }> {
  const client = new Anthropic({ apiKey });
  const beforeTruncated = actual.beforeSnapshot.slice(0, 3000);
  const afterTruncated = actual.afterSnapshot.slice(0, 3000);

  const prompt = `A browser automation action was executed. Judge whether it succeeded.

Expected Result: ${expected.description}
${expected.urlChange ? `Expected URL Change: ${expected.urlChange}` : ""}

Before URL: ${actual.beforeUrl}
After URL: ${actual.afterUrl}

Before State (a11y tree):
${beforeTruncated}

After State (a11y tree):
${afterTruncated}

Did the action achieve its expected result? Return JSON with {passed: boolean, reason: string, confidence: number}.`;

  const result = await callLLMWithValidation({
    client,
    model: "claude-haiku-4-5-20251001",
    system: "You are judging whether a browser automation action succeeded. Be strict but fair.",
    prompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: JudgeResultSchema as any,
    maxTokens: 300,
  });

  const data = result.data as { passed: boolean; reason: string; confidence: number } | null;
  if (data) {
    return { passed: data.passed, reason: data.reason };
  }

  return { passed: true, reason: "LLM judge returned no data — assuming pass" };
}
