/**
 * Automated self-testing pipeline for generated SiteActions.
 * Executes each action on the live site and verifies results.
 */

import { chromium, type Page } from "playwright";
import type { DomainAPI, SiteAction, ActionTestResult, SelfTestReport, ActionExecutionResult } from "../types.js";
import { generateTestParams } from "./test-param-gen.js";
import { judgeActionResult } from "./diff-judge.js";
import { executeSiteAction } from "../retrieval/site-api-executor.js";

/** Max actions to test per page (avoid excessive interaction) */
const MAX_ACTIONS_PER_PAGE = 40;
/** Timeout for each action test */
const ACTION_TEST_TIMEOUT = 10000;

/**
 * Run the self-testing pipeline on a DomainAPI.
 * Tests each action on the live site and updates reliability ratings.
 */
export async function runSelfTest(
  domainApi: DomainAPI,
  options: {
    apiKey?: string;
    /** Only test untested actions (skip verified) */
    untestedOnly?: boolean;
    /** Max total actions to test */
    maxActions?: number;
    /** Called after each action test */
    onProgress?: (result: ActionTestResult, tested: number, total: number) => void;
  } = {}
): Promise<SelfTestReport> {
  const startTime = Date.now();
  const results: ActionTestResult[] = [];
  let skipped = 0;

  // Collect all actions to test, grouped by page
  const pageGroups = new Map<string, SiteAction[]>();

  // Add global actions under a special key
  const globalToTest = filterActionsToTest(domainApi.globalActions, options);
  if (globalToTest.length > 0) {
    pageGroups.set("__global__", globalToTest);
  }

  // Add page-scoped actions
  for (const [pattern, pageApi] of Object.entries(domainApi.pages)) {
    const toTest = filterActionsToTest(pageApi.actions, options);
    if (toTest.length > 0) {
      pageGroups.set(pageApi.canonicalUrl, toTest);
    }
  }

  // Count total
  let totalToTest = 0;
  for (const actions of pageGroups.values()) totalToTest += actions.length;
  if (options.maxActions && totalToTest > options.maxActions) {
    totalToTest = options.maxActions;
  }

  const browser = await chromium.launch({ headless: true });
  let tested = 0;

  try {
    for (const [pageUrl, actions] of pageGroups) {
      if (options.maxActions && tested >= options.maxActions) break;

      const context = await browser.newContext({
        viewport: { width: 1024, height: 768 },
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();

      try {
        // Navigate to page (use root URL for global actions)
        const navUrl = pageUrl === "__global__" ? domainApi.rootUrl : pageUrl;
        await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(1000);

        for (const action of actions.slice(0, MAX_ACTIONS_PER_PAGE)) {
          if (options.maxActions && tested >= options.maxActions) break;

          const result = await testSingleAction(page, action, navUrl, options.apiKey);
          results.push(result);
          tested++;

          options.onProgress?.(result, tested, totalToTest);

          // Navigate back after each test to reset state
          try {
            await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
            await page.waitForTimeout(500);
          } catch {
            // If navigation fails, try to continue
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return {
    domain: domainApi.domain,
    totalTested: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    skipped,
    durationMs: Date.now() - startTime,
    results,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Test a single SiteAction on a live page.
 */
async function testSingleAction(
  page: Page,
  action: SiteAction,
  pageUrl: string,
  apiKey?: string
): Promise<ActionTestResult> {
  const startTime = Date.now();

  try {
    // Generate test parameters
    const testParams = generateTestParams(action.params);

    // Capture before state
    let beforeSnapshot: string;
    try {
      beforeSnapshot = await page.locator("body").ariaSnapshot();
    } catch {
      beforeSnapshot = "";
    }
    const beforeUrl = page.url();

    // Execute the action
    const execResult = await executeSiteAction(page, action, testParams);

    // Capture after state
    let afterSnapshot: string;
    try {
      afterSnapshot = await page.locator("body").ariaSnapshot();
    } catch {
      afterSnapshot = "";
    }

    // Judge the result
    const judgment = await judgeActionResult(
      action.expectedResult,
      {
        beforeSnapshot,
        afterSnapshot,
        beforeUrl,
        afterUrl: page.url(),
        error: execResult.success ? undefined : execResult.error,
      },
      apiKey
    );

    return {
      actionId: action.id,
      actionName: action.name,
      passed: judgment.passed,
      error: execResult.success ? undefined : execResult.error,
      beforeSnapshot: beforeSnapshot.slice(0, 2000),
      afterSnapshot: afterSnapshot.slice(0, 2000),
      resultMatched: judgment.passed,
      judgeReason: judgment.reason,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      actionId: action.id,
      actionName: action.name,
      passed: false,
      error: (err as Error).message,
      resultMatched: false,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Filter actions to test based on options.
 */
function filterActionsToTest(
  actions: SiteAction[],
  options: { untestedOnly?: boolean }
): SiteAction[] {
  if (options.untestedOnly) {
    return actions.filter(a => a.reliability === "untested" || a.reliability === "stale");
  }
  return [...actions];
}

/**
 * Apply test results back to a DomainAPI, updating reliability ratings.
 */
export function applyTestResults(domainApi: DomainAPI, report: SelfTestReport): DomainAPI {
  const resultMap = new Map(report.results.map(r => [r.actionId, r]));

  function updateAction(action: SiteAction): SiteAction {
    const result = resultMap.get(action.id);
    if (!result) return action;

    return {
      ...action,
      reliability: result.passed ? "verified-passed" : "verified-failed",
      successCount: result.passed ? action.successCount + 1 : action.successCount,
      failureCount: result.passed ? action.failureCount : action.failureCount + 1,
      lastTestedAt: result.timestamp,
      lastSuccessAt: result.passed ? result.timestamp : action.lastSuccessAt,
      lastError: result.passed ? undefined : result.error,
      updatedAt: result.timestamp,
    };
  }

  const updatedGlobal = domainApi.globalActions.map(updateAction);
  const updatedPages: Record<string, typeof domainApi.pages[string]> = {};
  for (const [pattern, pageApi] of Object.entries(domainApi.pages)) {
    updatedPages[pattern] = {
      ...pageApi,
      actions: pageApi.actions.map(updateAction),
    };
  }

  // Recompute stats
  const allActions = [...updatedGlobal];
  for (const p of Object.values(updatedPages)) allActions.push(...p.actions);

  const vp = allActions.filter(a => a.reliability === "verified-passed").length;
  const vf = allActions.filter(a => a.reliability === "verified-failed").length;

  return {
    ...domainApi,
    globalActions: updatedGlobal,
    pages: updatedPages,
    lastTestedAt: report.timestamp,
    stats: {
      ...domainApi.stats,
      verifiedPassed: vp,
      verifiedFailed: vf,
      untested: allActions.filter(a => a.reliability === "untested").length,
      stale: allActions.filter(a => a.reliability === "stale").length,
      avgReliabilityScore: (vp + vf) > 0 ? vp / (vp + vf) : 0,
    },
  };
}
