/**
 * Accessibility-tree based browser action tool and executor.
 */

import type { Page } from "playwright";

export const A11Y_BROWSER_TOOL = {
  name: "browser_action",
  description: "Execute a browser action. Use role and name from the accessibility tree to identify elements. For clicks/typing, specify the element's role and name. For scrolling, use direction. For key presses, use key.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["click", "type", "scroll", "key", "goto"],
        description: "The action to perform",
      },
      role: {
        type: "string",
        description: "ARIA role of the target element (e.g. 'link', 'button', 'textbox', 'heading')",
      },
      name: {
        type: "string",
        description: "Accessible name of the target element (the text label)",
      },
      text: {
        type: "string",
        description: "Text to type (for 'type' action) or key to press (for 'key' action)",
      },
      direction: {
        type: "string",
        enum: ["up", "down"],
        description: "Scroll direction (for 'scroll' action)",
      },
      url: {
        type: "string",
        description: "URL to navigate to (for 'goto' action)",
      },
    },
    required: ["action"],
  },
};

/**
 * Execute a browser action based on a11y-tree element references.
 * Maps role/name pairs to Playwright locators.
 */
export async function executeA11yAction(
  page: Page,
  input: Record<string, unknown>
): Promise<void> {
  const action = input.action as string;
  const role = input.role as string | undefined;
  const name = input.name as string | undefined;
  const text = input.text as string | undefined;

  switch (action) {
    case "click": {
      if (role && name) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0], { name }).first().click({ timeout: 5000 });
      } else if (name) {
        await page.getByText(name, { exact: false }).first().click({ timeout: 5000 });
      }
      break;
    }
    case "type": {
      if (role && name && text) {
        await page.getByRole(role as Parameters<Page["getByRole"]>[0], { name }).first().fill(text, { timeout: 5000 });
      } else if (name && text) {
        await page.getByLabel(name).first().fill(text, { timeout: 5000 });
      } else if (text) {
        await page.keyboard.type(text);
      }
      break;
    }
    case "key": {
      if (text) await page.keyboard.press(text);
      break;
    }
    case "scroll": {
      const dir = input.direction as string;
      await page.mouse.wheel(0, dir === "up" ? -500 : 500);
      break;
    }
    case "goto": {
      if (input.url) {
        await page.goto(input.url as string, { waitUntil: "domcontentloaded" });
      }
      break;
    }
  }
}
