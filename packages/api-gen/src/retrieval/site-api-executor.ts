/**
 * Execute SiteAction step sequences against a Playwright page.
 * Maps each ActionStep to the appropriate Playwright command.
 */

import type { Page } from "playwright";
import type { SiteAction, ActionStep, ActionExecutionResult } from "../types.js";

/** Default timeout per step */
const STEP_TIMEOUT = 5000;

/**
 * Execute a SiteAction's step sequence on a live page.
 * Resolves ${paramName} templates in step values.
 */
export async function executeSiteAction(
  page: Page,
  action: SiteAction,
  params: Record<string, unknown>
): Promise<ActionExecutionResult> {
  const startTime = Date.now();

  try {
    for (const step of action.steps) {
      await executeStep(page, step, params);
    }

    // Capture result snapshot
    let resultSnapshot: string;
    try {
      resultSnapshot = await page.locator("body").ariaSnapshot();
      if (resultSnapshot.length > 8000) {
        resultSnapshot = resultSnapshot.slice(0, 8000) + "\n... [truncated]";
      }
    } catch {
      resultSnapshot = "Snapshot unavailable";
    }

    return {
      success: true,
      resultSnapshot,
      currentUrl: page.url(),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    let resultSnapshot: string;
    try {
      resultSnapshot = await page.locator("body").ariaSnapshot();
      if (resultSnapshot.length > 4000) resultSnapshot = resultSnapshot.slice(0, 4000);
    } catch {
      resultSnapshot = "Snapshot unavailable";
    }

    return {
      success: false,
      error: (err as Error).message,
      resultSnapshot,
      currentUrl: page.url(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a single ActionStep.
 */
async function executeStep(
  page: Page,
  step: ActionStep,
  params: Record<string, unknown>
): Promise<void> {
  const timeout = step.timeout ?? STEP_TIMEOUT;

  switch (step.type) {
    case "click": {
      if (!step.selector) throw new Error("Click step requires a selector");
      const { role, name, cssSelector } = parseSelector(step.selector);
      if (cssSelector) {
        await page.locator(cssSelector).first().click({ timeout });
      } else if (role && name) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0], { name })
          .first().click({ timeout });
      } else if (role) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0])
          .first().click({ timeout });
      } else if (name) {
        await page.getByText(name, { exact: false }).first().click({ timeout });
      }
      break;
    }

    case "fill": {
      if (!step.selector) throw new Error("Fill step requires a selector");
      const value = resolveTemplate(step.value || "", params);
      const { role, name, cssSelector } = parseSelector(step.selector);
      if (cssSelector) {
        await page.locator(cssSelector).first().fill(value, { timeout });
      } else if (role && name) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0], { name })
          .first().fill(value, { timeout });
      } else if (name) {
        await page.getByLabel(name).first().fill(value, { timeout });
      }
      break;
    }

    case "select": {
      if (!step.selector) throw new Error("Select step requires a selector");
      const value = resolveTemplate(step.value || "", params);
      const { role, name, cssSelector } = parseSelector(step.selector);
      if (cssSelector) {
        await page.locator(cssSelector).first().selectOption(value, { timeout });
      } else if (role && name) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0], { name })
          .first().selectOption(value, { timeout });
      }
      break;
    }

    case "key": {
      const key = resolveTemplate(step.value || "", params);
      await page.keyboard.press(key);
      break;
    }

    case "scroll": {
      const direction = step.value === "up" ? -500 : 500;
      await page.mouse.wheel(0, direction);
      break;
    }

    case "wait": {
      const ms = step.timeout ?? 1000;
      await page.waitForTimeout(ms);
      break;
    }

    case "goto": {
      const url = resolveTemplate(step.value || "", params);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      break;
    }

    case "hover": {
      if (!step.selector) throw new Error("Hover step requires a selector");
      const { role, name, cssSelector } = parseSelector(step.selector);
      if (cssSelector) {
        await page.locator(cssSelector).first().hover({ timeout });
      } else if (role && name) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0], { name })
          .first().hover({ timeout });
      } else if (role) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0])
          .first().hover({ timeout });
      } else if (name) {
        await page.getByText(name, { exact: false }).first().hover({ timeout });
      }
      break;
    }

    case "fetch": {
      if (!step.request) throw new Error("Fetch step requires a request template");
      const { method, urlPattern, bodyTemplate, contentType } = step.request;
      const url = resolveTemplate(urlPattern, params);
      const body = bodyTemplate ? resolveTemplate(bodyTemplate, params) : undefined;

      // Execute fetch in the page context (uses site cookies)
      await page.evaluate(async ({ url, method, body, contentType }) => {
        const headers: Record<string, string> = {};
        if (contentType) headers["Content-Type"] = contentType;
        await fetch(url, { method, body, headers });
      }, { url, method, body, contentType: contentType || undefined });
      break;
    }
  }
}

/**
 * Parse an a11y-style selector like 'role=button, name="Search"'.
 * Also handles CSS selectors like [name="email"] as fallback.
 */
function parseSelector(selector: string): { role?: string; name?: string; cssSelector?: string } {
  // Handle CSS attribute selectors: [name="..."], #id, .class
  if (selector.startsWith("[") || selector.startsWith("#") || selector.startsWith(".")) {
    return { cssSelector: selector };
  }

  const roleMatch = selector.match(/role=(\w+)/);
  // Use a more robust name extraction — handle escaped quotes and apostrophes
  let name: string | undefined;
  const nameIdx = selector.indexOf('name="');
  if (nameIdx !== -1) {
    const start = nameIdx + 6;
    const end = selector.indexOf('"', start);
    if (end !== -1) {
      name = selector.slice(start, end);
    }
  }
  // Also try single quotes
  if (!name) {
    const nameIdx2 = selector.indexOf("name='");
    if (nameIdx2 !== -1) {
      const start = nameIdx2 + 6;
      const end = selector.indexOf("'", start);
      if (end !== -1) {
        name = selector.slice(start, end);
      }
    }
  }

  return {
    role: roleMatch?.[1],
    name,
  };
}

/**
 * Resolve ${paramName} templates in a string.
 */
function resolveTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    return value !== undefined ? String(value) : "";
  });
}
