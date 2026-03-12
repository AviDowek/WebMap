import type { DocMethod } from "./types";

// ─── Constants ───────────────────────────────────────────────────────

export const API_BASE =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
    : "http://localhost:3001";

export const PHASE_LABELS: Record<string, string> = {
  queued: "Queued — waiting to start...",
  crawling: "Crawling — discovering pages with Playwright...",
  analyzing: "Analyzing — enriching pages with Claude AI...",
  formatting: "Formatting — generating markdown documentation...",
};

export const MAX_POLL_ATTEMPTS = 120;
export const MAX_BENCHMARK_POLL_ATTEMPTS = 4800; // 4800 * 3s = 4 hours

export const DOC_METHOD_LABELS: Record<DocMethod, string> = {
  "none": "Baseline",
  "micro-guide": "Micro Guide",
  "full-guide": "Full Guide",
  "first-message": "First Msg",
  "pre-plan": "Pre-Plan",
  "a11y-tree": "A11y Tree",
  "hybrid": "Hybrid",
  "a11y-first-message": "A11y+FirstMsg",
  "haiku-vision": "Haiku Vision",
  "cascade": "Cascade",
  "programmatic": "Programmatic",
};

export const DOC_METHOD_DESCRIPTIONS: Record<DocMethod, string> = {
  "none": "No documentation — pure vision-based navigation. The CUA agent receives only a screenshot and the task instruction. This is the control group.",
  "micro-guide": "~100 token summary injected into the system prompt every turn. Contains domain name, one-line layout description, and a navigation hint. Compounds across turns.",
  "full-guide": "~400 token guide in the system prompt with visual layout, navigation strategy, and site map. More detailed than micro but compounds across all turns (~7,200 extra tokens over 18 steps).",
  "first-message": "Full documentation injected once in the first user message only. Doesn't compound across turns since it's not in the system prompt. One-time cost.",
  "pre-plan": "Uses Haiku to generate a task-specific step-by-step plan before the CUA agent starts. Plan is injected into the system prompt (~150 tokens/turn). Haiku planning is 3x cheaper than Sonnet.",
  "a11y-tree": "Text-only agent using accessibility tree instead of screenshots. Uses Haiku (fast/cheap). Tests whether structured page data is sufficient without vision.",
  "hybrid": "Vision agent enhanced with accessibility tree text alongside each screenshot. Tests whether adding structured element data improves the vision agent.",
  "a11y-first-message": "Combines A11y Tree (Haiku, text-only, 5.0 avg steps) with first-message site context injection. Orthogonal advantages: semantic navigation + site awareness. One-time doc cost, no compounding.",
  "haiku-vision": "Claude Haiku 4.5 with computer_use tool (vision/screenshot mode). 3x cheaper than Sonnet vision. Haiku 4.5 supports computer_use and achieves ~50% on CUA benchmarks.",
  "cascade": "Starts with Haiku vision (cheap), detects stuck state (same URL 3 steps or 2+ errors), escalates to Sonnet. Blended cost ~40% lower than pure Sonnet at similar or better accuracy.",
  "programmatic": "Pre-built site-specific API functions discovered via crawling. Uses Haiku (text-only). Agent calls typed functions instead of screenshots. Falls back to browser_action if APIs fail. APIs cached per domain (~$1.65 one-time generation cost).",
};

export const ALL_DOC_METHODS: DocMethod[] = [
  "none", "micro-guide", "full-guide", "first-message", "pre-plan",
  "a11y-tree", "hybrid", "a11y-first-message", "haiku-vision", "cascade", "programmatic",
];

export const METHOD_COLORS: Record<DocMethod, string> = {
  "none": "#888",
  "micro-guide": "#3b82f6",
  "full-guide": "#8b5cf6",
  "first-message": "#f59e0b",
  "pre-plan": "#22c55e",
  "a11y-tree": "#ec4899",
  "hybrid": "#06b6d4",
  "a11y-first-message": "#f97316",
  "haiku-vision": "#84cc16",
  "cascade": "#a78bfa",
  "programmatic": "#14b8a6",
};

/** Average tokens per task per method (from benchmark results) — used for pre-run cost estimates */
export const METHOD_AVG_TOKENS: Record<DocMethod, number> = {
  "none": 120_339,
  "micro-guide": 122_000,
  "full-guide": 127_000,
  "first-message": 132_331,
  "pre-plan": 125_000,
  "a11y-tree": 142_768,
  "hybrid": 381_972,
  "a11y-first-message": 145_000,
  "haiku-vision": 110_000,
  "cascade": 115_000,
  "programmatic": 80_000,
};

/** True if the method uses Haiku model (cheaper) — used for cost estimation */
export const METHOD_IS_HAIKU: Record<DocMethod, boolean> = {
  "none": false,
  "micro-guide": false,
  "full-guide": false,
  "first-message": false,
  "pre-plan": false,
  "hybrid": false,
  "a11y-tree": true,
  "haiku-vision": true,
  "a11y-first-message": true,
  "cascade": false, // blended ~60% Haiku + 40% Sonnet
  "programmatic": true,
};
