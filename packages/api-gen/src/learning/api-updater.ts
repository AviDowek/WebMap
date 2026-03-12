/**
 * Update DomainAPI after CUA execution based on learning data.
 * Merges fallback discoveries, updates reliability, regenerates failures.
 */

import { createHash } from "node:crypto";
import type { DomainAPI, SiteAction, FallbackEvent } from "../types.js";
import { STALE_FAILURE_THRESHOLD } from "../types.js";
import type { FailureTracker } from "./failure-tracker.js";
import { FallbackCapture } from "./fallback-capture.js";

/**
 * Update a DomainAPI with learning data from a CUA execution session.
 */
export function updateDomainAPIFromExecution(
  domainApi: DomainAPI,
  failureTracker: FailureTracker,
  fallbackCapture: FallbackCapture
): DomainAPI {
  const failures = failureTracker.getAllFailures();
  const successes = failureTracker.getAllSuccesses();
  const fallbackEvents = fallbackCapture.getEvents();
  const now = new Date().toISOString();

  // Build lookup of failed actions with learned replacements
  const learnedReplacements = new Map<string, SiteAction>();
  for (const event of fallbackEvents) {
    if (event.fallbackSteps.length > 0) {
      const learned = createLearnedAction(event, domainApi.domain, now);
      learnedReplacements.set(event.failedActionId, learned);
    }
  }

  // Update function to apply to each action
  function updateAction(action: SiteAction): SiteAction {
    const failCount = failures.get(action.id)?.length || 0;
    const successCount = successes.get(action.id) || 0;

    let updated = { ...action };

    // Update counts
    updated.successCount += successCount;
    updated.failureCount += failCount;
    updated.updatedAt = now;

    if (successCount > 0) {
      updated.lastSuccessAt = now;
      // If it was stale, promote back to verified-passed
      if (updated.reliability === "stale") {
        updated.reliability = "verified-passed";
      }
    }

    // Mark as stale if too many failures
    if (failCount >= STALE_FAILURE_THRESHOLD && successCount === 0) {
      updated.reliability = "stale";
      const lastFailure = failures.get(action.id);
      if (lastFailure && lastFailure.length > 0) {
        updated.lastError = lastFailure[lastFailure.length - 1].error;
      }
    }

    return updated;
  }

  // Apply updates to global actions
  let updatedGlobal = domainApi.globalActions.map(updateAction);

  // Apply updates to page actions + merge learned replacements
  const updatedPages: Record<string, typeof domainApi.pages[string]> = {};
  for (const [pattern, pageApi] of Object.entries(domainApi.pages)) {
    let actions = pageApi.actions.map(updateAction);

    // Replace stale actions with learned replacements
    actions = actions.map(action => {
      const replacement = learnedReplacements.get(action.id);
      if (replacement && action.reliability === "stale") {
        return replacement;
      }
      return action;
    });

    updatedPages[pattern] = { ...pageApi, actions };
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
    stats: {
      ...domainApi.stats,
      totalActions: allActions.length,
      verifiedPassed: vp,
      verifiedFailed: vf,
      untested: allActions.filter(a => a.reliability === "untested").length,
      stale: allActions.filter(a => a.reliability === "stale").length,
      avgReliabilityScore: (vp + vf) > 0 ? vp / (vp + vf) : 0,
    },
  };
}

/**
 * Create a new SiteAction from a captured fallback sequence.
 */
function createLearnedAction(
  event: FallbackEvent,
  domain: string,
  now: string
): SiteAction {
  const steps = FallbackCapture.toActionSteps(event.fallbackSteps);
  const hash = createHash("md5")
    .update(`${domain}:${event.failedActionName}:learned:${now}`)
    .digest("hex")
    .slice(0, 8);

  return {
    id: `${domain}:${event.failedActionName}_learned:${hash}`,
    name: `${event.failedActionName}_learned`,
    description: `Learned replacement for "${event.failedActionName}" from successful fallback`,
    tier: "interaction",
    pagePattern: extractPattern(event.pageUrl),
    sourceUrl: event.pageUrl,
    steps,
    params: [], // Learned actions don't have typed params yet
    expectedResult: {
      description: `Same as original "${event.failedActionName}"`,
    },
    reliability: "untested",
    successCount: 1, // It succeeded as a fallback
    failureCount: 0,
    source: "fallback-learned",
    createdAt: now,
    updatedAt: now,
  };
}

function extractPattern(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/\d+/g, "/*").replace(/\/[0-9a-f]{8,}/gi, "/*") || "/";
  } catch {
    return "/";
  }
}
