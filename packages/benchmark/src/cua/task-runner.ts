/**
 * Core CUA task execution loop.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessageParam,
  BetaContentBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Browser } from "playwright";
import type { SiteDocumentation } from "@webmap/core";

import type { BenchmarkTask, TaskResult, DocMethod } from "../types.js";
import { formatMicroGuide } from "../formatters/micro-guide.js";
import { formatFullGuide } from "../formatters/full-guide.js";
import { formatFirstMessageDocs } from "../formatters/first-message.js";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT, MAX_STEPS } from "./constants.js";
import { captureScreenshot, getA11ySnapshot } from "./screenshot.js";
import { executeComputerAction } from "./actions.js";
import { A11Y_BROWSER_TOOL, executeA11yAction } from "./a11y-actions.js";
import { verifyTaskSuccess } from "./verification.js";

export interface RunTaskOptions {
  /** Enable automated success verification via independent LLM judge */
  verify?: boolean;
}

export async function runTask(
  client: Anthropic,
  browser: Browser,
  task: BenchmarkTask,
  documentation?: SiteDocumentation,
  method: DocMethod = "none",
  prePlan?: string,
  options?: RunTaskOptions
): Promise<TaskResult> {
  const startTime = Date.now();
  const actions: string[] = [];
  let tokensUsed = 0;
  let success = false;
  let error: string | undefined;

  const isA11yOnly = method === "a11y-tree";
  const isHybrid = method === "hybrid";
  const useA11y = isA11yOnly || isHybrid;

  const context = await browser.newContext({
    viewport: { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
  });
  const page = await context.newPage();

  try {
    await page.goto(task.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const baseInstructions = `When you have completed the task, respond with a text message containing "TASK_COMPLETE" and a brief summary.
If you cannot complete the task, respond with "TASK_FAILED" and the reason.`;

    // Build system prompt based on method
    let systemPrompt: string;
    if (isA11yOnly) {
      systemPrompt = `You are a browser automation agent completing tasks on websites.
You receive the page's accessibility tree (text representation of all elements). Use element roles and names to identify targets for your actions.

${baseInstructions}`;
    } else {
      systemPrompt = `You are a browser automation agent completing tasks on websites.
Analyze the screenshots to understand the page and interact with elements to complete the given task.

`;
      if (method === "micro-guide" && documentation) {
        systemPrompt += formatMicroGuide(documentation) + "\n\n";
      } else if (method === "full-guide" && documentation) {
        systemPrompt += formatFullGuide(documentation) + "\n\n";
      } else if (method === "pre-plan" && prePlan) {
        systemPrompt += `PLAN:\n${prePlan}\n\n`;
      }

      systemPrompt += baseInstructions;
    }

    // Build initial message content
    let taskText = `Task: ${task.instruction}\nSuccess criteria: ${task.successCriteria}`;

    if (method === "first-message" && documentation) {
      const docText = formatFirstMessageDocs(documentation);
      taskText = `${docText}\n\n${taskText}`;
    }

    const initialContent: BetaContentBlockParam[] = [];

    if (isA11yOnly) {
      // A11y-tree mode: text only, no screenshots
      const a11yTree = await getA11ySnapshot(page);
      taskText += "\n\nCurrent page accessibility tree:\n" + a11yTree;
      initialContent.push({ type: "text", text: taskText });
    } else {
      // Vision or hybrid mode
      const initialScreenshot = await captureScreenshot(page);
      if (isHybrid) {
        const a11yTree = await getA11ySnapshot(page);
        taskText += "\n\nAccessibility tree:\n" + a11yTree + "\n\nBrowser screenshot:";
      } else {
        taskText += "\n\nHere is the current browser screenshot:";
      }
      initialContent.push(
        { type: "text", text: taskText },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: initialScreenshot } },
      );
    }

    const messages: BetaMessageParam[] = [
      { role: "user", content: initialContent },
    ];

    // Choose model and tools based on mode
    const model = isA11yOnly ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-20250514";

    for (let step = 0; step < MAX_STEPS; step++) {
      // Build request differently for a11y vs vision modes
      const response = isA11yOnly
        ? await client.messages.create({
            model,
            max_tokens: 4096,
            temperature: 0.3,
            system: systemPrompt,
            tools: [A11Y_BROWSER_TOOL],
            messages: messages as Parameters<typeof client.messages.create>[0]["messages"],
          })
        : await client.beta.messages.create({
            model,
            max_tokens: 4096,
            temperature: 0.3,
            system: systemPrompt,
            tools: [
              {
                type: "computer_20250124",
                name: "computer",
                display_width_px: DISPLAY_WIDTH,
                display_height_px: DISPLAY_HEIGHT,
              },
            ],
            messages,
            betas: ["computer-use-2025-01-24"],
          });

      tokensUsed +=
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0);

      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter(
        (
          b
        ): b is {
          type: "tool_use";
          id: string;
          name: string;
          input: unknown;
        } => b.type === "tool_use"
      );

      // If no tool calls or end_turn → check for completion
      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        const textBlocks = response.content.filter((b) => b.type === "text");
        const fullText = textBlocks
          .map((b) => (b as unknown as { text: string }).text)
          .join(" ");

        if (fullText.includes("TASK_COMPLETE")) {
          success = true;
          actions.push(`Step ${step + 1}: TASK_COMPLETE`);
        } else if (fullText.includes("TASK_FAILED")) {
          error = fullText;
          actions.push(`Step ${step + 1}: TASK_FAILED`);
        } else {
          actions.push(
            `Step ${step + 1}: Agent stopped without explicit completion signal`
          );
        }
        break;
      }

      // Execute each tool call and return results
      const toolResults: BetaContentBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const input = toolUse.input as Record<string, unknown>;

        // Format action string for logging
        const actionStr = isA11yOnly
          ? `${input.action}${input.role ? ` [${input.role}]` : ""}${input.name ? ` "${input.name}"` : ""}${input.text ? ` text="${input.text}"` : ""}`
          : `${input.action}${Array.isArray(input.coordinate) ? ` (${input.coordinate[0]},${input.coordinate[1]})` : ""}${typeof input.text === "string" ? ` "${input.text}"` : ""}`;
        actions.push(`Step ${step + 1}: ${actionStr}`);

        try {
          if (isA11yOnly) {
            await executeA11yAction(page, input);
          } else {
            await executeComputerAction(page, input);
          }
          await page.waitForTimeout(500);

          if (isA11yOnly) {
            // A11y-tree mode: return text snapshot
            const a11yTree = await getA11ySnapshot(page);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Page accessibility tree after action:\n${a11yTree}`,
            });
          } else if (isHybrid) {
            // Hybrid: return both a11y tree and screenshot
            const screenshot = await captureScreenshot(page);
            const a11yTree = await getA11ySnapshot(page);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: [
                { type: "text", text: `Accessibility tree:\n${a11yTree}` },
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshot } },
              ],
            });
          } else {
            // Standard vision mode
            const screenshot = await captureScreenshot(page);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: [
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshot } },
              ],
            });
          }
        } catch (actionError) {
          const errMsg =
            actionError instanceof Error
              ? actionError.message
              : String(actionError);
          actions.push(`  → Error: ${errMsg}`);

          if (isA11yOnly) {
            const a11yTree = await getA11ySnapshot(page).catch(() => "(unavailable)");
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Action failed: ${errMsg}\n\nPage accessibility tree:\n${a11yTree}`,
              is_error: true,
            });
          } else {
            let screenshot = "";
            try { screenshot = await captureScreenshot(page); } catch { /* ignore */ }

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: screenshot
                ? [
                    { type: "text", text: `Action failed: ${errMsg}` },
                    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshot } },
                  ]
                : `Action failed: ${errMsg}`,
              is_error: true,
            });
          }
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Record CUA-only metrics before verification
  const cuaDurationMs = Date.now() - startTime;

  // ─── Automated Verification ──────────────────────────────────────
  let verified: boolean | undefined;
  let selfReportedSuccess: boolean | undefined;
  let verificationReason: string | undefined;
  let verificationTokensUsed: number | undefined;
  let verificationDurationMs: number | undefined;

  if (options?.verify) {
    selfReportedSuccess = success;
    const verifyStart = Date.now();
    try {
      const verification = await verifyTaskSuccess(client, page, task, success);
      verified = true;
      verificationReason = verification.reason;
      verificationTokensUsed = verification.tokensUsed;
      verificationDurationMs = Date.now() - verifyStart;

      if (verification.confidence >= 0.6 && verification.success !== success) {
        success = verification.success;
        console.log(
          `    [verify] Override: agent said ${selfReportedSuccess ? "PASS" : "FAIL"}, ` +
          `verifier says ${success ? "PASS" : "FAIL"} (${(verification.confidence * 100).toFixed(0)}% confidence): ${verification.reason}`
        );
      } else if (verification.confidence < 0.6) {
        verificationReason = `Low confidence (${(verification.confidence * 100).toFixed(0)}%): ${verification.reason}`;
        console.log(`    [verify] Low confidence — keeping self-report: ${verificationReason}`);
      }
    } catch (e) {
      verificationReason = `Verification failed: ${e instanceof Error ? e.message : String(e)}`;
      verificationDurationMs = Date.now() - verifyStart;
    }
  }

  // Close browser context
  await context.close();

  return {
    taskId: task.id,
    success,
    steps: actions.length,
    tokensUsed,
    durationMs: cuaDurationMs,
    error,
    actions,
    verified,
    selfReportedSuccess,
    verificationReason,
    verificationTokensUsed,
    verificationDurationMs,
  };
}
