#!/usr/bin/env node
/**
 * Benchmark Suite Runner — standalone CLI for running the full multi-method
 * benchmark against curated sites and tasks.
 *
 * Usage:
 *   npm run run-suite                  # Run full suite (all 7 methods, 5 sites)
 *   npm run run-suite -- --yes         # Skip cost confirmation
 *   npm run run-suite -- --methods none,micro-guide,first-message
 *   npm run run-suite -- --sites 3     # Only use first N sites
 *   npm run run-suite -- --runs 3      # Run each task 3 times (majority vote)
 *   npm run run-suite -- --verify      # Enable automated success verification
 */

import { crawlSite, DocGenerator, formatAsMarkdown } from "@webmap/core";
import type { SiteDocumentation } from "@webmap/core";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

import {
  runMultiMethodBenchmark,
  ALL_DOC_METHODS,
  type DocMethod,
  type MultiMethodBenchmarkResult,
} from "./runner.js";
import { SUITE_SITES, SUITE_TASKS } from "./tasks/suite-tasks.js";
import {
  generateMultiMethodReport,
  printMultiMethodSummary,
} from "./multi-report.js";

// ─── CLI Argument Parsing ────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--yes" || args[i] === "-y") {
      flags.yes = true;
    } else if (args[i] === "--verify") {
      flags.verify = true;
    } else if (args[i] === "--methods" && args[i + 1]) {
      flags.methods = args[++i];
    } else if (args[i] === "--sites" && args[i + 1]) {
      flags.sites = args[++i];
    } else if (args[i] === "--runs" && args[i + 1]) {
      flags.runs = args[++i];
    }
  }

  return flags;
}

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ─── Cost Estimation ────────────────────────────────────────────

function estimateCost(
  siteCount: number,
  tasksPerSite: number,
  methodCount: number,
  runsPerTask: number,
  verify: boolean
): { totalRuns: number; estimatedCost: number; estimatedMinutes: number } {
  const totalRuns = siteCount * tasksPerSite * methodCount * runsPerTask;
  // ~$0.10 per CUA task run + ~$0.30 per site for crawl+doc gen + ~$0.01 per verification
  const verifyCost = verify ? totalRuns * 0.01 : 0;
  const estimatedCost = totalRuns * 0.1 + siteCount * 0.3 + verifyCost;
  // ~60s per task run on average
  const estimatedMinutes = (totalRuns * 60 + siteCount * 180) / 60;
  return { totalRuns, estimatedCost, estimatedMinutes };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable required.");
    process.exit(1);
  }

  // Parse methods
  let methods: DocMethod[] = ALL_DOC_METHODS;
  if (typeof flags.methods === "string") {
    methods = flags.methods.split(",").map((m) => m.trim()) as DocMethod[];
    const invalid = methods.filter((m) => !ALL_DOC_METHODS.includes(m));
    if (invalid.length > 0) {
      console.error(`Invalid methods: ${invalid.join(", ")}`);
      console.error(`Valid methods: ${ALL_DOC_METHODS.join(", ")}`);
      process.exit(1);
    }
  }

  // Parse site count
  const siteCount = typeof flags.sites === "string"
    ? Math.min(Math.max(parseInt(flags.sites, 10) || 5, 1), SUITE_SITES.length)
    : SUITE_SITES.length;

  // Parse runs per task
  const runsPerTask = typeof flags.runs === "string"
    ? Math.min(Math.max(parseInt(flags.runs, 10) || 1, 1), 10)
    : 1;
  const verifyResults = flags.verify === true;

  const sites = SUITE_SITES.slice(0, siteCount);
  const tasks = SUITE_TASKS.filter((t) =>
    sites.some((s) => t.url.startsWith(s.url))
  );

  const tasksPerSite = Math.ceil(tasks.length / sites.length);

  console.log("\n  WEBMAP BENCHMARK SUITE");
  console.log("  " + "─".repeat(40));
  console.log(`  Sites:   ${sites.length} (${sites.map((s) => s.name).join(", ")})`);
  console.log(`  Tasks:   ${tasks.length} total`);
  console.log(`  Methods: ${methods.length} (${methods.join(", ")})`);
  if (runsPerTask > 1) console.log(`  Runs:    ${runsPerTask} per task (majority vote)`);
  if (verifyResults) console.log(`  Verify:  Enabled (independent LLM judge)`);
  console.log("");

  // Cost estimate
  const estimate = estimateCost(sites.length, tasksPerSite, methods.length, runsPerTask, verifyResults);
  console.log(`  Estimated runs:     ${estimate.totalRuns}`);
  console.log(`  Estimated cost:     ~$${estimate.estimatedCost.toFixed(2)}`);
  console.log(`  Estimated duration: ~${estimate.estimatedMinutes.toFixed(0)} minutes`);
  console.log("");

  if (!flags.yes) {
    const proceed = await confirm("  Proceed with benchmark?");
    if (!proceed) {
      console.log("  Aborted.");
      process.exit(0);
    }
  }

  const startTime = Date.now();
  const client = new Anthropic({ apiKey });

  // ─── Phase 1: Crawl sites ──────────────────────────────────────
  console.log("\n  Phase 1: Crawling sites...\n");

  const documentation = new Map<string, SiteDocumentation>();

  for (const site of sites) {
    console.log(`  Crawling ${site.name} (${site.url})...`);
    try {
      const crawlResult = await crawlSite({
        url: site.url,
        maxPages: 10,
        maxDepth: 2,
      });
      console.log(`    Pages found: ${crawlResult.pages.length}`);

      // Generate CUA docs
      const generator = new DocGenerator({
        apiKey,
        cuaMode: true,
      });
      const doc = await generator.generate(crawlResult, {
        url: site.url,
        maxPages: 10,
        maxDepth: 2,
      });

      const domain = new URL(site.url).hostname;
      documentation.set(domain, doc);
      console.log(
        `    Doc generated: ${doc.metadata.totalPages} pages, ${doc.metadata.tokensUsed} tokens, confidence: ${(doc.metadata.avgConfidence * 100).toFixed(0)}%`
      );
    } catch (e) {
      console.error(`    Error crawling ${site.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\n  Crawled ${documentation.size}/${sites.length} sites.\n`);

  // ─── Phase 2: Run benchmark ────────────────────────────────────
  console.log("  Phase 2: Running benchmark...\n");

  // Build siteTasks map
  const siteTasks = new Map<
    string,
    { url: string; tasks: typeof tasks }
  >();

  for (const site of sites) {
    const domain = new URL(site.url).hostname;
    const siteScopedTasks = tasks.filter((t) => t.url.startsWith(site.url));
    if (siteScopedTasks.length > 0) {
      siteTasks.set(domain, { url: site.url, tasks: siteScopedTasks });
    }
  }

  const result = await runMultiMethodBenchmark(siteTasks, documentation, {
    apiKey,
    methods,
    sequential: true, // Avoid API rate limits
    runsPerTask,
    verifyResults,
    onProgress: (update) => {
      const runInfo = update.currentRun && update.totalRuns && update.totalRuns > 1
        ? ` (run ${update.currentRun}/${update.totalRuns})`
        : "";
      if (update.site && update.method) {
        process.stdout.write(
          `\r  [${update.tasksCompleted}/${update.tasksTotal}] ${update.site} — ${update.method}${runInfo}    `
        );
      }
    },
  });

  console.log("\n");

  // ─── Phase 3: Save results ─────────────────────────────────────
  const resultsDir = path.resolve("benchmark-results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .substring(0, 19);

  const jsonPath = path.join(resultsDir, `suite-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`  Results saved: ${jsonPath}`);

  const reportMarkdown = generateMultiMethodReport(result);
  const mdPath = path.join(resultsDir, `suite-${timestamp}.md`);
  fs.writeFileSync(mdPath, reportMarkdown);
  console.log(`  Report saved:  ${mdPath}`);

  // ─── Phase 4: Print summary ────────────────────────────────────
  printMultiMethodSummary(result);

  const totalDuration = Date.now() - startTime;
  console.log(
    `  Total time: ${(totalDuration / 60_000).toFixed(1)} minutes`
  );
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
