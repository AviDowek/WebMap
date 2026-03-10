import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAsMarkdown } from "./markdown-formatter.js";
import type { SiteDocumentation } from "../types.js";

function makeDoc(overrides: Partial<SiteDocumentation> = {}): SiteDocumentation {
  return {
    domain: "example.com",
    rootUrl: "https://example.com",
    description: "An example website.",
    crawledAt: "2025-01-01T00:00:00Z",
    siteMap: { rootUrl: "https://example.com", pages: [] },
    pages: [],
    workflows: [],
    metadata: {
      totalPages: 0,
      totalElements: 0,
      totalWorkflows: 0,
      crawlDurationMs: 1000,
      tokensUsed: 500,
      llmRetries: 0,
      llmFailures: 0,
      avgConfidence: 1.0,
      enrichmentRate: 1.0,
    },
    ...overrides,
  };
}

describe("formatAsMarkdown", () => {
  it("includes domain in header", () => {
    const md = formatAsMarkdown(makeDoc());
    assert.ok(md.includes("# Site: example.com"));
  });

  it("includes site description", () => {
    const md = formatAsMarkdown(makeDoc({ description: "Test description" }));
    assert.ok(md.includes("> Test description"));
  });

  it("includes metadata line", () => {
    const md = formatAsMarkdown(makeDoc({ metadata: {
      totalPages: 5, totalElements: 20, totalWorkflows: 2,
      crawlDurationMs: 1000, tokensUsed: 500,
      llmRetries: 0, llmFailures: 0, avgConfidence: 1.0, enrichmentRate: 1.0,
    }}));
    assert.ok(md.includes("Pages: 5"));
    assert.ok(md.includes("Elements: 20"));
    assert.ok(md.includes("Workflows: 2"));
  });

  it("formats site map nodes", () => {
    const md = formatAsMarkdown(makeDoc({
      siteMap: {
        rootUrl: "https://example.com",
        pages: [{
          url: "https://example.com",
          title: "Home",
          description: "Homepage",
          requiresAuth: false,
          children: [],
        }],
      },
    }));
    assert.ok(md.includes("[Home](https://example.com)"));
    assert.ok(md.includes("Homepage"));
  });

  it("formats nested site map with children", () => {
    const md = formatAsMarkdown(makeDoc({
      siteMap: {
        rootUrl: "https://example.com",
        pages: [{
          url: "https://example.com",
          title: "Home",
          description: "",
          requiresAuth: false,
          children: [{
            url: "https://example.com/about",
            title: "About",
            description: "About us",
            requiresAuth: false,
            children: [],
          }],
        }],
      },
    }));
    assert.ok(md.includes("  - [About]"));
  });

  it("formats page with elements table", () => {
    const md = formatAsMarkdown(makeDoc({
      pages: [{
        url: "https://example.com/page",
        title: "Test Page",
        purpose: "Test purpose",
        howToReach: "",
        elements: [{
          role: "button",
          name: "Submit",
          selector: 'role=button, name="Submit"',
          type: "button",
          action: "Click",
          result: "Submits form",
        }],
        forms: [],
        dynamicBehavior: [],
      }],
    }));
    assert.ok(md.includes("| Submit |"));
    assert.ok(md.includes("### Interactive Elements"));
  });

  it("formats workflows", () => {
    const md = formatAsMarkdown(makeDoc({
      workflows: [{
        name: "Login Flow",
        description: "Log into the site",
        steps: [{
          step: 1,
          description: "Click login button",
          selector: 'role=button, name="Login"',
          actionType: "click",
          expectedResult: "Login modal opens",
        }],
      }],
    }));
    assert.ok(md.includes("### Login Flow"));
    assert.ok(md.includes("Log into the site"));
    assert.ok(md.includes("1. Click login button"));
  });

  it("handles empty pages", () => {
    const md = formatAsMarkdown(makeDoc());
    assert.ok(md.includes("## Site Map"));
    assert.ok(!md.includes("## Page:"));
  });

  it("formats page purpose", () => {
    const md = formatAsMarkdown(makeDoc({
      pages: [{
        url: "https://example.com/",
        title: "Home",
        purpose: "The main landing page",
        howToReach: "",
        elements: [],
        forms: [],
        dynamicBehavior: [],
      }],
    }));
    assert.ok(md.includes("The main landing page"));
  });

  it("formats dynamic behavior", () => {
    const md = formatAsMarkdown(makeDoc({
      pages: [{
        url: "https://example.com/",
        title: "Home",
        purpose: "Home",
        howToReach: "",
        elements: [],
        forms: [],
        dynamicBehavior: ["Infinite scroll", "Auto-refresh every 30s"],
      }],
    }));
    assert.ok(md.includes("- Infinite scroll"));
    assert.ok(md.includes("- Auto-refresh every 30s"));
  });
});
