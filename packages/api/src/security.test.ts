import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isBlockedUrl,
  createRateLimiter,
  requireAuth,
  clampNumber,
  timingSafeCompare,
} from "./security.js";

describe("isBlockedUrl", () => {
  it("blocks localhost", () => {
    assert.equal(isBlockedUrl("http://localhost/foo"), true);
    assert.equal(isBlockedUrl("http://localhost:3000/foo"), true);
  });

  it("blocks 127.0.0.1", () => {
    assert.equal(isBlockedUrl("http://127.0.0.1/path"), true);
  });

  it("blocks IPv6 loopback", () => {
    assert.equal(isBlockedUrl("http://[::1]/path"), true);
  });

  it("blocks 0.0.0.0", () => {
    assert.equal(isBlockedUrl("http://0.0.0.0/"), true);
  });

  it("blocks metadata.google.internal", () => {
    assert.equal(isBlockedUrl("http://metadata.google.internal/computeMetadata"), true);
  });

  it("blocks 10.x.x.x private range", () => {
    assert.equal(isBlockedUrl("http://10.0.0.1/"), true);
    assert.equal(isBlockedUrl("http://10.255.255.255/"), true);
  });

  it("blocks 172.16-31.x.x private range", () => {
    assert.equal(isBlockedUrl("http://172.16.0.1/"), true);
    assert.equal(isBlockedUrl("http://172.31.255.255/"), true);
    // 172.15 and 172.32 should NOT be blocked
    assert.equal(isBlockedUrl("http://172.15.0.1/"), false);
    assert.equal(isBlockedUrl("http://172.32.0.1/"), false);
  });

  it("blocks 192.168.x.x private range", () => {
    assert.equal(isBlockedUrl("http://192.168.1.1/"), true);
    assert.equal(isBlockedUrl("http://192.168.0.1/"), true);
  });

  it("blocks 169.254.x.x link-local", () => {
    assert.equal(isBlockedUrl("http://169.254.169.254/"), true);
  });

  it("blocks CGNAT range 100.64-127.x.x", () => {
    assert.equal(isBlockedUrl("http://100.64.0.1/"), true);
    assert.equal(isBlockedUrl("http://100.127.255.255/"), true);
    assert.equal(isBlockedUrl("http://100.63.0.1/"), false);
  });

  it("blocks .local and .internal TLDs", () => {
    assert.equal(isBlockedUrl("http://myservice.local/"), true);
    assert.equal(isBlockedUrl("http://db.internal/"), true);
  });

  it("blocks non-http protocols", () => {
    assert.equal(isBlockedUrl("ftp://example.com/"), true);
    assert.equal(isBlockedUrl("file:///etc/passwd"), true);
    assert.equal(isBlockedUrl("javascript:alert(1)"), true);
  });

  it("blocks invalid URLs", () => {
    assert.equal(isBlockedUrl("not-a-url"), true);
    assert.equal(isBlockedUrl(""), true);
  });

  it("allows valid public URLs", () => {
    assert.equal(isBlockedUrl("https://example.com/"), false);
    assert.equal(isBlockedUrl("http://google.com/search"), false);
    assert.equal(isBlockedUrl("https://github.com/"), false);
  });
});

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      assert.equal(limiter.check("1.2.3.4", 5), true);
    }
  });

  it("blocks requests over the limit", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.check("1.2.3.4", 5);
    }
    assert.equal(limiter.check("1.2.3.4", 5), false);
  });

  it("tracks different IPs independently", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.check("1.1.1.1", 5);
    }
    assert.equal(limiter.check("1.1.1.1", 5), false);
    assert.equal(limiter.check("2.2.2.2", 5), true);
  });

  it("tracks different limits independently", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.check("1.1.1.1", 5);
    }
    assert.equal(limiter.check("1.1.1.1", 5), false);
    assert.equal(limiter.check("1.1.1.1", 60), true);
  });

  it("resets via reset()", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.check("1.1.1.1", 5);
    }
    assert.equal(limiter.check("1.1.1.1", 5), false);
    limiter.reset();
    assert.equal(limiter.check("1.1.1.1", 5), true);
  });
});

describe("requireAuth", () => {
  it("allows all requests when no API key is configured", () => {
    assert.equal(requireAuth(undefined, undefined), true);
    assert.equal(requireAuth("anything", undefined), true);
  });

  it("rejects requests with no auth header when key is set", () => {
    assert.equal(requireAuth(undefined, "my-secret"), false);
  });

  it("accepts valid Bearer token", () => {
    assert.equal(requireAuth("Bearer my-secret", "my-secret"), true);
  });

  it("accepts raw token", () => {
    assert.equal(requireAuth("my-secret", "my-secret"), true);
  });

  it("rejects invalid token", () => {
    assert.equal(requireAuth("Bearer wrong-key", "my-secret"), false);
    assert.equal(requireAuth("wrong-key", "my-secret"), false);
  });

  it("rejects empty auth header", () => {
    assert.equal(requireAuth("", "my-secret"), false);
  });
});

describe("timingSafeCompare", () => {
  it("returns true for equal strings", () => {
    assert.equal(timingSafeCompare("abc", "abc"), true);
  });

  it("returns false for different strings", () => {
    assert.equal(timingSafeCompare("abc", "def"), false);
  });

  it("returns false for different length strings", () => {
    assert.equal(timingSafeCompare("short", "a-longer-string"), false);
  });

  it("returns true for empty strings", () => {
    assert.equal(timingSafeCompare("", ""), true);
  });
});

describe("clampNumber", () => {
  it("clamps within range", () => {
    assert.equal(clampNumber(5, 1, 10, 3), 5);
  });

  it("clamps to min", () => {
    assert.equal(clampNumber(0, 1, 10, 3), 1);
    assert.equal(clampNumber(-5, 1, 10, 3), 1);
  });

  it("clamps to max", () => {
    assert.equal(clampNumber(100, 1, 10, 3), 10);
  });

  it("returns fallback for NaN", () => {
    assert.equal(clampNumber("abc", 1, 10, 3), 3);
    assert.equal(clampNumber(undefined, 1, 10, 3), 3);
    assert.equal(clampNumber(null, 1, 10, 3), 3);
  });

  it("parses string numbers", () => {
    assert.equal(clampNumber("7", 1, 10, 3), 7);
  });
});
