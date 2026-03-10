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
};

export const DOC_METHOD_DESCRIPTIONS: Record<DocMethod, string> = {
  "none": "No documentation — pure vision-based navigation. The CUA agent receives only a screenshot and the task instruction. This is the control group.",
  "micro-guide": "~100 token summary injected into the system prompt every turn. Contains domain name, one-line layout description, and a navigation hint. Compounds across turns.",
  "full-guide": "~400 token guide in the system prompt with visual layout, navigation strategy, and site map. More detailed than micro but compounds across all turns (~7,200 extra tokens over 18 steps).",
  "first-message": "Full documentation injected once in the first user message only. Doesn't compound across turns since it's not in the system prompt. One-time cost.",
  "pre-plan": "Uses docs to generate a task-specific step-by-step plan via a separate Claude call before the CUA agent starts. Plan is injected into the system prompt (~150 tokens/turn).",
  "a11y-tree": "Text-only agent using accessibility tree instead of screenshots. Uses Haiku (fast/cheap). Tests whether structured page data is sufficient without vision.",
  "hybrid": "Vision agent enhanced with accessibility tree text alongside each screenshot. Tests whether adding structured element data improves the vision agent.",
};

export const ALL_DOC_METHODS: DocMethod[] = ["none", "micro-guide", "full-guide", "first-message", "pre-plan", "a11y-tree", "hybrid"];

export const METHOD_COLORS: Record<DocMethod, string> = {
  "none": "#888",
  "micro-guide": "#3b82f6",
  "full-guide": "#8b5cf6",
  "first-message": "#f59e0b",
  "pre-plan": "#22c55e",
  "a11y-tree": "#ec4899",
  "hybrid": "#06b6d4",
};
