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
  error?: string;
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
      {cachedDocs.length > 0 && (
        <div
          style={{
            backgroundColor: "#111",
            border: "1px solid #222",
            borderRadius: 8,
            padding: 24,
            marginTop: 32,
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
            Cached Documentation
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cachedDocs.map((doc) => (
              <div
                key={doc.domain}
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
            ))}
          </div>
        </div>
      )}
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
  const [addingTask, setAddingTask] = useState<string | null>(null); // domain being edited
  const [taskForm, setTaskForm] = useState({ instruction: "", successCriteria: "", category: "navigation" });
  const [generating, setGenerating] = useState<string | null>(null); // domain generating tasks for
  const [siteLoading, setSiteLoading] = useState(false);
  const [history, setHistory] = useState<BenchmarkHistoryEntry[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<BenchmarkStatus["result"] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load configured sites and history on mount
  useEffect(() => {
    loadSites();
    loadHistory();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function loadSites() {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/sites`);
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites || []);
      }
    } catch {
      // ignore
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/history`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.runs || []);
      }
    } catch {
      // ignore
    }
  }

  async function deleteRun(runId: string) {
    try {
      await fetch(`${API_BASE}/api/benchmark/history/${runId}`, { method: "DELETE" });
      setHistory((prev) => prev.filter((r) => r.id !== runId));
      if (expandedRun === runId) {
        setExpandedRun(null);
        setExpandedResult(null);
      }
    } catch {
      // ignore
    }
  }

  async function toggleExpandRun(runId: string) {
    if (expandedRun === runId) {
      setExpandedRun(null);
      setExpandedResult(null);
      return;
    }
    setExpandedRun(runId);
    setExpandedResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/history/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setExpandedResult(data.result);
      }
    } catch {
      // ignore
    }
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
    } catch {
      // ignore
    }
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
    } catch {
      // ignore
    }
  }

  async function removeTask(domain: string, taskId: string) {
    try {
      await fetch(`${API_BASE}/api/benchmark/sites/${domain}/tasks/${taskId}`, { method: "DELETE" });
      await loadSites();
    } catch {
      // ignore
    }
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
          useConfigured
            ? { useConfiguredSites: true }
            : { useSampleTasks: true }
        ),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ state: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      const benchId = data.benchId;
      setStatus({
        state: "running",
        benchId,
        phase: "Generating documentation...",
        tasksTotal: data.tasksTotal,
        tasksCompleted: 0,
      });

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > MAX_POLL_ATTEMPTS * 3) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setStatus((prev) => ({ ...prev, state: "error", error: "Benchmark timed out" }));
          return;
        }

        try {
          const statusRes = await fetch(`${API_BASE}/api/benchmark/status/${benchId}`);
          if (!statusRes.ok) return;

          const statusData = await statusRes.json();

          if (statusData.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setStatus({ state: "done", benchId, result: statusData.result });
            loadHistory();
          } else if (statusData.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setStatus({ state: "error", error: statusData.error });
          } else {
            const phaseLabel =
              statusData.status === "generating-docs"
                ? "Generating documentation for test sites..."
                : statusData.status === "running-baseline"
                ? "Running CUA baseline (no docs)..."
                : statusData.status === "running-with-docs"
                ? "Running CUA with documentation..."
                : "Processing...";

            setStatus((prev) => ({
              ...prev,
              phase: phaseLabel,
              tasksTotal: statusData.tasksTotal || prev.tasksTotal,
              tasksCompleted: statusData.tasksCompleted ?? prev.tasksCompleted,
            }));
          }
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

  const totalConfiguredTasks = sites.reduce((sum, s) => sum + s.tasks.length, 0);

  return (
    <>
      <p style={{ textAlign: "center", color: "#666", marginBottom: 24, fontSize: 14 }}>
        A/B benchmark using Claude CUA (Computer Use Agent). Compare AI agent
        performance with and without WebMap documentation.
      </p>

      {/* Site Management */}
      {status.state === "idle" && (
        <>
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
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
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
            </div>

            {/* Sites list */}
            {sites.length === 0 ? (
              <p style={{ color: "#666", fontSize: 14, textAlign: "center", padding: 20 }}>
                No sites configured. Add a site above, or run with sample tasks below.
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
                    {/* Site header */}
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
                          <span
                            style={{
                              color: "#22c55e",
                              fontSize: 11,
                              marginLeft: 8,
                              border: "1px solid #22c55e33",
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            docs cached
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => generateTasks(site.url, site.domain)}
                          disabled={generating === site.domain}
                          style={{
                            ...btnStyle,
                            fontSize: 12,
                            padding: "4px 10px",
                            backgroundColor: "#1a1a2e",
                            color: "#a855f7",
                            border: "1px solid #a855f733",
                          }}
                        >
                          {generating === site.domain ? "Generating..." : "AI Generate Tasks"}
                        </button>
                        <button
                          onClick={() =>
                            setAddingTask(addingTask === site.domain ? null : site.domain)
                          }
                          style={{
                            ...btnStyle,
                            fontSize: 12,
                            padding: "4px 10px",
                          }}
                        >
                          + Task
                        </button>
                        <button
                          onClick={() => removeSite(site.domain)}
                          style={{
                            ...btnStyle,
                            fontSize: 12,
                            padding: "4px 10px",
                            color: "#ef4444",
                            border: "1px solid #ef444433",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Tasks list */}
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
                                {task.source === "ai-generated" && (
                                  <span style={{ color: "#a855f7", marginLeft: 6 }}>AI</span>
                                )}
                                {task.source === "manual" && (
                                  <span style={{ color: "#3b82f6", marginLeft: 6 }}>manual</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => removeTask(site.domain, task.id)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#666",
                                cursor: "pointer",
                                padding: "0 4px",
                                fontSize: 16,
                              }}
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add task form */}
                    {addingTask === site.domain && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          backgroundColor: "#111",
                          borderRadius: 4,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <input
                          type="text"
                          placeholder="Task instruction (e.g., 'Find the search bar and search for AI')"
                          value={taskForm.instruction}
                          onChange={(e) =>
                            setTaskForm({ ...taskForm, instruction: e.target.value })
                          }
                          style={{
                            ...inputStyle,
                            fontSize: 13,
                            padding: "8px 12px",
                          }}
                        />
                        <input
                          type="text"
                          placeholder="Success criteria (e.g., 'Search results page is displayed')"
                          value={taskForm.successCriteria}
                          onChange={(e) =>
                            setTaskForm({ ...taskForm, successCriteria: e.target.value })
                          }
                          style={{
                            ...inputStyle,
                            fontSize: 13,
                            padding: "8px 12px",
                          }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <select
                            value={taskForm.category}
                            onChange={(e) =>
                              setTaskForm({ ...taskForm, category: e.target.value })
                            }
                            style={{
                              ...inputStyle,
                              fontSize: 13,
                              padding: "8px 12px",
                              flex: "none",
                              width: 180,
                            }}
                          >
                            <option value="navigation">Navigation</option>
                            <option value="search">Search</option>
                            <option value="form-fill">Form Fill</option>
                            <option value="multi-step">Multi-step</option>
                            <option value="information-extraction">Info Extraction</option>
                          </select>
                          <button
                            onClick={() => addManualTask(site.domain)}
                            style={{
                              ...btnStyle,
                              fontSize: 13,
                              backgroundColor: "#3b82f6",
                              border: "none",
                              color: "#fff",
                            }}
                          >
                            Add Task
                          </button>
                          <button
                            onClick={() => setAddingTask(null)}
                            style={{ ...btnStyle, fontSize: 13 }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Run buttons */}
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              marginBottom: 32,
              flexWrap: "wrap",
            }}
          >
            {totalConfiguredTasks > 0 && (
              <button onClick={() => handleRun(true)} style={primaryBtn(false)}>
                Run CUA Benchmark ({totalConfiguredTasks} tasks)
              </button>
            )}
            <button
              onClick={() => handleRun(false)}
              style={{
                ...primaryBtn(false),
                backgroundColor: totalConfiguredTasks > 0 ? "#333" : "#3b82f6",
              }}
            >
              Run with Sample Tasks
            </button>
          </div>

          {/* Previous Runs */}
          {history.length > 0 && (
            <div
              style={{
                backgroundColor: "#111",
                border: "1px solid #222",
                borderRadius: 8,
                padding: 24,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
                Previous Runs
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map((run) => {
                  const isExpanded = expandedRun === run.id;
                  const successDelta = run.improvement?.successRateDelta;
                  const tokenReduction = run.improvement?.tokenReduction;
                  return (
                    <div
                      key={run.id}
                      style={{
                        backgroundColor: "#0a0a0a",
                        border: "1px solid #222",
                        borderRadius: 6,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "12px 16px",
                          cursor: "pointer",
                        }}
                        onClick={() => toggleExpandRun(run.id)}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <span style={{ color: "#888", fontSize: 12 }}>
                            {new Date(run.timestamp).toLocaleString()}
                          </span>
                          <span style={{ fontSize: 13 }}>
                            {run.tasksTotal} task{run.tasksTotal !== 1 ? "s" : ""}
                          </span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>
                            {(run.successRateBaseline * 100).toFixed(0)}% baseline
                          </span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>
                            {(run.successRateWithDocs * 100).toFixed(0)}% w/ docs
                          </span>
                          {successDelta != null && (
                            <span
                              style={{
                                fontSize: 12,
                                color: successDelta > 0 ? "#22c55e" : successDelta < 0 ? "#ef4444" : "#888",
                                fontWeight: 600,
                              }}
                            >
                              {successDelta > 0 ? "+" : ""}
                              {(successDelta * 100).toFixed(1)}pp
                            </span>
                          )}
                          {tokenReduction != null && (
                            <span
                              style={{
                                fontSize: 12,
                                color: tokenReduction > 0 ? "#22c55e" : "#ef4444",
                              }}
                            >
                              {tokenReduction > 0 ? "-" : "+"}
                              {Math.abs(tokenReduction).toFixed(0)}% tokens
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRun(run.id);
                            }}
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
                          <span style={{ color: "#555", fontSize: 14 }}>
                            {isExpanded ? "\u25B2" : "\u25BC"}
                          </span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: "0 16px 16px" }}>
                          {expandedResult ? (
                            <BenchmarkResults result={expandedResult} />
                          ) : (
                            <p style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 12 }}>
                              Loading details...
                            </p>
                          )}
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
            CUA Benchmark Running
          </div>
          <p style={{ color: "#888", marginBottom: 8 }}>{status.phase}</p>
          {status.tasksTotal != null && status.tasksTotal > 0 && (
            <p style={{ color: "#666", fontSize: 14 }}>
              Tasks: {status.tasksCompleted || 0} / {status.tasksTotal}
            </p>
          )}
          <div
            style={{
              width: 200,
              height: 4,
              backgroundColor: "#333",
              borderRadius: 2,
              margin: "20px auto",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width:
                  status.tasksTotal && status.tasksTotal > 0
                    ? `${((status.tasksCompleted || 0) / (status.tasksTotal * 2)) * 100}%`
                    : "10%",
                height: "100%",
                backgroundColor: "#3b82f6",
                borderRadius: 2,
                transition: "width 0.5s",
              }}
            />
          </div>
          <p style={{ color: "#555", fontSize: 12, marginTop: 16 }}>
            Claude CUA is controlling a real browser with screenshots. This may take several minutes.
          </p>
        </div>
      )}

      {/* Error */}
      {status.state === "error" && (
        <>
          <ErrorBox error={status.error} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <button onClick={() => setStatus({ state: "idle" })} style={btnStyle}>
              Back to Setup
            </button>
            <button onClick={() => handleRun(totalConfiguredTasks > 0)} style={primaryBtn(false)}>
              Retry
            </button>
          </div>
        </>
      )}

      {/* Results */}
      {status.state === "done" && status.result && (
        <div>
          <BenchmarkResults result={status.result} />
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
            <button onClick={() => setStatus({ state: "idle" })} style={btnStyle}>
              Back to Setup
            </button>
            <button onClick={() => handleRun(totalConfiguredTasks > 0)} style={primaryBtn(false)}>
              Run Again
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Benchmark Results Component ─────────────────────────────────────

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
