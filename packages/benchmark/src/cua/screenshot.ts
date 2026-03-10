/**
 * Screenshot capture and accessibility snapshot utilities.
 */

import type { Page } from "playwright";

export async function captureScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality: 85 });
  return buffer.toString("base64");
}

export async function getA11ySnapshot(page: Page): Promise<string> {
  try {
    return await page.locator("body").ariaSnapshot();
  } catch {
    return "(accessibility tree unavailable)";
  }
}
