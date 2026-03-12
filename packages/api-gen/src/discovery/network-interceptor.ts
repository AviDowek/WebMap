/**
 * Network request/response interception during crawling.
 * Captures XHR/fetch requests to discover REST/GraphQL endpoints.
 */

import type { Page, Request, Response } from "playwright";
import type { InterceptedRequest, NetworkEndpoint, ActionParam } from "../types.js";

/** Resource types to ignore during interception */
const IGNORED_RESOURCE_TYPES = new Set([
  "image", "stylesheet", "font", "media", "manifest", "other",
]);

/** URL patterns to ignore (static assets, tracking, etc.) */
const IGNORED_URL_PATTERNS = [
  /\.(css|js|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico|webp|avif)(\?|$)/i,
  /google-analytics\.com/,
  /googletagmanager\.com/,
  /facebook\.net/,
  /doubleclick\.net/,
  /hotjar\.com/,
  /sentry\.io/,
  /segment\.com/,
];

/** Maximum body size to capture (2KB) */
const MAX_BODY_SIZE = 2048;

/**
 * Attach network interception to a Playwright page.
 * Returns a function to retrieve all captured requests.
 */
export function attachNetworkInterceptor(page: Page, sourcePageUrl: string): {
  getRequests: () => InterceptedRequest[];
  detach: () => void;
} {
  const captured: InterceptedRequest[] = [];
  const pendingRequests = new Map<string, { method: string; url: string; contentType?: string; body?: string }>();

  const onRequest = (request: Request) => {
    try {
      const resourceType = request.resourceType();
      if (IGNORED_RESOURCE_TYPES.has(resourceType)) return;
      if (resourceType !== "xhr" && resourceType !== "fetch") return;

      const url = request.url();
      if (IGNORED_URL_PATTERNS.some(p => p.test(url))) return;

      let body: string | undefined;
      try {
        body = request.postData() ?? undefined;
        if (body && body.length > MAX_BODY_SIZE) {
          body = body.slice(0, MAX_BODY_SIZE) + "...[truncated]";
        }
      } catch {
        // postData() can throw for some request types
      }

      pendingRequests.set(request.url() + request.method(), {
        method: request.method(),
        url: request.url(),
        contentType: request.headers()["content-type"],
        body,
      });
    } catch {
      // Ignore errors during request capture
    }
  };

  const onResponse = async (response: Response) => {
    try {
      const request = response.request();
      const key = request.url() + request.method();
      const pending = pendingRequests.get(key);
      if (!pending) return;
      pendingRequests.delete(key);

      let responseBody: string | undefined;
      try {
        const ct = response.headers()["content-type"] || "";
        if (ct.includes("json") || ct.includes("text")) {
          const raw = await response.text();
          responseBody = raw.length > MAX_BODY_SIZE
            ? raw.slice(0, MAX_BODY_SIZE) + "...[truncated]"
            : raw;
        }
      } catch {
        // Response body may not be available
      }

      captured.push({
        method: pending.method,
        url: pending.url,
        contentType: pending.contentType,
        requestBody: pending.body,
        responseStatus: response.status(),
        responseBody,
        sourcePageUrl,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Ignore errors during response capture
    }
  };

  page.on("request", onRequest);
  page.on("response", onResponse);

  return {
    getRequests: () => [...captured],
    detach: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
    },
  };
}

/**
 * Deduplicate and parameterize captured requests into NetworkEndpoints.
 * e.g. /api/products/123 and /api/products/456 → /api/products/:id
 */
export function deduplicateEndpoints(requests: InterceptedRequest[]): NetworkEndpoint[] {
  // Group by method + parameterized URL pattern
  const groups = new Map<string, InterceptedRequest[]>();

  for (const req of requests) {
    const pattern = parameterizeUrl(req.url);
    const key = `${req.method} ${pattern}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(req);
  }

  const endpoints: NetworkEndpoint[] = [];
  for (const [key, reqs] of groups) {
    const [method, ...urlParts] = key.split(" ");
    const urlPattern = urlParts.join(" ");
    const first = reqs[0];

    // Infer params from request bodies
    const params = inferParams(first);

    endpoints.push({
      method,
      urlPattern,
      params,
      responseShape: first.responseBody ? truncateJsonShape(first.responseBody) : undefined,
      exampleBody: first.requestBody,
      sourcePageUrl: first.sourcePageUrl,
      contentType: first.contentType,
      triggeredBy: [],
    });
  }

  return endpoints;
}

/**
 * Replace numeric path segments and UUIDs with :id placeholders.
 */
function parameterizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").map(seg => {
      // Numeric IDs
      if (/^\d+$/.test(seg)) return ":id";
      // UUIDs
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
      // Hex hashes (8+ chars)
      if (/^[0-9a-f]{8,}$/i.test(seg)) return ":id";
      return seg;
    });
    return parsed.origin + segments.join("/");
  } catch {
    return url;
  }
}

/**
 * Infer ActionParam[] from a request's body.
 */
function inferParams(req: InterceptedRequest): ActionParam[] {
  if (!req.requestBody) return [];

  try {
    const body = JSON.parse(req.requestBody);
    if (typeof body !== "object" || body === null) return [];

    return Object.entries(body).map(([name, value]) => ({
      name,
      type: inferParamType(value),
      description: `${name} parameter`,
      required: true,
    }));
  } catch {
    // Not JSON — try URL-encoded
    try {
      const params = new URLSearchParams(req.requestBody);
      return Array.from(params.entries()).map(([name]) => ({
        name,
        type: "string" as const,
        description: `${name} parameter`,
        required: true,
      }));
    } catch {
      return [];
    }
  }
}

function inferParamType(value: unknown): "string" | "number" | "boolean" | "select" {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

/**
 * Truncate a JSON response to just its top-level shape.
 */
function truncateJsonShape(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return typeof parsed;
    if (Array.isArray(parsed)) {
      return `Array[${parsed.length}]${parsed.length > 0 ? ` of ${typeof parsed[0]}` : ""}`;
    }
    const keys = Object.keys(parsed).slice(0, 10);
    return `{ ${keys.map(k => `${k}: ${typeof parsed[k]}`).join(", ")} }`;
  } catch {
    return body.slice(0, 100);
  }
}
