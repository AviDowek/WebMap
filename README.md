# WebMap- An Experiment in Progress

AI-powered website documentation generator for AI agents. WebMap crawls websites using Playwright, extracts interactive elements and accessibility trees, and uses Claude to generate comprehensive structured documentation. It includes a multi-method benchmarking system that measures how different documentation injection strategies affect vision-based browser agent (CUA) performance.

## Update
This shows promise and indicates multiple, promising ways of improving on baseline CUA performance.     Putting it on hold due to the high cost of testing, one day of $200+ in token costs is enough :)   

## Features

- **Website Crawling** — Playwright-based crawler captures DOM, interactive elements, accessibility trees, forms, and page structure
- **LLM Analysis** — Claude analyzes each page to identify workflows, forms, navigation patterns, visual layout, and navigation strategies
- **CUA Mode** — Specialized documentation optimized for vision-based browser agents (Claude Computer Use Agent), generating concise visual layout descriptions and navigation hints instead of verbose element catalogs
- **Markdown Documentation** — Generates structured docs with site maps, page hierarchies, interactive elements, forms, and detected workflows
- **REST API** — Hono-based server with job queue, 1-hour TTL caching, rate limiting, batch processing, SSRF protection, and optional API key auth
- **CLI Tool** — Generate docs from the command line with configurable depth, page limits, and output directory
- **Web Dashboard** — Next.js UI with three tabs: single-site generation, batch testing, and multi-method benchmarking
- **MCP Server** — Model Context Protocol integration exposing `get_site_docs`, `get_page_docs`, and `get_workflow` tools
- **Multi-Method Benchmarking** — Compare 7 different documentation injection strategies across multiple sites using Claude CUA
- **Reliability Features** — Optional multi-run with majority vote, automated success verification via independent LLM judge, Wilson confidence intervals

## Multi-Method Benchmark System

The benchmark tests how different ways of providing documentation to a vision-based browser agent affect task completion. It uses Claude's Computer Use Agent (CUA) which controls a real browser via screenshots and coordinate clicks.

### Documentation Injection Methods

| Method | Description | Token Cost |
|---|---|---|
| **Baseline** | No documentation — pure vision-based navigation | 0 extra |
| **Micro Guide** | ~100 token summary in system prompt (domain + one-line nav hint) | ~100/turn |
| **Full Guide** | ~400 token guide with visual layout, navigation strategy, and site map in system prompt | ~400/turn |
| **First Message** | Full docs injected in the first user message only (doesn't compound across turns) | One-time |
| **Pre-Plan** | Uses docs to generate a task-specific step-by-step plan via a separate Claude call before CUA starts | One-time + ~150/turn |
| **A11y Tree** | Text-only accessibility tree instead of screenshots (uses Haiku) | Variable |
| **Hybrid** | Both accessibility tree + screenshots (Sonnet) | Variable |

### How It Works

1. **Site Generation** — AI generates a diverse list of websites across categories (docs, news, reference, developer tools, e-commerce, government, educational, community)
2. **Crawling & Documentation** — Each site is crawled with Playwright and documented with Claude in CUA mode
3. **Task Generation** — AI creates realistic browser automation tasks for each site (navigation, search, form-fill, multi-step, information extraction)
4. **Benchmark Execution** — Every task is run with every selected method, using a real headless browser controlled by Claude CUA
5. **Results** — Per-site and overall metrics: success rate, average tokens, duration, steps, and delta vs baseline

### Reliability Features

- **Multiple Runs** — Run each task N times per method. Success is determined by majority vote. Results include Wilson score confidence intervals.
- **Automated Verification** — An independent LLM judge reviews the final screenshot + accessibility tree against the task's success criteria, overriding self-reported results when confident. Verification overhead (tokens/time) is tracked separately from CUA metrics.

### Key Insight

System prompt content compounds — it's re-sent with every API call. Over 18+ steps, a 400-token guide costs ~7,200 extra input tokens. The first-message and pre-plan methods avoid this compounding effect.

## Benchmark Results

Results from a run across **20 real websites** (60 tasks each, 420 total) including developer.mozilla.org, Wikipedia, GitHub, Amazon, BBC, Khan Academy, eBay, and others. Each task is a realistic browser automation goal (search, navigate, extract information, multi-step workflows).

### Overall Method Comparison

| Method | Success Rate | Avg Tokens | Avg Duration | Avg Steps | vs Baseline |
|---|---|---|---|---|---|
| **Baseline** | 55.0% (33/60) | 120,339 | 119.5s | 10.1 | — |
| **Micro Guide** | 53.3% (32/60) | 120,529 | 121.7s | 10.0 | -1.7pp |
| **Full Guide** | 50.0% (30/60) | 131,191 | 124.3s | 10.5 | -5.0pp |
| **First Message** | 58.3% (35/60) | 132,331 | 118.5s | 9.8 | +3.3pp |
| **Pre-Plan** | 51.7% (31/60) | 105,497 | 107.0s | 9.1 | -3.3pp |
| **A11y Tree** | **61.7%** (37/60) | 142,768 | **41.4s** | **5.0** | **+6.7pp** |
| **Hybrid** | 48.3% (29/60) | 381,972 | 98.0s | 7.5 | -6.7pp |

### Delta vs Baseline

| Method | Success Delta | Token Delta | Speed |
|---|---|---|---|
| Micro Guide | -1.7pp | +0.2% | 0.98x |
| Full Guide | -5.0pp | +9.0% | 0.96x |
| First Message | +3.3pp | +10.0% | 1.01x |
| Pre-Plan | -3.3pp | -12.3% | **1.12x** |
| A11y Tree | **+6.7pp** | +18.6% | **2.88x** |
| Hybrid | -6.7pp | +217.4% | 1.22x |

### Key Findings

1. **A11y Tree is the clear winner** — highest success rate (61.7%), fastest execution (2.88x baseline speed), and fewest steps (5.0 avg). It uses Haiku with text-only accessibility trees instead of screenshots, making it both cheaper per-step and more efficient.

2. **System prompt injection hurts more than it helps** — Both Micro Guide (-1.7pp) and Full Guide (-5.0pp) performed *worse* than baseline. The compounding token cost of system prompt content across 10+ steps adds noise without enough navigation value.

3. **First Message is the best doc injection approach** — +3.3pp improvement with no compounding cost. Docs are sent once and don't inflate subsequent turns.

4. **Pre-Plan trades accuracy for speed** — 12.3% fewer tokens and 1.12x faster, but slightly lower success rate. The upfront planning step saves steps during execution.

5. **Hybrid is expensive and underperforms** — 217% more tokens than baseline for lower success. Sending both accessibility trees and screenshots per turn is too much context.

6. **Some sites are simply hard** — stackoverflow.com, reddit.com, npmjs.com, and hackernews all scored 0% across every method, likely due to anti-bot protections or aggressive JS rendering that blocks headless browsers.

### Per-Site Heatmap

Sites where docs made the biggest difference (best method vs baseline):

| Site | Baseline | Best Method | Best Rate | Delta |
|---|---|---|---|---|
| www.amazon.com | 33.3% | Full Guide | 100.0% | +66.7pp |
| www.bbc.com | 66.7% | First Message / Pre-Plan / A11y | 100.0% | +33.3pp |
| www.khanacademy.org | 66.7% | Micro / First Msg / Pre-Plan / A11y | 100.0% | +33.3pp |
| www.edx.org | 100.0% | Baseline / A11y | 100.0% | 0pp |
| en.wikipedia.org | 100.0% | Baseline / Micro / Full / First / A11y | 100.0% | 0pp |

## Project Structure

```
packages/
  core/        — Crawling engine + doc generation (Playwright, Claude API)
  api/         — REST API server (Hono) with benchmark orchestration
  cli/         — Command-line interface
  web/         — Next.js web dashboard
  mcp/         — Model Context Protocol server
  benchmark/   — Benchmark runner, task generation, and reporting
```

## Prerequisites

- Node.js 22+
- npm 10.9+
- [Anthropic API key](https://console.anthropic.com/)

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Copy environment file and add your API key
cp .env.example .env
```

Edit `.env` and set your `ANTHROPIC_API_KEY`.

### Environment Variables

| Variable | Description | Required | Default |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key | Yes | — |
| `WEBMAP_API_KEY` | API server authentication key | No | Open |
| `ALLOWED_ORIGINS` | CORS allowed origins | No | `http://localhost:3000` |
| `PORT` | API server port | No | `3001` |
| `NEXT_PUBLIC_API_URL` | Web UI API base URL | No | `http://localhost:3001` |

## Usage

### Development

```bash
# Start all packages in dev mode
npm run dev

# Build all packages
npm run build

# Run tests
npm run test

# Lint
npm run lint
```

### CLI

```bash
npm run cli -- <url> [options]
```

Options:

| Flag | Description | Default |
|---|---|---|
| `--depth <n>` | Crawl depth (1-5) | 3 |
| `--max-pages <n>` | Max pages to crawl (1-100) | 50 |
| `--output <dir>` | Output directory | `./generated` |
| `--model <model>` | Claude model to use | `claude-sonnet-4-20250514` |

Example:

```bash
npm run cli -- https://example.com --depth 3 --max-pages 50 --output ./docs
```

### API

Start the API server:

```bash
cd packages/api
npm run dev
```

Key endpoints:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/crawl` | Start a crawl job |
| `GET` | `/api/status/:jobId` | Check job status |
| `GET` | `/api/docs` | List all cached documentation |
| `GET` | `/api/docs/:domain` | Get cached documentation for a domain |
| `DELETE` | `/api/docs/:domain` | Delete cached documentation |
| `POST` | `/api/docs/:domain/regenerate` | Regenerate docs from cached crawl data |
| `POST` | `/api/batch` | Batch process multiple URLs |
| `GET` | `/api/batch/status/:batchId` | Check batch job status |
| `POST` | `/api/benchmark` | Run legacy A/B benchmark |
| `POST` | `/api/benchmark/multi` | Run multi-method benchmark |
| `GET` | `/api/benchmark/status/:benchId` | Check benchmark progress |
| `GET` | `/api/benchmark/sites` | List configured benchmark sites |
| `POST` | `/api/benchmark/sites` | Add a benchmark site |
| `POST` | `/api/benchmark/sites/generate` | AI-generate diverse benchmark sites |
| `POST` | `/api/benchmark/tasks/generate` | AI-generate tasks for a site |
| `GET` | `/api/benchmark/multi/history` | List previous multi-method runs |
| `GET` | `/api/health` | Health check |
| `GET` | `/{url}` | URL-prefix proxy — returns docs for any URL |

### Web Dashboard

```bash
cd packages/web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The dashboard has three tabs:

- **Generate** — Paste a URL, watch the crawl progress, and view/copy/download the generated markdown. Manage cached documentation.
- **Batch Test** — Test WebMap against multiple websites at once (up to 20). See per-site results with page counts, element counts, token usage, and duration.
- **Benchmark** — Configure and run multi-method benchmarks. Select which methods to test, set site count and tasks per site, generate sites with AI or use manually configured sites. View overall method comparison and per-site breakdowns with detailed per-task results.

### MCP Server

The MCP server exposes three tools for Claude and other MCP-compatible clients:

- `get_site_docs(url)` — Crawl and generate full site documentation
- `get_page_docs(url)` — Get documentation for a specific page
- `get_workflow(domain, task)` — Get relevant workflow steps for a task

## Docker

```bash
# Start API and web dashboard
docker-compose up -d
```

| Service | Port | Description |
|---|---|---|
| `api` | 3001 | REST API + crawling engine |
| `web` | 3000 | Next.js dashboard |

Set `ANTHROPIC_API_KEY` in your environment or `.env` file before running.

## License

MIT
