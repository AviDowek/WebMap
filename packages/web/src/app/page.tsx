"use client";

import { useState, type FormEvent } from "react";

interface CrawlStatus {
  state: "idle" | "crawling" | "done" | "error";
  markdown?: string;
  metadata?: {
    totalPages: number;
    totalElements: number;
    totalWorkflows: number;
    crawlDurationMs: number;
    tokensUsed: number;
  };
  error?: string;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<CrawlStatus>({ state: "idle" });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!url) return;

    // Validate URL
    try {
      new URL(url.startsWith("http") ? url : `https://${url}`);
    } catch {
      setStatus({ state: "error", error: "Invalid URL" });
      return;
    }

    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    setStatus({ state: "crawling" });

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

      // Start crawl
      const res = await fetch(`${apiBase}/api/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });

      const data = await res.json();

      if (data.status === "cached") {
        setStatus({
          state: "done",
          markdown: data.documentation,
        });
        return;
      }

      // Poll for completion
      const jobId = data.jobId;
      const pollInterval = setInterval(async () => {
        const statusRes = await fetch(`${apiBase}/api/status/${jobId}`);
        const statusData = await statusRes.json();

        if (statusData.status === "done") {
          clearInterval(pollInterval);

          // Fetch the docs
          const domain = new URL(targetUrl).hostname;
          const docsRes = await fetch(`${apiBase}/api/docs/${domain}`);
          const markdown = await docsRes.text();

          setStatus({
            state: "done",
            markdown,
            metadata: statusData.metadata,
          });
        } else if (statusData.status === "error") {
          clearInterval(pollInterval);
          setStatus({ state: "error", error: statusData.error });
        }
      }, 3000);
    } catch (error) {
      setStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to API",
      });
    }
  }

  function handleCopy() {
    if (status.markdown) {
      navigator.clipboard.writeText(status.markdown);
    }
  }

  function handleDownload() {
    if (status.markdown) {
      const blob = new Blob([status.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "documentation.md";
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "40px 20px",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>
          <span style={{ color: "#3b82f6" }}>Web</span>Map
        </h1>
        <p style={{ color: "#888", fontSize: 18, maxWidth: 600, margin: "0 auto" }}>
          Generate comprehensive website documentation for AI agents. Paste any
          URL and get structured docs with interactive elements, forms, and
          workflows.
        </p>
      </div>

      {/* URL Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 12,
          maxWidth: 700,
          margin: "0 auto 40px",
        }}
      >
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          style={{
            flex: 1,
            padding: "14px 18px",
            fontSize: 16,
            borderRadius: 8,
            border: "1px solid #333",
            backgroundColor: "#1a1a1a",
            color: "#ededed",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={status.state === "crawling"}
          style={{
            padding: "14px 28px",
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 8,
            border: "none",
            backgroundColor: status.state === "crawling" ? "#1e3a5f" : "#3b82f6",
            color: "#fff",
            cursor: status.state === "crawling" ? "wait" : "pointer",
          }}
        >
          {status.state === "crawling" ? "Crawling..." : "Generate Docs"}
        </button>
      </form>

      {/* Status */}
      {status.state === "crawling" && (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: "#3b82f6",
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 12 }}>Crawling website...</div>
          <p style={{ color: "#888" }}>
            Extracting accessibility trees, mapping interactive elements, detecting workflows...
          </p>
        </div>
      )}

      {/* Error */}
      {status.state === "error" && (
        <div
          style={{
            textAlign: "center",
            padding: 20,
            color: "#ef4444",
            backgroundColor: "#1a0000",
            borderRadius: 8,
            maxWidth: 700,
            margin: "0 auto",
          }}
        >
          Error: {status.error}
        </div>
      )}

      {/* Results */}
      {status.state === "done" && status.markdown && (
        <div>
          {/* Metadata bar */}
          {status.metadata && (
            <div
              style={{
                display: "flex",
                gap: 24,
                justifyContent: "center",
                marginBottom: 24,
                color: "#888",
                fontSize: 14,
              }}
            >
              <span>Pages: {status.metadata.totalPages}</span>
              <span>Elements: {status.metadata.totalElements}</span>
              <span>Workflows: {status.metadata.totalWorkflows}</span>
              <span>Tokens: {status.metadata.tokensUsed.toLocaleString()}</span>
              <span>Duration: {(status.metadata.crawlDurationMs / 1000).toFixed(1)}s</span>
            </div>
          )}

          {/* Action buttons */}
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              marginBottom: 24,
            }}
          >
            <button
              onClick={handleCopy}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #333",
                backgroundColor: "#1a1a1a",
                color: "#ededed",
                cursor: "pointer",
              }}
            >
              Copy Markdown
            </button>
            <button
              onClick={handleDownload}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #333",
                backgroundColor: "#1a1a1a",
                color: "#ededed",
                cursor: "pointer",
              }}
            >
              Download .md
            </button>
          </div>

          {/* Markdown output */}
          <pre
            style={{
              backgroundColor: "#111",
              border: "1px solid #222",
              borderRadius: 8,
              padding: 24,
              overflow: "auto",
              maxHeight: "70vh",
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {status.markdown}
          </pre>
        </div>
      )}
    </main>
  );
}
