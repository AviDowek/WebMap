/**
 * Security utilities — extracted for testability.
 */

import { timingSafeEqual } from "node:crypto";

// ─── SSRF Protection ──────────────────────────────────────────────────────────

export const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
]);

export const PRIVATE_IP_RANGES = [
  /^10\.\d+\.\d+\.\d+$/,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,          // 172.16.0.0/12
  /^192\.168\.\d+\.\d+$/,                          // 192.168.0.0/16
  /^169\.254\.\d+\.\d+$/,                          // Link-local (AWS metadata)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/, // CGNAT
];

export function isBlockedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return true;
    }

    if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) {
      return true;
    }

    for (const pattern of PRIVATE_IP_RANGES) {
      if (pattern.test(url.hostname)) {
        return true;
      }
    }

    if (url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_CRAWLS = 5;
export const RATE_LIMIT_MAX_READS = 60;

export function createRateLimiter() {
  const map = new Map<string, { count: number; resetAt: number }>();

  return {
    check(ip: string, limit: number): boolean {
      const now = Date.now();
      const key = `${ip}:${limit}`;
      const entry = map.get(key);

      if (!entry || now > entry.resetAt) {
        map.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
      }

      if (entry.count >= limit) {
        return false;
      }

      entry.count++;
      return true;
    },

    reset() {
      map.clear();
    },
  };
}

// ─── Authentication ───────────────────────────────────────────────────────────

export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireAuth(authHeader: string | undefined, apiKey: string | undefined): boolean {
  if (!apiKey) return true;
  if (!authHeader) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  return timingSafeCompare(token, apiKey);
}

// ─── Input Validation ─────────────────────────────────────────────────────────

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  if (isNaN(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}
