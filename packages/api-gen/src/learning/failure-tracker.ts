/**
 * Track per-function failure counts during CUA execution.
 * Determines when an action should be marked as stale.
 */

import type { SiteAction } from "../types.js";
import { STALE_FAILURE_THRESHOLD } from "../types.js";

export interface FailureRecord {
  actionId: string;
  actionName: string;
  error: string;
  timestamp: string;
  pageUrl: string;
}

/**
 * In-memory failure tracker for a single CUA execution session.
 */
export class FailureTracker {
  private failures: Map<string, FailureRecord[]> = new Map();
  private successes: Map<string, number> = new Map();

  /** Record a successful action execution */
  recordSuccess(actionId: string): void {
    this.successes.set(actionId, (this.successes.get(actionId) || 0) + 1);
  }

  /** Record a failed action execution */
  recordFailure(record: FailureRecord): void {
    if (!this.failures.has(record.actionId)) {
      this.failures.set(record.actionId, []);
    }
    this.failures.get(record.actionId)!.push(record);
  }

  /** Check if an action should be marked as stale */
  shouldMarkStale(actionId: string): boolean {
    const failures = this.failures.get(actionId)?.length || 0;
    const successes = this.successes.get(actionId) || 0;
    // Stale if failures exceed threshold AND no recent successes
    return failures >= STALE_FAILURE_THRESHOLD && successes === 0;
  }

  /** Get all failure records */
  getAllFailures(): Map<string, FailureRecord[]> {
    return new Map(this.failures);
  }

  /** Get success counts */
  getAllSuccesses(): Map<string, number> {
    return new Map(this.successes);
  }

  /** Get aggregated counts for cache update */
  getFailureCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [id, records] of this.failures) {
      counts[id] = records.length;
    }
    return counts;
  }

  /** Get total API calls and fallback counts */
  getStats(): { apiCalls: number; fallbacks: number } {
    let apiCalls = 0;
    for (const count of this.successes.values()) apiCalls += count;
    let fallbacks = 0;
    for (const records of this.failures.values()) fallbacks += records.length;
    return { apiCalls, fallbacks };
  }
}
