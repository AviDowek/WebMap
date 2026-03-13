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

// Programmatic mode imports (lazy — only used when method === "programmatic")
import type { DomainAPI } from "@webmap/api-gen";
import { buildToolsForStep, handleDiscoverActions, executeSiteAction } from "@webmap/api-gen";
import type { FailureTracker, FallbackCapture } from "@webmap/api-gen";

// ─── Model pricing (USD per token) ──────────────────────────────────
// Cache reads cost 10% of normal input; cache writes cost 125% of normal input.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 },
  "claude-sonnet-4-20250514":  { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};

function computeStepCost(
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined,
  model: string
): { cost: number; cacheRead: number; cacheCreation: number } {
  if (!usage) return { cost: 0, cacheRead: 0, cacheCreation: 0 };
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-20250514"];
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const cost =
    inputTokens * pricing.input +
    outputTokens * pricing.output +
    cacheRead * pricing.input * 0.1 +
    cacheCreation * pricing.input * 1.25;
  return { cost, cacheRead, cacheCreation };
}

// ─── A11y tree size limit ─────────────────────────────────────────────
// Large a11y snapshots can spike tokens significantly on complex pages.
// 8000 chars ≈ ~2000 tokens — enough to cover typical page structure.
const A11Y_MAX_CHARS = 8_000;

function truncateA11y(tree: string): string {
  if (tree.length <= A11Y_MAX_CHARS) return tree;
  return tree.slice(0, A11Y_MAX_CHARS) + "\n... [truncated — tree exceeds size limit]";
}

// ─── Rate-limit retry helper ──────────────────────────────────────────
// Anthropic returns 429 (rate limit) or 529 (overloaded). Retry with
// exponential backoff up to 3 times before propagating the error.
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_RETRIES = 3;
  let delay = 10_000; // start at 10s
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      const isRetryable = status === 429 || status === 529;
      if (!isRetryable || attempt === MAX_RETRIES) throw e;
      console.warn(`  [rate-limit] HTTP ${status} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2; // 10s → 20s → 40s
    }
  }
  throw new Error("unreachable");
}

// ─── System prompt builder (as cacheable array block) ────────────────
function buildSystemBlock(text: string): Parameters<typeof Anthropic.prototype.messages.create>[0]["system"] {
  return [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];
}

export interface RunTaskOptions {
  /** Enable automated success verification via independent LLM judge */
  verify?: boolean;
  /** DomainAPI for programmatic method */
  siteApi?: DomainAPI;
  /** Failure tracker for programmatic method learning loop */
  failureTracker?: FailureTracker;
  /** Fallback capture for programmatic method learning loop */
  fallbackCapture?: FallbackCapture;
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
  let estimatedCostUsd = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let success = false;
  let error: string | undefined;

  const isA11yOnly = method === "a11y-tree" || method === "a11y-first-message";
  const isHybrid = method === "hybrid";
  const isHaikuVision = method === "haiku-vision";
  const isCascade = method === "cascade";
  const isProgrammatic = method === "programmatic";
  const useA11y = isA11yOnly || isHybrid;

  const context = await browser.newContext({
    viewport: { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
  });
  const page = await context.newPage();

  // Programmatic mode tracking
  let apiCallCount = 0;
  let visionFallbackCount = 0;
  const siteApiFunctionsCalled: string[] = [];

  // Mutable model for cascade support
  let currentModel: string;
  if (isA11yOnly || isHaikuVision || isCascade || isProgrammatic) {
    currentModel = "claude-haiku-4-5-20251001";
  } else {
    currentModel = "claude-sonnet-4-20250514";
  }

  // Cascade state
  const recentUrls: string[] = [];
  let cascadeEscalations = 0;

  try {
    await page.goto(task.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const baseInstructions = `When you have completed the task, respond with a text message containing "TASK_COMPLETE" and a brief summary.
If you cannot complete the task, respond with "TASK_FAILED" and the reason.`;

    // ─── Programmatic mode: entirely different execution path ─────
    if (isProgrammatic && options?.siteApi) {
      const programmaticResult = await runProgrammaticTask(
        client, page, task, options.siteApi, baseInstructions,
        actions, options.failureTracker, options.fallbackCapture, options.verify
      );
      await context.close();
      return {
        ...programmaticResult,
        taskId: task.id,
        estimatedCostUsd: programmaticResult.estimatedCostUsd,
        apiCallCount: programmaticResult.apiCallCount,
        visionFallbackCount: programmaticResult.visionFallbackCount,
        siteApiFunctionsCalled: programmaticResult.siteApiFunctionsCalled,
        siteApiFallbacks: programmaticResult.visionFallbackCount,
      };
    }

    // Build system prompt based on method
    let systemPromptText: string;
    if (isA11yOnly) {
      systemPromptText = `You are a browser automation agent completing tasks on websites.
You receive the page's accessibility tree (text representation of all elements). Use element roles and names to identify targets for your actions.

${baseInstructions}`;
    } else {
      systemPromptText = `You are a browser automation agent completing tasks on websites.
Analyze the screenshots to understand the page and interact with elements to complete the given task.

`;
      if (method === "micro-guide" && documentation) {
        systemPromptText += formatMicroGuide(documentation) + "\n\n";
      } else if (method === "full-guide" && documentation) {
        systemPromptText += formatFullGuide(documentation) + "\n\n";
      } else if (method === "pre-plan" && prePlan) {
        systemPromptText += `PLAN:\n${prePlan}\n\n`;
      }

      systemPromptText += baseInstructions;
    }

    // Wrap in cacheable array block so repeat calls hit the cache
    const systemBlock = buildSystemBlock(systemPromptText);

    // Build initial message content
    let taskText = `Task: ${task.instruction}\nSuccess criteria: ${task.successCriteria}`;

    // First-message doc injection (works for both first-message and a11y-first-message)
    if ((method === "first-message" || method === "a11y-first-message") && documentation) {
      const docText = formatFirstMessageDocs(documentation);
      taskText = `${docText}\n\n${taskText}`;
    }

    const initialContent: BetaContentBlockParam[] = [];

    if (isA11yOnly) {
      // A11y-tree mode: text only, no screenshots
      const a11yTree = truncateA11y(await getA11ySnapshot(page));
      taskText += "\n\nCurrent page accessibility tree:\n" + a11yTree;
      initialContent.push({ type: "text", text: taskText });
    } else {
      // Vision or hybrid mode
      const initialScreenshot = await captureScreenshot(page);
      if (isHybrid) {
        const a11yTree = truncateA11y(await getA11ySnapshot(page));
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

    for (let step = 0; step < MAX_STEPS; step++) {
      // Build request differently for a11y vs vision modes; retry on 429/529
      const response = await withRateLimitRetry(() =>
        isA11yOnly
          ? client.messages.create({
              model: currentModel,
              max_tokens: 4096,
              temperature: 0.3,
              system: systemBlock as Parameters<typeof client.messages.create>[0]["system"],
              tools: [A11Y_BROWSER_TOOL],
              messages: messages as Parameters<typeof client.messages.create>[0]["messages"],
            })
          : client.beta.messages.create({
              model: currentModel,
              max_tokens: 4096,
              temperature: 0.3,
              system: systemBlock as Parameters<typeof client.beta.messages.create>[0]["system"],
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
            })
      );

      // Accumulate tokens
      tokensUsed +=
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0) +
        (response.usage?.cache_read_input_tokens || 0) +
        (response.usage?.cache_creation_input_tokens || 0);

      // Compute USD cost for this step using current model's pricing
      const stepCost = computeStepCost(response.usage as Parameters<typeof computeStepCost>[0], currentModel);
      estimatedCostUsd += stepCost.cost;
      cacheReadTokens += stepCost.cacheRead;
      cacheCreationTokens += stepCost.cacheCreation;

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
            const a11yTree = truncateA11y(await getA11ySnapshot(page));
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Page accessibility tree after action:\n${a11yTree}`,
            });
          } else if (isHybrid) {
            // Hybrid: return both a11y tree and screenshot
            const screenshot = await captureScreenshot(page);
            const a11yTree = truncateA11y(await getA11ySnapshot(page));
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: [
                { type: "text", text: `Accessibility tree:\n${a11yTree}` },
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshot } },
              ],
            });
          } else {
            // Standard vision mode (Sonnet or Haiku)
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
            const rawTree = await getA11ySnapshot(page).catch(() => "(unavailable)");
            const a11yTree = typeof rawTree === "string" ? truncateA11y(rawTree) : rawTree;
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

      // ─── Cascade stuck detection ─────────────────────────────────
      if (isCascade && currentModel !== "claude-sonnet-4-20250514") {
        const currentUrl = page.url();
        recentUrls.push(currentUrl);
        if (recentUrls.length > 3) recentUrls.shift();

        const urlStuck = recentUrls.length === 3 && new Set(recentUrls).size === 1;
        const errorCount = actions.filter(a => a.includes("→ Error:")).length;

        if (urlStuck || errorCount >= 2) {
          currentModel = "claude-sonnet-4-20250514";
          cascadeEscalations++;
          console.log(`  [cascade] Escalating to Sonnet at step ${step + 1} (urlStuck=${urlStuck}, errors=${errorCount})`);
        }
      }
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
  let verificationCostUsd: number | undefined;

  if (options?.verify) {
    selfReportedSuccess = success;
    const verifyStart = Date.now();
    try {
      const verification = await verifyTaskSuccess(client, page, task, success);
      verified = true;
      verificationReason = verification.reason;
      verificationTokensUsed = verification.tokensUsed;
      verificationDurationMs = Date.now() - verifyStart;

      // Verification always uses Sonnet — use actual input/output split for accuracy
      const sonnetPricing = MODEL_PRICING["claude-sonnet-4-20250514"];
      verificationCostUsd =
        verification.inputTokens * sonnetPricing.input +
        verification.outputTokens * sonnetPricing.output;

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
    estimatedCostUsd,
    cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
    cacheCreationTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
    verificationCostUsd,
    cascadeEscalations: isCascade ? cascadeEscalations : undefined,
  };
}

// ─── Programmatic mode execution ───────────────────────────────────

interface ProgrammaticResult {
  success: boolean;
  steps: number;
  tokensUsed: number;
  durationMs: number;
  error?: string;
  actions: string[];
  estimatedCostUsd: number;
  apiCallCount: number;
  visionFallbackCount: number;
  siteApiFunctionsCalled: string[];
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  verified?: boolean;
  selfReportedSuccess?: boolean;
  verificationReason?: string;
  verificationTokensUsed?: number;
  verificationDurationMs?: number;
  verificationCostUsd?: number;
}

async function runProgrammaticTask(
  client: Anthropic,
  page: import("playwright").Page,
  task: BenchmarkTask,
  domainApi: DomainAPI,
  baseInstructions: string,
  actions: string[],
  failureTracker?: FailureTracker,
  fallbackCapture?: FallbackCapture,
  verify?: boolean
): Promise<ProgrammaticResult> {
  const startTime = Date.now();
  let tokensUsed = 0;
  let estimatedCostUsd = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let success = false;
  let error: string | undefined;
  let apiCallCount = 0;
  let visionFallbackCount = 0;
  const siteApiFunctionsCalled: string[] = [];
  // Sonnet for execution — better tool selection and multi-step reasoning
  const currentModel = "claude-sonnet-4-20250514";

  const systemPromptText = `You are a browser automation agent with pre-built functions for this website.

RULES:
1. ALWAYS use the site-specific functions (like search_products, click_add_to_cart, navigate_to_checkout, etc.) — they are reliable and fast.
2. If a function fails, try calling it again with adjusted parameters before considering alternatives.
3. Use discover_actions("keyword") to find functions on other pages — e.g. discover_actions("cart") or discover_actions("login").
4. Only use fallback_browser_action as an absolute last resort after retrying the site function.
5. When you see "TASK_COMPLETE" criteria are met, output TASK_COMPLETE immediately.

The available functions change as you navigate between pages. After each action, you'll get an updated accessibility tree showing the page state.

${baseInstructions}`;

  const systemBlock = buildSystemBlock(systemPromptText);

  // Build initial tools based on current URL
  let { tools, actionMap, systemAddendum } = buildToolsForStep(domainApi, page.url());

  // Initial a11y snapshot
  const a11yTree = truncateA11y(await getA11ySnapshot(page));
  const taskText = `Task: ${task.instruction}\nSuccess criteria: ${task.successCriteria}\n\n${systemAddendum}\n\nCurrent page accessibility tree:\n${a11yTree}`;

  const messages: Parameters<typeof client.messages.create>[0]["messages"] = [
    { role: "user", content: [{ type: "text", text: taskText }] },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await withRateLimitRetry(() =>
      client.messages.create({
        model: currentModel,
        max_tokens: 4096,
        temperature: 0.3,
        system: systemBlock as Parameters<typeof client.messages.create>[0]["system"],
        tools: tools as Parameters<typeof client.messages.create>[0]["tools"],
        messages,
      })
    );

    // Accumulate tokens
    tokensUsed +=
      (response.usage?.input_tokens || 0) +
      (response.usage?.output_tokens || 0) +
      (response.usage?.cache_read_input_tokens || 0) +
      (response.usage?.cache_creation_input_tokens || 0);

    const stepCost = computeStepCost(response.usage as Parameters<typeof computeStepCost>[0], currentModel);
    estimatedCostUsd += stepCost.cost;
    cacheReadTokens += stepCost.cacheRead;
    cacheCreationTokens += stepCost.cacheCreation;

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
        b.type === "tool_use"
    );

    // Check for completion
    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      const textBlocks = response.content.filter((b) => b.type === "text");
      const fullText = textBlocks.map((b) => (b as unknown as { text: string }).text).join(" ");

      if (fullText.includes("TASK_COMPLETE")) {
        success = true;
        actions.push(`Step ${step + 1}: TASK_COMPLETE`);
      } else if (fullText.includes("TASK_FAILED")) {
        error = fullText;
        actions.push(`Step ${step + 1}: TASK_FAILED`);
      } else {
        actions.push(`Step ${step + 1}: Agent stopped without completion signal`);
      }
      break;
    }

    // Execute tool calls
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];

    for (const toolUse of toolUseBlocks) {
      const input = toolUse.input as Record<string, unknown>;

      if (toolUse.name === "discover_actions") {
        // Meta-tool: search for actions
        actions.push(`Step ${step + 1}: discover_actions("${input.query}")`);
        const result = handleDiscoverActions(domainApi, input);
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
        continue;
      }

      if (toolUse.name === "fallback_browser_action") {
        // Fallback to a11y browser action
        visionFallbackCount++;
        const actionStr = `${input.action}${input.role ? ` [${input.role}]` : ""}${input.name ? ` "${input.name}"` : ""}${input.text ? ` text="${input.text}"` : ""}`;
        actions.push(`Step ${step + 1}: [FALLBACK] ${actionStr}`);

        // Track fallback for learning
        fallbackCapture?.recordFallbackStep(input);

        try {
          await executeA11yAction(page, input);
          await page.waitForTimeout(500);
          const snapshot = truncateA11y(await getA11ySnapshot(page));
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Action succeeded.\n\nPage accessibility tree:\n${snapshot}`,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          actions.push(`  → Error: ${errMsg}`);
          const snapshot = await getA11ySnapshot(page).catch(() => "(unavailable)");
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Action failed: ${errMsg}\n\nPage accessibility tree:\n${truncateA11y(snapshot)}`,
            is_error: true,
          });
        }
        continue;
      }

      // Site API function call
      const action = actionMap.get(toolUse.name);
      if (action) {
        apiCallCount++;
        siteApiFunctionsCalled.push(toolUse.name);
        actions.push(`Step ${step + 1}: [API] ${toolUse.name}(${JSON.stringify(input).slice(0, 100)})`);

        // Flush any pending fallback capture (new API call = end of fallback sequence)
        fallbackCapture?.flushPending();

        try {
          const result = await executeSiteAction(page, action, input);
          await page.waitForTimeout(500);

          if (result.success) {
            failureTracker?.recordSuccess(action.id);
            const snapshot = truncateA11y(result.resultSnapshot);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Function executed successfully.\n\nPage accessibility tree:\n${snapshot}`,
            });
          } else {
            // API function failed — mark failure and prepare for fallback
            failureTracker?.recordFailure({
              actionId: action.id,
              actionName: action.name,
              error: result.error || "Unknown error",
              timestamp: new Date().toISOString(),
              pageUrl: page.url(),
            });
            fallbackCapture?.markFailure(action.id, action.name, result.error || "Unknown error", page.url());

            const snapshot = truncateA11y(result.resultSnapshot);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Function "${toolUse.name}" failed: ${result.error}\n\nRetry with different parameters, or try discover_actions to find an alternative function.\n\nPage accessibility tree:\n${snapshot}`,
              is_error: true,
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          actions.push(`  → Error: ${errMsg}`);
          failureTracker?.recordFailure({
            actionId: action.id,
            actionName: action.name,
            error: errMsg,
            timestamp: new Date().toISOString(),
            pageUrl: page.url(),
          });
          fallbackCapture?.markFailure(action.id, action.name, errMsg, page.url());

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Function "${toolUse.name}" error: ${errMsg}\n\nRetry with different parameters, or use discover_actions to find an alternative.`,
            is_error: true,
          });
        }
      } else {
        // Unknown tool name
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Unknown function "${toolUse.name}". Use discover_actions to find available functions.`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });

    // Rebuild tools if URL changed (page navigation)
    const newToolSet = buildToolsForStep(domainApi, page.url());
    tools = newToolSet.tools;
    actionMap = newToolSet.actionMap;
  }

  // Flush any pending fallback capture
  fallbackCapture?.flushPending();

  const cuaDurationMs = Date.now() - startTime;

  // Verification (same as non-programmatic)
  let verified: boolean | undefined;
  let selfReportedSuccess: boolean | undefined;
  let verificationReason: string | undefined;
  let verificationTokensUsed: number | undefined;
  let verificationDurationMs: number | undefined;
  let verificationCostUsd: number | undefined;

  if (verify) {
    selfReportedSuccess = success;
    const verifyStart = Date.now();
    try {
      const verification = await verifyTaskSuccess(client, page, task, success);
      verified = true;
      verificationReason = verification.reason;
      verificationTokensUsed = verification.tokensUsed;
      verificationDurationMs = Date.now() - verifyStart;

      const sonnetPricing = MODEL_PRICING["claude-sonnet-4-20250514"];
      verificationCostUsd =
        verification.inputTokens * sonnetPricing.input +
        verification.outputTokens * sonnetPricing.output;

      if (verification.confidence >= 0.6 && verification.success !== success) {
        success = verification.success;
      }
    } catch (e) {
      verificationReason = `Verification failed: ${e instanceof Error ? e.message : String(e)}`;
      verificationDurationMs = Date.now() - verifyStart;
    }
  }

  return {
    success,
    steps: actions.length,
    tokensUsed,
    durationMs: cuaDurationMs,
    error,
    actions,
    estimatedCostUsd,
    apiCallCount,
    visionFallbackCount,
    siteApiFunctionsCalled,
    cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
    cacheCreationTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
    verified,
    selfReportedSuccess,
    verificationReason,
    verificationTokensUsed,
    verificationDurationMs,
    verificationCostUsd,
  };
}
