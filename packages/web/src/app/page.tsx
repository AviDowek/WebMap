"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";

// ─── Types ───────────────────────────────────────────────────────────

type Tab = "generate" | "batch" | "benchmark";

interface CrawlStatus {
  state: "idle" | "crawling" | "done" | "error";
  phase?: "queued" | "crawling" | "analyzing" | "formatting";
  pagesFound?: number;
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

interface BatchSiteResult {
  url: string;
  domain: string;
  status: "pending" | "crawling" | "analyzing" | "done" | "error";
  pagesFound?: number;
  elementsFound?: number;
  workflowsFound?: number;
  tokensUsed?: number;
  durationMs?: number;
  error?: string;
}

interface BatchStatus {
  state: "idle" | "running" | "done" | "error";
  batchId?: string;
  sites?: BatchSiteResult[];
  error?: string;
}

interface BenchmarkMetrics {
  totalTasks: number;
  successRate: number;
  avgTokensPerTask: number;
  avgDurationMs: number;
  avgSteps: number;
}

interface BenchmarkStatus {
  state: "idle" | "running" | "done" | "error";
  benchId?: string;
  phase?: string;
  tasksTotal?: number;
  tasksCompleted?: number;
  multiMethod?: boolean;
  currentSite?: string;
  currentMethod?: string;
  result?: {
    summary: {
      baseline: BenchmarkMetrics;
      withDocs: BenchmarkMetrics;
      improvement: {
        successRateDelta: number;
        tokenReduction: number;
        speedup: number;
      };
    };
    baseline: Array<{
      taskId: string;
      success: boolean;
      steps: number;
      tokensUsed: number;
      durationMs: number;
      error?: string;
    }>;
    withDocs: Array<{
      taskId: string;
      success: boolean;
      steps: number;
      tokensUsed: number;
      durationMs: number;
      error?: string;
    }>;
  };
  multiResult?: MultiMethodResult;
  error?: string;
}

type DocMethod = "none" | "micro-guide" | "full-guide" | "first-message" | "pre-plan";

const DOC_METHOD_LABELS: Record<DocMethod, string> = {
  "none": "Baseline",
  "micro-guide": "Micro Guide",
  "full-guide": "Full Guide",
  "first-message": "First Msg",
  "pre-plan": "Pre-Plan",
};

const ALL_DOC_METHODS: DocMethod[] = ["none", "micro-guide", "full-guide", "first-message", "pre-plan"];

interface MethodResultData {
  method: DocMethod;
  tasks: Array<{
    taskId: string;
    success: boolean;
    steps: number;
    tokensUsed: number;
    durationMs: number;
    error?: string;
  }>;
  metrics: BenchmarkMetrics;
}

interface SiteResultData {
  domain: string;
  url: string;
  methods: MethodResultData[];
}

interface MultiMethodResult {
  timestamp: string;
  sites: SiteResultData[];
  overall: MethodResultData[];
  methods: DocMethod[];
  totalTasks: number;
}

interface MultiMethodHistoryEntry {
  id: string;
  timestamp: string;
  sites: number;
  methods: DocMethod[];
  totalTasks: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const API_BASE =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
    : "http://localhost:3001";

const PHASE_LABELS: Record<string, string> = {
  queued: "Queued — waiting to start...",
  crawling: "Crawling — discovering pages with Playwright...",
  analyzing: "Analyzing — enriching pages with Claude AI...",
  formatting: "Formatting — generating markdown documentation...",
};

const MAX_POLL_ATTEMPTS = 120;
const MAX_BENCHMARK_POLL_ATTEMPTS = 4800; // 4800 * 3s = 4 hours

// ─── Styles ──────────────────────────────────────────────────────────

const tabStyle = (active: boolean) => ({
  padding: "10px 24px",
  fontSize: 15,
  fontWeight: active ? 700 : 400,
  borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
  color: active ? "#3b82f6" : "#888",
  background: "none",
  border: "none",
  borderBottomWidth: 2,
  borderBottomStyle: "solid" as const,
  borderBottomColor: active ? "#3b82f6" : "transparent",
  cursor: "pointer",
  transition: "color 0.2s",
});

const btnStyle = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid #333",
  backgroundColor: "#1a1a1a",
  color: "#ededed",
  cursor: "pointer",
  fontSize: 14,
};

const primaryBtn = (disabled: boolean) => ({
  padding: "14px 28px",
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 8,
  border: "none",
  backgroundColor: disabled ? "#1e3a5f" : "#3b82f6",
  color: "#fff",
  cursor: disabled ? "wait" : "pointer",
});

const inputStyle = {
  flex: 1,
  padding: "14px 18px",
  fontSize: 16,
  borderRadius: 8,
  border: "1px solid #333",
  backgroundColor: "#1a1a1a",
  color: "#ededed",
  outline: "none",
};

const statusColors: Record<string, string> = {
  pending: "#888",
  crawling: "#3b82f6",
  analyzing: "#a855f7",
  done: "#22c55e",
  error: "#ef4444",
};

// ─── Main Component ─────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab] = useState<Tab>("generate");

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 20px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>
          <span style={{ color: "#3b82f6" }}>Web</span>Map
        </h1>
        <p
          style={{
            color: "#888",
            fontSize: 18,
            maxWidth: 600,
            margin: "0 auto",
          }}
        >
          Generate comprehensive website documentation for AI agents.
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 4,
          borderBottom: "1px solid #333",
          marginBottom: 32,
        }}
      >
        <button style={tabStyle(tab === "generate")} onClick={() => setTab("generate")}>
          Generate
        </button>
        <button style={tabStyle(tab === "batch")} onClick={() => setTab("batch")}>
          Batch Test
        </button>
        <button style={tabStyle(tab === "benchmark")} onClick={() => setTab("benchmark")}>
          Benchmark
        </button>
      </div>

      {tab === "generate" && <GenerateTab />}
      {tab === "batch" && <BatchTab />}
      {tab === "benchmark" && <BenchmarkTab />}
    </main>
  );
}

// ─── Generate Tab ────────────────────────────────────────────────────

interface CachedDoc {
  domain: string;
  totalPages: number;
  totalElements: number;
  totalWorkflows: number;
  tokensUsed: number;
  crawledAt: string;
}

function GenerateTab() {
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
      const res = await fetch(`${API_BASE}/api/docs`);
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
      await fetch(`${API_BASE}/api/docs/${domain}`, { method: "DELETE" });
      setCachedDocs((prev) => prev.filter((d) => d.domain !== domain));
    } catch {
      // ignore
    }
  }

  async function regenerateDoc(domain: string) {
    setRegenerating(domain);
    try {
      const res = await fetch(`${API_BASE}/api/docs/${domain}/regenerate`, { method: "POST" });
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
      const res = await fetch(`${API_BASE}/api/docs/${domain}`);
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
        headers: { "Content-Type": "application/json" },
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
          const statusRes = await fetch(`${API_BASE}/api/status/${jobId}`);
          if (!statusRes.ok) return;

          const statusData = await statusRes.json();

          if (statusData.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;

            let markdown = statusData.markdown;
            if (!markdown) {
              const domain = new URL(targetUrl).hostname;
              const docsRes = await fetch(`${API_BASE}/api/docs/${domain}`);
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

// ─── Batch Test Tab ──────────────────────────────────────────────────

function BatchTab() {
  const [urls, setUrls] = useState("");
  const [status, setStatus] = useState<BatchStatus>({ state: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const urlList = urls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => (u.startsWith("http") ? u : `https://${u}`));

    if (urlList.length === 0) return;
    if (urlList.length > 20) {
      setStatus({ state: "error", error: "Maximum 20 URLs per batch" });
      return;
    }

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setStatus({ state: "running" });

    try {
      const res = await fetch(`${API_BASE}/api/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urlList }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ state: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      const batchId = data.batchId;
      setStatus({ state: "running", batchId, sites: data.sites });

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > MAX_POLL_ATTEMPTS * 2) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setStatus((prev) => ({ ...prev, state: "error", error: "Batch timed out" }));
          return;
        }

        try {
          const statusRes = await fetch(`${API_BASE}/api/batch/status/${batchId}`);
          if (!statusRes.ok) return;

          const statusData = await statusRes.json();

          if (statusData.status === "done" || statusData.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }

          setStatus({
            state: statusData.status === "done" ? "done" : statusData.status === "error" ? "error" : "running",
            batchId,
            sites: statusData.sites,
            error: statusData.error,
          });
        } catch {
          // Keep polling
        }
      }, 3000);
    } catch (error) {
      setStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to API",
      });
    }
  }

  const completedCount = status.sites?.filter((s) => s.status === "done" || s.status === "error").length || 0;
  const totalCount = status.sites?.length || 0;

  return (
    <>
      <p style={{ textAlign: "center", color: "#666", marginBottom: 24, fontSize: 14 }}>
        Test WebMap against multiple websites at once. Enter one URL per line (max 20).
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ maxWidth: 700, margin: "0 auto 32px" }}
      >
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={"https://example.com\nhttps://docs.github.com\nhttps://react.dev"}
          rows={6}
          style={{
            width: "100%",
            padding: "14px 18px",
            fontSize: 14,
            borderRadius: 8,
            border: "1px solid #333",
            backgroundColor: "#1a1a1a",
            color: "#ededed",
            outline: "none",
            resize: "vertical",
            fontFamily: "monospace",
            marginBottom: 12,
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={status.state === "running"}
            style={primaryBtn(status.state === "running")}
          >
            {status.state === "running"
              ? `Running... (${completedCount}/${totalCount})`
              : "Run Batch Test"}
          </button>
        </div>
      </form>

      {status.state === "error" && !status.sites && <ErrorBox error={status.error} />}

      {/* Results Table */}
      {status.sites && status.sites.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>URL</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Status</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Pages</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Elements</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Workflows</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Tokens</th>
                <th style={{ textAlign: "center", padding: "10px 12px" }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {status.sites.map((site, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid #222",
                    backgroundColor: i % 2 === 0 ? "transparent" : "#0a0a0a",
                  }}
                >
                  <td
                    style={{
                      padding: "10px 12px",
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {site.domain}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px" }}>
                    <span
                      style={{
                        color: statusColors[site.status] || "#888",
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {site.status === "done" ? "Done" : site.status === "error" ? "Error" : site.status === "analyzing" ? "Analyzing" : site.status === "crawling" ? "Crawling" : "Pending"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.pagesFound ?? "—"}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.elementsFound ?? "—"}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.workflowsFound ?? "—"}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.tokensUsed != null ? site.tokensUsed.toLocaleString() : "—"}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px", color: "#aaa" }}>
                    {site.durationMs != null ? `${(site.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary */}
          {status.state === "done" && (
            <div
              style={{
                marginTop: 24,
                padding: 20,
                backgroundColor: "#111",
                borderRadius: 8,
                border: "1px solid #222",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
                Batch Complete
              </div>
              <div style={{ display: "flex", gap: 32, justifyContent: "center", color: "#aaa", fontSize: 14 }}>
                <span>
                  Success:{" "}
                  <strong style={{ color: "#22c55e" }}>
                    {status.sites.filter((s) => s.status === "done").length}
                  </strong>{" "}
                  / {status.sites.length}
                </span>
                <span>
                  Failed:{" "}
                  <strong style={{ color: "#ef4444" }}>
                    {status.sites.filter((s) => s.status === "error").length}
                  </strong>
                </span>
                <span>
                  Total Tokens:{" "}
                  <strong style={{ color: "#ededed" }}>
                    {status.sites
                      .reduce((sum, s) => sum + (s.tokensUsed || 0), 0)
                      .toLocaleString()}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─── Benchmark Tab ───────────────────────────────────────────────────

interface BenchmarkSite {
  url: string;
  domain: string;
  tasks: Array<{
    id: string;
    url: string;
    instruction: string;
    successCriteria: string;
    category: string;
    source?: string;
  }>;
  hasDocumentation: boolean;
}

interface BenchmarkHistoryEntry {
  id: string;
  timestamp: string;
  tasksTotal: number;
  successRateBaseline: number;
  successRateWithDocs: number;
  improvement: {
    successRateDelta: number;
    tokenReduction: number;
    speedup: number;
  };
}

function BenchmarkTab() {
  const [sites, setSites] = useState<BenchmarkSite[]>([]);
  const [status, setStatus] = useState<BenchmarkStatus>({ state: "idle" });
  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [addingTask, setAddingTask] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ instruction: "", successCriteria: "", category: "navigation" });
  const [generating, setGenerating] = useState<string | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [history, setHistory] = useState<BenchmarkHistoryEntry[]>([]);
  const [multiHistory, setMultiHistory] = useState<MultiMethodHistoryEntry[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<BenchmarkStatus["result"] | null>(null);
  const [expandedMultiResult, setExpandedMultiResult] = useState<MultiMethodResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Multi-method config
  const [siteCount, setSiteCount] = useState(5);
  const [tasksPerSite, setTasksPerSite] = useState(3);
  const [selectedMethods, setSelectedMethods] = useState<DocMethod[]>([...ALL_DOC_METHODS]);
  const [generatingSites, setGeneratingSites] = useState(false);

  useEffect(() => {
    loadSites();
    loadHistory();
    loadMultiHistory();
    // Reconnect to running benchmark if page was refreshed
    const savedBenchId = localStorage.getItem("activeBenchmarkId");
    const savedMulti = localStorage.getItem("activeBenchmarkMulti") === "true";
    if (savedBenchId) {
      // Check if it's still running
      fetch(`${API_BASE}/api/benchmark/status/${savedBenchId}`)
        .then((res) => res.ok ? res.json() : null)
        .then((d) => {
          if (d && d.status !== "done" && d.status !== "error") {
            pollBenchmark(savedBenchId, d.tasksTotal || 0, savedMulti);
          } else {
            localStorage.removeItem("activeBenchmarkId");
            localStorage.removeItem("activeBenchmarkMulti");
          }
        })
        .catch(() => {
          localStorage.removeItem("activeBenchmarkId");
          localStorage.removeItem("activeBenchmarkMulti");
        });
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSites() {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites`);
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites || []);
      }
    } catch { /* ignore */ }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/history`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.runs || []);
      }
    } catch { /* ignore */ }
  }

  async function loadMultiHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/multi/history`);
      if (res.ok) {
        const data = await res.json();
        setMultiHistory(data.runs || []);
      }
    } catch { /* ignore */ }
  }

  async function deleteRun(runId: string, multi: boolean) {
    const base = multi ? "multi/history" : "history";
    try {
      await fetch(`${API_BASE}/api/benchmark/${base}/${runId}`, { method: "DELETE" });
      if (multi) {
        setMultiHistory((prev) => prev.filter((r) => r.id !== runId));
      } else {
        setHistory((prev) => prev.filter((r) => r.id !== runId));
      }
      if (expandedRun === runId) {
        setExpandedRun(null);
        setExpandedResult(null);
        setExpandedMultiResult(null);
      }
    } catch { /* ignore */ }
  }

  async function toggleExpandRun(runId: string, multi: boolean) {
    if (expandedRun === runId) {
      setExpandedRun(null);
      setExpandedResult(null);
      setExpandedMultiResult(null);
      return;
    }
    setExpandedRun(runId);
    setExpandedResult(null);
    setExpandedMultiResult(null);
    const base = multi ? "multi/history" : "history";
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/${base}/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (multi) {
          setExpandedMultiResult(data.result);
        } else {
          setExpandedResult(data.result);
        }
      }
    } catch { /* ignore */ }
  }

  async function addSite() {
    if (!newSiteUrl) return;
    setSiteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newSiteUrl }),
      });
      if (res.ok) {
        setNewSiteUrl("");
        await loadSites();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to add site");
      }
    } catch {
      alert("Failed to connect to API");
    } finally {
      setSiteLoading(false);
    }
  }

  async function removeSite(domain: string) {
    try {
      await fetch(`${API_BASE}/api/benchmark/sites/${domain}`, { method: "DELETE" });
      await loadSites();
    } catch { /* ignore */ }
  }

  async function addManualTask(domain: string) {
    if (!taskForm.instruction || !taskForm.successCriteria) return;
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites/${domain}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskForm),
      });
      if (res.ok) {
        setAddingTask(null);
        setTaskForm({ instruction: "", successCriteria: "", category: "navigation" });
        await loadSites();
      }
    } catch { /* ignore */ }
  }

  async function removeTask(domain: string, taskId: string) {
    try {
      await fetch(`${API_BASE}/api/benchmark/sites/${domain}/tasks/${taskId}`, { method: "DELETE" });
      await loadSites();
    } catch { /* ignore */ }
  }

  async function generateTasks(url: string, domain: string) {
    setGenerating(domain);
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/tasks/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, count: 3 }),
      });
      if (res.ok) {
        await loadSites();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Task generation failed");
      }
    } catch {
      alert("Failed to connect to API");
    } finally {
      setGenerating(null);
    }
  }

  async function generateSitesWithAI() {
    setGeneratingSites(true);
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: siteCount }),
      });
      if (res.ok) {
        await loadSites();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Site generation failed");
      }
    } catch {
      alert("Failed to connect to API");
    } finally {
      setGeneratingSites(false);
    }
  }

  function toggleMethod(method: DocMethod) {
    setSelectedMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  }

  async function handleRun(useConfigured: boolean) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setStatus({ state: "running", phase: "Starting..." });

    try {
      const res = await fetch(`${API_BASE}/api/benchmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useConfigured ? { useConfiguredSites: true } : { useSampleTasks: true }
        ),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ state: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      pollBenchmark(data.benchId, data.tasksTotal, false);
    } catch (error) {
      setStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to API",
      });
    }
  }

  async function handleMultiMethodRun(generateNewSites: boolean) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (selectedMethods.length === 0) {
      alert("Select at least one method to test.");
      return;
    }

    setStatus({ state: "running", phase: "Starting multi-method benchmark...", multiMethod: true });

    try {
      const res = await fetch(`${API_BASE}/api/benchmark/multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          methods: selectedMethods,
          generateSites: generateNewSites,
          useConfiguredSites: !generateNewSites,
          siteCount: generateNewSites ? siteCount : undefined,
          tasksPerSite,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ state: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      pollBenchmark(data.benchId, 0, true);
    } catch (error) {
      setStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to API",
      });
    }
  }

  function pollBenchmark(benchId: string, initialTotal: number, multi: boolean) {
    // Save to localStorage so we can reconnect after page refresh
    localStorage.setItem("activeBenchmarkId", benchId);
    localStorage.setItem("activeBenchmarkMulti", String(multi));

    setStatus({
      state: "running",
      benchId,
      phase: "Reconnecting..." ,
      tasksTotal: initialTotal,
      tasksCompleted: 0,
      multiMethod: multi,
    });

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_BENCHMARK_POLL_ATTEMPTS) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        localStorage.removeItem("activeBenchmarkId");
        localStorage.removeItem("activeBenchmarkMulti");
        setStatus((prev) => ({ ...prev, state: "error", error: "Benchmark timed out after 4 hours" }));
        return;
      }

      try {
        const statusRes = await fetch(`${API_BASE}/api/benchmark/status/${benchId}`);
        if (!statusRes.ok) return;

        const d = await statusRes.json();

        if (d.status === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          localStorage.removeItem("activeBenchmarkId");
          localStorage.removeItem("activeBenchmarkMulti");
          if (d.multiResult) {
            setStatus({ state: "done", benchId, multiMethod: true, multiResult: d.multiResult });
            loadMultiHistory();
          } else {
            setStatus({ state: "done", benchId, result: d.result });
            loadHistory();
          }
          loadSites();
        } else if (d.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          localStorage.removeItem("activeBenchmarkId");
          localStorage.removeItem("activeBenchmarkMulti");
          setStatus({ state: "error", error: d.error });
        } else {
          const phaseLabel = d.currentSite && d.currentMethod
            ? `Testing ${d.currentSite} with ${DOC_METHOD_LABELS[d.currentMethod as DocMethod] || d.currentMethod}...`
            : d.status === "generating-docs"
            ? `Generating documentation${d.currentSite ? ` for ${d.currentSite}` : ""}...`
            : d.status === "generating-tasks"
            ? `Generating tasks${d.currentSite ? ` for ${d.currentSite}` : ""}...`
            : d.status === "running-baseline"
            ? "Running baseline (no docs)..."
            : d.status === "running-with-docs"
            ? "Running with documentation..."
            : d.status === "running"
            ? "Running benchmark..."
            : "Processing...";

          setStatus((prev) => ({
            ...prev,
            phase: phaseLabel,
            tasksTotal: d.tasksTotal || prev.tasksTotal,
            tasksCompleted: d.tasksCompleted ?? prev.tasksCompleted,
            currentSite: d.currentSite,
            currentMethod: d.currentMethod,
          }));
        }
      } catch { /* Keep polling */ }
    }, 3000);
  }

  const totalConfiguredTasks = sites.reduce((sum, s) => sum + s.tasks.length, 0);

  return (
    <>
      <p style={{ textAlign: "center", color: "#666", marginBottom: 24, fontSize: 14 }}>
        Multi-method benchmark using Claude CUA (Computer Use Agent). Compare different
        documentation injection strategies across diverse websites.
      </p>

      {/* Setup */}
      {status.state === "idle" && (
        <>
          {/* Multi-Method Configuration */}
          <div
            style={{
              backgroundColor: "#111",
              border: "1px solid #222",
              borderRadius: 8,
              padding: 24,
              marginBottom: 24,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              Multi-Method Benchmark
            </h3>
            <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
              Test all doc injection methods simultaneously across multiple sites. AI generates a diverse site list, crawls and documents each site, then benchmarks every method.
            </p>

            {/* Method Selection */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 8 }}>
                Methods to test:
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ALL_DOC_METHODS.map((method) => (
                  <button
                    key={method}
                    onClick={() => toggleMethod(method)}
                    style={{
                      ...btnStyle,
                      fontSize: 12,
                      padding: "6px 12px",
                      backgroundColor: selectedMethods.includes(method) ? "#1a2a4a" : "#1a1a1a",
                      color: selectedMethods.includes(method) ? "#3b82f6" : "#888",
                      border: selectedMethods.includes(method) ? "1px solid #3b82f6" : "1px solid #333",
                    }}
                  >
                    {DOC_METHOD_LABELS[method]}
                  </button>
                ))}
              </div>
            </div>

            {/* Site Count & Tasks Per Site */}
            <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
              <div>
                <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 6 }}>
                  Number of sites:
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={siteCount}
                  onChange={(e) => setSiteCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  style={{ ...inputStyle, fontSize: 14, padding: "8px 12px", width: 80 }}
                />
              </div>
              <div>
                <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 6 }}>
                  Tasks per site:
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={tasksPerSite}
                  onChange={(e) => setTasksPerSite(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                  style={{ ...inputStyle, fontSize: 14, padding: "8px 12px", width: 80 }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <span style={{ color: "#666", fontSize: 12, paddingBottom: 10 }}>
                  Total runs: {siteCount * tasksPerSite * selectedMethods.length} ({siteCount} sites x {tasksPerSite} tasks x {selectedMethods.length} methods)
                </span>
              </div>
            </div>

            {/* Run Buttons */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => handleMultiMethodRun(true)}
                style={{
                  ...primaryBtn(false),
                  fontSize: 14,
                }}
              >
                Generate {siteCount} Sites & Run Benchmark
              </button>
              {sites.length > 0 && (
                <button
                  onClick={() => handleMultiMethodRun(false)}
                  style={{
                    ...primaryBtn(false),
                    fontSize: 14,
                    backgroundColor: "#333",
                  }}
                >
                  Run on Configured Sites ({sites.length})
                </button>
              )}
            </div>
          </div>

          {/* Site Management */}
          <div
            style={{
              backgroundColor: "#111",
              border: "1px solid #222",
              borderRadius: 8,
              padding: 24,
              marginBottom: 24,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              Benchmark Sites & Tasks
            </h3>

            {/* Add site form */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={newSiteUrl}
                onChange={(e) => setNewSiteUrl(e.target.value)}
                placeholder="https://example.com"
                onKeyDown={(e) => e.key === "Enter" && addSite()}
                style={{ ...inputStyle, fontSize: 14, padding: "10px 14px" }}
              />
              <button
                onClick={addSite}
                disabled={siteLoading}
                style={{
                  ...btnStyle,
                  backgroundColor: "#3b82f6",
                  border: "none",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {siteLoading ? "Adding..." : "Add Site"}
              </button>
              <button
                onClick={generateSitesWithAI}
                disabled={generatingSites}
                style={{
                  ...btnStyle,
                  backgroundColor: "#1a1a2e",
                  color: "#a855f7",
                  border: "1px solid #a855f733",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {generatingSites ? "Generating..." : `AI Generate ${siteCount} Sites`}
              </button>
            </div>

            {/* Sites list */}
            {sites.length === 0 ? (
              <p style={{ color: "#666", fontSize: 14, textAlign: "center", padding: 20 }}>
                No sites configured. Add manually or use AI to generate a diverse set.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sites.map((site) => (
                  <div
                    key={site.domain}
                    style={{
                      backgroundColor: "#0a0a0a",
                      border: "1px solid #222",
                      borderRadius: 6,
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: site.tasks.length > 0 || addingTask === site.domain ? 12 : 0,
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{site.domain}</span>
                        <span style={{ color: "#666", fontSize: 12, marginLeft: 8 }}>
                          {site.tasks.length} task{site.tasks.length !== 1 ? "s" : ""}
                        </span>
                        {site.hasDocumentation && (
                          <span style={{ color: "#22c55e", fontSize: 11, marginLeft: 8, border: "1px solid #22c55e33", padding: "2px 6px", borderRadius: 4 }}>
                            docs cached
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => generateTasks(site.url, site.domain)}
                          disabled={generating === site.domain}
                          style={{ ...btnStyle, fontSize: 12, padding: "4px 10px", backgroundColor: "#1a1a2e", color: "#a855f7", border: "1px solid #a855f733" }}
                        >
                          {generating === site.domain ? "Generating..." : "AI Generate Tasks"}
                        </button>
                        <button
                          onClick={() => setAddingTask(addingTask === site.domain ? null : site.domain)}
                          style={{ ...btnStyle, fontSize: 12, padding: "4px 10px" }}
                        >
                          + Task
                        </button>
                        <button
                          onClick={() => removeSite(site.domain)}
                          style={{ ...btnStyle, fontSize: 12, padding: "4px 10px", color: "#ef4444", border: "1px solid #ef444433" }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {site.tasks.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {site.tasks.map((task) => (
                          <div
                            key={task.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              padding: "8px 12px",
                              backgroundColor: "#111",
                              borderRadius: 4,
                              fontSize: 13,
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ color: "#ededed" }}>{task.instruction}</div>
                              <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                                {task.category}
                                {task.source === "ai-generated" && <span style={{ color: "#a855f7", marginLeft: 6 }}>AI</span>}
                                {task.source === "manual" && <span style={{ color: "#3b82f6", marginLeft: 6 }}>manual</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => removeTask(site.domain, task.id)}
                              style={{ background: "none", border: "none", color: "#666", cursor: "pointer", padding: "0 4px", fontSize: 16 }}
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {addingTask === site.domain && (
                      <div style={{ marginTop: 12, padding: 12, backgroundColor: "#111", borderRadius: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                        <input type="text" placeholder="Task instruction" value={taskForm.instruction} onChange={(e) => setTaskForm({ ...taskForm, instruction: e.target.value })} style={{ ...inputStyle, fontSize: 13, padding: "8px 12px" }} />
                        <input type="text" placeholder="Success criteria" value={taskForm.successCriteria} onChange={(e) => setTaskForm({ ...taskForm, successCriteria: e.target.value })} style={{ ...inputStyle, fontSize: 13, padding: "8px 12px" }} />
                        <div style={{ display: "flex", gap: 8 }}>
                          <select value={taskForm.category} onChange={(e) => setTaskForm({ ...taskForm, category: e.target.value })} style={{ ...inputStyle, fontSize: 13, padding: "8px 12px", flex: "none", width: 180 }}>
                            <option value="navigation">Navigation</option>
                            <option value="search">Search</option>
                            <option value="form-fill">Form Fill</option>
                            <option value="multi-step">Multi-step</option>
                            <option value="information-extraction">Info Extraction</option>
                          </select>
                          <button onClick={() => addManualTask(site.domain)} style={{ ...btnStyle, fontSize: 13, backgroundColor: "#3b82f6", border: "none", color: "#fff" }}>Add Task</button>
                          <button onClick={() => setAddingTask(null)} style={{ ...btnStyle, fontSize: 13 }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Legacy A/B Run buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 32, flexWrap: "wrap" }}>
            {totalConfiguredTasks > 0 && (
              <button onClick={() => handleRun(true)} style={{ ...primaryBtn(false), backgroundColor: "#333", fontSize: 14 }}>
                Run Legacy A/B Benchmark ({totalConfiguredTasks} tasks)
              </button>
            )}
            <button onClick={() => handleRun(false)} style={{ ...primaryBtn(false), backgroundColor: "#333", fontSize: 14 }}>
              Run with Sample Tasks (Legacy)
            </button>
          </div>

          {/* Previous Multi-Method Runs */}
          {multiHistory.length > 0 && (
            <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: 8, padding: 24, marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Previous Multi-Method Runs</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {multiHistory.map((run) => {
                  const isExpanded = expandedRun === run.id;
                  return (
                    <div key={run.id} style={{ backgroundColor: "#0a0a0a", border: "1px solid #222", borderRadius: 6, overflow: "hidden" }}>
                      <div
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
                        onClick={() => toggleExpandRun(run.id, true)}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <span style={{ color: "#888", fontSize: 12 }}>{new Date(run.timestamp).toLocaleString()}</span>
                          <span style={{ fontSize: 13 }}>{run.sites} site{run.sites !== 1 ? "s" : ""}</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{run.totalTasks} total runs</span>
                          <span style={{ fontSize: 12, color: "#3b82f6" }}>{run.methods.length} methods</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteRun(run.id, true); }}
                            style={{ ...btnStyle, fontSize: 12, padding: "4px 10px", color: "#ef4444", border: "1px solid #ef444433" }}
                          >
                            Delete
                          </button>
                          <span style={{ color: "#555", fontSize: 14 }}>{isExpanded ? "\u25B2" : "\u25BC"}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: "0 16px 16px" }}>
                          {expandedMultiResult ? (
                            <MultiMethodResults result={expandedMultiResult} />
                          ) : (
                            <p style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 12 }}>Loading details...</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Previous Legacy Runs */}
          {history.length > 0 && (
            <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: 8, padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Previous A/B Runs (Legacy)</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map((run) => {
                  const isExpanded = expandedRun === run.id;
                  const successDelta = run.improvement?.successRateDelta;
                  const tokenReduction = run.improvement?.tokenReduction;
                  return (
                    <div key={run.id} style={{ backgroundColor: "#0a0a0a", border: "1px solid #222", borderRadius: 6, overflow: "hidden" }}>
                      <div
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
                        onClick={() => toggleExpandRun(run.id, false)}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <span style={{ color: "#888", fontSize: 12 }}>{new Date(run.timestamp).toLocaleString()}</span>
                          <span style={{ fontSize: 13 }}>{run.tasksTotal} task{run.tasksTotal !== 1 ? "s" : ""}</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{(run.successRateBaseline * 100).toFixed(0)}% baseline</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{(run.successRateWithDocs * 100).toFixed(0)}% w/ docs</span>
                          {successDelta != null && (
                            <span style={{ fontSize: 12, color: successDelta > 0 ? "#22c55e" : successDelta < 0 ? "#ef4444" : "#888", fontWeight: 600 }}>
                              {successDelta > 0 ? "+" : ""}{(successDelta * 100).toFixed(1)}pp
                            </span>
                          )}
                          {tokenReduction != null && (
                            <span style={{ fontSize: 12, color: tokenReduction > 0 ? "#22c55e" : "#ef4444" }}>
                              {tokenReduction > 0 ? "-" : "+"}{Math.abs(tokenReduction).toFixed(0)}% tokens
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button onClick={(e) => { e.stopPropagation(); deleteRun(run.id, false); }} style={{ ...btnStyle, fontSize: 12, padding: "4px 10px", color: "#ef4444", border: "1px solid #ef444433" }}>Delete</button>
                          <span style={{ color: "#555", fontSize: 14 }}>{isExpanded ? "\u25B2" : "\u25BC"}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: "0 16px 16px" }}>
                          {expandedResult ? <BenchmarkResults result={expandedResult} /> : <p style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 12 }}>Loading details...</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Running */}
      {status.state === "running" && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 24, color: "#3b82f6", marginBottom: 12 }}>
            {status.multiMethod ? "Multi-Method Benchmark Running" : "CUA Benchmark Running"}
          </div>
          <p style={{ color: "#888", marginBottom: 8 }}>{status.phase}</p>
          {status.currentSite && (
            <p style={{ color: "#aaa", fontSize: 13, marginBottom: 4 }}>Site: {status.currentSite}</p>
          )}
          {status.tasksTotal != null && status.tasksTotal > 0 && (
            <p style={{ color: "#666", fontSize: 14 }}>
              Progress: {status.tasksCompleted || 0} / {status.tasksTotal} task runs
            </p>
          )}
          <div style={{ width: 300, height: 4, backgroundColor: "#333", borderRadius: 2, margin: "20px auto", overflow: "hidden" }}>
            <div
              style={{
                width: status.tasksTotal && status.tasksTotal > 0
                  ? `${((status.tasksCompleted || 0) / status.tasksTotal) * 100}%`
                  : "5%",
                height: "100%",
                backgroundColor: "#3b82f6",
                borderRadius: 2,
                transition: "width 0.5s",
              }}
            />
          </div>
          <p style={{ color: "#555", fontSize: 12, marginTop: 16 }}>
            Claude CUA is controlling a real browser with screenshots. This may take a while.
          </p>
        </div>
      )}

      {/* Error */}
      {status.state === "error" && (
        <>
          <ErrorBox error={status.error} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <button onClick={() => setStatus({ state: "idle" })} style={btnStyle}>Back to Setup</button>
          </div>
        </>
      )}

      {/* Multi-Method Results */}
      {status.state === "done" && status.multiResult && (
        <div>
          <MultiMethodResults result={status.multiResult} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
            <button onClick={() => setStatus({ state: "idle" })} style={btnStyle}>Back to Setup</button>
          </div>
        </div>
      )}

      {/* Legacy Results */}
      {status.state === "done" && status.result && !status.multiResult && (
        <div>
          <BenchmarkResults result={status.result} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
            <button onClick={() => setStatus({ state: "idle" })} style={btnStyle}>Back to Setup</button>
            <button onClick={() => handleRun(totalConfiguredTasks > 0)} style={primaryBtn(false)}>Run Again</button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Multi-Method Results Component ──────────────────────────────────

const METHOD_COLORS: Record<DocMethod, string> = {
  "none": "#888",
  "micro-guide": "#3b82f6",
  "full-guide": "#8b5cf6",
  "first-message": "#f59e0b",
  "pre-plan": "#22c55e",
};

function MultiMethodResults({ result }: { result: MultiMethodResult }) {
  const [expandedSite, setExpandedSite] = useState<string | null>(null);

  const baselineOverall = result.overall.find((m) => m.method === "none");

  return (
    <>
      {/* Overall Method Comparison */}
      <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, textAlign: "center" }}>
          Overall Method Comparison
        </h3>
        <p style={{ color: "#888", fontSize: 12, textAlign: "center", marginBottom: 16 }}>
          {result.sites.length} site{result.sites.length !== 1 ? "s" : ""} &middot; {result.totalTasks} total task runs &middot; {result.methods.length} methods
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
              <th style={{ textAlign: "left", padding: "10px 12px" }}>Method</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Success Rate</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Avg Tokens</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Avg Duration</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Avg Steps</th>
              {baselineOverall && <th style={{ textAlign: "center", padding: "10px 12px" }}>vs Baseline</th>}
            </tr>
          </thead>
          <tbody>
            {result.overall.map((mr, i) => {
              const successDelta = baselineOverall && mr.method !== "none"
                ? mr.metrics.successRate - baselineOverall.metrics.successRate
                : null;
              const tokenDelta = baselineOverall && mr.method !== "none" && baselineOverall.metrics.avgTokensPerTask > 0
                ? ((mr.metrics.avgTokensPerTask - baselineOverall.metrics.avgTokensPerTask) / baselineOverall.metrics.avgTokensPerTask) * 100
                : null;

              return (
                <tr key={mr.method} style={{ borderBottom: "1px solid #222", backgroundColor: i % 2 === 0 ? "transparent" : "#0a0a0a" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                    <span style={{ color: METHOD_COLORS[mr.method] || "#aaa" }}>
                      {DOC_METHOD_LABELS[mr.method]}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px" }}>
                    {(mr.metrics.successRate * 100).toFixed(1)}%
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px" }}>
                    {mr.metrics.avgTokensPerTask.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px" }}>
                    {(mr.metrics.avgDurationMs / 1000).toFixed(1)}s
                  </td>
                  <td style={{ textAlign: "center", padding: "10px 12px" }}>
                    {mr.metrics.avgSteps.toFixed(1)}
                  </td>
                  {baselineOverall && (
                    <td style={{ textAlign: "center", padding: "10px 12px" }}>
                      {mr.method === "none" ? (
                        <span style={{ color: "#555" }}>--</span>
                      ) : (
                        <span>
                          <span style={{ color: successDelta != null && successDelta > 0 ? "#22c55e" : successDelta != null && successDelta < 0 ? "#ef4444" : "#888", fontWeight: 600, marginRight: 8 }}>
                            {successDelta != null ? `${successDelta > 0 ? "+" : ""}${(successDelta * 100).toFixed(1)}pp` : ""}
                          </span>
                          <span style={{ color: tokenDelta != null && tokenDelta < 0 ? "#22c55e" : tokenDelta != null && tokenDelta > 0 ? "#ef4444" : "#888", fontSize: 12 }}>
                            {tokenDelta != null ? `${tokenDelta > 0 ? "+" : ""}${tokenDelta.toFixed(0)}% tokens` : ""}
                          </span>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Per-Site Breakdown */}
      <div style={{ backgroundColor: "#111", border: "1px solid #222", borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, textAlign: "center" }}>
          Per-Site Breakdown
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {result.sites.map((site) => {
            const isExpanded = expandedSite === site.domain;
            const baseline = site.methods.find((m) => m.method === "none");
            const bestMethod = [...site.methods].sort(
              (a, b) => b.metrics.successRate - a.metrics.successRate || a.metrics.avgTokensPerTask - b.metrics.avgTokensPerTask
            )[0];

            return (
              <div key={site.domain} style={{ backgroundColor: "#0a0a0a", border: "1px solid #222", borderRadius: 6, overflow: "hidden" }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}
                  onClick={() => setExpandedSite(isExpanded ? null : site.domain)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{site.domain}</span>
                    {baseline && (
                      <span style={{ fontSize: 12, color: "#888" }}>
                        Baseline: {(baseline.metrics.successRate * 100).toFixed(0)}%
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: METHOD_COLORS[bestMethod.method] || "#aaa" }}>
                      Best: {DOC_METHOD_LABELS[bestMethod.method]} ({(bestMethod.metrics.successRate * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <span style={{ color: "#555", fontSize: 14 }}>{isExpanded ? "\u25B2" : "\u25BC"}</span>
                </div>

                {isExpanded && (
                  <div style={{ padding: "0 16px 16px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
                          <th style={{ textAlign: "left", padding: "8px 10px" }}>Method</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Success</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Avg Tokens</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Avg Duration</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Avg Steps</th>
                        </tr>
                      </thead>
                      <tbody>
                        {site.methods.map((mr, j) => (
                          <tr key={mr.method} style={{ borderBottom: "1px solid #222", backgroundColor: j % 2 === 0 ? "transparent" : "#111" }}>
                            <td style={{ padding: "8px 10px" }}>
                              <span style={{ color: METHOD_COLORS[mr.method] || "#aaa", fontWeight: 600 }}>
                                {DOC_METHOD_LABELS[mr.method]}
                              </span>
                            </td>
                            <td style={{ textAlign: "center", padding: "8px 10px" }}>
                              <span style={{ color: mr.metrics.successRate >= 0.5 ? "#22c55e" : "#ef4444" }}>
                                {(mr.metrics.successRate * 100).toFixed(0)}%
                              </span>
                              <span style={{ color: "#555", fontSize: 11, marginLeft: 4 }}>
                                ({mr.tasks.filter((t) => t.success).length}/{mr.tasks.length})
                              </span>
                            </td>
                            <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                              {mr.metrics.avgTokensPerTask.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                            <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                              {(mr.metrics.avgDurationMs / 1000).toFixed(1)}s
                            </td>
                            <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                              {mr.metrics.avgSteps.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Per-task detail within site */}
                    <div style={{ marginTop: 12 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 8 }}>Task Details</h4>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #333", color: "#666" }}>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>Task</th>
                            {site.methods.map((mr) => (
                              <th key={mr.method} style={{ textAlign: "center", padding: "6px 8px", color: METHOD_COLORS[mr.method] }}>
                                {DOC_METHOD_LABELS[mr.method]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {site.methods[0]?.tasks.map((_, taskIdx) => (
                            <tr key={taskIdx} style={{ borderBottom: "1px solid #222" }}>
                              <td style={{ padding: "6px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {site.methods[0].tasks[taskIdx].taskId}
                              </td>
                              {site.methods.map((mr) => {
                                const task = mr.tasks[taskIdx];
                                return (
                                  <td key={mr.method} style={{ textAlign: "center", padding: "6px 8px" }}>
                                    <span style={{ color: task?.success ? "#22c55e" : "#ef4444", fontWeight: 600, fontSize: 11 }}>
                                      {task?.success ? "Pass" : "Fail"}
                                    </span>
                                    <span style={{ color: "#555", fontSize: 10, marginLeft: 4 }}>
                                      {task ? `${(task.tokensUsed / 1000).toFixed(0)}K` : "--"}
                                    </span>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Benchmark Results Component (Legacy A/B) ───────────────────────

function BenchmarkResults({ result }: { result: BenchmarkStatus["result"] }) {
  if (!result) return null;

  const { summary } = result;

  return (
    <>
      {/* Comparison Table */}
      <div
        style={{
          backgroundColor: "#111",
          border: "1px solid #222",
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, textAlign: "center" }}>
          CUA A/B Comparison
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
              <th style={{ textAlign: "left", padding: "10px 12px" }}>Metric</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Baseline (no docs)</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>With Docs</th>
              <th style={{ textAlign: "center", padding: "10px 12px" }}>Improvement</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid #222" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>Success Rate</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {(summary.baseline.successRate * 100).toFixed(1)}%
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {(summary.withDocs.successRate * 100).toFixed(1)}%
              </td>
              <td
                style={{
                  textAlign: "center",
                  padding: "10px 12px",
                  color:
                    summary.improvement.successRateDelta > 0
                      ? "#22c55e"
                      : summary.improvement.successRateDelta < 0
                      ? "#ef4444"
                      : "#888",
                  fontWeight: 600,
                }}
              >
                {summary.improvement.successRateDelta > 0 ? "+" : ""}
                {(summary.improvement.successRateDelta * 100).toFixed(1)}pp
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #222", backgroundColor: "#0a0a0a" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>Avg Tokens/Task</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {summary.baseline.avgTokensPerTask.toFixed(0)}
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {summary.withDocs.avgTokensPerTask.toFixed(0)}
              </td>
              <td
                style={{
                  textAlign: "center",
                  padding: "10px 12px",
                  color: summary.improvement.tokenReduction > 0 ? "#22c55e" : "#ef4444",
                  fontWeight: 600,
                }}
              >
                {summary.improvement.tokenReduction > 0 ? "-" : "+"}
                {Math.abs(summary.improvement.tokenReduction).toFixed(1)}%
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #222" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>Avg Duration</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {(summary.baseline.avgDurationMs / 1000).toFixed(1)}s
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {(summary.withDocs.avgDurationMs / 1000).toFixed(1)}s
              </td>
              <td
                style={{
                  textAlign: "center",
                  padding: "10px 12px",
                  color: summary.improvement.speedup > 1 ? "#22c55e" : "#ef4444",
                  fontWeight: 600,
                }}
              >
                {summary.improvement.speedup.toFixed(2)}x
              </td>
            </tr>
            <tr style={{ backgroundColor: "#0a0a0a" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>Avg Steps</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {summary.baseline.avgSteps.toFixed(1)}
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                {summary.withDocs.avgSteps.toFixed(1)}
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px", color: "#888" }}>
                {(summary.withDocs.avgSteps - summary.baseline.avgSteps).toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Per-task breakdown */}
      <div
        style={{
          backgroundColor: "#111",
          border: "1px solid #222",
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, textAlign: "center" }}>
          Per-Task Breakdown
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", color: "#888" }}>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Task</th>
              <th style={{ textAlign: "center", padding: "8px 10px" }}>Baseline</th>
              <th style={{ textAlign: "center", padding: "8px 10px" }}>With Docs</th>
              <th style={{ textAlign: "center", padding: "8px 10px" }}>Baseline Tokens</th>
              <th style={{ textAlign: "center", padding: "8px 10px" }}>Docs Tokens</th>
            </tr>
          </thead>
          <tbody>
            {result.baseline.map((baseline, i) => {
              const withDocs = result.withDocs[i];
              return (
                <tr
                  key={baseline.taskId}
                  style={{
                    borderBottom: "1px solid #222",
                    backgroundColor: i % 2 === 0 ? "transparent" : "#0a0a0a",
                  }}
                >
                  <td style={{ padding: "8px 10px" }}>{baseline.taskId}</td>
                  <td style={{ textAlign: "center", padding: "8px 10px" }}>
                    <span
                      style={{
                        color: baseline.success ? "#22c55e" : "#ef4444",
                        fontWeight: 600,
                      }}
                    >
                      {baseline.success ? "Pass" : "Fail"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 10px" }}>
                    <span
                      style={{
                        color: withDocs?.success ? "#22c55e" : "#ef4444",
                        fontWeight: 600,
                      }}
                    >
                      {withDocs?.success ? "Pass" : "Fail"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                    {baseline.tokensUsed.toLocaleString()}
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 10px", color: "#aaa" }}>
                    {withDocs?.tokensUsed.toLocaleString() ?? "\u2014"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Shared Components ───────────────────────────────────────────────

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
