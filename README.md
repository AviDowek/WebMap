# WebMap

AI-powered website documentation generator + programmatic API discovery for browser automation agents. WebMap crawls websites using Playwright, extracts interactive elements and accessibility trees, and uses Claude to generate structured documentation. It includes a multi-method benchmarking system that measures how different strategies affect browser agent (CUA) performance, and a programmatic API generation system that auto-discovers typed functions for every interaction on a website.

## What It Does

1. **Crawls websites** — Playwright captures DOM, interactive elements, accessibility trees, forms, navigation, and network requests
2. **Generates documentation** — Claude analyzes pages to produce concise guides optimized for AI agent consumption
3. **Discovers site APIs** — Active exploration (clicks dropdowns, expands menus, intercepts network calls) produces typed, self-tested functions for every interactive element
4. **Benchmarks strategies** — 11 different approaches to browser automation compared head-to-head on real websites
5. **Self-improves** — When API functions fail during CUA execution, successful fallback actions are captured and used to update the APIs

## Packages

```
packages/
  core/        — Crawling engine + doc generation (Playwright, Claude API)
  api-gen/     — Programmatic site API discovery, generation, testing, and learning
  benchmark/   — Multi-method benchmark runner, metrics, and reporting
  api/         — REST API server (Hono) with benchmark orchestration
  web/         — Next.js dashboard (Generate, Batch Test, Benchmark, APIs tabs)
  cli/         — Command-line interface
  mcp/         — Model Context Protocol server
```

## Benchmark Methods

11 CUA methods compared across real websites:

| Method | Model | Mode | Description |
|---|---|---|---|
| **Baseline** | Sonnet | Vision | No docs — pure screenshot navigation |
| **Micro Guide** | Sonnet | Vision | ~100 token nav hint in system prompt every turn |
| **Full Guide** | Sonnet | Vision | ~400 token guide with layout + site map in system prompt |
| **First Message** | Sonnet | Vision | Full docs in first user message only (no compounding) |
| **Pre-Plan** | Haiku+Sonnet | Vision | Haiku generates task plan, Sonnet executes with plan in system prompt |
| **A11y Tree** | Haiku | Text | Accessibility tree instead of screenshots |
| **Hybrid** | Sonnet | Both | Screenshots + accessibility tree together |
| **A11y+FirstMsg** | Haiku | Text | A11y tree + first-message doc injection |
| **Haiku Vision** | Haiku | Vision | Haiku with computer_use tool (3x cheaper than Sonnet) |
| **Cascade** | Haiku→Sonnet | Vision | Starts with Haiku, escalates to Sonnet when stuck |
| **Programmatic** | Haiku | Text | Pre-built site API functions instead of screenshots |

## Programmatic Site API System

The `api-gen` package crawls a website and generates typed API functions for every interactive element, then provides them as tools for CUA agents. This replaces screenshot→click loops with direct function calls.

### How It Works

**Discovery** — Active crawl with Playwright (up to 150 pages):
- Clicks every dropdown/combobox to capture all options
- Expands collapsed elements to discover hidden content
- Intercepts XHR/fetch requests to find REST endpoints
- Deduplicates URL patterns (`/api/products/123` → `/api/products/:id`)

**Generation** — Two-phase function building:
- Deterministic stubs from elements: buttons → `click_add_to_cart`, forms → `submit_login`, links → `navigate_to_products`, network endpoints → `api_post_cart`
- LLM enrichment (Haiku): better descriptions, expected results, composite workflows (e.g., `search_and_filter`, `add_to_cart_then_checkout`)

**Testing** — Automated self-test against live site:
- Generates realistic test params (email → `test@example.com`, search → `laptop`)
- Executes each function, compares before/after accessibility snapshots
- Marks actions as verified-passed, verified-failed, or untested

**Execution** — Per-step tool loading during CUA:
- ~20 global nav actions always available
- ~30-50 page-scoped actions matched by current URL
- `discover_actions(query)` meta-tool for cross-page search
- `fallback_browser_action` as escape hatch when APIs fail
- Tools update every step as the agent navigates

**Learning** — Self-improvement from failures:
- Failed API calls → agent falls back to browser_action
- Successful fallback sequences captured and converted to new API functions
- Actions with 3+ failures marked stale and replaced with learned alternatives
- Updated APIs cached for next run

### Cost

| Phase | Cost |
|---|---|
| Discovery crawl + exploration | $0 (Playwright only) |
| LLM enrichment (150 pages) | ~$0.45 (Haiku) |
| Self-testing (2000 actions) | ~$1.20 (Haiku) |
| **One-time per domain** | **~$1.65** |
| Per-task execution | ~$0.06-0.08 (Haiku) |

## Benchmark Results

Results from 20 real websites (60 tasks each) including Wikipedia, GitHub, Amazon, BBC, Khan Academy, eBay, and others.

| Method | Success Rate | Avg Tokens | Avg Duration | Avg Steps | vs Baseline |
|---|---|---|---|---|---|
| **A11y Tree** | **61.7%** | 142,768 | **41.4s** | **5.0** | **+6.7pp** |
| **First Message** | 58.3% | 132,331 | 118.5s | 9.8 | +3.3pp |
| **Baseline** | 55.0% | 120,339 | 119.5s | 10.1 | — |
| **Micro Guide** | 53.3% | 120,529 | 121.7s | 10.0 | -1.7pp |
| **Pre-Plan** | 51.7% | 105,497 | 107.0s | 9.1 | -3.3pp |
| **Full Guide** | 50.0% | 131,191 | 124.3s | 10.5 | -5.0pp |
| **Hybrid** | 48.3% | 381,972 | 98.0s | 7.5 | -6.7pp |

### Key Findings

1. **A11y Tree wins** — Highest success (61.7%), fastest (2.88x baseline), fewest steps (5.0). Text-only accessibility trees beat vision for structured navigation.
2. **System prompt injection hurts** — Micro Guide (-1.7pp) and Full Guide (-5.0pp) both worse than baseline. Compounding tokens across 10+ steps add noise.
3. **First Message works** — +3.3pp with no compounding. Docs sent once in the first user message.
4. **Hybrid is expensive and bad** — 217% more tokens for lower success. Too much context per turn.
5. **Some sites are hard** — stackoverflow.com, reddit.com, npmjs.com scored 0% across all methods (anti-bot protections).

## Setup

### Prerequisites

- Node.js 22+
- npm 10.9+
- [Anthropic API key](https://console.anthropic.com/)

### Install

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
```

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
# Build all packages
npm run build

# Start all packages in dev mode
npm run dev

# Web dashboard at http://localhost:3000
# API server at http://localhost:3001
```

### CLI

```bash
npm run cli -- <url> [options]
```

| Flag | Description | Default |
|---|---|---|
| `--depth <n>` | Crawl depth (1-5) | 3 |
| `--max-pages <n>` | Max pages (1-100) | 50 |
| `--output <dir>` | Output directory | `./generated` |
| `--model <model>` | Claude model | `claude-sonnet-4-20250514` |

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/crawl` | Start a crawl job |
| `GET` | `/api/status/:jobId` | Check job status |
| `GET` | `/api/docs/:domain` | Get cached documentation |
| `POST` | `/api/benchmark/multi` | Run multi-method benchmark |
| `GET` | `/api/benchmark/status/:benchId` | Check benchmark progress |
| `POST` | `/api/benchmark/sites/generate` | AI-generate benchmark sites |
| `POST` | `/api/benchmark/tasks/generate` | AI-generate tasks for a site |
| `GET` | `/api/benchmark/datasets` | List industry benchmark datasets |
| `POST` | `/api/api-gen/discover` | Start API discovery for a URL |
| `GET` | `/api/api-gen/status/:jobId` | Poll discovery job status |
| `GET` | `/api/api-gen/domains` | List domains with generated APIs |
| `GET` | `/api/api-gen/:domain` | Get full DomainAPI for a domain |
| `POST` | `/api/api-gen/:domain/test` | Trigger self-test pipeline |
| `DELETE` | `/api/api-gen/:domain` | Clear cached API |
| `GET` | `/api/health` | Health check |

### Web Dashboard

Four tabs at [http://localhost:3000](http://localhost:3000):

- **Generate** — Paste a URL, crawl it, view/copy/download generated documentation
- **Batch Test** — Test across multiple websites at once (up to 20)
- **Benchmark** — Configure and run multi-method benchmarks with custom or industry datasets. View method comparison tables, per-site heatmaps, and per-task breakdowns with cost tracking
- **APIs** — Browse auto-generated site APIs. Discover APIs for new URLs, view actions per page with expandable detail (params, steps, expected results, reliability), run self-tests, export as JSON

### MCP Server

Three tools for Claude and MCP-compatible clients:

- `get_site_docs(url)` — Crawl and generate full site documentation
- `get_page_docs(url)` — Get documentation for a specific page
- `get_workflow(domain, task)` — Get relevant workflow steps for a task

### Industry Benchmark Datasets

Six dataset loaders for standardized evaluation:

| Dataset | Tasks | Source | Type |
|---|---|---|---|
| Mind2Web | 300 | HuggingFace | Live sites |
| WebBench | 2,454 | HuggingFace | Live sites |
| WebArena | 812 | Self-hosted Docker | Controlled |
| WebChore Arena | 532 | Self-hosted Docker | Long-horizon |
| Visual WebArena | 910 | Self-hosted Docker | Visual grounding |
| WorkArena | 29 | ServiceNow SaaS | Enterprise |

## Docker

```bash
docker-compose up -d
```

| Service | Port | Description |
|---|---|---|
| `api` | 3001 | REST API + crawling engine |
| `web` | 3000 | Next.js dashboard |

## License

MIT
