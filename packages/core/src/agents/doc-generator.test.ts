import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractText, safeParseJson, sanitize } from "./doc-generator.js";

describe("safeParseJson", () => {
  it("parses valid JSON object", () => {
    const result = safeParseJson('{"key": "value"}');
    assert.deepEqual(result, { key: "value" });
  });

  it("extracts JSON from surrounding text", () => {
    const result = safeParseJson('Here is the result: {"key": "value"} end');
    assert.deepEqual(result, { key: "value" });
  });

  it("returns null for no JSON", () => {
    assert.equal(safeParseJson("no json here"), null);
  });

  it("returns null for JSON array", () => {
    assert.equal(safeParseJson("[1,2,3]"), null);
  });

  it("returns null for broken JSON", () => {
    assert.equal(safeParseJson('{"broken'), null);
  });

  it("parses nested objects", () => {
    const result = safeParseJson('{"a": {"b": 1}}');
    assert.deepEqual(result, { a: { b: 1 } });
  });

  it("returns null for empty string", () => {
    assert.equal(safeParseJson(""), null);
  });
});

describe("sanitize", () => {
  it("strips HTML tags", () => {
    assert.equal(sanitize("<b>bold</b>"), "bold");
  });

  it("strips control characters", () => {
    assert.equal(sanitize("hello\x00world"), "helloworld");
  });

  it("returns empty for non-string", () => {
    assert.equal(sanitize(42), "");
  });

  it("returns empty for undefined", () => {
    assert.equal(sanitize(undefined), "");
  });

  it("returns empty for null", () => {
    assert.equal(sanitize(null), "");
  });

  it("trims whitespace", () => {
    assert.equal(sanitize("  hello  "), "hello");
  });

  it("passes through clean strings", () => {
    assert.equal(sanitize("hello world"), "hello world");
  });

  it("strips nested HTML tags", () => {
    assert.equal(sanitize("<div><span>text</span></div>"), "text");
  });
});

describe("extractText", () => {
  it("extracts text from text block", () => {
    const msg = { content: [{ type: "text" as const, text: "hello" }] } as any;
    assert.equal(extractText(msg), "hello");
  });

  it("returns empty for empty content", () => {
    const msg = { content: [] } as any;
    assert.equal(extractText(msg), "");
  });

  it("returns empty for non-text block", () => {
    const msg = { content: [{ type: "tool_use" as const, id: "1", name: "t", input: {} }] } as any;
    assert.equal(extractText(msg), "");
  });

  it("returns empty for undefined content", () => {
    const msg = { content: undefined } as any;
    assert.equal(extractText(msg), "");
  });
});
