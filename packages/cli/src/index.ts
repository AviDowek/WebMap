#!/usr/bin/env node

/**
 * WebMap CLI — Generate AI agent documentation for any website.
 *
 * Usage:
 *   npx webmap https://example.com
 *   npx webmap https://example.com --depth 5 --max-pages 100 --output ./docs
 */

import { program } from "commander";
import ora from "ora";
import chalk from "chalk";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { webmap } from "@webmap/core";

program
  .name("webmap")
  .description("Generate AI agent documentation for any website")
  .version("0.1.0")
  .argument("<url>", "URL to crawl and document")
  .option("-d, --depth <number>", "Maximum crawl depth", "3")
  .option("-p, --max-pages <number>", "Maximum pages to crawl", "50")
  .option("-o, --output <dir>", "Output directory", "./generated")
  .option("--no-screenshots", "Skip taking screenshots")
  .option("--vision", "Use vision model for unlabeled elements")
  .option("--model <model>", "Claude model for analysis", "claude-sonnet-4-20250514")
  .option("--api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY)")
  .action(async (url: string, opts) => {
    console.log("");
    console.log(
      chalk.bold.cyan("  WebMap") +
        chalk.gray(" — AI Agent Website Documentation Generator")
    );
    console.log("");

    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(
        chalk.red(
          "Error: Anthropic API key required. Set ANTHROPIC_API_KEY or use --api-key"
        )
      );
      process.exit(1);
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      console.error(chalk.red(`Error: Invalid URL: ${url}`));
      process.exit(1);
    }

    const domain = new URL(url).hostname;
    const spinner = ora(`Crawling ${chalk.bold(domain)}...`).start();

    try {
      const startTime = Date.now();

      // Run WebMap
      const result = await webmap({
        url,
        maxDepth: parseInt(opts.depth),
        maxPages: parseInt(opts.maxPages),
        screenshots: opts.screenshots !== false,
        useVision: opts.vision || false,
        apiKey,
        pageModel: opts.model,
        synthesisModel: opts.model,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      spinner.succeed(`Crawled ${chalk.bold(domain)} in ${elapsed}s`);

      // Save output
      const outputDir = join(opts.output, domain);
      await mkdir(outputDir, { recursive: true });

      const mdPath = join(outputDir, "documentation.md");
      await writeFile(mdPath, result.markdown, "utf-8");

      const jsonPath = join(outputDir, "documentation.json");
      await writeFile(
        jsonPath,
        JSON.stringify(result.documentation, null, 2),
        "utf-8"
      );

      // Summary
      const meta = result.documentation.metadata;
      console.log("");
      console.log(chalk.green("  Documentation generated successfully!"));
      console.log("");
      console.log(`  ${chalk.gray("Pages:")}      ${meta.totalPages}`);
      console.log(`  ${chalk.gray("Elements:")}   ${meta.totalElements}`);
      console.log(`  ${chalk.gray("Workflows:")}  ${meta.totalWorkflows}`);
      console.log(`  ${chalk.gray("Tokens:")}     ${meta.tokensUsed.toLocaleString()}`);
      console.log(`  ${chalk.gray("Duration:")}   ${(meta.crawlDurationMs / 1000).toFixed(1)}s`);
      console.log("");
      console.log(`  ${chalk.gray("Markdown:")}   ${mdPath}`);
      console.log(`  ${chalk.gray("JSON:")}       ${jsonPath}`);
      console.log("");
    } catch (error) {
      spinner.fail("Crawl failed");
      console.error(
        chalk.red(`\nError: ${error instanceof Error ? error.message : error}`)
      );
      process.exit(1);
    }
  });

program.parse();
