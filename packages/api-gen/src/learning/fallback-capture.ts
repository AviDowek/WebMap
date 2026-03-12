/**
 * Capture successful fallback actions during CUA execution.
 * When a SiteAction fails and the agent falls back to browser_action,
 * the successful fallback steps are recorded for later API generation.
 */

import type { FallbackEvent, ActionStep } from "../types.js";

/**
 * In-memory capture buffer for fallback events during a CUA session.
 */
export class FallbackCapture {
  private events: FallbackEvent[] = [];
  private pendingFailure: {
    actionId: string;
    actionName: string;
    error: string;
    pageUrl: string;
  } | null = null;
  private fallbackSteps: Array<{
    action: string;
    role?: string;
    name?: string;
    text?: string;
  }> = [];

  /**
   * Mark that a SiteAction just failed.
   * Call this before the agent tries fallback_browser_action.
   */
  markFailure(actionId: string, actionName: string, error: string, pageUrl: string): void {
    // If there's a pending failure with collected fallback steps, save it
    this.flushPending();

    this.pendingFailure = { actionId, actionName, error, pageUrl };
    this.fallbackSteps = [];
  }

  /**
   * Record a successful fallback_browser_action call.
   * These are collected as the fallback sequence for the pending failed action.
   */
  recordFallbackStep(input: Record<string, unknown>): void {
    if (!this.pendingFailure) return;

    this.fallbackSteps.push({
      action: input.action as string,
      role: input.role as string | undefined,
      name: input.name as string | undefined,
      text: input.text as string | undefined,
    });
  }

  /**
   * Mark the end of a fallback sequence (agent called a SiteAction or task ended).
   */
  flushPending(): void {
    if (this.pendingFailure && this.fallbackSteps.length > 0) {
      this.events.push({
        failedActionId: this.pendingFailure.actionId,
        failedActionName: this.pendingFailure.actionName,
        error: this.pendingFailure.error,
        fallbackSteps: [...this.fallbackSteps],
        pageUrl: this.pendingFailure.pageUrl,
        taskInstruction: "",
        timestamp: new Date().toISOString(),
      });
    }
    this.pendingFailure = null;
    this.fallbackSteps = [];
  }

  /**
   * Get all captured fallback events.
   */
  getEvents(): FallbackEvent[] {
    this.flushPending();
    return [...this.events];
  }

  /**
   * Convert fallback steps to ActionStep format for API generation.
   */
  static toActionSteps(
    fallbackSteps: FallbackEvent["fallbackSteps"]
  ): ActionStep[] {
    return fallbackSteps.map(step => {
      const selector = step.role && step.name
        ? `role=${step.role}, name="${step.name}"`
        : step.role ? `role=${step.role}` : undefined;

      switch (step.action) {
        case "click":
          return { type: "click" as const, selector };
        case "type":
          return { type: "fill" as const, selector, value: step.text };
        case "key":
          return { type: "key" as const, value: step.text };
        case "scroll":
          return { type: "scroll" as const, value: step.text };
        case "goto":
          return { type: "goto" as const, value: step.text };
        default:
          return { type: "click" as const, selector };
      }
    });
  }
}
