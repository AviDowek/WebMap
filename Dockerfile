# ── Build stage ──────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/benchmark/package.json packages/benchmark/
COPY packages/api-gen/package.json packages/api-gen/
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/

RUN npm ci

COPY packages/core/ packages/core/
COPY packages/benchmark/ packages/benchmark/
COPY packages/api-gen/ packages/api-gen/
COPY packages/api/ packages/api/
COPY packages/cli/ packages/cli/
COPY packages/mcp/ packages/mcp/

RUN npx turbo build --filter=@webmap/api --filter=@webmap/cli --filter=@webmap/mcp

# ── Production stage ────────────────────────────────────────
FROM node:22-slim AS production

RUN npx playwright install --with-deps chromium

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/benchmark/package.json packages/benchmark/
COPY packages/api-gen/package.json packages/api-gen/
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/benchmark/dist packages/benchmark/dist
COPY --from=builder /app/packages/api-gen/dist packages/api-gen/dist
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/cli/dist packages/cli/dist
COPY --from=builder /app/packages/mcp/dist packages/mcp/dist

# Create data directory for persistence
RUN mkdir -p packages/api/data && chmod 700 packages/api/data

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "packages/api/dist/index.js"]
