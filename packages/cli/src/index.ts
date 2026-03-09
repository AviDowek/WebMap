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
  .option("-d, --depth <number>", "Maximum crawl depth (1-5)", "3")
  .option("-p, --max-pages <number>", "Maximum pages to crawl (1-100)", "50")
  .option("-o, --output <dir>", "Output directory", "./generated")
  .option("--model <model>", "Claude model for analysis", "claude-sonnet-4-20250514")
  .action(async (url: string, opts) => {
    console.log("");
    console.log(
      chalk.bold.cyan("  WebMap") +
        chalk.gray(" — AI Agent Website Documentation Generator")
    );
    console.log("");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(
        chalk.red(
          "Error: ANTHROPIC_API_KEY environment variable is required."
        )
      );
      process.exit(1);
    }

    // Validate URL
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http/https URLs are allowed");
      }
    } catch (e) {
      console.error(chalk.red(`Error: Invalid URL: ${url}`));
      process.exit(1);
    }

    // Validate numeric options
    const maxDepth = Math.max(1, Math.min(5, parseInt(opts.depth, 10) || 3));
    const maxPages = Math.max(1, Math.min(100, parseInt(opts.maxPages, 10) || 50));

    const domain = new URL(url).hostname;
    const spinner = ora(`Crawling ${chalk.bold(domain)}...`).start();

    try {
      const startTime = Date.now();

      const result = await webmap({
        url,
        maxDepth,
        maxPages,
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
