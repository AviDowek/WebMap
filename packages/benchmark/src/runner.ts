/**
 * WebMap Benchmark Runner — A/B test agent performance with and without docs.
 *
 * Uses Claude's Computer Use Agent (CUA) with real screenshots to drive
 * a Playwright browser. Tests whether WebMap documentation measurably
 * improves AI agent task success rates, reduces token usage, and
 * increases consistency.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessageParam,
  BetaContentBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { chromium, type Browser, type Page } from "playwright";
import type { SiteDocumentation } from "@webmap/core";

// ─── Types ───────────────────────────────────────────────────────────

export interface BenchmarkTask {
  /** Unique task ID */
  id: string;
  /** Target website URL */
  url: string;
  /** Task description in natural language */
  instruction: string;
  /** Expected outcome / success criteria */
  successCriteria: string;
  /** Category (navigation, form-fill, search, purchase, etc.) */
  category: string;
  /** Source: 'sample' | 'manual' | 'ai-generated' */
  source?: string;
}

export interface TaskResult {
  taskId: string;
  /** Whether the task was completed successfully */
  success: boolean;
  /** Number of steps/actions taken */
  steps: number;
  /** Total tokens consumed */
  tokensUsed: number;
  /** Time taken in ms */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Action log */
  actions: string[];
}

export interface BenchmarkResult {
  /** When the benchmark was run */
  timestamp: string;
  /** Results without documentation */
  baseline: TaskResult[];
  /** Results with documentation */
  withDocs: TaskResult[];
  /** Aggregate comparison */
  summary: {
    baseline: AggregateMetrics;
    withDocs: AggregateMetrics;
    improvement: {
      successRateDelta: number; // percentage points
      tokenReduction: number; // percentage
      speedup: number; // ratio
    };
  };
}

export interface AggregateMetrics {
  totalTasks: number;
  successRate: number;
  avgTokensPerTask: number;
  avgDurationMs: number;
  avgSteps: number;
}

// ─── Multi-Method Types ─────────────────────────────────────────────

/** Doc injection methods to compare in benchmarks */
export type DocMethod =
  | "none"           // Baseline — no documentation
  | "micro-guide"    // ~100 token guide in system prompt
  | "full-guide"     // ~400 token guide with layout/nav/sitemap in system prompt
  | "first-message"  // Docs injected in first user message (doesn't compound)
  | "pre-plan"       // Use docs to generate task-specific plan before CUA starts
  | "a11y-tree"      // Text-based: accessibility tree instead of screenshots
  | "hybrid";        // Both: accessibility tree + screenshots

export const ALL_DOC_METHODS: DocMethod[] = [
  "none",
  "micro-guide",
  "full-guide",
  "first-message",
  "pre-plan",
  "a11y-tree",
  "hybrid",
];

export const DOC_METHOD_LABELS: Record<DocMethod, string> = {
  "none": "Baseline (no docs)",
  "micro-guide": "Micro Guide (~100 tokens, system prompt)",
  "full-guide": "Full Guide (~400 tokens, system prompt)",
  "first-message": "First Message Injection (no compounding)",
  "pre-plan": "Pre-Plan (task-specific plan from docs)",
  "a11y-tree": "A11y Tree (text-only, no screenshots)",
  "hybrid": "Hybrid (a11y tree + screenshots)",
};

export interface MethodResult {
  method: DocMethod;
  tasks: TaskResult[];
  metrics: AggregateMetrics;
}

export interface SiteResult {
  domain: string;
  url: string;
  methods: MethodResult[];
}

export interface MultiMethodBenchmarkResult {
  timestamp: string;
  sites: SiteResult[];
  /** Overall metrics per method across all sites */
  overall: MethodResult[];
  /** Which methods were tested */
  methods: DocMethod[];
  /** Total tasks across all sites */
  totalTasks: number;
}

// ─── CUA Constants ───────────────────────────────────────────────────

const DISPLAY_WIDTH = 1024;
const DISPLAY_HEIGHT = 768;
const MAX_STEPS = 25;

// ─── CUA Doc Formatter ──────────────────────────────────────────────

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

// ─── Micro Guide (ultra-compact, ~100 tokens) ───────────────────────

/**
 * Build an ultra-minimal site guide for CUA agents (~100 tokens / ~400 chars).
 * Minimizes system prompt overhead that compounds over 18+ step conversations.
 * Only includes: domain, one-line description, one-line nav hint from homepage.
 */
export function formatMicroGuide(doc: SiteDocumentation): string {
  const lines: string[] = [];

  lines.push(`SITE: ${doc.domain}`);
  if (doc.description) {
    // Truncate description to first sentence
    const firstSentence = doc.description.split(/\.\s/)[0];
    lines.push(firstSentence.endsWith(".") ? firstSentence : firstSentence + ".");
  }

  // One-line nav hint from homepage visual layout
  const homePage = doc.pages.find((p) => {
    try {
      const pathname = new URL(p.url).pathname;
      return pathname === "/" || pathname === "";
    } catch { return false; }
  }) || doc.pages[0];

  if (homePage?.visualLayout && homePage.visualLayout.trim()) {
    // Take just the first sentence of visual layout
    const navHint = homePage.visualLayout.split(/\.\s/)[0];
    lines.push(`NAV: ${navHint.endsWith(".") ? navHint : navHint + "."}`);
  }

  return lines.join("\n").trim();
}

// Keep formatCompactCUAGuide as a re-export of formatMicroGuide for backward compat
export const formatCompactCUAGuide = formatMicroGuide as (
  doc: SiteDocumentation,
  task?: { instruction: string; category: string }
) => string;

// ─── Full Guide (~400 tokens with layout/nav/sitemap) ───────────────

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

// ─── First-Message Doc Formatter ────────────────────────────────────

/**
 * Format docs for injection in the first user message.
 * Since this doesn't compound (only sent once), we can be more generous.
 */
function formatFirstMessageDocs(doc: SiteDocumentation): string {
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

// ─── Pre-Plan Generator ─────────────────────────────────────────────

/**
 * Use Claude to generate a task-specific plan from the documentation
 * before the CUA agent starts. This is a separate, cheap API call.
 */
async function generatePrePlan(
  client: Anthropic,
  task: BenchmarkTask,
  doc: SiteDocumentation
): Promise<string> {
  const fullGuide = formatFullGuide(doc);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: "You are a planning assistant. Given a website guide and a task, produce a concise step-by-step plan (max 5 steps) for a vision-based browser agent to complete the task. Each step should describe what to look for visually and what action to take. Be specific but brief.",
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

// ─── Key mapping ─────────────────────────────────────────────────────

const KEY_MAP: Record<string, string> = {
  Return: "Enter",
  BackSpace: "Backspace",
  space: " ",
  Tab: "Tab",
  Escape: "Escape",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  Page_Up: "PageUp",
  Page_Down: "PageDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Up: "ArrowUp",
  Down: "ArrowDown",
};

function mapCuaKeyToPlaywright(key: string): string {
  // Handle combo keys like "ctrl+a" → "Control+a"
  if (key.includes("+")) {
    return key
      .split("+")
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === "ctrl" || lower === "control") return "Control";
        if (lower === "alt") return "Alt";
        if (lower === "shift") return "Shift";
        if (lower === "meta" || lower === "super" || lower === "cmd")
          return "Meta";
        return KEY_MAP[part] || part;
      })
      .join("+");
  }
  return KEY_MAP[key] || key;
}

// ─── Screenshot & Accessibility ─────────────────────────────────────

async function captureScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality: 85 });
  return buffer.toString("base64");
}

async function getA11ySnapshot(page: Page): Promise<string> {
  try {
    return await page.locator("body").ariaSnapshot();
  } catch {
    return "(accessibility tree unavailable)";
  }
}

// ─── CUA Action Execution ───────────────────────────────────────────

async function executeComputerAction(
  page: Page,
  input: Record<string, unknown>
): Promise<void> {
  const action = input.action as string;

  switch (action) {
    case "mouse_move":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.move(input.coordinate[0], input.coordinate[1]);
      }
      break;

    case "left_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.click(input.coordinate[0], input.coordinate[1]);
      }
      break;

    case "right_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.click(input.coordinate[0], input.coordinate[1], {
          button: "right",
        });
      }
      break;

    case "double_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.dblclick(input.coordinate[0], input.coordinate[1]);
      }
      break;

    case "triple_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.click(input.coordinate[0], input.coordinate[1], {
          clickCount: 3,
        });
      }
      break;

    case "middle_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.click(input.coordinate[0], input.coordinate[1], {
          button: "middle",
        });
      }
      break;

    case "type":
      if (typeof input.text === "string") {
        await page.keyboard.type(input.text);
      }
      break;

    case "key":
      if (typeof input.text === "string") {
        await page.keyboard.press(mapCuaKeyToPlaywright(input.text));
      }
      break;

    case "scroll":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.move(input.coordinate[0], input.coordinate[1]);
      }
      await page.mouse.wheel(
        (input.delta_x as number) || 0,
        (input.delta_y as number) || 0
      );
      break;

    case "left_click_drag":
      if (
        Array.isArray(input.start_coordinate) &&
        Array.isArray(input.coordinate)
      ) {
        await page.mouse.move(
          input.start_coordinate[0],
          input.start_coordinate[1]
        );
        await page.mouse.down();
        await page.mouse.move(input.coordinate[0], input.coordinate[1]);
        await page.mouse.up();
      }
      break;

    case "screenshot":
      // No action — screenshot is taken after every action anyway
      break;

    case "wait":
      await page.waitForTimeout(2000);
      break;

    default:
      break;
  }
}

// ─── A11y-tree tool schema for text-only agent ─────────────────────

const A11Y_BROWSER_TOOL = {
  name: "browser_action",
  description: "Execute a browser action. Use role and name from the accessibility tree to identify elements. For clicks/typing, specify the element's role and name. For scrolling, use direction. For key presses, use key.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["click", "type", "scroll", "key", "goto"],
        description: "The action to perform",
      },
      role: {
        type: "string",
        description: "ARIA role of the target element (e.g. 'link', 'button', 'textbox', 'heading')",
      },
      name: {
        type: "string",
        description: "Accessible name of the target element (the text label)",
      },
      text: {
        type: "string",
        description: "Text to type (for 'type' action) or key to press (for 'key' action)",
      },
      direction: {
        type: "string",
        enum: ["up", "down"],
        description: "Scroll direction (for 'scroll' action)",
      },
      url: {
        type: "string",
        description: "URL to navigate to (for 'goto' action)",
      },
    },
    required: ["action"],
  },
};

/**
 * Execute a browser action based on a11y-tree element references.
 * Maps role/name pairs to Playwright locators.
 */
async function executeA11yAction(
  page: Page,
  input: Record<string, unknown>
): Promise<void> {
  const action = input.action as string;
  const role = input.role as string | undefined;
  const name = input.name as string | undefined;
  const text = input.text as string | undefined;

  switch (action) {
    case "click": {
      if (role && name) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0], { name }).first().click({ timeout: 5000 });
      } else if (name) {
        await page.getByText(name, { exact: false }).first().click({ timeout: 5000 });
      }
      break;
    }
    case "type": {
      if (role && name && text) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0], { name }).first().fill(text, { timeout: 5000 });
      } else if (name && text) {
        await page.getByLabel(name).first().fill(text, { timeout: 5000 });
      } else if (text) {
        await page.keyboard.type(text);
      }
      break;
    }
    case "key": {
      if (text) await page.keyboard.press(text);
      break;
    }
    case "scroll": {
      const dir = input.direction as string;
      await page.mouse.wheel(0, dir === "up" ? -500 : 500);
      break;
    }
    case "goto": {
      if (input.url) {
        await page.goto(input.url as string, { waitUntil: "domcontentloaded" });
      }
      break;
    }
  }
}

// ─── Run a single task with Claude CUA ──────────────────────────────

async function runTask(
  client: Anthropic,
  browser: Browser,
  task: BenchmarkTask,
  documentation?: SiteDocumentation,
  method: DocMethod = "none",
  prePlan?: string
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
  } finally {
    await context.close();
  }

  return {
    taskId: task.id,
    success,
    steps: actions.length,
    tokensUsed,
    durationMs: Date.now() - startTime,
    error,
    actions,
  };
}

// ─── Metrics ─────────────────────────────────────────────────────────

export function computeMetrics(results: TaskResult[]): AggregateMetrics {
  const total = results.length;
  const successes = results.filter((r) => r.success).length;
  const totalTokens = results.reduce((s, r) => s + r.tokensUsed, 0);
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  const totalSteps = results.reduce((s, r) => s + r.steps, 0);

  return {
    totalTasks: total,
    successRate: total > 0 ? successes / total : 0,
    avgTokensPerTask: total > 0 ? totalTokens / total : 0,
    avgDurationMs: total > 0 ? totalDuration / total : 0,
    avgSteps: total > 0 ? totalSteps / total : 0,
  };
}

// ─── Run the full A/B benchmark ─────────────────────────────────────

export async function runBenchmark(
  tasks: BenchmarkTask[],
  documentation: Map<string, SiteDocumentation>,
  options?: {
    apiKey?: string;
    onPhaseChange?: (
      phase: "baseline" | "with-docs",
      tasksCompleted: number
    ) => void;
  }
): Promise<BenchmarkResult> {
  const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required for benchmarks");
  }

  const onPhase = options?.onPhaseChange || (() => {});
  const client = new Anthropic({ apiKey });
  const browser = await chromium.launch({ headless: true });

  console.log(`Running CUA benchmark with ${tasks.length} tasks...`);
  console.log("Phase 1: Baseline (no documentation)...");

  const baselineResults: TaskResult[] = [];
  onPhase("baseline", 0);
  for (const task of tasks) {
    console.log(`  [baseline] ${task.id}: ${task.instruction}`);
    const result = await runTask(client, browser, task);
    baselineResults.push(result);
    onPhase("baseline", baselineResults.length);
    console.log(
      `    → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`
    );
  }

  console.log("\nPhase 2: With documentation...");

  const withDocsResults: TaskResult[] = [];
  onPhase("with-docs", 0);
  for (const task of tasks) {
    const domain = new URL(task.url).hostname;
    const docs = documentation.get(domain);
    console.log(
      `  [with-docs] ${task.id}: ${task.instruction}${docs ? " (docs available)" : " (no docs)"}`
    );
    const result = await runTask(client, browser, task, docs);
    withDocsResults.push(result);
    onPhase("with-docs", withDocsResults.length);
    console.log(
      `    → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`
    );
  }

  await browser.close();

  const baselineMetrics = computeMetrics(baselineResults);
  const withDocsMetrics = computeMetrics(withDocsResults);

  return {
    timestamp: new Date().toISOString(),
    baseline: baselineResults,
    withDocs: withDocsResults,
    summary: {
      baseline: baselineMetrics,
      withDocs: withDocsMetrics,
      improvement: {
        successRateDelta:
          withDocsMetrics.successRate - baselineMetrics.successRate,
        tokenReduction:
          baselineMetrics.avgTokensPerTask > 0
            ? (1 -
                withDocsMetrics.avgTokensPerTask /
                  baselineMetrics.avgTokensPerTask) *
              100
            : 0,
        speedup:
          withDocsMetrics.avgDurationMs > 0
            ? baselineMetrics.avgDurationMs / withDocsMetrics.avgDurationMs
            : 0,
      },
    },
  };
}

// ─── Pretty print ────────────────────────────────────────────────────

export function printBenchmarkSummary(result: BenchmarkResult): void {
  const { baseline, withDocs, improvement } = result.summary;

  console.log("\n" + "=".repeat(60));
  console.log("  CUA BENCHMARK RESULTS");
  console.log("=".repeat(60));
  console.log("");
  console.log("                    Baseline    With Docs    Delta");
  console.log("  ─────────────────────────────────────────────────");
  console.log(
    `  Success Rate      ${(baseline.successRate * 100).toFixed(1)}%        ${(withDocs.successRate * 100).toFixed(1)}%         ${improvement.successRateDelta > 0 ? "+" : ""}${(improvement.successRateDelta * 100).toFixed(1)}pp`
  );
  console.log(
    `  Avg Tokens        ${baseline.avgTokensPerTask.toFixed(0)}        ${withDocs.avgTokensPerTask.toFixed(0)}         ${improvement.tokenReduction > 0 ? "-" : "+"}${Math.abs(improvement.tokenReduction).toFixed(1)}%`
  );
  console.log(
    `  Avg Duration      ${(baseline.avgDurationMs / 1000).toFixed(1)}s        ${(withDocs.avgDurationMs / 1000).toFixed(1)}s         ${improvement.speedup.toFixed(2)}x`
  );
  console.log(
    `  Avg Steps         ${baseline.avgSteps.toFixed(1)}          ${withDocs.avgSteps.toFixed(1)}          ${(withDocs.avgSteps - baseline.avgSteps).toFixed(1)}`
  );
  console.log("=".repeat(60));
}

// ─── Multi-Method Benchmark Runner ──────────────────────────────────

export interface MultiMethodBenchmarkOptions {
  apiKey?: string;
  methods?: DocMethod[];
  onProgress?: (update: {
    phase: string;
    site?: string;
    method?: DocMethod;
    tasksCompleted: number;
    tasksTotal: number;
  }) => void;
}

/**
 * Run a multi-method benchmark across multiple sites.
 * Tests each doc injection method on every task for every site.
 */
export async function runMultiMethodBenchmark(
  siteTasks: Map<string, { url: string; tasks: BenchmarkTask[] }>,
  documentation: Map<string, SiteDocumentation>,
  options?: MultiMethodBenchmarkOptions
): Promise<MultiMethodBenchmarkResult> {
  const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required for benchmarks");
  }

  const methods = options?.methods || ALL_DOC_METHODS;
  const onProgress = options?.onProgress || (() => {});
  const client = new Anthropic({ apiKey });
  const browser = await chromium.launch({ headless: true });

  const siteResults: SiteResult[] = [];
  // Track all results per method across all sites for overall metrics
  const allMethodResults = new Map<DocMethod, TaskResult[]>();
  for (const m of methods) allMethodResults.set(m, []);

  let totalTasksRun = 0;
  const totalTasksExpected = [...siteTasks.values()].reduce(
    (sum, s) => sum + s.tasks.length * methods.length, 0
  );

  // Run sites concurrently (up to 2 at a time)
  const SITE_CONCURRENCY = 2;
  const siteEntries = [...siteTasks.entries()];
  const siteResultsMap = new Map<string, { domain: string; url: string; methods: MethodResult[] }>();

  const runSite = async ([domain, { url, tasks }]: [string, { url: string; tasks: BenchmarkTask[] }]) => {
    const doc = documentation.get(domain);
    const methodTaskResults = new Map<DocMethod, TaskResult[]>();
    for (const m of methods) methodTaskResults.set(m, []);

    for (const task of tasks) {
      console.log(`\n[${domain}] Task: ${task.id} — running ${methods.length} methods in parallel`);
      onProgress({
        phase: "running",
        site: domain,
        tasksCompleted: totalTasksRun,
        tasksTotal: totalTasksExpected,
      });

      // Run all methods for this task in parallel
      const methodPromises = methods.map(async (method) => {
        console.log(`  [${method}] ${task.id}: ${task.instruction}`);

        // Generate pre-plan if needed
        let prePlan: string | undefined;
        if (method === "pre-plan" && doc) {
          try {
            prePlan = await generatePrePlan(client, task, doc);
            console.log(`    [${method}] Pre-plan generated (${prePlan.length} chars)`);
          } catch (e) {
            console.log(`    [${method}] Pre-plan generation failed: ${e}`);
          }
        }

        const result = await runTask(
          client,
          browser,
          task,
          method === "none" || method === "a11y-tree" ? undefined : doc,
          method,
          prePlan
        );

        console.log(
          `    [${method}] → ${result.success ? "SUCCESS" : "FAIL"} (${result.tokensUsed} tokens, ${result.steps} steps)`
        );

        return { method, result };
      });

      const results = await Promise.all(methodPromises);

      for (const { method, result } of results) {
        methodTaskResults.get(method)!.push(result);
        allMethodResults.get(method)!.push(result);
        totalTasksRun++;
      }

      onProgress({
        phase: "running",
        site: domain,
        tasksCompleted: totalTasksRun,
        tasksTotal: totalTasksExpected,
      });
    }

    const methodResults: MethodResult[] = methods.map((method) => ({
      method,
      tasks: methodTaskResults.get(method)!,
      metrics: computeMetrics(methodTaskResults.get(method)!),
    }));

    siteResultsMap.set(domain, { domain, url, methods: methodResults });
  };

  // Process sites with concurrency limit
  const activeSites: Promise<void>[] = [];
  for (const entry of siteEntries) {
    const p = runSite(entry).then(() => {
      // Remove from active set when done
      const idx = activeSites.indexOf(p);
      if (idx >= 0) activeSites.splice(idx, 1);
    });
    activeSites.push(p);
    if (activeSites.length >= SITE_CONCURRENCY) {
      await Promise.race(activeSites);
    }
  }
  await Promise.all(activeSites);

  // Preserve original site order
  for (const [domain, { url }] of siteEntries) {
    const sr = siteResultsMap.get(domain);
    if (sr) siteResults.push(sr);
  }

  await browser.close();

  // Compute overall metrics per method
  const overall: MethodResult[] = methods.map((method) => ({
    method,
    tasks: allMethodResults.get(method)!,
    metrics: computeMetrics(allMethodResults.get(method)!),
  }));

  return {
    timestamp: new Date().toISOString(),
    sites: siteResults,
    overall,
    methods,
    totalTasks: totalTasksRun,
  };
}
