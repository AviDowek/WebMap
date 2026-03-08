/**
 * Converts SiteDocumentation into comprehensive markdown output.
 */

import type {
  SiteDocumentation,
  SiteMapNode,
  PageData,
  Workflow,
} from "../types.js";

/**
 * Format a SiteDocumentation object as a comprehensive markdown string.
 */
export function formatAsMarkdown(doc: SiteDocumentation): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Site: ${doc.domain}`);
  sections.push(`> ${doc.description}`);
  sections.push("");
  sections.push(
    `*Crawled: ${doc.crawledAt} | Pages: ${doc.metadata.totalPages} | Elements: ${doc.metadata.totalElements} | Workflows: ${doc.metadata.totalWorkflows}*`
  );
  sections.push("");

  // Site Map
  sections.push("---");
  sections.push("");
  sections.push("## Site Map");
  sections.push("");
  for (const node of doc.siteMap.pages) {
    sections.push(formatSiteMapNode(node, 0));
  }
  sections.push("");

  // Pages
  sections.push("---");
  sections.push("");
  for (const page of doc.pages) {
    sections.push(formatPage(page));
  }

  // Workflows
  if (doc.workflows.length > 0) {
    sections.push("---");
    sections.push("");
    sections.push("## Workflows");
    sections.push("");
    for (const workflow of doc.workflows) {
      sections.push(formatWorkflow(workflow));
    }
  }

  return sections.join("\n");
}

function formatSiteMapNode(node: SiteMapNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const authTag = node.requiresAuth ? " (requires auth)" : "";
  let line = `${indent}- [${node.title || node.url}](${node.url})${authTag}`;
  if (node.description) {
    line += ` — ${node.description}`;
  }

  const childLines = node.children
    .map((child) => formatSiteMapNode(child, depth + 1))
    .join("\n");

  return childLines ? `${line}\n${childLines}` : line;
}

function formatPage(page: PageData): string {
  const sections: string[] = [];
  const urlPath = new URL(page.url).pathname || "/";

  sections.push(`## Page: ${urlPath}`);
  sections.push("");

  // Purpose
  sections.push("### Purpose");
  sections.push(page.purpose || page.title || "Unknown");
  sections.push("");

  // How to Reach
  if (page.howToReach) {
    sections.push("### How to Reach");
    sections.push(page.howToReach);
    sections.push("");
  }

  // Interactive Elements
  if (page.elements.length > 0) {
    sections.push("### Interactive Elements");
    sections.push("");
    sections.push("| Element | Type | Selector | Action | Result |");
    sections.push("|---------|------|----------|--------|--------|");
    for (const el of page.elements) {
      const escapedName = el.name.replace(/\|/g, "\\|");
      const escapedSelector = el.selector.replace(/\|/g, "\\|");
      const escapedResult = el.result.replace(/\|/g, "\\|");
      sections.push(
        `| ${escapedName} | ${el.type} | \`${escapedSelector}\` | ${el.action} | ${escapedResult} |`
      );
    }
    sections.push("");
  }

  // Forms
  if (page.forms.length > 0) {
    sections.push("### Forms");
    sections.push("");
    for (const form of page.forms) {
      sections.push(`**${form.name}**`);
      sections.push("");
      sections.push("| Field | Type | Selector | Required |");
      sections.push("|-------|------|----------|----------|");
      for (const field of form.fields) {
        const escapedLabel = field.label.replace(/\|/g, "\\|");
        const escapedSelector = field.selector.replace(/\|/g, "\\|");
        sections.push(
          `| ${escapedLabel} | ${field.inputType} | \`${escapedSelector}\` | ${field.required ? "Yes" : "No"} |`
        );
      }
      sections.push("");
      if (form.submitSelector) {
        sections.push(
          `Submit: \`${form.submitSelector}\` → ${form.submitAction}`
        );
        sections.push("");
      }
    }
  }

  // Dynamic Behavior
  if (page.dynamicBehavior.length > 0) {
    sections.push("### Dynamic Behavior");
    for (const behavior of page.dynamicBehavior) {
      sections.push(`- ${behavior}`);
    }
    sections.push("");
  }

  sections.push("");
  return sections.join("\n");
}

function formatWorkflow(workflow: Workflow): string {
  const sections: string[] = [];

  sections.push(`### ${workflow.name}`);
  sections.push(workflow.description);
  sections.push("");

  for (const step of workflow.steps) {
    let line = `${step.step}. ${step.description}`;
    if (step.selector) {
      line += ` → \`${step.selector}\``;
    }
    if (step.value) {
      line += ` (value: "${step.value}")`;
    }
    if (step.expectedResult) {
      line += ` — *${step.expectedResult}*`;
    }
    sections.push(line);
  }

  sections.push("");
  return sections.join("\n");
}
