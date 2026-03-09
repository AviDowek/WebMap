# WebMap

AI-powered website documentation generator for AI agents. WebMap crawls websites, extracts interactive elements and accessibility trees, and generates comprehensive markdown documentation that AI agents can use to navigate and operate websites.

This is a WIP and more of an experiment currently, on the feasability of such an approach.

## Features

- **Website Crawling** — Playwright-based crawler captures DOM, interactive elements, and page structure
- **LLM Analysis** — Claude analyzes each page to identify workflows, forms, and navigation patterns
- **Markdown Documentation** — Generates structured docs with page hierarchy, elements, and workflows
- **REST API** — Job queue, caching (1-hour TTL), rate limiting, batch processing, and SSRF protection
- **CLI Tool** — Generate docs from the command line
- **Web Dashboard** — Next.js UI for generating, batching, and benchmarking
- **MCP Server** — Model Context Protocol integration for Claude
- **Benchmarking** — Measure AI agent task success rates with and without generated docs

## Project Structure

```
packages/
  core/        — Crawling engine + doc generation (Playwright, Claude API)
  api/         — REST API server (Hono)
  cli/         — Command-line interface
  web/         — Next.js web dashboard
  mcp/         — Model Context Protocol server
  benchmark/   — Benchmark suite and reporting
```

## Prerequisites

- Node.js 22+
- npm 10.9+
- [Anthropic API key](https://console.anthropic.com/)

## Setup

```bash
# Install dependencies
npm install

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
| `--depth <n>` | Crawl depth (1–5) | 2 |
| `--max-pages <n>` | Max pages to crawl (1–100) | 10 |
| `--output <dir>` | Output directory | `./webmap-docs` |
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
| `GET` | `/api/docs/:domain` | Get cached documentation |
| `POST` | `/api/batch` | Batch process multiple URLs |
| `POST` | `/api/benchmark` | Run benchmark tests |
| `GET` | `/api/health` | Health check |

### Web Dashboard

```bash
cd packages/web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
