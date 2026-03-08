#!/usr/bin/env node

/**
 * Benchmark CLI — run A/B tests to measure WebMap documentation effectiveness.
 *
 * Usage:
 *   npx @webmap/benchmark                    # Run sample tasks
 *   npx @webmap/benchmark --tasks tasks.json  # Run custom tasks
 */

import { runBenchmark, printBenchmarkSummary } from "./runner.js";
import { sampleTasks } from "./tasks/sample-tasks.js";
import { webmap } from "@webmap/core";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  console.log("WebMap Benchmark Runner");
  console.log("=======================\n");

  const tasks = sampleTasks;

  // First, generate documentation for all target domains
  const docsMap = new Map<string, string>();
  const domains = [...new Set(tasks.map((t) => new URL(t.url).hostname))];

  console.log(`Generating documentation for ${domains.length} domains...\n`);

  for (const domain of domains) {
    const task = tasks.find((t) => new URL(t.url).hostname === domain)!;
    console.log(`  Crawling ${domain}...`);
    try {
      const result = await webmap({
        url: task.url,
        maxPages: 15,
        maxDepth: 2,
      });
      docsMap.set(domain, result.markdown);
      console.log(
        `  ✓ ${domain}: ${result.documentation.metadata.totalPages} pages, ${result.documentation.metadata.totalElements} elements\n`
      );
    } catch (error) {
      console.log(
        `  ✗ ${domain}: ${error instanceof Error ? error.message : error}\n`
      );
    }
  }

  // Run the benchmark
  console.log("\nStarting A/B benchmark...\n");
  const result = await runBenchmark(tasks, docsMap);

  // Print results
  printBenchmarkSummary(result);

  // Save results
  const outputDir = "./benchmark-results";
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(
    outputDir,
    `benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

main().catch(console.error);
