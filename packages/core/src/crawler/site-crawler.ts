/**
 * Site crawler using Crawlee + Playwright.
 * Discovers all pages and extracts accessibility trees.
 */

import { PlaywrightCrawler, Configuration, type PlaywrightCrawlingContext } from "crawlee";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Page } from "playwright";
import type { CrawlOptions, InteractiveElement, PageForm, FormField, PageData } from "../types.js";

export interface CrawlResult {
  pages: PageData[];
  /** URLs that were discovered but not crawled (over limit) */
  skippedUrls: string[];
  /** Total crawl duration in ms */
  durationMs: number;
}

/**
 * Parse Playwright's accessibility tree snapshot into structured interactive elements.
 * The snapshot is YAML-like with roles, names, and states.
 */
export function parseAccessibilitySnapshot(snapshot: string): InteractiveElement[] {
  const elements: InteractiveElement[] = [];
  const lines = snapshot.split("\n");

  const interactiveRoles =
    /^(button|link|textbox|combobox|checkbox|radio|menuitem|tab|switch|slider|spinbutton|searchbox|menuitemcheckbox|menuitemradio)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Playwright aria snapshot format: "- role "name" [state]" or "- role:"
    // Match: - link "Products" or - button "Submit" [disabled]
    const match = trimmed.match(
      /^-\s+(\w+)\s+"([^"]*)"(?:\s+\[([^\]]*)\])?/
    );

    if (match) {
      const [, role, name] = match;
      const state = match[3];
      if (interactiveRoles.test(role) && name) {
        elements.push({
          role,
          name,
          selector: `role=${role}, name="${name}"`,
          type: role,
          action: getDefaultAction(role),
          result: "Unknown — requires LLM inference",
          state: state || "enabled",
        });
      }
    }

    // Also match: - link: with /url on next line  or - link "name":
    const roleOnlyMatch = trimmed.match(/^-\s+(link|button)\s*:/);
    if (roleOnlyMatch) {
      // Look at inline text: "- link:" means unnamed link, skip
      // But "- link "name":" means a named link with children
      const namedMatch = trimmed.match(/^-\s+(\w+)\s+"([^"]+)":/);
      if (namedMatch) {
        const [, role, name] = namedMatch;
        if (interactiveRoles.test(role)) {
          elements.push({
            role,
            name,
            selector: `role=${role}, name="${name}"`,
            type: role,
            action: getDefaultAction(role),
            result: "Unknown — requires LLM inference",
            state: "enabled",
          });
        }
      }
    }
  }

  return elements;
}

export function getDefaultAction(role: string): string {
  switch (role) {
    case "button":
      return "Click";
    case "link":
      return "Click to navigate";
    case "textbox":
    case "searchbox":
      return "Type text";
    case "combobox":
      return "Select option";
    case "checkbox":
    case "switch":
      return "Toggle";
    case "radio":
      return "Select";
    case "menuitem":
    case "menuitemcheckbox":
    case "menuitemradio":
      return "Click to select";
    case "tab":
      return "Click to switch tab";
    case "slider":
    case "spinbutton":
      return "Adjust value";
    default:
      return "Interact";
  }
}

/**
 * Extract forms from a page using the accessibility tree and DOM queries.
 */
async function extractForms(page: Page): Promise<PageForm[]> {
  return await page.evaluate(() => {
    const forms: Array<{
      name: string;
      submitSelector: string;
      fields: Array<{
        label: string;
        inputType: string;
        selector: string;
        required: boolean;
        validation: string;
        placeholder: string;
      }>;
      submitAction: string;
    }> = [];

    document.querySelectorAll("form").forEach((form, i) => {
      const fields: typeof forms[0]["fields"] = [];

      form.querySelectorAll("input, select, textarea").forEach((input) => {
        const el = input as HTMLInputElement;
        const label =
          el.labels?.[0]?.textContent?.trim() ||
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.name ||
          "";

        if (el.type === "hidden") return;

        fields.push({
          label,
          inputType: el.tagName === "SELECT" ? "select" : el.type || "text",
          selector: el.getAttribute("aria-label")
            ? `role=textbox, name="${el.getAttribute("aria-label")}"`
            : `[name="${el.name}"]`,
          required: el.required || el.getAttribute("aria-required") === "true",
          validation: el.pattern || "",
          placeholder: el.placeholder || "",
        });
      });

      const submitBtn = form.querySelector(
        'button[type="submit"], input[type="submit"]'
      );
      const formName =
        form.getAttribute("aria-label") ||
        form.id ||
        `Form ${i + 1}`;

      forms.push({
        name: formName,
        submitSelector: submitBtn
          ? `role=button, name="${submitBtn.textContent?.trim() || "Submit"}"`
          : "",
        fields,
        submitAction: form.action || "submit",
      });
    });

    return forms;
  });
}

/**
 * Extract the accessibility tree snapshot from a page.
 * Uses Playwright's built-in accessibility snapshot API.
 */
async function getAccessibilitySnapshot(page: Page): Promise<string> {
  try {
    // Use Playwright's accessibility snapshot
    const snapshot = await page.locator("body").ariaSnapshot();
    return snapshot;
  } catch {
    // Fallback: extract interactive elements from DOM
    const fallback = await page.evaluate(() => {
      const elements: string[] = [];
      document.querySelectorAll("a, button, input, select, textarea, [role]").forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || tag;
        const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 50) || "";
        if (name) elements.push(`- ${role} "${name}"`);
      });
      return elements.join("\n");
    });
    return fallback;
  }
}

/**
 * Capture an annotated screenshot with numbered overlays on key navigation elements.
 * Inspired by OmniParser V2's Set-of-Marks and Vercel agent-browser's annotation system.
 * Returns base64-encoded JPEG and a legend mapping numbers to element descriptions.
 */
async function captureAnnotatedScreenshot(
  page: Page,
  elements: InteractiveElement[]
): Promise<{ screenshot: string; legend: string[] }> {
  // Select navigation-relevant elements (short-named links, buttons, inputs, tabs)
  const navElements = elements.filter((el) => {
    if (el.role !== "link") return true; // buttons, inputs, tabs always relevant
    const wordCount = el.name.split(/\s+/).length;
    return wordCount <= 6 && el.name.length <= 60;
  });

  // Cap at 40 elements for annotated screenshots
  const toAnnotate = navElements.slice(0, 40);

  // Inject numbered overlays onto the page
  const legend: string[] = [];
  const selectors: Array<{ index: number; role: string; name: string }> = [];

  for (let i = 0; i < toAnnotate.length; i++) {
    const el = toAnnotate[i];
    legend.push(`[${i + 1}] ${el.role}: "${el.name}"`);
    selectors.push({ index: i + 1, role: el.role, name: el.name });
  }

  // Use page.evaluate to find elements and overlay numbered badges
  await page.evaluate((items: Array<{ index: number; role: string; name: string }>) => {
    // Remove any previous annotations
    document.querySelectorAll("[data-webmap-annotation]").forEach((el) => el.remove());

    for (const item of items) {
      // Find element by role and accessible name
      const selector =
        item.role === "link" ? `a` :
        item.role === "button" ? `button, [role="button"]` :
        item.role === "textbox" || item.role === "searchbox" ? `input[type="text"], input[type="search"], input:not([type]), textarea, [role="searchbox"], [role="textbox"]` :
        item.role === "tab" ? `[role="tab"]` :
        item.role === "menuitem" ? `[role="menuitem"]` :
        item.role === "combobox" ? `[role="combobox"], select` :
        item.role === "checkbox" ? `input[type="checkbox"], [role="checkbox"]` :
        `[role="${item.role}"]`;

      const candidates = document.querySelectorAll(selector);
      let target: Element | null = null;

      for (const candidate of candidates) {
        const ariaLabel = candidate.getAttribute("aria-label") || "";
        const textContent = candidate.textContent?.trim() || "";
        if (
          ariaLabel === item.name ||
          textContent === item.name ||
          textContent.startsWith(item.name)
        ) {
          target = candidate;
          break;
        }
      }

      if (!target) continue;

      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Create numbered badge overlay
      const badge = document.createElement("div");
      badge.setAttribute("data-webmap-annotation", "true");
      badge.style.cssText = `
        position: absolute;
        left: ${rect.left + window.scrollX - 2}px;
        top: ${rect.top + window.scrollY - 14}px;
        background: #ff4444;
        color: white;
        font-size: 11px;
        font-weight: bold;
        padding: 1px 4px;
        border-radius: 3px;
        z-index: 999999;
        pointer-events: none;
        font-family: monospace;
        line-height: 14px;
      `;
      badge.textContent = String(item.index);

      // Create outline around the element
      const outline = document.createElement("div");
      outline.setAttribute("data-webmap-annotation", "true");
      outline.style.cssText = `
        position: absolute;
        left: ${rect.left + window.scrollX - 2}px;
        top: ${rect.top + window.scrollY - 2}px;
        width: ${rect.width + 4}px;
        height: ${rect.height + 4}px;
        border: 2px solid #ff4444;
        border-radius: 3px;
        z-index: 999998;
        pointer-events: none;
      `;

      document.body.appendChild(outline);
      document.body.appendChild(badge);
    }
  }, selectors);

  // Capture the annotated screenshot
  const buffer = await page.screenshot({ type: "jpeg", quality: 75 });
  const screenshot = buffer.toString("base64");

  // Clean up annotations
  await page.evaluate(() => {
    document.querySelectorAll("[data-webmap-annotation]").forEach((el) => el.remove());
  });

  return { screenshot, legend };
}

/**
 * Dismiss common cookie consent banners and popup overlays.
 * Called after page load, before extracting accessibility data.
 */
async function dismissPopups(page: Page): Promise<void> {
  const consentSelectors = [
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    '[id*="cookie"] button',
    '[class*="cookie"] button',
    '[id*="consent"] button',
    '[class*="consent"] button',
  ];

  for (const selector of consentSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        await page.waitForTimeout(500);
        break;
      }
    } catch {
      // Continue trying other selectors
    }
  }
}

/**
 * Crawl a website and extract structured data from every page.
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const {
    url,
    maxDepth = 3,
    maxPages = 50,
    pageTimeout = 30000,
  } = options;

  const startTime = Date.now();
  const pages: PageData[] = [];
  const skippedUrls: string[] = [];
  const visitedUrls = new Set<string>();

  // Each crawl gets its own storage directory to allow concurrent crawls
  const storageDir = `./storage/crawl-${randomUUID()}`;
  const config = new Configuration({ storageClientOptions: { localDataDirectory: storageDir } });

  // Parse the base domain for same-origin filtering
  const baseUrl = new URL(url);
  const baseDomain = baseUrl.hostname;

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxPages,
    maxConcurrency: 3,
    requestHandlerTimeoutSecs: pageTimeout / 1000,
    headless: true,
    navigationTimeoutSecs: 30,
    browserPoolOptions: {
      maxOpenPagesPerBrowser: 3,
      retireBrowserAfterPageCount: 20,
      operationTimeoutSecs: 60,
    },
    launchContext: {
      launchOptions: {
        args: [
          "--disable-gpu",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-setuid-sandbox",
        ],
        timeout: 30000,
      },
    },

    async requestHandler({ request, page, enqueueLinks, log }: PlaywrightCrawlingContext) {
      const currentUrl = request.loadedUrl || request.url;

      // Skip if already visited (dedup)
      if (visitedUrls.has(currentUrl)) return;
      visitedUrls.add(currentUrl);

      log.info(`Crawling: ${currentUrl}`);

      // Wait for page to be reasonably loaded
      await page.waitForLoadState("domcontentloaded");
      // Wait for network idle (no requests for 500ms), capped at 5s
      await Promise.race([
        page.waitForLoadState("networkidle").catch(() => {}),
        page.waitForTimeout(5000),
      ]);

      // Dismiss cookie consent and common popup overlays
      await dismissPopups(page);

      // Extract page title
      const title = await page.title();

      // Get accessibility tree snapshot
      const accessibilitySnapshot = await getAccessibilitySnapshot(page);

      // Parse elements from accessibility tree
      const elements = parseAccessibilitySnapshot(accessibilitySnapshot);

      // Extract forms
      const forms = await extractForms(page);

      // Capture annotated screenshot with numbered element overlays
      let annotatedScreenshot: string | undefined;
      try {
        const annotation = await captureAnnotatedScreenshot(page, elements);
        annotatedScreenshot = annotation.screenshot;
      } catch {
        // Non-critical — continue without annotated screenshot
      }

      // Build page data (purpose, howToReach, dynamicBehavior filled by LLM later)
      const pageData: PageData = {
        url: currentUrl,
        title,
        purpose: "",
        howToReach: "",
        elements,
        forms,
        dynamicBehavior: [],
        accessibilitySnapshot,
        annotatedScreenshot,
      };

      pages.push(pageData);

      // Discover and enqueue links (same domain only)
      await enqueueLinks({
        strategy: "same-domain",
        transformRequestFunction: (req) => {
          const reqUrl = new URL(req.url);
          // Only follow same-domain links
          if (reqUrl.hostname !== baseDomain) return false;
          // Skip common non-page URLs
          if (/\.(pdf|zip|png|jpg|gif|svg|css|js|woff|ttf)$/i.test(reqUrl.pathname)) {
            return false;
          }
          return req;
        },
      });
    },

    failedRequestHandler({ request, log }) {
      log.warning(`Failed to crawl: ${request.url}`);
      skippedUrls.push(request.url);
    },
  }, config);

  try {
    await crawler.run([url]);
  } finally {
    // Clean up isolated storage directory
    await rm(storageDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    pages,
    skippedUrls,
    durationMs: Date.now() - startTime,
  };
}
