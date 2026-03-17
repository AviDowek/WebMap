"use client";

import { useState } from "react";

// ─── Types ──────────────────────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

// ─── Styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: "#111",
  border: "1px solid #222",
  borderRadius: 12,
  padding: "24px 28px",
  marginBottom: 20,
};

const stepNum: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "50%",
  backgroundColor: "#3b82f6",
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
  marginRight: 12,
  flexShrink: 0,
};

const kbd: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  backgroundColor: "#1a1a2e",
  border: "1px solid #333",
  borderRadius: 4,
  fontSize: 13,
  fontFamily: "monospace",
  color: "#a5b4fc",
};

const tipBox: React.CSSProperties = {
  backgroundColor: "#0a1a2e",
  border: "1px solid #1a3a5f",
  borderRadius: 8,
  padding: "12px 16px",
  marginTop: 16,
  fontSize: 14,
  color: "#93c5fd",
};

const warnBox: React.CSSProperties = {
  backgroundColor: "#1a1500",
  border: "1px solid #3a2a00",
  borderRadius: 8,
  padding: "12px 16px",
  marginTop: 16,
  fontSize: 14,
  color: "#fbbf24",
};

// ─── Sections ───────────────────────────────────────────────────────────

const sections: Section[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    content: (
      <>
        <p style={{ color: "#aaa", lineHeight: 1.7, marginBottom: 16 }}>
          WebMap uses AI to crawl websites and generate structured documentation
          that other AI agents can use. Here is how to get set up.
        </p>

        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 16 }}>
          <span style={stepNum}>1</span>
          <div>
            <strong style={{ color: "#ededed" }}>Add your Anthropic API key</strong>
            <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>
              The yellow banner at the top of the app asks for your API key. Get one
              from{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener"
                style={{ color: "#3b82f6" }}>
                console.anthropic.com
              </a>.
              Your key stays in your browser and is never stored on our servers.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 16 }}>
          <span style={stepNum}>2</span>
          <div>
            <strong style={{ color: "#ededed" }}>Generate docs for your first site</strong>
            <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>
              Go to the <span style={kbd}>Generate</span> tab, paste any URL, and click
              Generate. WebMap will crawl the site, map its pages and interactive elements,
              and produce a markdown document.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <span style={stepNum}>3</span>
          <div>
            <strong style={{ color: "#ededed" }}>Explore the other tabs</strong>
            <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>
              Use <span style={kbd}>Batch Test</span> to process many sites at once,{" "}
              <span style={kbd}>Benchmark</span> to compare AI agent methods, and{" "}
              <span style={kbd}>APIs</span> to inspect auto-generated site APIs.
            </p>
          </div>
        </div>

        <div style={tipBox}>
          <strong>Tip:</strong> Documentation is cached per domain. If you generate
          docs for the same site again, it will be instant unless you click Regenerate.
        </div>
      </>
    ),
  },
  {
    id: "generate",
    title: "Generate Tab",
    content: (
      <>
        <p style={{ color: "#aaa", lineHeight: 1.7, marginBottom: 16 }}>
          The Generate tab is the core feature. It crawls a website and produces
          comprehensive markdown documentation that AI agents can use to navigate
          and interact with the site.
        </p>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>What it produces</h4>
        <ul style={{ color: "#888", lineHeight: 1.8, paddingLeft: 20, marginBottom: 16 }}>
          <li><strong style={{ color: "#ccc" }}>Site structure</strong> - all pages, their URLs, and hierarchy</li>
          <li><strong style={{ color: "#ccc" }}>Interactive elements</strong> - buttons, forms, dropdowns, links with their roles and labels</li>
          <li><strong style={{ color: "#ccc" }}>Workflows</strong> - common multi-step tasks like "add to cart", "log in", etc.</li>
          <li><strong style={{ color: "#ccc" }}>Navigation patterns</strong> - how to get between pages</li>
        </ul>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>How it works</h4>
        <ol style={{ color: "#888", lineHeight: 1.8, paddingLeft: 20 }}>
          <li><strong style={{ color: "#ccc" }}>Crawl</strong> - Playwright browser visits pages and builds a site map</li>
          <li><strong style={{ color: "#ccc" }}>Analyze</strong> - Claude reads each page's accessibility tree to identify elements</li>
          <li><strong style={{ color: "#ccc" }}>Format</strong> - Results are compiled into a single structured markdown document</li>
        </ol>

        <div style={tipBox}>
          <strong>Tip:</strong> After generating docs, use the copy button to paste
          them into any AI assistant's context. The docs are designed to be
          token-efficient while maximizing the agent's understanding of the site.
        </div>
      </>
    ),
  },
  {
    id: "batch",
    title: "Batch Test Tab",
    content: (
      <>
        <p style={{ color: "#aaa", lineHeight: 1.7, marginBottom: 16 }}>
          Batch Test lets you generate documentation for up to 20 websites in
          parallel. Paste one URL per line and click Start.
        </p>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>When to use it</h4>
        <ul style={{ color: "#888", lineHeight: 1.8, paddingLeft: 20, marginBottom: 16 }}>
          <li>Pre-generating docs for a set of sites your agents will use</li>
          <li>Testing WebMap's performance across different kinds of sites</li>
          <li>Building a documentation library for your team</li>
        </ul>

        <p style={{ color: "#aaa", lineHeight: 1.7 }}>
          Each site runs independently, so one failure won't affect the rest.
          Results show per-site stats: pages found, interactive elements, workflows
          detected, and token count.
        </p>
      </>
    ),
  },
  {
    id: "benchmark",
    title: "Benchmark Tab",
    content: (
      <>
        <p style={{ color: "#aaa", lineHeight: 1.7, marginBottom: 16 }}>
          The Benchmark tab is WebMap's research tool. It runs real AI agent tasks
          on websites using different methods and compares their effectiveness.
        </p>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>Core concept</h4>
        <p style={{ color: "#888", lineHeight: 1.7, marginBottom: 16 }}>
          A "benchmark" gives an AI agent a task (like "search for laptops" or
          "add an item to cart") and measures whether it succeeds, how many tokens
          it uses, how long it takes, and how much it costs.
        </p>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>Methods</h4>
        <p style={{ color: "#888", lineHeight: 1.7, marginBottom: 12 }}>
          WebMap supports 11 different CUA (Computer Use Agent) methods. Each
          approaches the task differently:
        </p>
        <ul style={{ color: "#888", lineHeight: 1.8, paddingLeft: 20, marginBottom: 16 }}>
          <li><strong style={{ color: "#ccc" }}>Baseline (none)</strong> - Raw vision-based agent, no docs</li>
          <li><strong style={{ color: "#ccc" }}>Guide methods</strong> - Inject documentation as system prompt or first message</li>
          <li><strong style={{ color: "#ccc" }}>A11y Tree</strong> - Uses accessibility tree instead of screenshots (faster, cheaper)</li>
          <li><strong style={{ color: "#ccc" }}>Hybrid</strong> - Both screenshots and accessibility tree</li>
          <li><strong style={{ color: "#ccc" }}>Cascade</strong> - Starts cheap (Haiku), escalates to powerful (Sonnet) when stuck</li>
          <li><strong style={{ color: "#ccc" }}>Programmatic</strong> - Pre-built site APIs, no vision needed</li>
        </ul>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>Multi-method comparison</h4>
        <p style={{ color: "#888", lineHeight: 1.7, marginBottom: 12 }}>
          Select multiple methods and run them against the same sites/tasks.
          WebMap produces a comparison table with composite scores (50% accuracy,
          30% cost efficiency, 20% speed).
        </p>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>Industry datasets</h4>
        <p style={{ color: "#888", lineHeight: 1.7, marginBottom: 12 }}>
          Toggle "Industry Benchmark" as the task source to use standard research
          datasets like Mind2Web, WebBench, and WebArena. These provide hundreds
          of pre-defined tasks on real websites.
        </p>

        <div style={warnBox}>
          <strong>Cost warning:</strong> Benchmarks run real AI agent tasks and
          consume API tokens. A small run (3 sites, 3 tasks, 2 methods) costs
          roughly $1-2. Large runs with many methods can be expensive. Always
          check the cost estimate before starting.
        </div>
      </>
    ),
  },
  {
    id: "apis",
    title: "APIs Tab",
    content: (
      <>
        <p style={{ color: "#aaa", lineHeight: 1.7, marginBottom: 16 }}>
          The APIs tab shows programmatic interfaces that WebMap auto-discovers
          from websites. These are typed, testable functions that an AI agent can
          call instead of relying on screenshots.
        </p>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>How it works</h4>
        <ol style={{ color: "#888", lineHeight: 1.8, paddingLeft: 20, marginBottom: 16 }}>
          <li><strong style={{ color: "#ccc" }}>Discovery</strong> - Crawls the site, clicks interactive elements, and intercepts network requests</li>
          <li><strong style={{ color: "#ccc" }}>Generation</strong> - Creates typed functions for every interaction (click, fill, select, navigate)</li>
          <li><strong style={{ color: "#ccc" }}>Self-testing</strong> - Runs each function to verify it works, marking reliability</li>
        </ol>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>What you see</h4>
        <ul style={{ color: "#888", lineHeight: 1.8, paddingLeft: 20 }}>
          <li><strong style={{ color: "#ccc" }}>Domain selector</strong> - Pick which site's APIs to view</li>
          <li><strong style={{ color: "#ccc" }}>Stats cards</strong> - Total actions, verified count, failure count, pages covered</li>
          <li><strong style={{ color: "#ccc" }}>Page groups</strong> - Actions organized by URL pattern, expandable</li>
          <li><strong style={{ color: "#ccc" }}>Action detail</strong> - Steps, params, expected results, reliability badge</li>
        </ul>

        <div style={tipBox}>
          <strong>Tip:</strong> To discover APIs for a new site, click "Discover
          APIs", enter the URL, and wait. Discovery takes 2-5 minutes depending
          on site size.
        </div>
      </>
    ),
  },
  {
    id: "api-key",
    title: "API Key & Privacy",
    content: (
      <>
        <p style={{ color: "#aaa", lineHeight: 1.7, marginBottom: 16 }}>
          WebMap uses a Bring Your Own Key (BYOK) model. You provide your own
          Anthropic API key, and all AI costs go to your account.
        </p>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>How your key is handled</h4>
        <ul style={{ color: "#888", lineHeight: 1.8, paddingLeft: 20, marginBottom: 16 }}>
          <li>Your key is stored <strong style={{ color: "#ccc" }}>only in your browser's localStorage</strong></li>
          <li>It is sent to the WebMap server per-request as a header</li>
          <li>The server uses it to call the Anthropic API and never saves it to disk</li>
          <li>Clearing your browser data or clicking "Remove" deletes it completely</li>
        </ul>

        <h4 style={{ color: "#ededed", marginBottom: 8 }}>Getting a key</h4>
        <ol style={{ color: "#888", lineHeight: 1.8, paddingLeft: 20 }}>
          <li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style={{ color: "#3b82f6" }}>console.anthropic.com/settings/keys</a></li>
          <li>Click "Create Key"</li>
          <li>Copy the key (starts with <span style={kbd}>sk-ant-</span>)</li>
          <li>Paste it into the yellow banner at the top of the app</li>
        </ol>

        <h4 style={{ color: "#ededed", marginBottom: 8, marginTop: 16 }}>Your data</h4>
        <p style={{ color: "#888", lineHeight: 1.7 }}>
          All documentation, benchmarks, and API discoveries you create are tied
          to your account and visible only to you. Other users cannot see your data.
        </p>
      </>
    ),
  },
];

// ─── Component ──────────────────────────────────────────────────────────

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState("getting-started");

  return (
    <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
      {/* Sidebar nav */}
      <nav style={{
        position: "sticky",
        top: 20,
        minWidth: 200,
        flexShrink: 0,
      }}>
        <div style={{
          backgroundColor: "#111",
          border: "1px solid #222",
          borderRadius: 12,
          padding: "12px 0",
        }}>
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveSection(s.id);
                document.getElementById(`guide-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 20px",
                fontSize: 14,
                textAlign: "left",
                backgroundColor: activeSection === s.id ? "#1a1a2e" : "transparent",
                color: activeSection === s.id ? "#3b82f6" : "#888",
                fontWeight: activeSection === s.id ? 600 : 400,
                border: "none",
                borderLeft: activeSection === s.id ? "3px solid #3b82f6" : "3px solid transparent",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {s.title}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: "#ededed", marginBottom: 4 }}>
            How to Use WebMap
          </h2>
          <p style={{ color: "#666", fontSize: 15 }}>
            Everything you need to know to get started and make the most of each feature.
          </p>
        </div>

        {sections.map((s) => (
          <div key={s.id} id={`guide-${s.id}`} style={card}>
            <h3 style={{ fontSize: 20, fontWeight: 600, color: "#ededed", marginBottom: 16 }}>
              {s.title}
            </h3>
            {s.content}
          </div>
        ))}
      </div>
    </div>
  );
}
