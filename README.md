# WebMap

AI-powered website documentation generator for AI agents. WebMap crawls websites using Playwright, extracts interactive elements and accessibility trees, and uses Claude to generate comprehensive structured documentation. It includes a multi-method benchmarking system that measures how different documentation injection strategies affect vision-based browser agent (CUA) performance.

## Features

- **Website Crawling** — Playwright-based crawler captures DOM, interactive elements, accessibility trees, forms, and page structure
- **LLM Analysis** — Claude analyzes each page to identify workflows, forms, navigation patterns, visual layout, and navigation strategies
- **CUA Mode** — Specialized documentation optimized for vision-based browser agents (Claude Computer Use Agent), generating concise visual layout descriptions and navigation hints instead of verbose element catalogs
- **Markdown Documentation** — Generates structured docs with site maps, page hierarchies, interactive elements, forms, and detected workflows
- **REST API** — Hono-based server with job queue, 1-hour TTL caching, rate limiting, batch processing, SSRF protection, and optional API key auth
- **CLI Tool** — Generate docs from the command line with configurable depth, page limits, and output directory
- **Web Dashboard** — Next.js UI with three tabs: single-site generation, batch testing, and multi-method benchmarking
- **MCP Server** — Model Context Protocol integration exposing `get_site_docs`, `get_page_docs`, and `get_workflow` tools
- **Multi-Method Benchmarking** — Compare 5 different documentation injection strategies across multiple sites using Claude CUA

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

### How It Works

1. **Site Generation** — AI generates a diverse list of websites across categories (docs, news, reference, developer tools, e-commerce, government, educational, community)
2. **Crawling & Documentation** — Each site is crawled with Playwright and documented with Claude in CUA mode
3. **Task Generation** — AI creates realistic browser automation tasks for each site (navigation, search, form-fill, multi-step, information extraction)
4. **Benchmark Execution** — Every task is run with every selected method, using a real headless browser controlled by Claude CUA
5. **Results** — Per-site and overall metrics: success rate, average tokens, duration, steps, and delta vs baseline

### Key Insight

System prompt content compounds — it's re-sent with every API call. Over 18+ steps, a 400-token guide costs ~7,200 extra input tokens. The first-message and pre-plan methods avoid this compounding effect.

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
