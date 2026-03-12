/**
 * Deterministic function builder.
 * Converts InteractiveElement[] and PageForm[] into SiteAction stubs
 * WITHOUT any LLM calls. Pure data transformation.
 */

import { createHash } from "node:crypto";
import type { InteractiveElement, PageForm, PageData } from "@webmap/core";
import type { SiteAction, ActionStep, ActionParam, NetworkEndpoint } from "../types.js";

/**
 * Generate SiteAction stubs from a page's interactive elements and forms.
 * These are deterministic — no LLM needed.
 */
export function buildActionsFromPage(
  page: PageData,
  domain: string,
  networkEndpoints?: NetworkEndpoint[]
): SiteAction[] {
  const actions: SiteAction[] = [];
  const now = new Date().toISOString();
  const pagePattern = extractPagePattern(page.url);

  // 1. Actions from interactive elements
  for (const element of page.elements) {
    const action = buildActionFromElement(element, domain, page.url, pagePattern, now);
    if (action) actions.push(action);
  }

  // 2. Actions from forms (composite: fill all fields + submit)
  for (const form of page.forms) {
    const action = buildActionFromForm(form, domain, page.url, pagePattern, now);
    if (action) actions.push(action);
  }

  // 3. Actions from network endpoints (direct-api tier)
  if (networkEndpoints) {
    for (const endpoint of networkEndpoints) {
      if (endpoint.sourcePageUrl === page.url) {
        const action = buildActionFromEndpoint(endpoint, domain, page.url, pagePattern, now);
        if (action) actions.push(action);
      }
    }
  }

  // Deduplicate by name (keep first)
  const seen = new Set<string>();
  return actions.filter(a => {
    if (seen.has(a.name)) return false;
    seen.add(a.name);
    return true;
  });
}

/**
 * Build a SiteAction from a single InteractiveElement.
 */
function buildActionFromElement(
  element: InteractiveElement,
  domain: string,
  pageUrl: string,
  pagePattern: string,
  now: string
): SiteAction | null {
  const { role, name, selector } = element;
  if (!name || name.length < 2) return null;

  const sanitizedName = sanitizeName(name);
  let actionName: string;
  let steps: ActionStep[];
  let params: ActionParam[] = [];
  let tier: SiteAction["tier"] = "interaction";
  let description: string;

  switch (role) {
    case "link":
      actionName = `navigate_to_${sanitizedName}`;
      description = `Navigate to "${name}" link`;
      steps = [{ type: "click", selector, description: `Click link "${name}"` }];
      tier = "navigation";
      break;

    case "button":
      actionName = `click_${sanitizedName}`;
      description = `Click the "${name}" button`;
      steps = [{ type: "click", selector, description: `Click button "${name}"` }];
      break;

    case "textbox":
    case "searchbox":
      actionName = `fill_${sanitizedName}`;
      description = `Type text into "${name}" field`;
      params = [{
        name: "text",
        type: "string",
        description: `Text to enter into "${name}"`,
        required: true,
      }];
      steps = [{ type: "fill", selector, value: "${text}", description: `Fill "${name}" field` }];
      break;

    case "combobox":
      actionName = `select_${sanitizedName}`;
      description = `Select an option from "${name}" dropdown`;
      const options = element.result?.startsWith("Options: ")
        ? element.result.replace("Options: ", "").split(", ")
        : undefined;
      params = [{
        name: "option",
        type: options ? "select" : "string",
        description: `Option to select in "${name}"`,
        required: true,
        options,
        testDefault: options?.[0],
      }];
      steps = [{ type: "select", selector, value: "${option}", description: `Select option in "${name}"` }];
      break;

    case "checkbox":
    case "switch":
      actionName = `toggle_${sanitizedName}`;
      description = `Toggle the "${name}" ${role}`;
      steps = [{ type: "click", selector, description: `Toggle "${name}"` }];
      break;

    case "radio":
      actionName = `select_radio_${sanitizedName}`;
      description = `Select the "${name}" radio option`;
      steps = [{ type: "click", selector, description: `Select radio "${name}"` }];
      break;

    case "tab":
      actionName = `switch_tab_${sanitizedName}`;
      description = `Switch to the "${name}" tab`;
      steps = [{ type: "click", selector, description: `Click tab "${name}"` }];
      break;

    case "menuitem":
    case "menuitemcheckbox":
    case "menuitemradio":
      actionName = `click_menu_${sanitizedName}`;
      description = `Click menu item "${name}"`;
      steps = [{ type: "click", selector, description: `Click menu item "${name}"` }];
      break;

    case "slider":
    case "spinbutton":
      actionName = `set_${sanitizedName}`;
      description = `Set value for "${name}"`;
      params = [{
        name: "value",
        type: "string",
        description: `Value to set for "${name}"`,
        required: true,
      }];
      steps = [{ type: "fill", selector, value: "${value}", description: `Set "${name}" value` }];
      break;

    default:
      return null;
  }

  const id = generateActionId(domain, pagePattern, actionName);

  return {
    id,
    name: actionName,
    description,
    tier,
    pagePattern,
    sourceUrl: pageUrl,
    steps,
    params,
    expectedResult: {
      description: element.result || `${element.action} "${name}"`,
    },
    reliability: "untested",
    successCount: 0,
    failureCount: 0,
    source: "crawl",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build a composite SiteAction from a form.
 */
function buildActionFromForm(
  form: PageForm,
  domain: string,
  pageUrl: string,
  pagePattern: string,
  now: string
): SiteAction | null {
  if (!form.name || form.fields.length === 0) return null;

  const sanitizedName = sanitizeName(form.name);
  const actionName = `submit_${sanitizedName}`;

  const params: ActionParam[] = form.fields.map(field => ({
    name: sanitizeName(field.label || field.selector),
    type: field.inputType === "number" ? "number" as const :
          field.inputType === "checkbox" ? "boolean" as const :
          field.inputType === "select" ? "select" as const : "string" as const,
    description: `${field.label || "Field"} (${field.inputType})`,
    required: field.required,
    testDefault: getTestDefaultForField(field.inputType, field.label),
    pattern: field.validation || undefined,
  }));

  const steps: ActionStep[] = form.fields.map(field => ({
    type: (field.inputType === "select" ? "select" : "fill") as ActionStep["type"],
    selector: field.selector,
    value: `\${${sanitizeName(field.label || field.selector)}}`,
    description: `Fill "${field.label}" field`,
  }));

  // Add submit step
  if (form.submitSelector) {
    steps.push({
      type: "click",
      selector: form.submitSelector,
      description: `Click submit button`,
    });
  }

  const id = generateActionId(domain, pagePattern, actionName);

  return {
    id,
    name: actionName,
    description: `Submit the "${form.name}" form`,
    tier: "interaction",
    pagePattern,
    sourceUrl: pageUrl,
    steps,
    params,
    expectedResult: {
      description: form.submitAction || `Form "${form.name}" submitted`,
    },
    reliability: "untested",
    successCount: 0,
    failureCount: 0,
    source: "crawl",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build a SiteAction from a discovered network endpoint.
 */
function buildActionFromEndpoint(
  endpoint: NetworkEndpoint,
  domain: string,
  pageUrl: string,
  pagePattern: string,
  now: string
): SiteAction | null {
  const pathParts = new URL(endpoint.urlPattern).pathname.split("/").filter(Boolean);
  const sanitized = pathParts.map(p => p.replace(/^:/, "")).join("_");
  const actionName = `api_${endpoint.method.toLowerCase()}_${sanitized || "root"}`;

  const id = generateActionId(domain, pagePattern, actionName);

  return {
    id,
    name: actionName,
    description: `${endpoint.method} ${new URL(endpoint.urlPattern).pathname} — direct API call`,
    tier: "direct-api",
    pagePattern,
    sourceUrl: pageUrl,
    steps: [{
      type: "fetch",
      request: {
        method: endpoint.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
        urlPattern: endpoint.urlPattern,
        bodyTemplate: endpoint.exampleBody,
        contentType: endpoint.contentType,
      },
      description: `${endpoint.method} ${endpoint.urlPattern}`,
    }],
    params: endpoint.params,
    expectedResult: {
      description: `API response from ${endpoint.method} ${new URL(endpoint.urlPattern).pathname}`,
      expectedResponse: { status: 200 },
    },
    reliability: "untested",
    successCount: 0,
    failureCount: 0,
    source: "network-intercepted",
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Sanitize a name for use as a function name.
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

/**
 * Extract a URL pattern from a full URL.
 * /products/123 → /products/*
 */
function extractPagePattern(url: string): string {
  try {
    const parsed = new URL(url);
    // Replace numeric segments with *
    const segments = parsed.pathname.split("/").map(seg => {
      if (/^\d+$/.test(seg)) return "*";
      if (/^[0-9a-f]{8,}$/i.test(seg)) return "*";
      return seg;
    });
    return segments.join("/") || "/";
  } catch {
    return "/";
  }
}

/**
 * Generate a deterministic action ID.
 */
function generateActionId(domain: string, pagePattern: string, actionName: string): string {
  const hash = createHash("md5")
    .update(`${domain}:${pagePattern}:${actionName}`)
    .digest("hex")
    .slice(0, 8);
  return `${domain}:${actionName}:${hash}`;
}

/**
 * Generate reasonable test defaults based on field type and label.
 */
function getTestDefaultForField(inputType: string, label?: string): string | undefined {
  const lowerLabel = (label || "").toLowerCase();

  if (inputType === "email" || lowerLabel.includes("email")) return "test@example.com";
  if (inputType === "password" || lowerLabel.includes("password")) return "TestPass123!";
  if (inputType === "tel" || lowerLabel.includes("phone")) return "555-0100";
  if (inputType === "url" || lowerLabel.includes("url")) return "https://example.com";
  if (inputType === "number") return "1";
  if (lowerLabel.includes("name")) return "Test User";
  if (lowerLabel.includes("search") || lowerLabel.includes("query")) return "test";
  if (lowerLabel.includes("zip") || lowerLabel.includes("postal")) return "10001";
  if (lowerLabel.includes("city")) return "New York";
  if (lowerLabel.includes("address")) return "123 Test St";

  return undefined;
}
