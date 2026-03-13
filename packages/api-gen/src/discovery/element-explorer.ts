/**
 * Active element exploration during crawl.
 * Clicks dropdowns, expands menus, triggers modals to discover
 * hidden interactive elements and their options.
 */

import type { Page } from "playwright";
import type { InteractiveElement } from "@webmap/core";

/** Timeout for each exploration interaction */
const EXPLORE_TIMEOUT = 3000;

/** Roles that might reveal more content when clicked/expanded */
const EXPANDABLE_ROLES = new Set([
  "combobox", "listbox", "menu", "menubar", "tree",
  "tablist", "disclosure", "dialog",
]);

/**
 * Actively explore a page's interactive elements to discover hidden content.
 * Returns discovered dropdown options and expanded elements.
 */
export async function explorePage(
  page: Page,
  elements: InteractiveElement[]
): Promise<{
  discoveredOptions: Map<string, string[]>;
  expandedElements: InteractiveElement[];
}> {
  const discoveredOptions = new Map<string, string[]>();
  const expandedElements: InteractiveElement[] = [];
  const startUrl = page.url();

  // Explore comboboxes/dropdowns to discover their options
  const comboboxes = elements.filter(el => el.role === "combobox" || el.role === "listbox");
  for (const combo of comboboxes) {
    try {
      const options = await exploreCombobox(page, combo);
      if (options.length > 0) {
        discoveredOptions.set(combo.selector, options);
      }
      // Ensure we're still on the same page
      if (page.url() !== startUrl) {
        await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      }
    } catch {
      // Skip this element on failure
    }
  }

  // Explore expandable elements (aria-expanded=false)
  const expandables = elements.filter(el =>
    el.state?.includes("expanded=false") || el.state?.includes("collapsed")
  );
  for (const exp of expandables) {
    try {
      const newElements = await exploreExpandable(page, exp);
      expandedElements.push(...newElements);
      if (page.url() !== startUrl) {
        await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      }
    } catch {
      // Skip
    }
  }

  // Explore tab groups
  const tabs = elements.filter(el => el.role === "tab");
  const tabGroups = groupTabsByPanel(tabs);
  for (const group of tabGroups) {
    try {
      const newElements = await exploreTabGroup(page, group);
      expandedElements.push(...newElements);
      if (page.url() !== startUrl) {
        await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      }
    } catch {
      // Skip
    }
  }

  return { discoveredOptions, expandedElements };
}

/**
 * Click a combobox to open it, capture all option texts, then close.
 */
async function exploreCombobox(page: Page, combo: InteractiveElement): Promise<string[]> {
  const locator = page.getByRole(
    combo.role as Parameters<Page["getByRole"]>[0],
    { name: combo.name }
  ).first();

  // Click to open
  await locator.click({ timeout: EXPLORE_TIMEOUT });
  // Wait for options to render
  await page.waitForTimeout(300);

  // Capture all options
  const options = await page.locator("[role=option]").allTextContents();

  // Close by pressing Escape
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);

  return options.filter(o => o.trim().length > 0);
}

/**
 * Click an expandable element to reveal hidden content.
 * Captures new elements from the expanded a11y tree diff.
 */
async function exploreExpandable(
  page: Page,
  element: InteractiveElement
): Promise<InteractiveElement[]> {
  // Capture before snapshot
  let beforeSnapshot: string;
  try {
    beforeSnapshot = await page.locator("body").ariaSnapshot();
  } catch {
    return [];
  }

  // Click to expand
  const locator = page.getByRole(
    element.role as Parameters<Page["getByRole"]>[0],
    { name: element.name }
  ).first();
  await locator.click({ timeout: EXPLORE_TIMEOUT });
  await page.waitForTimeout(300);

  // Capture after snapshot
  let afterSnapshot: string;
  try {
    afterSnapshot = await page.locator("body").ariaSnapshot();
  } catch {
    return [];
  }

  // Find new elements in the diff
  const newElements = diffSnapshots(beforeSnapshot, afterSnapshot);

  // Collapse back
  try {
    await locator.click({ timeout: EXPLORE_TIMEOUT });
    await page.waitForTimeout(100);
  } catch {
    // May already be collapsed or element moved
    await page.keyboard.press("Escape");
  }

  return newElements;
}

/**
 * Explore a tab group by clicking each tab and capturing content.
 */
async function exploreTabGroup(
  page: Page,
  tabs: InteractiveElement[]
): Promise<InteractiveElement[]> {
  const allNew: InteractiveElement[] = [];

  for (const tab of tabs.slice(1)) { // Skip first (already visible)
    try {
      const locator = page.getByRole("tab", { name: tab.name }).first();

      const beforeSnapshot = await page.locator("body").ariaSnapshot();
      await locator.click({ timeout: EXPLORE_TIMEOUT });
      await page.waitForTimeout(300);
      const afterSnapshot = await page.locator("body").ariaSnapshot();

      const newElements = diffSnapshots(beforeSnapshot, afterSnapshot);
      allNew.push(...newElements);
    } catch {
      // Skip this tab
    }
  }

  return allNew;
}

/**
 * Group tabs by proximity (heuristic: tabs with similar names are in the same group).
 */
function groupTabsByPanel(tabs: InteractiveElement[]): InteractiveElement[][] {
  if (tabs.length === 0) return [];
  // Simple heuristic: all tabs with the same name prefix form a group
  // For now, treat all tabs as one group
  return [tabs];
}

/**
 * Find new interactive elements in the after snapshot that weren't in before.
 */
function diffSnapshots(before: string, after: string): InteractiveElement[] {
  const interactiveRoles =
    /^(button|link|textbox|combobox|checkbox|radio|menuitem|tab|switch|slider|spinbutton|searchbox)$/;

  const beforeElements = new Set<string>();
  for (const line of before.split("\n")) {
    const match = line.trim().match(/^-\s+(\w+)\s+"([^"]*)"/);
    if (match) beforeElements.add(`${match[1]}:${match[2]}`);
  }

  const newElements: InteractiveElement[] = [];
  for (const line of after.split("\n")) {
    const match = line.trim().match(/^-\s+(\w+)\s+"([^"]*)"(?:\s+\[([^\]]*)\])?/);
    if (!match) continue;
    const [, role, name, state] = match;
    if (!interactiveRoles.test(role)) continue;
    if (!name) continue;

    const key = `${role}:${name}`;
    if (beforeElements.has(key)) continue;

    newElements.push({
      role,
      name,
      selector: `role=${role}, name="${name}"`,
      type: role,
      action: getDefaultAction(role),
      result: "Discovered during expansion — requires inference",
      state: state || "enabled",
    });
  }

  return newElements;
}

function getDefaultAction(role: string): string {
  switch (role) {
    case "button": return "Click";
    case "link": return "Click to navigate";
    case "textbox": case "searchbox": return "Type text";
    case "combobox": return "Select option";
    case "checkbox": case "switch": return "Toggle";
    case "radio": return "Select";
    default: return "Click";
  }
}
