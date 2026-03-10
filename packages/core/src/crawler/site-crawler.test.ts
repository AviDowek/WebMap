import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAccessibilitySnapshot, getDefaultAction } from "./site-crawler.js";

describe("parseAccessibilitySnapshot", () => {
  it("parses a button element", () => {
    const result = parseAccessibilitySnapshot('- button "Submit"');
    assert.equal(result.length, 1);
    assert.equal(result[0].role, "button");
    assert.equal(result[0].name, "Submit");
    assert.equal(result[0].action, "Click");
    assert.equal(result[0].selector, 'role=button, name="Submit"');
  });

  it("parses a link element", () => {
    const result = parseAccessibilitySnapshot('- link "Products"');
    assert.equal(result.length, 1);
    assert.equal(result[0].role, "link");
    assert.equal(result[0].name, "Products");
    assert.equal(result[0].action, "Click to navigate");
  });

  it("parses element with disabled state", () => {
    const result = parseAccessibilitySnapshot('- button "Save" [disabled]');
    assert.equal(result.length, 1);
    assert.equal(result[0].state, "disabled");
  });

  it("parses element without state as enabled", () => {
    const result = parseAccessibilitySnapshot('- button "Go"');
    assert.equal(result[0].state, "enabled");
  });

  it("parses named link with colon", () => {
    const result = parseAccessibilitySnapshot('- link "Home":');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Home");
  });

  it("ignores non-interactive roles", () => {
    const result = parseAccessibilitySnapshot('- heading "Title"');
    assert.equal(result.length, 0);
  });

  it("ignores unnamed elements", () => {
    const result = parseAccessibilitySnapshot('- button ""');
    assert.equal(result.length, 0);
  });

  it("handles empty input", () => {
    const result = parseAccessibilitySnapshot("");
    assert.equal(result.length, 0);
  });

  it("parses textbox", () => {
    const result = parseAccessibilitySnapshot('- textbox "Email"');
    assert.equal(result.length, 1);
    assert.equal(result[0].role, "textbox");
    assert.equal(result[0].action, "Type text");
  });

  it("parses combobox", () => {
    const result = parseAccessibilitySnapshot('- combobox "Country"');
    assert.equal(result[0].action, "Select option");
  });

  it("parses checkbox", () => {
    const result = parseAccessibilitySnapshot('- checkbox "Remember me"');
    assert.equal(result[0].action, "Toggle");
  });

  it("parses searchbox", () => {
    const result = parseAccessibilitySnapshot('- searchbox "Search"');
    assert.equal(result[0].action, "Type text");
  });

  it("parses tab", () => {
    const result = parseAccessibilitySnapshot('- tab "Settings"');
    assert.equal(result[0].action, "Click to switch tab");
  });

  it("parses slider", () => {
    const result = parseAccessibilitySnapshot('- slider "Volume"');
    assert.equal(result[0].action, "Adjust value");
  });

  it("parses multi-line snapshot with mixed roles", () => {
    const snapshot = `- heading "Welcome"
- button "Sign In"
- link "About Us"
- paragraph "Some text"
- textbox "Username"`;
    const result = parseAccessibilitySnapshot(snapshot);
    assert.equal(result.length, 3);
    assert.equal(result[0].role, "button");
    assert.equal(result[1].role, "link");
    assert.equal(result[2].role, "textbox");
  });

  it("generates correct selectors", () => {
    const result = parseAccessibilitySnapshot('- radio "Option A"');
    assert.equal(result[0].selector, 'role=radio, name="Option A"');
  });
});

describe("getDefaultAction", () => {
  it("returns Click for button", () => {
    assert.equal(getDefaultAction("button"), "Click");
  });

  it("returns Click to navigate for link", () => {
    assert.equal(getDefaultAction("link"), "Click to navigate");
  });

  it("returns Type text for textbox", () => {
    assert.equal(getDefaultAction("textbox"), "Type text");
  });

  it("returns Type text for searchbox", () => {
    assert.equal(getDefaultAction("searchbox"), "Type text");
  });

  it("returns Select option for combobox", () => {
    assert.equal(getDefaultAction("combobox"), "Select option");
  });

  it("returns Toggle for checkbox", () => {
    assert.equal(getDefaultAction("checkbox"), "Toggle");
  });

  it("returns Toggle for switch", () => {
    assert.equal(getDefaultAction("switch"), "Toggle");
  });

  it("returns Select for radio", () => {
    assert.equal(getDefaultAction("radio"), "Select");
  });

  it("returns Click to switch tab for tab", () => {
    assert.equal(getDefaultAction("tab"), "Click to switch tab");
  });

  it("returns Adjust value for slider", () => {
    assert.equal(getDefaultAction("slider"), "Adjust value");
  });

  it("returns Interact for unknown role", () => {
    assert.equal(getDefaultAction("foobar"), "Interact");
  });
});
