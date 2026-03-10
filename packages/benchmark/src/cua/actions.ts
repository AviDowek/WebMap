/**
 * CUA key mapping and computer action execution.
 */

import type { Page } from "playwright";

export const KEY_MAP: Record<string, string> = {
  Return: "Enter",
  BackSpace: "Backspace",
  space: " ",
  Tab: "Tab",
  Escape: "Escape",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  Page_Up: "PageUp",
  Page_Down: "PageDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Up: "ArrowUp",
  Down: "ArrowDown",
};

export function mapCuaKeyToPlaywright(key: string): string {
  // Handle combo keys like "ctrl+a" → "Control+a"
  if (key.includes("+")) {
    return key
      .split("+")
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === "ctrl" || lower === "control") return "Control";
        if (lower === "alt") return "Alt";
        if (lower === "shift") return "Shift";
        if (lower === "meta" || lower === "super" || lower === "cmd")
          return "Meta";
        return KEY_MAP[part] || part;
      })
      .join("+");
  }
  return KEY_MAP[key] || key;
}

export async function executeComputerAction(
  page: Page,
  input: Record<string, unknown>
): Promise<void> {
  const action = input.action as string;

  switch (action) {
    case "mouse_move":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.move(input.coordinate[0], input.coordinate[1]);
      }
      break;

    case "left_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.click(input.coordinate[0], input.coordinate[1]);
      }
      break;

    case "right_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.click(input.coordinate[0], input.coordinate[1], {
          button: "right",
        });
      }
      break;

    case "double_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.dblclick(input.coordinate[0], input.coordinate[1]);
      }
      break;

    case "triple_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.click(input.coordinate[0], input.coordinate[1], {
          clickCount: 3,
        });
      }
      break;

    case "middle_click":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.click(input.coordinate[0], input.coordinate[1], {
          button: "middle",
        });
      }
      break;

    case "type":
      if (typeof input.text === "string") {
        await page.keyboard.type(input.text);
      }
      break;

    case "key":
      if (typeof input.text === "string") {
        await page.keyboard.press(mapCuaKeyToPlaywright(input.text));
      }
      break;

    case "scroll":
      if (Array.isArray(input.coordinate)) {
        await page.mouse.move(input.coordinate[0], input.coordinate[1]);
      }
      await page.mouse.wheel(
        (input.delta_x as number) || 0,
        (input.delta_y as number) || 0
      );
      break;

    case "left_click_drag":
      if (
        Array.isArray(input.start_coordinate) &&
        Array.isArray(input.coordinate)
      ) {
        await page.mouse.move(
          input.start_coordinate[0],
          input.start_coordinate[1]
        );
        await page.mouse.down();
        await page.mouse.move(input.coordinate[0], input.coordinate[1]);
        await page.mouse.up();
      }
      break;

    case "screenshot":
      // No action — screenshot is taken after every action anyway
      break;

    case "wait":
      await page.waitForTimeout(2000);
      break;

    default:
      break;
  }
}
