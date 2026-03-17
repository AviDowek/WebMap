"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import type { CrawlStatus, CachedDoc } from "../lib/types";
import { API_BASE, PHASE_LABELS, MAX_POLL_ATTEMPTS } from "../lib/constants";
import { apiHeaders } from "../lib/api";
import { btnStyle, primaryBtn, inputStyle } from "../lib/styles";

// ─── Shared Sub-Components ───────────────────────────────────────────

function ProgressBar({ phase }: { phase: string }) {
  const steps = ["crawling", "analyzing", "formatting"];
  const currentIdx = steps.indexOf(phase);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 20 }}>
        {steps.map((step, idx) => (
          <div
            key={step}
            style={{
              width: 80,
              height: 4,
              borderRadius: 2,
              backgroundColor:
                idx === currentIdx ? "#3b82f6" : idx < currentIdx ? "#22c55e" : "#333",
              transition: "background-color 0.3s",
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 8,
          marginTop: 6,
          fontSize: 11,
          color: "#666",
        }}
      >
        <span style={{ width: 80, textAlign: "center" }}>Crawl</span>
        <span style={{ width: 80, textAlign: "center" }}>Analyze</span>
        <span style={{ width: 80, textAlign: "center" }}>Format</span>
      </div>
    </>
  );
}

function ErrorBox({ error }: { error?: string }) {
  return (
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
      Error: {error}
    </div>
  );
}

// ─── Generate Tab ────────────────────────────────────────────────────

export default function GenerateTab() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<CrawlStatus>({ state: "idle" });
  const [cachedDocs, setCachedDocs] = useState<CachedDoc[]>([]);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<string | null>(null);
  const [viewingMarkdown, setViewingMarkdown] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadCachedDocs();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function loadCachedDocs() {
    try {
      const res = await fetch(`${API_BASE}/api/docs`, { headers: apiHeaders() });
      if (res.ok) {
        const data = await res.json();
        setCachedDocs(data.docs || []);
      }
    } catch {
      // ignore
    }
  }

  async function deleteDoc(domain: string) {
    try {
      await fetch(`${API_BASE}/api/docs/${domain}`, { method: "DELETE", headers: apiHeaders() });
      setCachedDocs((prev) => prev.filter((d) => d.domain !== domain));
    } catch {
      // ignore
    }
  }

  async function regenerateDoc(domain: string) {
    setRegenerating(domain);
    try {
      const res = await fetch(`${API_BASE}/api/docs/${domain}/regenerate`, { method: "POST", headers: apiHeaders() });
      if (res.ok) {
        await loadCachedDocs();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Regeneration failed");
      }
    } catch {
      alert("Failed to connect to API");
    } finally {
      setRegenerating(null);
    }
  }

  async function viewDoc(domain: string) {
    if (viewingDoc === domain) {
      setViewingDoc(null);
      setViewingMarkdown(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/docs/${domain}`, { headers: apiHeaders() });
      if (res.ok) {
        const markdown = await res.text();
        setViewingDoc(domain);
        setViewingMarkdown(markdown);
      }
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url) return;

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    try {
      new URL(url.startsWith("http") ? url : `https://${url}`);
    } catch {
      setStatus({ state: "error", error: "Invalid URL" });
      return;
    }

    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    setStatus({ state: "crawling" });

    try {
      const res = await fetch(`${API_BASE}/api/crawl`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ url: targetUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ state: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();

      if (data.status === "cached") {
        setStatus({ state: "done", markdown: data.documentation });
        loadCachedDocs();
        return;
      }

      const jobId = data.jobId;
      let attempts = 0;

      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > MAX_POLL_ATTEMPTS) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setStatus({ state: "error", error: "Crawl timed out after 6 minutes" });
          return;
        }

        try {
          const statusRes = await fetch(`${API_BASE}/api/status/${jobId}`, { headers: apiHeaders() });
          if (!statusRes.ok) return;

          const statusData = await statusRes.json();

          if (statusData.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;

            let markdown = statusData.markdown;
            if (!markdown) {
              const domain = new URL(targetUrl).hostname;
              const docsRes = await fetch(`${API_BASE}/api/docs/${domain}`, { headers: apiHeaders() });
              markdown = await docsRes.text();
            }

            setStatus({ state: "done", markdown, metadata: statusData.metadata });
            loadCachedDocs();
          } else if (statusData.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setStatus({ state: "error", error: statusData.error });
          } else {
            setStatus((prev) => ({
              ...prev,
              phase: statusData.status,
              pagesFound: statusData.pagesFound || prev.pagesFound,
            }));
          }
        } catch {
          // Network error — keep polling
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
    if (status.markdown) navigator.clipboard.writeText(status.markdown);
  }

  function handleDownload() {
    if (status.markdown) {
      const blob = new Blob([status.markdown], { type: "text/markdown" });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "documentation.md";
      a.click();
      URL.revokeObjectURL(blobUrl);
    }
  }

  return (
    <>
      <p style={{ textAlign: "center", color: "#666", marginBottom: 24, fontSize: 14 }}>
        Paste a URL to crawl and generate structured documentation.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: 12, maxWidth: 700, margin: "0 auto 40px" }}
      >
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          style={inputStyle}
        />
        <button type="submit" disabled={status.state === "crawling"} style={primaryBtn(status.state === "crawling")}>
          {status.state === "crawling" ? "Crawling..." : "Generate Docs"}
        </button>
      </form>

      {/* Progress */}
      {status.state === "crawling" && (
        <div style={{ textAlign: "center", padding: 40, color: "#3b82f6" }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>
            {status.phase === "analyzing"
              ? "Analyzing with AI..."
              : status.phase === "formatting"
              ? "Generating documentation..."
              : "Crawling website..."}
          </div>
          <p style={{ color: "#888", marginBottom: 8 }}>
            {PHASE_LABELS[status.phase || "crawling"]}
          </p>
          {status.pagesFound != null && status.pagesFound > 0 && (
            <p style={{ color: "#666", fontSize: 14 }}>{status.pagesFound} pages discovered</p>
          )}
          <ProgressBar phase={status.phase || "crawling"} />
        </div>
      )}

      {/* Error */}
      {status.state === "error" && <ErrorBox error={status.error} />}

      {/* Results */}
      {status.state === "done" && status.markdown && (
        <div>
          {status.metadata && (
            <div
              style={{
                display: "flex",
                gap: 24,
                justifyContent: "center",
                marginBottom: 24,
                color: "#888",
                fontSize: 14,
                flexWrap: "wrap",
              }}
            >
              <span>Pages: {status.metadata.totalPages}</span>
              <span>Elements: {status.metadata.totalElements}</span>
              <span>Workflows: {status.metadata.totalWorkflows}</span>
              <span>Tokens: {status.metadata.tokensUsed.toLocaleString()}</span>
              <span>Duration: {(status.metadata.crawlDurationMs / 1000).toFixed(1)}s</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 24 }}>
            <button onClick={handleCopy} style={btnStyle}>Copy Markdown</button>
            <button onClick={handleDownload} style={btnStyle}>Download .md</button>
          </div>

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

      {/* Cached Docs */}
      <div
        style={{
          backgroundColor: "#111",
          border: "1px solid #222",
          borderRadius: 8,
          padding: 24,
          marginTop: 32,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            Cached Documentation ({cachedDocs.length})
          </h3>
          <button
            onClick={loadCachedDocs}
            style={{
              ...btnStyle,
              fontSize: 12,
              padding: "4px 10px",
              color: "#888",
              border: "1px solid #333",
            }}
          >
            Refresh
          </button>
        </div>
        {cachedDocs.length === 0 ? (
          <p style={{ color: "#555", fontSize: 14, textAlign: "center", padding: 16 }}>
            No cached documentation yet. Generate docs for a URL above.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cachedDocs.map((doc) => (
              <div key={doc.domain}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    backgroundColor: "#0a0a0a",
                    borderRadius: 6,
                    border: "1px solid #222",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{doc.domain}</span>
                    <span style={{ color: "#666", fontSize: 12 }}>
                      {doc.totalPages} pages
                    </span>
                    <span style={{ color: "#666", fontSize: 12 }}>
                      {doc.totalElements} elements
                    </span>
                    <span style={{ color: "#666", fontSize: 12 }}>
                      {doc.tokensUsed.toLocaleString()} tokens
                    </span>
                    <span style={{ color: "#555", fontSize: 12 }}>
                      {new Date(doc.crawledAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => viewDoc(doc.domain)}
                      style={{
                        ...btnStyle,
                        fontSize: 12,
                        padding: "4px 10px",
                        backgroundColor: "#0a1a0a",
                        color: "#22c55e",
                        border: "1px solid #22c55e33",
                      }}
                    >
                      View
                    </button>
                    <button
                      onClick={() => regenerateDoc(doc.domain)}
                      disabled={regenerating === doc.domain}
                      style={{
                        ...btnStyle,
                        fontSize: 12,
                        padding: "4px 10px",
                        backgroundColor: "#1a1a2e",
                        color: "#3b82f6",
                        border: "1px solid #3b82f633",
                      }}
                    >
                      {regenerating === doc.domain ? "Regenerating..." : "Regenerate"}
                    </button>
                    <button
                      onClick={() => deleteDoc(doc.domain)}
                      style={{
                        ...btnStyle,
                        fontSize: 12,
                        padding: "4px 10px",
                        color: "#ef4444",
                        border: "1px solid #ef444433",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {viewingDoc === doc.domain && viewingMarkdown && (
                  <pre
                    style={{
                      backgroundColor: "#0a0a0a",
                      border: "1px solid #222",
                      borderTop: "none",
                      borderRadius: "0 0 6px 6px",
                      padding: 16,
                      overflow: "auto",
                      maxHeight: "50vh",
                      fontSize: 12,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      margin: 0,
                    }}
                  >
                    {viewingMarkdown}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
