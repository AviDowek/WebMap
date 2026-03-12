/**
 * Generate realistic test parameters for SiteAction self-testing.
 * Uses heuristics first, falls back to LLM if needed.
 */

import type { ActionParam } from "../types.js";

/** Default test values by parameter name patterns */
const PARAM_DEFAULTS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /email/i, value: "test@example.com" },
  { pattern: /password/i, value: "TestPass123!" },
  { pattern: /phone|tel/i, value: "555-0100" },
  { pattern: /name/i, value: "Test User" },
  { pattern: /search|query|keyword/i, value: "test" },
  { pattern: /url|website|link/i, value: "https://example.com" },
  { pattern: /zip|postal/i, value: "10001" },
  { pattern: /city/i, value: "New York" },
  { pattern: /state/i, value: "NY" },
  { pattern: /country/i, value: "US" },
  { pattern: /address/i, value: "123 Test St" },
  { pattern: /comment|message|description|text/i, value: "Test comment" },
  { pattern: /quantity|count|amount/i, value: "1" },
  { pattern: /price|cost/i, value: "9.99" },
  { pattern: /date/i, value: "2026-01-15" },
  { pattern: /color/i, value: "blue" },
  { pattern: /size/i, value: "medium" },
];

/**
 * Generate test parameters for a SiteAction.
 * Returns a Record<paramName, testValue> for all required + optional params.
 */
export function generateTestParams(params: ActionParam[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const param of params) {
    // Priority 1: explicit testDefault
    if (param.testDefault) {
      result[param.name] = param.testDefault;
      continue;
    }

    // Priority 2: select type — pick first option
    if (param.type === "select" && param.options && param.options.length > 0) {
      result[param.name] = param.options[0];
      continue;
    }

    // Priority 3: boolean
    if (param.type === "boolean") {
      result[param.name] = "true";
      continue;
    }

    // Priority 4: number
    if (param.type === "number") {
      result[param.name] = "1";
      continue;
    }

    // Priority 5: heuristic match on name/description
    const combined = `${param.name} ${param.description}`;
    const match = PARAM_DEFAULTS.find(d => d.pattern.test(combined));
    if (match) {
      result[param.name] = match.value;
      continue;
    }

    // Priority 6: generic fallback
    result[param.name] = "test";
  }

  return result;
}
